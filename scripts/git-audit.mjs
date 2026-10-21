// Inspect the index, including text inside fixture ZIPs. Never print secret values.
import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const paths = git('ls-files', '--cached', '-z').split('\0').filter(Boolean);
if (!paths.length) { console.log('Git audit: no staged/tracked files.'); process.exit(0); }
const failures = [];
const ignored = spawnSync('git', ['check-ignore', '--no-index', '--stdin', '-z'], {
  input: paths.join('\0') + '\0', encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
});
if (ignored.error || ![0, 1].includes(ignored.status)) throw new Error('Cannot inspect index ignore rules.');
for (const path of ignored.stdout.split('\0').filter(Boolean)) failures.push(`${path}: tracked despite ignore rule`);

const secrets = new Set();
function collect(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (/^(apiKey|accessToken|refreshToken|password|secret|clientSecret)$/i.test(key) && typeof entry === 'string' && entry.length >= 8) secrets.add(entry);
    else collect(entry);
  }
}
for (const name of readdirSync('config').filter(name => name.includes('.local.') && name.endsWith('.json'))) {
  // Read only configured credential fields; values never appear in audit output.
  try { collect(JSON.parse(readFileSync(`config/${name}`, 'utf8'))); }
  catch { throw new Error('Cannot parse local connection settings for the Git audit. Contents are withheld.'); }
}
const token = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}/;
function inspect(path, bytes) {
  if (bytes.length > 5 * 1024 * 1024) failures.push(`${path}: unexpectedly large file; review before committing`);
  const text = Buffer.from(bytes).toString('utf8');
  if (token.test(text) || [...secrets].some(secret => text.includes(secret))) failures.push(`${path}: possible credential`);
}
for (const path of paths) {
  if (/(?:^|\/)(?:data|node_modules|references|test-results|unsloth-tmp|build|dist|\.git|\.ssh|\.aws|secrets|credentials)(?:\/|$)|\.local\.|(?:^|\/)\.env(?:\.|$)|\.(?:sqlite[^/]*|db|pem|key|p12|pfx)$/i.test(path)) failures.push(`${path}: private/generated path`);
  const bytes = execFileSync('git', ['show', `:${path}`], { maxBuffer: 32 * 1024 * 1024 });
  if (path.endsWith('.zip')) {
    if (!/^exports\/(scoping-stress-test|ranch-scope-test|red-willow-ranch)\//.test(path)) failures.push(`${path}: unreviewed archive`);
    for (const [name, content] of Object.entries(unzipSync(bytes))) {
      if (/\.local\.|(?:^|\/)\.env|\.(?:sqlite[^/]*|pem|key)$/i.test(name)) failures.push(`${path}: private archive entry`);
      inspect(`${path}::${name}`, content);
    }
  } else inspect(path, bytes);
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else console.log(`Git audit passed: ${paths.length} staged/tracked files; ignored paths, credential patterns, local credential values and fixture ZIP contents checked. This is a bounded scan, not a guarantee against every secret format.`);
