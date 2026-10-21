// Isolated production acceptance for collection search, navigation and notebook drafts.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { createSample } from '../src/lib/server/fixture.ts';
import { blankSetupPlan } from '../src/lib/setup.ts';

const require = createRequire(import.meta.url), { chromium } = require('C:/Users/n_tin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const folder = mkdtempSync(join(tmpdir(), 'storyweaver-ui-navigation-')), config = join(folder, 'config'), data = join(folder, 'data');
mkdirSync(config); mkdirSync(data);
let child, browser, page, base, output = '', dismissDialog = true;
const errors = [], dialogs = [], pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const nav = name => page.getByRole('navigation', { name: 'Story navigation' }).getByRole('button', { name, exact: true });
async function api(path, init = {}) {
  const response = await fetch(base + path, { ...init, headers: { ...(init.method ? { Origin: base } : {}), ...init.headers }, signal: AbortSignal.timeout(15000) });
  const body = await response.json(); assert.equal(response.ok, true, JSON.stringify(body)); return body;
}
const post = (path, body, method = 'POST') => api(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
async function importStory(story) { return api('/api/import', { method: 'POST', body: zipSync({ 'manifest.json': strToU8(JSON.stringify({ format: 'guided-story-dev-1', media: [] })), 'story.json': strToU8(JSON.stringify(story)) }) }); }
async function focusHeading(title) { await page.waitForFunction(text => document.activeElement?.tagName === 'H1' && document.activeElement.textContent === text, title); }
async function stop() { if (!child || child.exitCode !== null) return; const done = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGKILL'); await done; }
async function fits(name) { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, name + ' must fit horizontally'); }

try {
  const probe = createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve)); base = `http://127.0.0.1:${port}`;
  const connections = JSON.parse(readFileSync('config/connections.example.json', 'utf8'));
  Object.assign(connections.text, { model: 'ui-navigation-no-provider', baseUrl: 'http://127.0.0.1:1/v1' });
  writeFileSync(join(config, 'connections.play.local.json'), JSON.stringify(connections));
  child = spawn(process.execPath, ['scripts/start-production.mjs'], { windowsHide: true, env: { ...process.env, STORY_PORT: String(port), STORY_DATA_DIR: data, STORY_CONFIG_DIR: config, STORY_SEED_SAMPLE: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => output = (output + chunk).slice(-20000));
  for (let attempt = 0; attempt < 120; attempt++) { if (child.exitCode !== null) throw new Error(output); try { if ((await fetch(base + '/api/stories')).ok) break; } catch {} if (attempt === 119) throw new Error(output); await pause(200); }
  browser = await chromium.launch({ channel: 'msedge', headless: true }); page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); page.setDefaultTimeout(18000);
  page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => { dialogs.push(dialog.message()); return dismissDialog ? dialog.dismiss() : dialog.accept(); });
  await page.goto(base); await page.waitForLoadState('networkidle'); assert.equal(await nav('Records').isDisabled(), true); assert.equal(await nav('Background').isDisabled(), true);
  await page.keyboard.press('Tab'); assert.equal(await page.getByRole('link', { name: 'Skip to content', exact: true }).evaluate(element => element === document.activeElement), true); await page.keyboard.press('Enter');
  const sample = createSample(); sample.title = 'North Harbour';
  sample.canon.items.push(...Array.from({ length: 25 }, (_, n) => ({ id: 'navigation-spare-' + n, name: 'Navigation spare ' + n.toString().padStart(2, '0'), description: 'A distinct spare for navigation equipment.', quantity: 1, ownerId: 'hold', equipped: false })));
  const first = await importStory(sample), second = await importStory({ ...createSample(), title: 'Quiet Orchard' });
  let setup = await post('/api/setups', { requestId: randomUUID(), input: { premise: 'An early feeding round on a ranch.', title: 'Ranch Morning', castSize: 1 } });
  const plan = blankSetupPlan(randomUUID); plan.title = 'Ranch Morning'; setup = await post(`/api/setups/${setup.id}`, { expectedRevision: setup.revision, requestId: randomUUID(), input: setup.input, plan }, 'PATCH');
  await page.reload(); await page.waitForLoadState('networkidle'); await nav('Library').click(); await focusHeading('Library');
  const search = page.getByLabel('Find a story or setup', { exact: true }); await search.fill('feeding'); await page.getByRole('region', { name: 'Ranch Morning', exact: true }).waitFor(); assert.equal(await page.getByRole('button', { name: 'Resume story ↗', exact: true }).count(), 0);
  await search.fill('no-such-story-947'); await page.getByRole('heading', { name: 'No matching stories or setups', exact: true }).waitFor(); await page.getByRole('button', { name: 'Show the whole library', exact: true }).click(); assert.equal(await page.getByRole('button', { name: 'Resume story ↗', exact: true }).count(), 2);
  const row = page.getByRole('region', { name: first.title, exact: true }); await row.getByRole('button', { name: 'Rename story', exact: true }).click(); await row.getByLabel('Story title', { exact: true }).fill('An unsaved harbour title'); await search.fill('no-such-story-947'); assert.equal(await row.getByLabel('Story title', { exact: true }).inputValue(), 'An unsaved harbour title');
  let count = dialogs.length; await nav('Help').click(); assert.equal(dialogs.length, count + 1); assert.equal(await nav('Library').getAttribute('aria-current'), 'page'); await row.getByRole('button', { name: 'Cancel rename', exact: true }).click(); await page.getByRole('button', { name: 'Clear library search', exact: true }).click();
  let releaseReload; const reloadGate = new Promise(resolve => releaseReload = resolve); await page.route('**/api/stories', async route => { await reloadGate; await route.continue(); });
  await page.getByRole('button', { name: 'Reload library', exact: true }).click(); assert.equal(await page.getByRole('button', { name: 'Reloading library…', exact: true }).isDisabled(), true); releaseReload(); await page.getByRole('button', { name: 'Reload library', exact: true }).waitFor(); await page.unroute('**/api/stories');
  await row.getByRole('button', { name: 'Resume story ↗', exact: true }).click(); await page.getByRole('heading', { name: first.passages.at(-1).title, exact: true }).waitFor(); await page.waitForFunction(element => !element.disabled, await nav('Contents').elementHandle()); await nav('Contents').focus(); await page.keyboard.press('Enter'); await focusHeading('Contents');
  const contents = page.getByLabel('Find a passage', { exact: true }); await contents.fill(first.passages[0].title); assert.equal(await page.locator('.toc-entry').count(), 1); await page.locator('.toc-entry').click(); await page.getByRole('heading', { name: first.passages[0].title, exact: true }).waitFor();
  await nav('Contents').click(); await contents.fill('no-such-passage-947'); await page.getByRole('heading', { name: 'No matching passages', exact: true }).waitFor(); await page.getByRole('button', { name: 'Show all passages', exact: true }).click(); assert.equal(await page.locator('.toc-entry').count(), first.passages.length); await page.getByRole('button', { name: 'Continue at latest ↗', exact: true }).click();
  const notebook = page.getByRole('complementary', { name: 'Story notebook', exact: true }); const notebookSearch = notebook.getByLabel('Search notebook', { exact: true });
  await notebookSearch.fill('no-matching-person-947'); assert.equal(await notebook.locator('.cast-row').count(), 1); const name = notebook.getByLabel('Name', { exact: true }); await name.fill('Unsaved notebook name'); count = dialogs.length; await page.getByRole('link', { name: '✦ Storyweaver', exact: true }).click(); assert.equal(dialogs.length, count + 1); assert.equal(await name.inputValue(), 'Unsaved notebook name'); assert.deepEqual(await api(`/api/stories/${first.id}`), first); await notebook.getByRole('button', { name: 'Reset to saved', exact: true }).click();
  await notebook.getByRole('button', { name: 'World', exact: true }).click(); assert.equal(await notebook.getByRole('combobox').count(), 12); await notebook.getByRole('button', { name: /^Show all \d+ possessions$/ }).click(); assert.equal(await notebook.getByRole('combobox').count(), first.canon.items.length); await notebook.getByRole('button', { name: 'Show fewer possessions', exact: true }).click();
  await notebookSearch.fill('Navigation spare 24'); assert.equal(await notebook.getByRole('combobox').count(), 1); await notebook.getByRole('combobox', { name: /^Navigation spare 24/ }).waitFor(); await notebookSearch.fill('no-such-possession-947'); await notebook.getByText('No possessions match this search.', { exact: true }).waitFor();
  await notebook.getByRole('button', { name: 'Threads', exact: true }).click(); const thread = notebook.getByRole('form', { name: first.canon.threads[0].title, exact: true }); await thread.getByLabel('Notes', { exact: true }).fill('Unsaved thread to keep'); await notebookSearch.fill('no-such-thread-947'); assert.equal(await thread.getByLabel('Notes', { exact: true }).inputValue(), 'Unsaved thread to keep'); await thread.getByRole('button', { name: 'Reset thread', exact: true }).click();
  mkdirSync('test-results', { recursive: true }); await nav('Library').click(); await page.getByRole('button', { name: 'Clear library search', exact: true }).count().then(async count => { if (count) await page.getByRole('button', { name: 'Clear library search', exact: true }).click(); }); await page.screenshot({ path: 'test-results/ui-library-desktop.png', fullPage: true });
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    for (const name of ['Library', 'Read', 'Contents', 'Background', 'Records', 'Pins', 'Prepare scene', 'Gallery', 'Illustrations', 'Story so far', 'Settings', 'Help', 'Dev']) { await nav(name).click(); await fits(`${name} at ${viewport.width}`); }
    await nav('Library').click(); await page.screenshot({ path: `test-results/ui-library-${viewport.width}.png`, fullPage: false });
  }
  const touchPage = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  touchPage.on('pageerror', error => errors.push(error.message)); await touchPage.goto(base); await touchPage.waitForLoadState('networkidle');
  assert.equal(await touchPage.evaluate(() => matchMedia('(pointer:coarse)').matches), true);
  for (const name of ['Library', 'Read', 'Background', 'Records', 'Pins', 'Prepare scene', 'Gallery', 'Illustrations', 'Settings', 'Help']) {
    await touchPage.getByRole('navigation', { name: 'Story navigation' }).getByRole('button', { name, exact: true }).tap();
    assert.equal(await touchPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, name + ' must fit with touch styles');
  }
  await touchPage.getByRole('navigation', { name: 'Story navigation' }).getByRole('button', { name: 'Library', exact: true }).tap();
  assert.ok(await touchPage.getByLabel('Find a story or setup', { exact: true }).evaluate(element => parseFloat(getComputedStyle(element).fontSize) >= 16), 'Touch form text avoids browser zoom.');
  await touchPage.screenshot({ path: 'test-results/ui-library-touch.png', fullPage: false }); await touchPage.close();
  assert.deepEqual(await api(`/api/stories/${first.id}`), first); assert.deepEqual(await api(`/api/stories/${second.id}`), second); assert.equal((await api('/api/dev/jobs')).jobs.length, 0); assert.deepEqual(errors, []);
  console.log('PASS: library/contents search, no-match recovery, guarded logo and rename drafts, keyboard heading focus, bounded searchable notebook, draft preservation, 13 routes at 320/390px and ten routes with coarse-pointer touch emulation; zero model calls and unchanged source stories.');
} catch (error) { mkdirSync('test-results', { recursive: true }); await page?.screenshot({ path: 'test-results/ui-navigation-failure.png', fullPage: true }).catch(() => {}); console.error(output); throw error; }
finally { await browser?.close(); await stop(); assert.equal(dirname(resolve(folder)), resolve(tmpdir())); rmSync(folder, { recursive: true, force: true }); }
