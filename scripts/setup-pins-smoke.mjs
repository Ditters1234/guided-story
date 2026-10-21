// node --import tsx scripts/setup-pins-smoke.mjs — isolated production setup-pin acceptance.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join, basename, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { blankSetupPlan } from '../src/lib/setup.ts';
import { normalizeCharacterProfile } from '../src/lib/character-profile.ts';

const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/n_tin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const folder = mkdtempSync(join(tmpdir(), 'storyweaver-setup-pins-')), data = join(folder, 'data'), config = join(folder, 'config');
mkdirSync(data); mkdirSync(config);
let child, browser, base, setup, output = '', calls = 0, openingCanon;
const ruleText = 'Couriers always carry a stamped delivery ledger.';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const provider = createServer(async (request, response) => {
  if (request.url !== '/v1/chat/completions') return response.writeHead(404).end();
  try {
    let raw = ''; for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw), system = body.messages[0].content, input = JSON.parse(body.messages[1].content);
    calls++;
    assert.ok(JSON.stringify(body.messages).includes(ruleText), 'Every setup request must include saved world rules.');
    const complete = content => response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }] }));
    if (system.startsWith('Reroll ONE novel')) {
      assert.equal(input.factPins.fields.find(pin => pin.field === 'name').value, 'Captain Mara');
      return complete({ name: 'Unwanted new name' });
    }
    if (system.startsWith('You design editable setup details')) {
      const { id, ...item } = input.current;
      return complete({ ...item, ownerId: input.cast[1].id });
    }
    if (system.startsWith('Return {effects:')) return complete({ effects: [], memory: { summary: 'The couriers examine the waiting ledger.', facts: ['The courier ledger remains aboard.'], openQuestions: ['Who sent the message?'], characterIds: openingCanon.characters.map(person => person.id), locationIds: [openingCanon.places[0].id] } });
    assert.ok(system.includes('There is no prior prose.'),system.slice(0,100));
    openingCanon = input.canon;
    assert.equal(input.factPins.fields.find(pin => pin.field === 'name').value, 'Captain Mara');
    return complete({ title: 'The waiting ledger', chapterTitle: setup.plan.chapterTitle, viewpointId: openingCanon.characters[0].id, endOfChapter: false, paragraphs: [
      'Captain Mara studied the delivery ledger inside her open courier bag. Ren waited by the door, listening to the loaders beyond the thin metal wall. Neither courier had expected a delivery before dawn, and the address was absent. The sealed message beside the bag bore a pale square where a stamp should have been.',
      'A bell rang somewhere along the wharf. Ren watched the window through its thin curtain. The ledger remained inside the bag, its familiar brass clasp catching a narrow reflection from the lamp. Mara considered the missing address and asked whether the sender might still be waiting outside. Ren listened for footsteps in the corridor before answering.'
    ] });
  } catch (error) { console.error('Mock setup provider failed:',String(error));response.writeHead(500).end(String(error)); }
});
async function request(path, init) {
  const response = await fetch(base + path, { ...init, headers: { ...(init?.method ? { Origin: base } : {}), ...init?.headers }, signal: AbortSignal.timeout(20000) });
  return { response, body: await response.json() };
}
async function api(path, init) { const result = await request(path, init); assert.equal(result.response.ok, true, JSON.stringify(result.body)); return result.body; }
const send = (path, body, method = 'POST') => api(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
async function start(port) {
  output = ''; child = spawn(process.execPath, ['scripts/start-production.mjs'], { windowsHide: true, env: { ...process.env, STORY_PORT: String(port), STORY_DATA_DIR: data, STORY_CONFIG_DIR: config, STORY_SEED_SAMPLE: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => output = (output + chunk).slice(-16000));
  for (let n = 0; n < 120; n++) { if (child.exitCode !== null) throw new Error(output); try { if ((await fetch(base + '/api/setups')).ok) return; } catch {} await pause(200); }
  throw new Error('Startup timed out: ' + output);
}
async function stop() { if (!child || child.exitCode !== null) return; const done = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGKILL'); await done; }
try {
  await listen(provider); const probe = createServer(); await listen(probe); const port = probe.address().port; await new Promise(resolve => probe.close(resolve)); base = `http://127.0.0.1:${port}`;
  const connections = JSON.parse(readFileSync('config/connections.example.json', 'utf8'));
  connections.text = { ...connections.text, baseUrl: `http://127.0.0.1:${provider.address().port}/v1`, model: 'qa-setup-pins', apiKey: '', maxTokens: 4096, contextTokens: 65536, structuredOutput: 'prompt' };
  connections.images.baseUrl = 'http://127.0.0.1:1'; writeFileSync(join(config, 'connections.play.local.json'), JSON.stringify(connections));
  await start(port);
  setup = await send('/api/setups', { requestId: randomUUID(), input: { premise: 'Two couriers receive a mysterious ledger.', preferences: { passageWords: 100 } } });
  const plan = blankSetupPlan(), first = plan.canon.characters[0], place = plan.canon.places[0];
  plan.title = 'A courier ledger'; first.name = 'Mara'; place.name = 'The Kite';
  const second = normalizeCharacterProfile({ ...structuredClone(first), id: randomUUID(), name: 'Ren' }), bagId = randomUUID(), ledgerId = randomUUID(), threadId = randomUUID();
  plan.canon.characters.push(second);
  plan.canon.items.push({ id: bagId, name: 'Courier bag', description: 'A canvas satchel.', ownerId: first.id, quantity: 1, equipped: false, isContainer: true }, { id: ledgerId, name: 'Delivery ledger', description: 'A stamped book.', ownerId: bagId, quantity: 1, equipped: false });
  plan.canon.threads.push({ id: threadId, title: 'A removable question', notes: '', status: 'open' });
  setup = await send('/api/setups/' + setup.id, { expectedRevision: setup.revision, requestId: randomUUID(), input: setup.input, plan }, 'PATCH');
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true }), errors = [];
  page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
  const nav = name => page.getByRole('navigation', { name: 'Story navigation' }).getByRole('button', { name, exact: true });
  const tab = name => page.getByRole('group', { name: 'Setup sections' }).getByRole('button', { name, exact: true });
  const pins = () => page.getByRole('region', { name: 'Setup pins and world rules', exact: true });
  const save = async () => { await page.getByRole('button', { name: 'Save setup draft', exact: true }).first().click(); await page.getByText('Setup saved locally.', { exact: true }).waitFor(); setup = await api('/api/setups/' + setup.id); };
  async function addPin(kind, recordId, field) {
    await pins().getByLabel('Record type', { exact: true }).selectOption(kind);
    if (kind !== 'world') await pins().getByLabel('Record', { exact: true }).selectOption(recordId);
    await pins().getByLabel('Field', { exact: true }).selectOption(field);
    await pins().getByRole('button', { name: 'Pin selected field', exact: true }).click();
  }
  await page.goto(base); await page.getByRole('button', { name: 'Resume setup ↗', exact: true }).click();
  await tab('Pins & rules').click(); await addPin('character', first.id, 'name'); await addPin('item', ledgerId, 'rootOwnerId'); await addPin('thread', threadId, 'title');
  await pins().getByRole('button', { name: 'Add world rule', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Save setup draft', exact: true }).first().isDisabled(), true);
  await pins().getByLabel('World rule 1', { exact: true }).fill(ruleText);
  assert.equal(await page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); dispatchEvent(event); return event.defaultPrevented; }), true);
  page.once('dialog', dialog => dialog.dismiss()); await nav('Library').click(); await pins().waitFor();
  await save(); assert.equal(setup.plan.factPins.fields.length, 3); assert.equal(setup.plan.factPins.rules[0].text, ruleText);
  assert.equal(await page.getByRole('button', { name: 'Regenerate cast & world', exact: true }).isDisabled(), true);
  // Manual edits establish the new protected value. Name-only AI rerolls cannot bypass it.
  await tab('Cast').click(); await page.getByLabel('Name', { exact: true }).first().fill('Captain Mara'); await save();
  await tab('Pins & rules').click(); await pins().locator('.pin-card').filter({ hasText: 'Captain Mara · Name' }).getByText('Captain Mara', { exact: true }).waitFor();
  await tab('Cast').click(); await page.getByRole('button', { name: 'Reroll name', exact: true }).first().click();
  await page.getByRole('alert').filter({ hasText: /Pinned name/ }).waitFor(); assert.deepEqual(await api('/api/setups/' + setup.id), setup);
  await page.getByRole('button', { name: 'Show errors', exact: true }).click(); await page.getByRole('tabpanel', { name: /Errors/ }).getByText(/Pinned name/).first().waitFor(); await page.getByRole('button', { name: 'Collapse request viewer', exact: true }).click();
  const beforeRegeneration = calls;
  const blocked = await request(`/api/setups/${setup.id}/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: setup.revision, requestId: randomUUID() }) });
  assert.equal(blocked.response.status, 409); assert.equal(calls, beforeRegeneration);
  const moved = await request(`/api/setups/${setup.id}/design`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: setup.revision, requestId: randomUUID(), kind: 'item', mode: 'revise', targetId: bagId, direction: 'Give the courier bag to Ren.' }) });
  assert.equal(moved.response.ok, false); assert.match(moved.body.error, /Pinned ultimate owner/); assert.deepEqual(await api('/api/setups/' + setup.id), setup);
  await tab('Story threads').click(); assert.equal(await page.getByRole('button', { name: 'Remove thread', exact: true }).isDisabled(), true);
  await tab('Pins & rules').click(); await pins().getByRole('button', { name: 'Unpin A removable question: Title', exact: true }).click();
  await tab('Story threads').click(); await page.getByRole('button', { name: 'Remove thread', exact: true }).click(); await save();
  await tab('Pins & rules').click(); await page.setViewportSize({ width: 320, height: 884 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); mkdirSync('test-results', { recursive: true }); await page.screenshot({ path: 'test-results/setup-pins-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 1000 });
  const downloadEvent = page.waitForEvent('download'); await page.getByRole('button', { name: 'Save & export setup ZIP', exact: true }).click();
  const zip = readFileSync(await (await downloadEvent).path()), exported = JSON.parse(strFromU8(unzipSync(zip)['setup.json'])); assert.deepEqual(exported.plan.factPins, setup.plan.factPins);
  const imported = await api('/api/setups/import', { method: 'POST', body: zip }); assert.notEqual(imported.id, setup.id); assert.deepEqual(imported.plan.factPins, setup.plan.factPins);
  const openingResponse=page.waitForResponse(r=>r.url().endsWith('/opening')&&r.request().method()==='POST');
  await page.getByRole('button', { name: 'Begin chapter one', exact: true }).click();
  const opening=await openingResponse;assert.equal(opening.ok(),true,await opening.text());
  await page.getByRole('heading', { name: 'The waiting ledger', exact: true }).waitFor();
  const story = await api('/api/stories/' + setup.id); assert.deepEqual(story.factPins, setup.plan.factPins); assert.equal(story.canon.items.find(item => item.id === ledgerId).ownerId, bagId);
  await nav('Pins').click(); await page.getByRole('heading', { name: 'Fact pins & world rules', exact: true }).waitFor(); await page.getByLabel('World rule 1', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('World rule 1', { exact: true }).inputValue(), ruleText);
  const storyZip = new Uint8Array(await (await fetch(base + `/api/stories/${story.id}/export`)).arrayBuffer());
  const storyCopy = await api('/api/import', { method: 'POST', body: storyZip }); assert.deepEqual(storyCopy.factPins, story.factPins);
  await stop(); await start(port); assert.deepEqual((await api('/api/stories/' + story.id)).factPins, story.factPins); assert.deepEqual((await api('/api/setups/' + imported.id)).plan.factPins, setup.plan.factPins);
  assert.deepEqual(errors, []);
  console.log('PASS: setup pins/rules authoring, blank-rule and unsaved protection, dynamic manual values, atomic AI name and indirect ownership refusals, no-call full-regeneration refusal, pinned deletion guidance, setup ZIP and chapter-one/story ZIP inheritance, restart and 320px layout.');
} finally {
  await browser?.close(); await stop(); provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve));
  const target = resolve(folder); assert.ok(target.startsWith(resolve(tmpdir()) + sep) && basename(target).startsWith('storyweaver-setup-pins-')); rmSync(target, { recursive: true, force: true });
}
