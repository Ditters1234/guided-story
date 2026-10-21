import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, mkdirSync, unlinkSync, rmdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { atomicWriteFile } from '../src/lib/server/atomic-files';
test('atomic writes replace whole files and remove only their own staging file on failure', () => {
  const folder = mkdtempSync(join(tmpdir(), 'guided-atomic-')), file = join(folder, 'settings.json'), directory = join(folder, 'directory');
  try {
    atomicWriteFile(file, 'long previous contents'); atomicWriteFile(file, 'new'); assert.equal(readFileSync(file, 'utf8'), 'new');
    mkdirSync(directory); assert.throws(() => atomicWriteFile(directory, 'cannot replace directory')); assert.deepEqual(readdirSync(folder).sort(), ['directory', 'settings.json']);
    assert.equal(readFileSync(file, 'utf8'), 'new');
  } finally { if (existsSync(file)) unlinkSync(file); if (existsSync(directory)) rmdirSync(directory); rmdirSync(folder); }
});
