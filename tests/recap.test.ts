import { estimateInputTokens } from '../src/lib/server/token-budget';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { StoryRepository } from '../src/lib/server/repository';
import { createSample } from '../src/lib/server/fixture';
import { generateRecap } from '../src/lib/server/recap';

const settings = { baseUrl: 'http://127.0.0.1:8888/v1', model: 'test-model', apiKey: 'test-secret-not-logged', temperature: 0.8, maxTokens: 1024, contextTokens: 16384, structuredOutput: 'auto' as const };
function fakeCompletion(content: string): typeof fetch {
  return async (_input, init) => {
    const body = JSON.parse(init!.body as string);
    assert.equal(body.model, 'test-model');
    assert.equal(body.stream, false);
    assert.ok(body.messages[0].content.includes('Do not add events'));
    return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }));
  };
}

test('manual recap persists without changing canon, marks stale on continuation, and keeps edits', async () => {
  const r = new StoryRepository(':memory:');
  try {
    const s = r.create();
    const saved = r.mutate(s.id, { expectedRevision: 0, requestId: randomUUID(), action: { type: 'recap', text: 'The crew reaches Halcyon with mysterious cargo.', confirmCurrent: true } });
    assert.deepEqual(saved.canon, s.canon); assert.equal(saved.recovery?.valid, true);
    assert.equal(saved.recap!.stale, false); assert.equal(saved.recap!.passageCount, 3);
    const next = r.mutate(s.id, { expectedRevision: 1, requestId: randomUUID(), action: { type: 'sample-continue', direction: '' } });
    assert.equal(next.recap!.stale, true); assert.equal(next.recap!.text, saved.recap!.text);
    const edit = r.mutate(s.id, { expectedRevision: 2, requestId: randomUUID(), action: { type: 'recap', text: 'A corrected older recap.', confirmCurrent: false } });
    assert.equal(edit.recap!.stale, true); assert.equal(edit.recap!.passageCount, 3);
    const refreshed = r.mutate(s.id, { expectedRevision: 3, requestId: randomUUID(), action: { type: 'recap', text: 'The crew reaches Halcyon; Ren receives the captain’s fob.', confirmCurrent: true } });
    assert.equal(refreshed.recap!.stale, false); assert.equal(refreshed.recap!.passageCount, 4);
    const imported = await r.import(r.export(s.id));
    assert.equal(imported.recap!.text, refreshed.recap!.text); assert.equal(imported.recap!.stale, false);
  } finally { r.close(); }
});

test('a first manual recap saved without confirming coverage remains marked for review', () => {
  const r = new StoryRepository(':memory:');
  try {
    const s = r.create();
    const saved = r.mutate(s.id, { expectedRevision: 0, requestId: randomUUID(), action: { type: 'recap', text: 'An incomplete draft.', confirmCurrent: false } });
    assert.equal(saved.recap!.stale, true);
  } finally { r.close(); }
});

test('generated recap is committed only against its original story revision, and retries are idempotent', async () => {
  const r = new StoryRepository(':memory:');
  try {
    const s = r.create();
    const result = await generateRecap(s, settings, new AbortController().signal, fakeCompletion('The Wayward arrives at Halcyon.'));
    assert.equal(result.recap.source, 'generated'); assert.equal(result.recap.passageCount, 3);
    const requestId = randomUUID();
    const saved = r.commitGeneratedRecap(s.id, { expectedRevision: 0, requestId, ...result });
    assert.equal(saved.recap!.text, 'The Wayward arrives at Halcyon.');
    assert.equal(r.commitGeneratedRecap(s.id, { expectedRevision: 0, requestId, ...result }).revision, 1);
    assert.throws(() => r.commitGeneratedRecap(s.id, { expectedRevision: 0, requestId: randomUUID(), ...result }), /story changed/i);
  } finally { r.close(); }
});

test('long recap generation bounds each request and reuses intermediate summaries', async () => {
  const s = createSample();
  s.passages[0].paragraphs = [('An established event aboard the Wayward. ').repeat(350)];
  let calls = 0;
  const shortSettings = { ...settings, maxTokens: 512, contextTokens: 4096 };
  const fetcher: typeof fetch = async (_url, init) => {
    calls++;
    const body = JSON.parse(init!.body as string);
    assert.ok(estimateInputTokens(body.messages)+body.max_tokens+1024<=shortSettings.contextTokens);
    return fakeCompletion('The crew faces a mystery at Halcyon.')(_url, init);
  };
  const first = await generateRecap(s, shortSettings, new AbortController().signal, fetcher);
  assert.ok(calls > 2);
  s.summaryCache = first.summaryCache; calls = 0;
  await generateRecap(s, shortSettings, new AbortController().signal, fetcher);
  assert.equal(calls, 1, 'refresh should regenerate the final recap while reusing the summaries');
});

test('missing configuration, refusals, truncation and cancelled generation preserve existing recap', async () => {
  const s = createSample(); const signal = new AbortController().signal;
  await assert.rejects(generateRecap(s, { ...settings, model: '' }, signal), /Model ID/);
  await assert.rejects(generateRecap(s, settings, signal, async () => new Response('secret error from upstream', { status: 401 })), /rejected the API key/);
  await assert.rejects(generateRecap(s, settings, signal, async () => new Response(JSON.stringify({ choices: [{ message: { content: 'Partial text' }, finish_reason: 'length' }] }))), /cut off/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(generateRecap(s, settings, controller.signal), /cancelled/);
  assert.equal(s.recap, null);
});
