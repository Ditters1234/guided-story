// Isolated foundation recovery test: private temporary data/config/cache and mock services.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { resolve, join, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const folder = mkdtempSync(join(tmpdir(), 'storyweaver-restart-'));
const config = join(folder, 'config'), data = join(folder, 'data'); mkdirSync(config); mkdirSync(data);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
let queued = 0, wrongEndpoint = 0, historyReady = false, child, appOutput = '', textPending = false;
const sockets = new Set();
const provider = createServer(async (req, res) => {
  const send = body => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
  if (req.url === '/object_info') { const graph = JSON.parse(readFileSync('AI/Comfy Workflow/portrait.comfy-desktop.api.json', 'utf8')); return send(Object.fromEntries(Object.values(graph).map(n => [n.class_type, { input: { required: {} } }]))); }
  if (req.url === '/prompt') { for await (const part of req) {} queued++; return send({ prompt_id: 'persistent-prompt' }); }
  if (req.url === '/history/persistent-prompt') return send(historyReady ? { 'persistent-prompt': { status: { completed: true }, outputs: { '9': { images: [{ filename: 'test.png' }] } } } } : {});
  if (req.url.startsWith('/view?')) return res.writeHead(200, { 'Content-Type': 'image/png' }).end(png);
  if (req.url === '/v1/chat/completions') { for await (const part of req) {} textPending = true; return; }
  res.writeHead(404).end();
});
provider.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
const other = createServer((req, res) => { wrongEndpoint++; res.writeHead(503).end(); });
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function stop() { if (!child) return; const current = child; child = undefined; if (current.exitCode !== null) return; const exited = new Promise(resolve => current.once('exit', resolve)); current.kill('SIGKILL'); await exited; }
let base;
async function start(port) {
  appOutput = '';
  child = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: resolve('.'), windowsHide: true, env: { ...process.env, STORY_INSTANCE: 'restart-test', STORY_DATA_DIR: data, STORY_CONFIG_DIR: config, STORY_VITE_CACHE: join(folder, 'vite-cache') }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => appOutput = (appOutput + chunk).slice(-15000));
  for (let n = 0; n < 100; n++) { if (child.exitCode !== null) throw new Error('Isolated server exited: ' + appOutput); try { const r = await fetch(base + '/api/connections'); if (r.ok) return; } catch { /* Await startup. */ } await pause(200); }
  throw new Error('Isolated server did not start: ' + appOutput);
}
async function json(path, init) { const response = await fetch(base + path, init); const body = await response.json(); assert.equal(response.ok, true, JSON.stringify(body)); return body; }
const post = (path, body) => json(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
try {
  await listen(provider); await listen(other);
  const probe = createServer(); await listen(probe); const port = probe.address().port; await new Promise(resolve => probe.close(resolve)); base = `http://127.0.0.1:${port}`;
  const settings = JSON.parse(readFileSync('config/connections.example.json', 'utf8'));
  settings.images.baseUrl = `http://127.0.0.1:${provider.address().port}`;
  settings.text.baseUrl = settings.images.baseUrl + '/v1'; settings.text.model = 'qa-held-model'; settings.text.apiKey = 'qa-restart-key';
  writeFileSync(join(config, 'connections.dev.local.json'), JSON.stringify(settings));
  await start(port);
  const publicSettings = await json('/api/connections');
  const imageInput = { images: publicSettings.images, prompt: 'A fully clothed adult portrait.', negative: '', requestId: randomUUID() };
  const image = await post('/api/image-tests', imageInput);
  assert.equal(image.status, 'queued'); assert.equal(queued, 1);
  assert.equal((await post('/api/image-tests', imageInput)).id, image.id); assert.equal(queued, 1);
  const heldText = post('/api/connections/text-test', { text: publicSettings.text, system: 'Test only.', prompt: 'Wait for interruption.' }).catch(() => null);
  for (let n = 0; n < 100 && !textPending; n++) await pause(50);
  assert.equal(textPending, true);
  const before = await json('/api/dev/jobs'); const textJob = before.jobs.find(j => j.kind === 'text-test'); assert.equal(textJob.state, 'generating');
  await stop(); await heldText;
  // Changing the active connection must not redirect an existing provider job.
  settings.images.baseUrl = `http://127.0.0.1:${other.address().port}`; writeFileSync(join(config, 'connections.dev.local.json'), JSON.stringify(settings)); historyReady = true;
  await start(port);
  const restarted = await json('/api/dev/jobs'); assert.equal(restarted.jobs.find(j => j.id === textJob.id).state, 'interrupted');
  const recovered = await json('/api/image-tests/' + image.id); assert.equal(recovered.status, 'complete'); assert.equal(queued, 1); assert.equal(wrongEndpoint, 0);
  assert.equal((await post('/api/image-tests', imageInput)).id, image.id); assert.equal(queued, 1);
  assert.deepEqual(Buffer.from(await (await fetch(base + recovered.images[0])).arrayBuffer()), png);
  await stop(); await start(port);
  const reopened = await json('/api/image-tests/' + image.id); assert.equal(reopened.status, 'complete');
  assert.deepEqual(Buffer.from(await (await fetch(base + reopened.images[0])).arrayBuffer()), png);
  assert.equal(queued, 1); assert.equal(wrongEndpoint, 0);
  const details = await json('/api/dev/jobs/' + textJob.id); assert.ok(!JSON.stringify(details).includes('qa-restart-key'));
  const orphan = join(data, 'test-images', image.id + '-0.img.' + randomUUID() + '.tmp'); writeFileSync(orphan, 'QA interrupted staging file');
  assert.equal((await json('/api/image-tests')).stagingCount, 1);
  const cleared = await json('/api/image-tests', { method: 'DELETE' }); assert.equal(cleared.stagingCount, 0); assert.equal(cleared.count, 0);
  console.log('PASS: real server restarts interrupt text, restore ComfyUI prompt IDs against the original endpoint, avoid duplicate submission, and retain completed image previews without touching dev/play data or settings.');
} finally {
  await stop(); for (const socket of sockets) socket.destroy(); await new Promise(resolve => provider.close(resolve)); await new Promise(resolve => other.close(resolve));
  // Verify the absolute recursive cleanup target stays in this test's temporary directory.
  const full = resolve(folder); if (dirname(full) !== resolve(tmpdir()) || !basename(full).startsWith('storyweaver-restart-')) throw new Error('Unsafe test cleanup path.');
  rmSync(full, { recursive: true, force: true });
}
