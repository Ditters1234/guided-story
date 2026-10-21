import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { zipSync, strToU8 } from 'fflate';

test('Git audit inspects isolated staged objects, blocks private paths and finds credentials inside text and ZIPs without echoing them', { skip: !existsSync('.git') }, () => {
  const folder = mkdtempSync(join(tmpdir(), 'story-git-audit-'));
  try {
    const objects = join(folder, 'objects'); mkdirSync(objects);
    const alternate = resolve(execFileSync('git', ['rev-parse', '--git-path', 'objects'], { encoding: 'utf8' }).trim());
    let sequence = 0;
    function audit(path: string, content: string | Uint8Array) {
      // Never modify the real index or object store, and never create a commit.
      const env = { ...process.env, GIT_INDEX_FILE: join(folder, `index-${sequence++}`), GIT_OBJECT_DIRECTORY: objects, GIT_ALTERNATE_OBJECT_DIRECTORIES: alternate };
      execFileSync('git', ['read-tree', '--empty'], { env });
      const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], { env, input: content, encoding: 'utf8' }).trim();
      execFileSync('git', ['update-index', '--add', '--cacheinfo', '100644', blob, path], { env });
      return spawnSync(process.execPath, ['scripts/git-audit.mjs'], { env, encoding: 'utf8' });
    }
    const safe = audit('docs/audit-test.md', 'A fictional development note.');
    assert.equal(safe.status, 0, safe.stderr);
    const privateFile = audit('config/connections.audit.local.json', '{}');
    assert.equal(privateFile.status, 1); assert.match(privateFile.stderr, /private|ignore/);
    const sentinel = 'sk-' + 'A'.repeat(30);
    for (const [path, bytes] of [
      ['src/audit-test.ts', `const credential = '${sentinel}';`],
      ['exports/scoping-stress-test/audit-test.zip', zipSync({ 'story.json': strToU8(JSON.stringify({ credential: sentinel })) })]
    ] as const) {
      const result = audit(path, bytes);
      assert.equal(result.status, 1); assert.match(result.stderr, /possible credential/);
      assert.ok(!(result.stdout + result.stderr).includes(sentinel));
    }
    const privateZip = audit('exports/scoping-stress-test/audit-test.zip', zipSync({ 'connections.local.json': strToU8('{}') }));
    assert.equal(privateZip.status, 1); assert.match(privateZip.stderr, /private archive entry/);
  } finally {
    assert.ok(resolve(folder).startsWith(resolve(tmpdir()) + '\\'));
    rmSync(folder, { recursive: true, force: true });
  }
});
