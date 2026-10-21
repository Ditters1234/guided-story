// Local acceptance walkthrough. Requires both `npm run dev` and `npm run play`.
// Playwright is supplied by the Codex workspace runtime; it is not an app dependency.
const { chromium } = require('C:/Users/n_tin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const { DatabaseSync } = require('node:sqlite');
const { mkdirSync, existsSync, readFileSync, writeFileSync, unlinkSync } = require('node:fs');
const { createServer } = require('node:http');
const { resolve } = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const createdIds = [];
  let imageTestId;
  const base = 'http://127.0.0.1:5173';
  const configPath = resolve('config/connections.dev.local.json');
  const originalConfig = existsSync(configPath) ? readFileSync(configPath) : null;
  let changedConfig = false;
  const mock = createServer(async (req, res) => {
    try {
      if (req.url === '/object_info') { const graph = JSON.parse(readFileSync('AI/Comfy Workflow/portrait.comfy-desktop.api.json', 'utf8')); res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(Object.fromEntries(Object.values(graph).map(n => [n.class_type, { input: { required: {} } }])))); return; }
      if (req.url === '/prompt') { for await (const part of req) {} res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ prompt_id: 'qa-image-prompt' })); return; }
      if (req.url === '/history/qa-image-prompt') { res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ 'qa-image-prompt': { status: { completed: true }, outputs: { '9': { images: [{ filename: 'qa.png' }] } } } })); return; }
      if (req.url.startsWith('/view?')) { res.writeHead(200, { 'Content-Type': 'image/png' }).end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')); return; }
      if (req.method === 'GET' && req.url === '/system_stats') { res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ system: { comfyui_version: 'qa-comfy' }, devices: [{ name: 'QA GPU' }] })); return; }
      if (req.headers.authorization !== 'Bearer qa-only-private-key') { res.writeHead(401).end(); return; }
      if (req.method === 'GET' && req.url === '/v1/models') { res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'qa-local-model' }, { id: 'qa-second-model' }] })); return; }
      let raw = ''; for await (const part of req) raw += part;
      const body = JSON.parse(raw), memory = body.messages[0].content.includes('Extract continuity memory');
      const content = memory ? JSON.stringify({ summary: 'QA model continuity summary.', facts: ['The crew faces the cargo mystery.'], openQuestions: ['What does Ren know?'], characterIds: ['elias', 'ren'], locationIds: ['bridge'] }) : 'QA generated recap of the written story.';
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 120, completion_tokens: 40 } }));
    } catch { res.writeHead(400).end(); }
  });
  async function json(path, options) {
    const response = await page.request.fetch(base + path, options);
    assert.equal(response.ok(), true, await response.text()); return response.json();
  }
  try {
    const userBefore = await page.request.get('http://127.0.0.1:5175/api/stories');
    assert.equal(userBefore.status(), 200);
    const playLibrary = await userBefore.json();
    const fixture = await json('/api/stories', { method: 'POST', data: { title: '__QA Foundation walkthrough' } });
    createdIds.push(fixture.id);
    assert.ok(!playLibrary.some(s => s.id === fixture.id));
    await page.goto(base); await page.waitForLoadState('networkidle'); await page.getByRole('heading', { name: 'Terms of arrival', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '← Previous chapter', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Next chapter →', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Story so far', exact: true }).click();
    await page.getByLabel('Your recap', { exact: true }).fill('The Wayward reaches Halcyon carrying a mysterious sealed container.');
    await page.getByRole('button', { name: 'Save recap', exact: true }).click();
    await page.getByRole('heading', { name: 'Recap up to date', exact: true }).waitFor();
    await page.reload(); await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Story so far', exact: true }).click();
    assert.equal(await page.getByLabel('Your recap', { exact: true }).inputValue(), 'The Wayward reaches Halcyon carrying a mysterious sealed container.');
    await page.getByRole('button', { name: 'Read', exact: true }).click();
    await page.getByRole('button', { name: 'Continue reading ↗', exact: true }).click();
    await page.getByRole('heading', { name: 'An old acquaintance', exact: true }).waitFor();
    let saved = await json('/api/stories/' + fixture.id);
    assert.equal(saved.canon.items.find(i => i.id === 'fob').ownerId, 'ren');
    await page.getByRole('button', { name: 'Story so far', exact: true }).click();
    await page.getByRole('heading', { name: 'Needs refresh', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Read', exact: true }).click();
    await page.reload(); await page.waitForLoadState('networkidle'); await page.getByRole('heading', { name: 'An old acquaintance', exact: true }).waitFor();
    await page.getByRole('button', { name: '← Previous chapter', exact: true }).click();
    await page.getByRole('heading', { name: 'A delivery with no questions', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Next passage →', exact: true }).click();
    await page.getByRole('heading', { name: 'The silence in the hold', exact: true }).waitFor();
    await page.getByRole('button', { name: '← Previous passage', exact: true }).click();
    await page.getByRole('button', { name: 'Next chapter →', exact: true }).click();
    await page.getByRole('heading', { name: 'An old acquaintance', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Contents', exact: true }).click();
    await page.getByRole('button', { name: 'A delivery with no questions Read', exact: false }).click();
    assert.ok(await page.getByRole('button', { name: 'Try alternate sample ending' }).isDisabled());
    await page.getByRole('button', { name: 'Return to latest ↗', exact: true }).click();
    page.once('dialog', d => d.accept());
    await page.getByRole('button', { name: 'Try alternate sample ending' }).click();
    await page.getByRole('heading', { name: 'No one goes alone', exact: true }).waitFor();
    saved = await json('/api/stories/' + fixture.id);
    assert.equal(saved.canon.items.find(i => i.id === 'fob').ownerId, 'elias');
    await page.getByRole('button', { name: 'Mira Sol Engineer', exact: false }).click();
    const nsfw = page.getByRole('checkbox', { name: 'No NSFW', exact: false });
    assert.ok(await nsfw.isChecked());
    await page.getByLabel('Personality & motives').fill('Foundation walkthrough saved note.');
    await page.getByRole('button', { name: 'Save character', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Saved locally' }).waitFor();
    await page.reload(); await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Mira Sol Engineer', exact: false }).click();
    assert.equal(await page.getByLabel('Personality & motives').inputValue(), 'Foundation walkthrough saved note.');
    await page.getByRole('button', { name: 'Library', exact: true }).click();
    const downloadEvent = page.waitForEvent('download');
    await page.locator(`a[href="/api/stories/${fixture.id}/export"]`).click();
    const download = await downloadEvent; mkdirSync('test-results', { recursive: true });
    const archive = resolve('test-results/foundation-story.zip'); await download.saveAs(archive);
    await page.getByLabel('Import a story ZIP').setInputFiles(archive);
    await page.getByRole('heading', { name: 'No one goes alone', exact: true }).waitFor();
    const all = await json('/api/stories');
    const imported = all.find(s => s.title === '__QA Foundation walkthrough (imported)');
    assert.ok(imported); createdIds.push(imported.id);
    const publicConfig = await json('/api/connections'); assert.ok(!Object.hasOwn(publicConfig.text, 'apiKey'));
    const playAfter = await (await page.request.get('http://127.0.0.1:5175/api/stories')).json();
    assert.deepEqual(playAfter.map(s => s.id), playLibrary.map(s => s.id));
    // Direct API requests must also enforce latest-only event changes.
    saved = await json('/api/stories/' + imported.id);
    const earlier = await page.request.patch(base + '/api/stories/' + imported.id, { data: { expectedRevision: saved.revision, requestId: randomUUID(), action: { type: 'sample-replace', passageId: saved.passages[0].id } } });
    assert.equal(earlier.status(), 409);
    // Configure only the development instance against a local mock model, then restore the exact previous file.
    await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
    const mockPort = mock.address().port;
    await json('/api/connections', { method: 'PUT', data: { text: { ...publicConfig.text, baseUrl: `http://127.0.0.1:${mockPort}/v1`, model: 'qa-local-model', apiKey: 'qa-only-private-key' }, images: publicConfig.images } });
    changedConfig = true;
    await page.reload(); await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const textSettings = page.getByRole('form', { name: 'Text LLM settings', exact: true });
    const comfySettings = page.getByRole('form', { name: 'ComfyUI settings', exact: true });
    const settingsTabs = page.getByRole('tablist', { name: 'Settings sections' });
    await settingsTabs.getByRole('tab', { name: 'Text LLM', exact: true }).click();
    await textSettings.getByLabel('Text API address', { exact: true }).fill('unsaved invalid address');
    await settingsTabs.getByRole('tab', { name: 'ComfyUI', exact: true }).click();
    await comfySettings.getByLabel('ComfyUI address', { exact: true }).fill(`http://127.0.0.1:${mockPort}`);
    await comfySettings.getByRole('combobox', { name: /^Workflow file/ }).selectOption('AI/Comfy Workflow/portrait.api.json');
    await comfySettings.getByRole('button', { name: 'Test ComfyUI connection', exact: true }).click();
    await comfySettings.getByText(/Connected to ComfyUI qa-comfy/).waitFor();
    assert.deepEqual((await json('/api/connections')).images, publicConfig.images, 'Comfy test must not save');
    await comfySettings.getByRole('button', { name: 'Save ComfyUI settings', exact: true }).click();
    await page.getByText('ComfyUI settings saved locally.', { exact: true }).waitFor();
    let separateConfig = await json('/api/connections');
    assert.equal(separateConfig.text.baseUrl, `http://127.0.0.1:${mockPort}/v1`);
    assert.equal(separateConfig.text.hasApiKey, true);
    await comfySettings.getByRole('combobox', { name: /^Workflow file/ }).selectOption('AI/Comfy Workflow/portrait.comfy-desktop.api.json');
    await settingsTabs.getByRole('tab', { name: 'Text LLM', exact: true }).click();
    assert.equal(await textSettings.getByLabel('Text API address', { exact: true }).inputValue(), 'unsaved invalid address');
    await textSettings.getByLabel('Text API address', { exact: true }).fill(`http://127.0.0.1:${mockPort}/v1`);
    await textSettings.getByRole('button', { name: 'Test Text LLM / refresh models', exact: true }).click();
    await page.getByText(/Connected · 2 available models/).waitFor();
    await page.getByRole('combobox', { name: /^Text model/ }).selectOption('qa-local-model');
    assert.equal(await page.getByRole('combobox', { name: /^Text model/ }).locator('option').count(), 3);
    await textSettings.getByRole('button', { name: 'Save Text LLM settings', exact: true }).click();
    await page.getByText('Text LLM settings saved locally.', { exact: true }).waitFor();
    separateConfig = await json('/api/connections');
    assert.equal(separateConfig.images.workflow, 'AI/Comfy Workflow/portrait.api.json');
    await page.getByRole('button', { name: 'Run text test', exact: true }).click();
    await page.getByLabel('Text test result', { exact: true }).filter({ hasText: 'QA generated recap' }).waitFor();
    await settingsTabs.getByRole('tab', { name: 'ComfyUI', exact: true }).click();
    assert.equal(await comfySettings.getByRole('combobox', { name: /^Workflow file/ }).inputValue(), 'AI/Comfy Workflow/portrait.comfy-desktop.api.json');
    const submittedImage = page.waitForResponse(r => r.url() === base + '/api/image-tests' && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Generate test image', exact: true }).click();
    const submittedJob = await (await submittedImage).json(); imageTestId = submittedJob.id;
    await page.locator(`img[src^="/api/image-tests/${imageTestId}/"]`).waitFor();
    const imageSrc = await page.getByRole('img', { name: 'ComfyUI test generation', exact: true }).getAttribute('src');
    imageTestId = imageSrc.split('/')[3];
    assert.equal((await page.request.get(base + imageSrc)).status(), 200);
    mkdirSync('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/separate-connection-settings.png', fullPage: true });
    await settingsTabs.getByRole('tab', { name: 'Prompts', exact: true }).click();
    await page.getByLabel('Portrait template', { exact: true }).fill('QA portrait {{subject.face}} {{subject.footwear}}');
    await page.getByRole('combobox', { name: /^Framing/ }).selectOption('fullbody');
    await page.getByLabel('subject.footwear', { exact: true }).fill('QA shoes should not appear');
    await page.getByRole('combobox', { name: /^Framing/ }).selectOption('portrait');
    assert.ok(!(await page.locator('.dev-json').textContent()).includes('QA shoes should not appear'));
    await page.getByRole('button', { name: 'Save prompt settings', exact: true }).click();
    await page.getByText('Prompt settings saved locally.', { exact: true }).waitFor();
    await settingsTabs.getByRole('tab', { name: 'Context', exact: true }).click();
    await page.getByLabel('Recent passages', { exact: true }).fill('3');
    await page.getByRole('button', { name: 'Save context settings', exact: true }).click();
    await page.getByText('Context settings saved locally.', { exact: true }).waitFor();
    const contextConfig = await json('/api/connections');
    assert.equal(contextConfig.context.recentPassages, 3); assert.ok(contextConfig.prompts.portrait.includes('QA portrait'));
    await settingsTabs.getByRole('tab', { name: 'Story', exact: true }).click();
    await page.getByRole('combobox', { name: /^Tense/ }).selectOption('present');
    await page.getByRole('button', { name: 'Save story preferences', exact: true }).click();
    await page.getByText('Story preferences saved.', { exact: true }).waitFor();
    assert.equal((await json('/api/stories/' + imported.id)).preferences.tense, 'present');
    await settingsTabs.getByRole('tab', { name: 'Reading', exact: true }).click();
    await settingsTabs.getByRole('tab', { name: 'Reading', exact: true }).press('ArrowRight');
    await page.getByRole('tabpanel', { name: 'Story', exact: true }).waitFor();
    await settingsTabs.getByRole('tab', { name: 'Reading', exact: true }).click();
    await page.getByRole('combobox', { name: /^Reading font/ }).selectOption('sans');
    await page.getByRole('combobox', { name: /^Line spacing/ }).selectOption('2.1');
    await page.reload(); await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    assert.equal(await page.getByRole('combobox', { name: /^Reading font/ }).inputValue(), 'sans');
    assert.equal(await page.getByRole('combobox', { name: /^Line spacing/ }).inputValue(), '2.1');
    await page.getByRole('button', { name: 'Dev', exact: true }).click();
    const devTabs = page.getByRole('group', { name: 'Developer sections' });
    await devTabs.getByRole('button', { name: 'Passage lab', exact: true }).click();
    const labBefore = await json('/api/stories/' + imported.id);
    await page.getByRole('button', { name: 'Load example proposal', exact: true }).click();
    await page.getByRole('button', { name: 'Validate proposal · dry run', exact: true }).click();
    await page.getByRole('heading', { name: 'Validated preview · nothing saved', exact: true }).waitFor();
    assert.ok((await page.locator('.dev-json').textContent()).includes('ownerId'));
    assert.deepEqual(await json('/api/stories/' + imported.id), labBefore);
    await devTabs.getByRole('button', { name: 'Jobs', exact: true }).click();
    await page.getByRole('button', { name: 'Refresh jobs', exact: true }).click();
    await page.getByRole('heading', { name: 'text-test · complete', exact: true }).first().waitFor();
    await page.getByRole('button', { name: 'Inspect job', exact: true }).first().click();
    await page.getByRole('heading', { name: 'Job details', exact: true }).waitFor();
    await devTabs.getByRole('button', { name: 'Memory', exact: true }).click();
    await page.getByRole('button', { name: 'Add lore entry', exact: true }).click();
    await page.getByLabel('Title', { exact: true }).last().fill('QA world rule');
    await page.getByLabel('Lore text', { exact: true }).last().fill('QA world detail: trade requires a station permit.');
    await page.getByRole('combobox', { name: /^Include in prose context/ }).last().selectOption('always');
    await page.getByRole('button', { name: 'Add fact or belief', exact: true }).click();
    await page.getByLabel('Fact, belief, or possibility', { exact: true }).last().fill('QA secret twist should be excluded.');
    await page.getByRole('button', { name: 'Add manual memory', exact: true }).click();
    await page.getByLabel('Summary', { exact: true }).last().fill('QA source-linked continuity note.');
    await page.getByRole('button', { name: 'Save context records', exact: true }).first().click();
    await page.getByText('Context records saved. Rebuild the preview to inspect the new selection.', { exact: true }).waitFor();
    await devTabs.getByRole('button', { name: 'Context', exact: true }).click();
    await page.getByRole('button', { name: 'Build context preview', exact: true }).click();
    await page.getByRole('heading', { name: 'Assembled messages', exact: true }).waitFor();
    const prompt = await page.locator('.dev-json').textContent();
    assert.ok(prompt.includes('QA world detail')); assert.ok(prompt.includes('QA source-linked continuity note.'));
    assert.ok(!prompt.includes('QA secret twist')); assert.ok(!prompt.includes('The Wayward reaches Halcyon carrying a mysterious sealed container.'));
    await devTabs.getByRole('button', { name: 'Memory', exact: true }).click();
    await page.getByRole('button', { name: 'Generate passage memory', exact: true }).click();
    await page.getByText('Continuity memory saved. World facts and passage text were not changed.', { exact: true }).waitFor();
    saved = await json('/api/stories/' + imported.id);
    assert.ok(saved.context.memories.some(m => m.source === 'generated' && m.summary === 'QA model continuity summary.'));
    await devTabs.getByRole('button', { name: 'Requests', exact: true }).click();
    await page.locator('.trace-row').filter({ hasText: 'continuity-memory' }).filter({ hasText: imported.id.slice(0, 8) }).first().click();
    assert.ok((await page.locator('.dev-json').textContent()).includes('QA model continuity summary.'));
    await page.evaluate(() => console.warn('qa-dev-console-marker', { apiKey: 'qa-browser-secret' }));
    await page.waitForFunction(async () => {
      const data = await (await fetch('/api/dev/diagnostics')).json(); return data.logs.some(l => l.message.includes('qa-dev-console-marker'));
    });
    await devTabs.getByRole('button', { name: 'Console', exact: true }).click();
    await page.getByRole('button', { name: 'Refresh logs', exact: true }).click();
    await page.getByLabel('Search logs', { exact: true }).fill('qa-dev-console-marker');
    await page.locator('.console-list summary').filter({ hasText: 'qa-dev-console-marker' }).first().waitFor();
    const diagnosticExport = await page.request.get(base + '/api/dev/diagnostics?download=1');
    const diagnosticText = await diagnosticExport.text();
    assert.ok(!diagnosticText.includes('qa-only-private-key')); assert.ok(!diagnosticText.includes('qa-browser-secret'));
    await page.getByRole('button', { name: 'Story so far', exact: true }).click();
    page.once('dialog', d => d.accept());
    await page.getByRole('button', { name: 'Refresh recap', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Recap generated and saved locally' }).waitFor();
    assert.equal(await page.getByLabel('Your recap', { exact: true }).inputValue(), 'QA generated recap of the written story.');
    for (const width of [1280, 736, 375, 320]) {
      await page.setViewportSize({ width, height: 1100 });
      for (const name of ['Read', 'Contents', 'Story so far', 'Gallery', 'Library', 'Settings', 'Dev']) {
        await page.getByRole('navigation', { name: 'Story navigation' }).getByRole('button', { name, exact: true }).click();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${name} overflows at ${width}`);
      }
      for (const name of ['Console', 'Requests', 'Jobs', 'Passage lab', 'Context', 'Memory', 'State']) {
        await page.getByRole('group', { name: 'Developer sections' }).getByRole('button', { name, exact: true }).click();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `Dev ${name} overflows at ${width}`);
      }
      await page.getByRole('navigation', { name: 'Story navigation' }).getByRole('button', { name: 'Settings', exact: true }).click();
      for (const name of ['Reading', 'Story', 'Text LLM', 'ComfyUI', 'Prompts', 'Context', 'Storage & Dev']) {
        await page.getByRole('tablist', { name: 'Settings sections' }).getByRole('tab', { name, exact: true }).click();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `Settings ${name} overflows at ${width}`);
      }
    }
    await page.setViewportSize({ width: 1280, height: 1050 });
    await page.getByRole('button', { name: 'Read', exact: true }).click();
    await page.screenshot({ path: 'test-results/reader-desktop.png', fullPage: true });
    await page.getByRole('button', { name: 'Dev', exact: true }).click();
    await page.getByRole('group', { name: 'Developer sections' }).getByRole('button', { name: 'Context', exact: true }).click();
    await page.getByRole('button', { name: 'Build context preview', exact: true }).click();
    await page.getByRole('heading', { name: 'Assembled messages', exact: true }).waitFor();
    await page.screenshot({ path: 'test-results/dev-context.png', fullPage: true });
    assert.deepEqual(errors, []);
    console.log('PASS: both instances, chapter/passage navigation, recap save/generate, continuation/reopen, ownership rollback, ZIP roundtrip, Dev editors/context selection, source-linked memory generation through mock model, request traces, browser console capture/redaction, all Dev tabs responsive, no browser errors.');
  } catch (e) {
    mkdirSync('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/browser-failure.png', fullPage: true }).catch(() => {});
    console.error('Page errors:', errors);
    throw e;
  } finally {
    await browser.close();
    if (imageTestId) await fetch(base + '/api/image-tests/' + imageTestId, { method: 'DELETE' }).catch(() => {});
    if (changedConfig) { if (originalConfig) writeFileSync(configPath, originalConfig); else if (existsSync(configPath)) unlinkSync(configPath); }
    if (mock.listening) await new Promise(resolve => mock.close(resolve));
    // Remove only the records created by this walkthrough, never the user's library.
    if (existsSync(resolve('data/dev/library.sqlite'))) {
      const db = new DatabaseSync(resolve('data/dev/library.sqlite'));
      try {
      for (const id of createdIds) {
        const row = db.prepare('SELECT payload FROM stories WHERE id = ?').get(id);
        if (row && JSON.parse(row.payload).title.startsWith('__QA Foundation walkthrough')) {
          db.exec('BEGIN IMMEDIATE');
          db.prepare('DELETE FROM operations WHERE story_id = ?').run(id);
          db.prepare('DELETE FROM stories WHERE id = ?').run(id);
          db.exec('COMMIT');
        }
      }
      } finally { db.close(); }
    }
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
