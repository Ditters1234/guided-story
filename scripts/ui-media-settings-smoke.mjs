// Isolated production UI acceptance. Build first; no model or image-provider calls.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve, basename, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { illustrationDraftSchema } from '../src/lib/illustration.ts';

const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/n_tin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const folder = mkdtempSync(join(tmpdir(), 'storyweaver-ui-media-')), data = join(folder, 'data'), config = join(folder, 'config');
mkdirSync(data); mkdirSync(config);
let child, browser, base, output = '';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function api(path, init) {
  const response = await fetch(base + path, { ...init, headers: { ...(init?.method ? { Origin: base } : {}), ...init?.headers }, signal: AbortSignal.timeout(10000) });
  const body = await response.json(); assert.equal(response.ok, true, JSON.stringify(body)); return body;
}
const patch = (story, action) => api('/api/stories/' + story.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: story.revision, requestId: randomUUID(), action }) });
async function stop() { if (!child || child.exitCode !== null) return; const done = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGKILL'); await done; }
try {
  const probe = createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve)); base = `http://127.0.0.1:${port}`;
  const server = `import {createServer} from 'node:http';import {handler} from './build/handler.js';createServer((request,response)=>{request.headers['x-storyweaver-protocol']='http';handler(request,response);}).listen(Number(process.env.STORY_PORT),'127.0.0.1');`;
  child = spawn(process.execPath, ['--input-type=module', '-e', server], { windowsHide: true, env: { ...process.env, STORY_PORT: String(port), STORY_INSTANCE: 'play', STORY_PRODUCTION: '1', PROTOCOL_HEADER: 'x-storyweaver-protocol', BODY_SIZE_LIMIT: '128M', STORY_SEED_SAMPLE: '1', STORY_DATA_DIR: data, STORY_CONFIG_DIR: config }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => output = (output + chunk).slice(-12000));
  for (let n = 0; n < 120; n++) { if (child.exitCode !== null) throw new Error(output); try { if ((await fetch(base + '/api/stories')).ok) break; } catch {} if (n === 119) throw new Error(output); await pause(200); }
  let story = await api('/api/stories/' + (await api('/api/stories'))[0].id);
  for (let i = 0; i < 30; i++) story = await patch(story, { type: 'record-save', edit: { kind: 'item', value: { id: null, name: `Stored prop ${String(i + 1).padStart(2, '0')}`, description: 'An isolated UI test prop.', quantity: 1, ownerId: 'hold', equipped: false } } });
  const png = await sharp({ create: { width: 64, height: 80, channels: 3, background: '#697b84' } }).png().toBuffer();
  for (const [caption, subjectIds, passageId] of [['Crew at the amber window', ['elias', 'mira'], story.passages.at(-1).id], ['Quiet tools on a shelf', ['fob'], null]]) {
    const form = new FormData(); form.set('image', new Blob([png], { type: 'image/png' }), 'ui-photo.png');
    form.set('metadata', JSON.stringify({ expectedRevision: story.revision, requestId: randomUUID(), caption, category: 'scene', subjectIds, passageId, parentId: null, status: 'canonical' }));
    story = await api(`/api/stories/${story.id}/media`, { method: 'POST', body: form });
  }
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } }), errors = [];
  page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
  let externalGenerationRequests = 0;
  page.on('request', request => { if (request.method() === 'POST' && /\/(illustrations(?:\/prepare)?|image-tests|connections\/text-test)$/.test(new URL(request.url()).pathname)) externalGenerationRequests++; });
  await page.goto(base); await page.getByRole('button', { name: 'Gallery', exact: true }).click();
  await page.getByLabel('Find a picture', { exact: true }).fill('AMBER'); assert.equal(await page.locator('.media-card').count(), 1);
  await page.getByRole('button', { name: 'Picture details: Crew at the amber window', exact: true }).click();
  const picture = page.getByRole('region', { name: 'Picture details', exact: true });
  await picture.getByLabel('Caption', { exact: true }).fill('A reviewed amber window');
  await page.getByLabel('Find a picture', { exact: true }).fill('missing-picture');
  await page.getByRole('heading', { name: 'No pictures match this view', exact: true }).waitFor();
  assert.equal(await picture.getByLabel('Caption', { exact: true }).inputValue(), 'A reviewed amber window', 'Filtering must retain the selected metadata draft.');
  const picker = picture.getByRole('group', { name: 'Who or what is actually pictured?', exact: true });
  await picker.getByLabel('Find a subject', { exact: true }).fill('Stored prop 30');
  assert.equal(await picker.getByRole('checkbox').count(), 3, 'Selected subjects plus matching options should stay visible.');
  assert.equal(await picker.getByRole('checkbox', { name: 'Elias Voss', exact: true }).isChecked(), true);
  await picker.getByRole('checkbox', { name: 'Stored prop 30', exact: true }).check();
  await picker.getByLabel('Find a subject', { exact: true }).fill('does-not-exist');
  assert.equal(await picker.getByRole('checkbox', { name: 'Stored prop 30', exact: true }).isChecked(), true);
  await picker.getByText('No more subjects match. Selected subjects stay above.', { exact: true }).waitFor();
  await picture.getByRole('button', { name: 'Save picture details', exact: true }).click();
  await page.getByText('Picture details saved.', { exact: true }).waitFor();
  story = await api('/api/stories/' + story.id); assert.equal(story.media.assets[0].caption, 'A reviewed amber window'); assert.equal(story.media.assets[0].subjectIds.length, 3);
  await picture.getByRole('button', { name: 'Back to pictures', exact: true }).click();
  await page.getByRole('button', { name: 'Show all pictures', exact: true }).click(); assert.equal(await page.locator('.media-card').count(), 2);

  let releasePreviews; const previewGate = new Promise(resolve => releasePreviews = resolve);
  const previewRoute = async route => { if (route.request().method() !== 'GET') return route.continue(); await previewGate; return route.fulfill({ status: 503, json: { error: 'UI preview service unavailable' } }); };
  await page.route('**/api/image-tests', previewRoute);
  await page.getByRole('button', { name: 'Add a picture', exact: true }).click();
  // Opening the editor does not fetch twice; the explicit refresh provides a retryable loading state.
  await page.getByRole('button', { name: 'Refresh completed preview', exact: true }).click();
  await page.getByText('Checking saved Settings test previews…', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Loading completed previews…', exact: true }).isDisabled(), true);
  releasePreviews(); await page.getByRole('alert').filter({ hasText: 'Use Refresh completed preview to try again.' }).waitFor();
  assert.equal(await page.getByText('No completed preview is available yet.', { exact: true }).count(), 0, 'An unavailable preview service is not an empty result.');
  await page.unroute('**/api/image-tests', previewRoute);
  await page.getByRole('button', { name: 'Refresh completed preview', exact: true }).click();
  await page.getByText('No completed preview is available yet.', { exact: true }).waitFor();
  assert.equal(await page.locator('main').getByRole('alert').count(), 0, 'Successful retry clears the current preview error.');
  await page.setViewportSize({ width: 320, height: 884 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  mkdirSync('test-results', { recursive: true }); await page.screenshot({ path: 'test-results/ui-media-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.getByRole('button', { name: 'Back to pictures', exact: true }).click();

  const draft = illustrationDraftSchema.parse({ framing: 'scene', subjectIds: [], subjects: [], passageId: null, style: '', scene: '', background: '', template: '{{image.scene}}', negative: '' });
  const job = (name, status) => ({ id: randomUUID(), status, seed: 10, durationMs: 1000, images: [], capture: { storyId: story.id, revision: story.revision, category: 'scene', parentId: null, source: null, snapshots: [{ id: name === 'Elias Voss' ? 'elias' : 'mira', name, appearance: '', outfit: '' }], draft, prompt: 'An isolated preview.', subjectIds: [], protectedNames: [], contentPreferences: { storyAdultContent: false, requestedNonsexual: true, contentNotes: '', characters: [] } } });
  const jobs = [job('Elias Voss', 'complete'), job('Mira Sol', 'error'), job('Mira Sol', 'queued')]; jobs[1].error = 'UI fixture preview failed';
  await page.route(new RegExp(`/api/stories/${story.id}/illustrations(?:/[^/?]+)?$`), route => {
    assert.equal(route.request().method(), 'GET'); const pathname = new URL(route.request().url()).pathname;
    return route.fulfill({ json: pathname.endsWith('/illustrations') ? { jobs } : jobs.find(job => pathname.endsWith(job.id)) });
  });
  await page.getByRole('button', { name: 'Illustrations', exact: true }).click();
  await page.getByRole('heading', { name: 'Illustration studio', exact: true }).waitFor();
  const studioPicker = page.getByRole('group', { name: 'Depicted subjects', exact: true });
  await studioPicker.getByLabel('Find a subject', { exact: true }).fill('Stored prop 30');
  await studioPicker.getByRole('checkbox', { name: 'Stored prop 30', exact: true }).check();
  await studioPicker.getByLabel('Find a subject', { exact: true }).fill('mira');
  assert.equal(await studioPicker.getByRole('checkbox', { name: 'Stored prop 30', exact: true }).isChecked(), true);
  await studioPicker.getByRole('checkbox', { name: 'Mira Sol', exact: true }).check();
  await page.getByLabel('Mira Sol · Hair', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Generate illustration', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: 'View queued illustration', exact: true }).click();
  await page.getByLabel('Generation status').selectOption('error'); assert.equal(await page.locator('.illustration-jobs button').count(), 1);
  await page.getByLabel('Find a generation', { exact: true }).fill('missing-generation'); assert.equal(await page.locator('.illustration-jobs button').count(), 0);
  await page.getByText('No generations match these filters. Your selected generation stays open below.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Clear generation filters', exact: true }).click(); assert.equal(await page.locator('.illustration-jobs button').count(), 3);
  await page.setViewportSize({ width: 320, height: 884 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.setViewportSize({ width: 1280, height: 1000 });

  let releaseStorage; const storageGate = new Promise(resolve => releaseStorage = resolve);
  const storageRoute = async route => { await storageGate; await route.fulfill({ status: 503, json: { error: 'UI storage service unavailable' } }); };
  await page.route('**/api/image-tests', storageRoute);
  await page.getByRole('navigation', { name: 'Story navigation' }).getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Storage & Dev', exact: true }).click();
  await page.getByText('Loading storage usage…', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Clear test image previews', exact: true }).isDisabled(), true);
  releaseStorage(); await page.getByText('Storage usage could not be loaded. Use Refresh storage usage to try again.', { exact: true }).waitFor();
  await page.unroute('**/api/image-tests', storageRoute);
  await page.getByRole('button', { name: 'Refresh storage usage', exact: true }).click();
  await page.getByText(/^0 test previews ·/).waitFor(); assert.equal(await page.locator('main').getByRole('alert').count(), 0);
  await page.getByRole('tab', { name: 'Reading', exact: true }).click();
  await page.getByLabel('Text size').selectOption('19'); await page.getByText('Reading preferences saved on this browser.', { exact: true }).waitFor();
  await page.getByRole('tab', { name: 'Text LLM', exact: true }).click();
  let releaseConnection; const connectionGate = new Promise(resolve => releaseConnection = resolve);
  await page.route('**/api/connections/test', async route => { await connectionGate; await route.fulfill({ json: { models: [], baseUrl: (await api('/api/connections')).text.baseUrl } }); });
  await page.getByRole('button', { name: 'Test Text LLM / refresh models', exact: true }).click();
  await page.getByText('Testing Text LLM connection…', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Save Text LLM settings', exact: true }).isDisabled(), true);
  releaseConnection(); await page.getByText('Connected, but the API returned no model IDs. Choose Enter model ID manually, then save Text LLM settings.', { exact: true }).waitFor();
  await page.getByRole('tab', { name: 'Text LLM', exact: true }).press('Home'); assert.equal(await page.getByRole('tab', { name: 'Reading', exact: true }).getAttribute('aria-selected'), 'true');
  await page.getByRole('tab', { name: 'Reading', exact: true }).press('End'); assert.equal(await page.getByRole('tab', { name: 'Storage & Dev', exact: true }).getAttribute('aria-selected'), 'true');
  await page.setViewportSize({ width: 320, height: 884 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: 'test-results/ui-settings-mobile.png', fullPage: true }); await page.setViewportSize({ width: 1280, height: 1000 });

  await page.getByRole('navigation', { name: 'Story navigation' }).getByRole('button', { name: 'Library', exact: true }).click();
  let row = page.getByRole('region', { name: story.title, exact: true });
  await row.getByRole('button', { name: 'Rename story', exact: true }).click(); await row.getByLabel('Story title', { exact: true }).fill('An unfinished title draft');
  story = await patch(await api('/api/stories/' + story.id), { type: 'story-title', title: 'An external title change' });
  await page.locator('main').getByRole('button', { name: 'Reload library', exact: true }).click(); row = page.getByRole('region', { name: story.title, exact: true });
  await row.getByText('This story changed while its title was being edited. Your draft is kept; load the saved title before renaming.', { exact: true }).waitFor();
  assert.equal(await row.getByLabel('Story title', { exact: true }).inputValue(), 'An unfinished title draft'); assert.equal(await row.getByRole('button', { name: 'Save title', exact: true }).isDisabled(), true);
  await row.getByRole('button', { name: 'Load saved title', exact: true }).click(); assert.equal(await row.getByLabel('Story title', { exact: true }).inputValue(), story.title);
  await row.getByRole('button', { name: 'Cancel rename', exact: true }).click();
  assert.deepEqual(errors, []); assert.equal(externalGenerationRequests, 0); assert.equal((await api('/api/dev/jobs')).jobs.length, 0);
  console.log('Production UI media/settings acceptance passed: gallery search and selected drafts, large subject lists, retry states, generation filtering, storage failures, keyboard tabs and stale library rename. No provider calls.');
} catch (error) {
  const currentPage = browser?.contexts()[0]?.pages()[0];
  if (currentPage) { mkdirSync('test-results', { recursive: true }); await currentPage.screenshot({ path: 'test-results/ui-media-settings-failure.png', fullPage: true }).catch(() => {}); console.error((await currentPage.locator('main').innerText().catch(() => '')).slice(0, 12000)); }
  throw error;
} finally {
  await browser?.close(); await stop();
  const target = resolve(folder), root = resolve(tmpdir()) + sep;
  if (target.startsWith(root) && basename(target).startsWith('storyweaver-ui-media-')) rmSync(target, { recursive: true, force: true });
}
