// Isolated production acceptance for unfinished setup portability. Build first.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve, join, basename, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';

const require = createRequire(import.meta.url), { chromium } = require('C:/Users/n_tin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const folder = mkdtempSync(join(tmpdir(), 'storyweaver-setup-archive-')), data = join(folder, 'data'), config = join(folder, 'config'); mkdirSync(data); mkdirSync(config);
let child, browser, base, output = '';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function api(path, init) {
  const response = await fetch(base + path, { ...init, headers: { ...(init?.method ? { Origin: base } : {}), ...init?.headers }, signal: AbortSignal.timeout(10000) });
  const body = await response.json(); assert.equal(response.ok, true, JSON.stringify(body)); return body;
}
const send = (path, body, method = 'POST') => api(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
async function stop() { if (!child || child.exitCode !== null) return; const done = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGKILL'); await done; }
try {
  const probe = createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve)); base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['scripts/start-production.mjs'], { windowsHide: true, env: { ...process.env, STORY_PORT: String(port), STORY_DATA_DIR: data, STORY_CONFIG_DIR: config, STORY_SEED_SAMPLE: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => output = (output + chunk).slice(-12000));
  for (let n = 0; n < 120; n++) { if (child.exitCode !== null) throw new Error(output); try { if ((await fetch(base + '/api/setups')).ok) break; } catch {} if (n === 119) throw new Error(output); await pause(200); }
  const premise = await send('/api/setups', { requestId: randomUUID(), input: { premise: 'A detective receives an impossible letter.', title: 'An unwritten mystery' } });
  let setup = await send('/api/setups', { requestId: randomUUID(), input: { premise: 'A courier crew investigates a vanished delivery.', title: 'The Missing Manifest', adultContent: true } });
  const person = randomUUID(), place = randomUUID(), item = randomUUID();
  const plan = { title: 'The Missing Manifest', chapterTitle: 'An empty berth', canon: { characters: [{ id: person, name: 'Ari', role: 'Courier', notes: 'Investigates quietly.', appearance: 'Dark eyes.', outfit: 'A wool jacket.', locationId: place, noNsfw: false, pinnedAppearance: true }], places: [{ id: place, name: 'Port Nine', description: 'A cold working port.', parentId: null }], items: [{ id: item, name: 'Copper key', description: 'A worn key.', quantity: 3, ownerId: person, equipped: false }], relationships: [], threads: [], funds: 50, cargoNotes: '' }, context: { sceneBrief: { purpose: 'Inspect the empty berth.', tension: 'The boat is missing.', stopAt: 'The first clue.', viewpointId: person, locationId: place, castIds: [person], clearAfterPassage: false }, lore: [], knowledge: [], memories: [], compaction: { epoch: 0, chapters: [], book: null } } };
  plan.context.lore = [
    { id: 'setting', title: 'World foundations', text: 'An independent working port.', keywords: [], relatedIds: [], visibility: 'always' },
    { id: 'home-garden', title: 'Time around the house', text: 'The courier may rest at home between deliveries.', keywords: ['home'], relatedIds: [person, place, item], visibility: 'relevant' },
    { id: 'secret', title: 'A private route', text: 'A concealed tunnel leads under the port.', keywords: ['tunnel'], relatedIds: [place], visibility: 'hidden' }
  ];
  setup = await send('/api/setups/' + setup.id, { expectedRevision: 0, requestId: randomUUID(), input: setup.input, plan }, 'PATCH');
  assert.equal((await fetch(base + `/api/setups/${setup.id}/export?expectedRevision=${setup.revision}`)).status, 200);
  assert.equal((await fetch(base + `/api/setups/${setup.id}/export?expectedRevision=0`)).status, 409);
  for (const query of ['expectedRevision=', 'expectedRevision=-1', 'expectedRevision=1.5', 'expectedRevision=01', 'expectedRevision=9007199254740992', 'expectedRevision=1&expectedRevision=1']) assert.equal((await fetch(base + `/api/setups/${setup.id}/export?${query}`)).status, 400);
  browser = await chromium.launch({ channel: 'msedge', headless: true }); const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true }), errors = []; page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
  await page.goto(base); await page.getByRole('heading', { name: 'Unfinished setups', exact: true }).waitFor();
  const row = page.getByRole('region', { name: setup.plan.title, exact: true });
  const downloaded = page.waitForEvent('download'); await row.getByRole('button', { name: 'Export setup ZIP', exact: true }).click();
  const download = await downloaded, bytes = readFileSync(await download.path()), files = unzipSync(bytes);
  assert.deepEqual(Object.keys(files).sort(), ['manifest.json', 'setup.json']); assert.deepEqual(JSON.parse(strFromU8(files['setup.json'])), setup);
  const importInput = () => page.getByLabel('Import a setup ZIP', { exact: true });
  async function uploadSetup(name,bytes){const [response]=await Promise.all([page.waitForResponse(response=>response.url().endsWith('/api/setups/import')&&response.request().method()==='POST'),importInput().setInputFiles({name,mimeType:'application/zip',buffer:Buffer.from(bytes)})]);return response;}
  let imported = await (await uploadSetup('setup.zip',bytes)).json();
  await page.getByRole('heading', { name: 'Shape your story', exact: true }).waitFor(); assert.notEqual(imported.id, setup.id); assert.equal(imported.revision, 0); assert.deepEqual(imported.plan, setup.plan);
  // Imported plans must expose the original settings before any prose is generated.
  for (const label of ['Story idea', 'Narrator style', 'Art style', 'Words per passage', 'Target chapter words', 'Content notes & boundaries']) assert.equal(await page.getByLabel(label, { exact: true }).isVisible(), true, label);
  assert.equal(await page.getByLabel(/^Writing guide/).isVisible(), true);
  await page.getByLabel('Narrator style', { exact: true }).fill('A restrained mystery told through distinct voices.');
  await page.getByLabel('Words per passage', { exact: true }).fill('650');
  assert.equal(await page.getByLabel('No NSFW', { exact: true }).isChecked(), false); assert.equal(await page.getByLabel('Pin appearance & outfit', { exact: true }).isChecked(), true);
  await page.getByRole('group', { name: 'Setup sections' }).getByRole('button', { name: 'Background', exact: true }).click();
  await page.getByText(/^Background diagnostics ·/).click();
  assert.equal(await page.getByText(/Copper key · Quantity 3/).isVisible(), true);
  assert.equal(await page.getByLabel('Background title', { exact: true }).count(), 3);
  const hidden = page.getByRole('region', { name: 'Background · A private route', exact: true });
  assert.equal(await hidden.getByLabel('Background text', { exact: true }).inputValue(), plan.context.lore[2].text);
  assert.equal(await hidden.getByLabel(/^When to include/).inputValue(), 'hidden');
  const background = page.getByRole('region', { name: 'Background · Time around the house', exact: true });
  await background.getByLabel('Background text', { exact: true }).fill('Tea on the porch is an optional quiet afternoon activity.');
  await background.getByLabel(/^Keywords/).fill('tea, porch');
  await background.getByLabel(/^When to include/).selectOption('always');
  await background.getByLabel(/^Related records/).selectOption([place, item]);
  await background.getByLabel('Background title', { exact: true }).fill('A quiet afternoon');
  await page.getByRole('button', { name: 'Add background entry', exact: true }).click();
  await page.getByRole('region', { name: 'Background · New background', exact: true }).getByRole('button', { name: 'Remove background entry', exact: true }).click();
  assert.equal(await page.getByLabel('Background title', { exact: true }).count(), 3);
  await page.getByRole('button', { name: 'Add background entry', exact: true }).click();
  const added = page.getByRole('region', { name: 'Background · New background', exact: true });
  await added.getByLabel('Background text', { exact: true }).fill('Neighbors sometimes exchange recipes.');
  await added.getByLabel('Background title', { exact: true }).fill('Local customs');
  await page.getByRole('button', { name: 'Possessions', exact: true }).click();
  assert.equal(await page.getByRole('region', { name: 'Possession · Copper key', exact: true }).getByRole('button', { name: 'Remove item', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: 'Add possession', exact: true }).click();
  const supply = page.getByRole('region', { name: 'Possession · New possession', exact: true });
  await supply.getByLabel('Description', { exact: true }).fill('Small sugar cubes as pony treats in tin.');
  await supply.getByLabel('Always available (unlimited supply)', { exact: true }).check();
  assert.equal(await supply.getByLabel('Quantity', { exact: true }).isDisabled(), true);
  assert.equal(await supply.getByLabel('Equipped by its owner', { exact: true }).isDisabled(), true);
  await supply.getByLabel('Item name', { exact: true }).fill('Sugar Cubes');
  await page.getByLabel('Book title', { exact: true }).fill('Imported and revised');
  let dismissed = false; page.once('dialog', async dialog => { dismissed = true; await dialog.dismiss(); }); await page.getByRole('navigation', { name: 'Story navigation' }).getByRole('button', { name: 'Library', exact: true }).click(); assert.equal(dismissed, true); assert.equal(await page.getByLabel('Book title', { exact: true }).inputValue(), 'Imported and revised');
  const changedDownload = page.waitForEvent('download'); await page.getByRole('button', { name: 'Save & export setup ZIP', exact: true }).click(); const changedFiles = unzipSync(readFileSync(await (await changedDownload).path()));
  const changed = JSON.parse(strFromU8(changedFiles['setup.json'])); assert.equal(changed.plan.title, 'Imported and revised'); assert.equal(changed.input.narrationStyle, 'A restrained mystery told through distinct voices.'); assert.equal(changed.input.preferences.passageWords, 650); assert.equal(changed.revision, 1); assert.deepEqual(await api('/api/setups/' + imported.id), changed);
  assert.deepEqual(changed.plan.context.lore[1], { id: 'home-garden', title: 'A quiet afternoon', text: 'Tea on the porch is an optional quiet afternoon activity.', keywords: ['tea', 'porch'], relatedIds: [place, item], visibility: 'always' });
  assert.deepEqual(changed.plan.context.lore[2], plan.context.lore[2]);
  assert.equal(changed.plan.context.lore[3].title, 'Local customs'); assert.equal(changed.plan.context.lore[3].visibility, 'relevant');
  assert.equal(changed.plan.canon.items.find(item => item.name === 'Sugar Cubes').unlimited, true);
  assert.deepEqual(await api('/api/setups/' + setup.id), setup);
  await page.reload(); await page.getByRole('heading', { name: 'Shape your story', exact: true }).waitFor();
  await page.getByRole('group', { name: 'Setup sections' }).getByRole('button', { name: 'Background', exact: true }).click();
  assert.equal(await page.getByLabel('Background title', { exact: true }).count(), 4);
  assert.equal(await page.getByRole('region', { name: 'Background · A quiet afternoon', exact: true }).getByLabel('Background text', { exact: true }).inputValue(), changed.plan.context.lore[1].text);
  // Simulate another tab saving after this form saves but before its ZIP request reaches the server.
  await page.getByLabel('Book title', { exact: true }).fill('Saved before concurrent export');
  const conflictDownloads = [], recordConflictDownload = download => conflictDownloads.push(download);
  page.on('download', recordConflictDownload);
  const exportPath = `/api/setups/${imported.id}/export`, exportRoute = url => url.pathname === exportPath;
  await page.route(exportRoute, async route => {
    const requestedRevision = Number(new URL(route.request().url()).searchParams.get('expectedRevision'));
    const current = await api('/api/setups/' + imported.id);
    assert.equal(requestedRevision, current.revision);
    assert.equal(current.plan.title, 'Saved before concurrent export');
    await send('/api/setups/' + imported.id, { expectedRevision: current.revision, requestId: randomUUID(), input: { ...current.input, title: 'Concurrent edit in another tab' }, plan: { ...current.plan, title: 'Concurrent edit in another tab' } }, 'PATCH');
    await route.continue();
  });
  const [conflictResponse] = await Promise.all([page.waitForResponse(response => new URL(response.url()).pathname === exportPath), page.getByRole('button', { name: 'Save & export setup ZIP', exact: true }).click()]);
  assert.equal(conflictResponse.status(), 409);
  await page.getByRole('alert').filter({ hasText: 'changed after saving' }).waitFor();
  assert.equal(await page.getByLabel('Book title', { exact: true }).inputValue(), 'Saved before concurrent export');
  assert.equal((await api('/api/setups/' + imported.id)).plan.title, 'Concurrent edit in another tab');
  assert.equal(conflictDownloads.length, 0);
  await page.unroute(exportRoute); page.off('download', recordConflictDownload);
  await page.getByRole('button', { name: 'Show errors', exact: true }).click(); await page.getByRole('tabpanel', { name: /Errors/ }).getByText(/changed after saving/).first().waitFor(); await page.getByRole('button', { name: 'Collapse request viewer', exact: true }).click();
  await page.getByRole('navigation', { name: 'Story navigation' }).getByRole('button', { name: 'Library', exact: true }).click();
  const second = await (await uploadSetup('again.zip',bytes)).json(); assert.notEqual(second.id, imported.id); assert.deepEqual(second.plan, setup.plan);
  await page.getByRole('group', { name: 'Setup sections' }).getByRole('button', { name: 'Background', exact: true }).click(); await page.setViewportSize({ width: 320, height: 884 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); await page.setViewportSize({ width: 1280, height: 1000 });
  await page.getByRole('navigation', { name: 'Story navigation' }).getByRole('button', { name: 'Library', exact: true }).click();
  const premiseZip = new Uint8Array(await (await fetch(base + `/api/setups/${premise.id}/export`)).arrayBuffer());
  const premiseImport = await (await uploadSetup('premise.zip',premiseZip)).json();
  await page.getByRole('heading', { name: 'New story', exact: true }).waitFor(); assert.equal(premiseImport.plan, null); assert.equal(await page.getByLabel('Story idea', { exact: true }).inputValue(), premise.input.premise);
  await page.getByRole('navigation', { name: 'Story navigation' }).getByRole('button', { name: 'Library', exact: true }).click();
  assert.equal((await uploadSetup('broken.zip',Buffer.from('not a ZIP'))).status(), 400);
  await page.getByRole('alert').filter({ hasText: /archive|ZIP/ }).waitFor(); await page.getByRole('button', { name: 'Show errors', exact: true }).click(); await page.getByRole('tabpanel', { name: /Errors/ }).getByText(/archive|ZIP/).first().waitFor(); await page.getByRole('button', { name: 'Collapse request viewer', exact: true }).click();
  assert.deepEqual(await api('/api/stories'), []); assert.equal((await api('/api/dev/jobs')).jobs.length, 0); assert.equal((await api('/api/setups')).length, 5);
  await page.setViewportSize({ width: 320, height: 884 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.getByRole('navigation',{name:'Story navigation'}).getByRole('button',{name:'Help',exact:true}).click();await page.getByText(/In Records → Items, the Inventory browser groups possessions/).waitFor();await page.getByText(/Unfinished stories have separate Export setup ZIP and Import a setup ZIP/).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors, []);
  console.log('PASS: setup ZIPs, visible story settings, complete background editing including hidden entries, add/remove, keywords/links/visibility, saved reload and independent imports, content/pins, unsaved guard, concurrent export rejection, no AI jobs and mobile layout.');
} finally {
  await browser?.close(); await stop(); const target = resolve(folder); assert.ok(target.startsWith(resolve(tmpdir()) + sep) && basename(target).startsWith('storyweaver-setup-archive-')); rmSync(target, { recursive: true, force: true });
}
