// Isolated UI/API acceptance test: no edits to the normal dev/play libraries or connections.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import sharp from 'sharp';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/n_tin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const folder = mkdtempSync(join(tmpdir(), 'storyweaver-media-'));
const config = join(folder, 'config'), data = join(folder, 'data'); mkdirSync(config); mkdirSync(data);
const png = await sharp({ create: { width: 960, height: 640, channels: 3, background: '#304958' } }).png().toBuffer();
let child, browser, output = '', queues = 0;
const provider = createServer(async (request, response) => {
  const send = body => response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
  if (request.url === '/object_info') { const graph = JSON.parse(readFileSync('AI/Comfy Workflow/portrait.comfy-desktop.api.json', 'utf8')); return send(Object.fromEntries(Object.values(graph).map(n => [n.class_type, { input: { required: {} } }]))); }
  if (request.url === '/prompt') { for await (const _ of request) {} queues++; return send({ prompt_id: 'media-preview' }); }
  if (request.url === '/history/media-preview') return send({ 'media-preview': { status: { completed: true }, outputs: { '9': { images: [{ filename: 'crew.png' }] } } } });
  if (request.url.startsWith('/view?')) return response.writeHead(200, { 'Content-Type': 'image/png' }).end(png);
  response.writeHead(404).end();
});
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let base;
async function stop() { if (!child) return; const current = child; child = undefined; if (current.exitCode !== null) return; const exited = new Promise(resolve => current.once('exit', resolve)); current.kill('SIGKILL'); await exited; }
async function start(port) {
  output = '';
  child = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { windowsHide: true, env: { ...process.env, STORY_INSTANCE: 'media-test', STORY_DATA_DIR: data, STORY_CONFIG_DIR: config, STORY_VITE_CACHE: join(folder, 'vite-cache') }, stdio: ['ignore','pipe','pipe'] });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => output = (output + chunk).slice(-16000));
  for (let i = 0; i < 120; i++) { if (child.exitCode !== null) throw new Error(output); try { const r = await fetch(base + '/api/stories'); if (r.ok) return; } catch {} await pause(200); }
  throw new Error('App startup timed out: ' + output);
}
async function json(path, options) { const response = await fetch(base + path, options); const body = await response.json(); assert.equal(response.ok, true, JSON.stringify(body)); return body; }
const post = (path, body) => json(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
try {
  await listen(provider); const probe = createServer(); await listen(probe); const port = probe.address().port; await new Promise(resolve => probe.close(resolve)); base = `http://127.0.0.1:${port}`;
  const settings = JSON.parse(readFileSync('config/connections.example.json', 'utf8')); settings.images.baseUrl = `http://127.0.0.1:${provider.address().port}`; settings.images.workflow = 'AI/Comfy Workflow/portrait.comfy-desktop.api.json';
  writeFileSync(join(config, 'connections.dev.local.json'), JSON.stringify(settings));
  await start(port);
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } }), errors = [];
  page.setDefaultTimeout(15000); console.log('Isolated media app ready.');
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base); await page.waitForLoadState('networkidle');
  const initial = (await json('/api/stories'))[0];
  await page.getByRole('button', { name: 'Gallery', exact: true }).click();
  await page.getByRole('button', { name: 'Add a picture', exact: true }).click();
  await page.getByLabel('Caption', { exact: true }).fill('The crew at Halcyon');
  await page.getByLabel('Elias Voss', { exact: true }).check(); await page.getByLabel('Mira Sol', { exact: true }).check();
  let s = await json('/api/stories/' + initial.id);
  await page.getByLabel(/^Source passage/).selectOption(s.passages.at(-1).id);
  await page.getByLabel(/^Upload PNG/).setInputFiles({ name: 'crew.png', mimeType: 'image/png', buffer: png });
  await page.getByRole('button', { name: 'Save uploaded picture', exact: true }).click();
  await page.getByText('Picture saved to the story library.', { exact: true }).waitFor();
  s = await json('/api/stories/' + initial.id); assert.equal(s.media.assets.length, 1); const first = s.media.assets[0];
  console.log('Upload saved; checking portrait selections and viewer.');
  const portrait = page.locator('.media-selection').filter({ has: page.getByText('Elias Voss', { exact: true }) });
  await portrait.getByRole('button', { name: 'Set as portrait', exact: true }).click();
  await portrait.getByRole('button', { name: 'Clear current portrait', exact: true }).waitFor();
  await portrait.getByRole('button', { name: 'Use as identity reference', exact: true }).click();
  await portrait.getByRole('button', { name: 'Clear identity reference', exact: true }).waitFor();
  await page.getByRole('button', { name: 'View & zoom', exact: true }).click();
  await page.locator('.pswp--open').waitFor(); await page.keyboard.press('Escape'); await page.locator('.pswp--open').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Add a variant', exact: true }).click();
  assert.equal(await page.getByLabel(/^Variant of/).inputValue(), first.id);
  await page.getByLabel('Caption', { exact: true }).fill('Another portrait');
  await page.getByLabel('Elias Voss', { exact: true }).check();
  await page.getByLabel(/^Upload PNG/).setInputFiles({ name: 'portrait.png', mimeType: 'image/png', buffer: png });
  await page.getByRole('button', { name: 'Save uploaded picture', exact: true }).click(); await page.getByText('Picture saved to the story library.', { exact: true }).waitFor();
  s = await json('/api/stories/' + initial.id); assert.equal(s.media.assets[1].parentId, first.id);
  await page.getByRole('button', { name: 'Set as portrait', exact: true }).click(); await page.getByRole('button', { name: 'Clear current portrait', exact: true }).waitFor();
  s = await json('/api/stories/' + initial.id); assert.equal(s.media.references.elias, first.id); assert.equal(s.media.portraits.elias, s.media.assets[1].id);
  console.log('Variant saved; checking ComfyUI preview promotion.');
  // A real pipeline execution against a local mock, then explicit promotion into the story.
  const publicConfig = await json('/api/connections');
  const job = await post('/api/image-tests', { images: publicConfig.images, prompt: 'Crew on the bridge', negative: '', template: '{{image.scene}}', variables: { 'image.scene': 'Crew on the bridge' }, requestId: randomUUID() });
  const ready = await json('/api/image-tests/' + job.id); assert.equal(ready.status, 'complete'); assert.equal(queues, 1);
  await page.getByRole('button', { name: 'Add a picture', exact: true }).click(); await page.getByLabel('Caption', { exact: true }).fill('A generated moment');
  await page.getByLabel('Mira Sol', { exact: true }).check(); await page.getByRole('button', { name: 'Refresh completed preview', exact: true }).click();
  await page.getByRole('button', { name: 'Save preview to story', exact: true }).click(); await page.getByText('Picture saved to the story library.', { exact: true }).waitFor();
  s = await json('/api/stories/' + initial.id); assert.equal(s.media.assets[2].provenance.prompt, 'Crew on the bridge'); assert.equal(s.media.assets[2].provenance.template, '{{image.scene}}'); assert.ok(s.media.assets[2].provenance.graph);
  await json('/api/image-tests', { method: 'DELETE' });
  assert.equal((await fetch(base + `/api/stories/${s.id}/media/${s.media.assets[2].id}`)).status, 200);
  await page.getByRole('button', { name: 'Read', exact: true }).click(); await page.getByRole('button', { name: 'Photobook', exact: true }).click();
  assert.equal(await page.locator('.photobook-mini img').count(), 2); assert.equal(await page.locator('.portrait-avatar').count(), 1);
  await page.getByRole('button', { name: 'Open photobook & add pictures ↗', exact: true }).click(); assert.equal(await page.getByLabel(/^Depicted subject/).inputValue(), 'elias');
  await page.getByLabel(/^Depicted subject/).selectOption('mira'); assert.equal(await page.locator('.media-card').count(), 2);
  await page.getByRole('button', { name: 'Picture details: The crew at Halcyon', exact: true }).click();
  await page.getByRole('button', { name: 'Read source passage ↗', exact: true }).click(); assert.equal(await page.locator('.passage-art img').count(), 1);
  // Latest revision marks old illustrations as history without removing their bytes.
  s = await json('/api/stories/' + initial.id);
  s = await json('/api/stories/' + s.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: s.revision, requestId: randomUUID(), action: { type: 'sample-replace', passageId: s.passages.at(-1).id } }) });
  assert.equal(s.media.assets[0].status, 'superseded');
  const archive = await (await fetch(base + `/api/stories/${s.id}/export`)).arrayBuffer();
  const imported = await json('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: archive });
  assert.deepEqual(imported.media, s.media); assert.notEqual(imported.id, s.id);
  await stop(); await start(port); assert.deepEqual((await json('/api/stories/' + imported.id)).media, imported.media);
  await page.goto(base); await page.waitForLoadState('networkidle'); await page.getByRole('button', { name: 'Gallery', exact: true }).click();
  assert.equal(await page.locator('.media-card').count(), 3);
  const audit = await json('/api/dev/media'); assert.equal(audit.missing.length, 0); assert.equal(audit.corrupt.length, 0); assert.equal(audit.unreferenced.length, 0); assert.equal(audit.records, 6); assert.equal(audit.originals, 1);
  mkdirSync('test-results', { recursive: true }); await page.screenshot({ path: 'test-results/media-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 320, height: 884 }); await page.getByRole('button', { name: 'Picture details: The crew at Halcyon', exact: true }).click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); await page.screenshot({ path: 'test-results/media-mobile.png', fullPage: true });
  assert.deepEqual(errors, []); console.log('Media smoke passed: upload, shared photobooks, portraits/references, variants, viewer, Comfy promotion/clear, source navigation/replacement, isolated ZIP import, restart, integrity audit and 320px layout.');
} finally {
  await browser?.close(); await stop(); provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve));
  const target = resolve(folder); if ((target.startsWith(resolve(tmpdir()) + '\\') || target.startsWith(resolve(tmpdir()) + '/')) && basename(target).startsWith('storyweaver-media-')) rmSync(target, { recursive: true, force: true });
}
