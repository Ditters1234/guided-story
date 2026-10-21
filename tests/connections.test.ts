import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeConnectionSettings, connectionSchema } from '../src/lib/server/connections';
import { testComfyConnection } from '../src/lib/server/comfy-connection';
const saved = connectionSchema.parse({
  text: { baseUrl: 'http://127.0.0.1:8888/v1', model: 'saved-model', apiKey: 'private-saved-key', temperature: 0.8, maxTokens: 1536, contextTokens: 16384, structuredOutput: 'auto' as const },
  images: { baseUrl: 'http://127.0.0.1:8188', workflow: 'saved-workflow.json' }
});

test('independent connection saves preserve the other service and retain a key unless explicitly changed', () => {
  const images = { ...saved.images, baseUrl: 'http://127.0.0.1:8190', workflow: 'new-workflow.json' };
  assert.deepEqual(mergeConnectionSettings(saved, { images }), { ...saved, images });
  const { apiKey, ...text } = saved.text;
  assert.deepEqual(mergeConnectionSettings(saved, { text: { ...text, model: 'new-model' } }), { ...saved, text: { ...saved.text, model: 'new-model' } });
  assert.equal(mergeConnectionSettings(saved, { text: { ...text, apiKey: '' } }).text.apiKey, '');
  assert.equal(saved.text.apiKey, apiKey);
  assert.throws(() => mergeConnectionSettings(saved, {}));
  assert.throws(() => mergeConnectionSettings(saved, { images: { ...images, baseUrl: 'invalid' } }));
});

test('ComfyUI test checks system stats only and returns limited version/device information', async () => {
  const result = await testComfyConnection(saved.images.baseUrl + '/', new AbortController().signal, async (url, init) => {
    assert.equal(url, 'http://127.0.0.1:8188/system_stats'); assert.equal(init?.method, undefined);
    return new Response(JSON.stringify({ system: { comfyui_version: '0.40.0', argv: ['private-path'] }, devices: [{ name: 'QA GPU', vram_free: 123 }] }));
  });
  assert.equal(result.version, '0.40.0'); assert.deepEqual(result.devices, ['QA GPU']); assert.ok(!JSON.stringify(result).includes('private-path'));
});

test('ComfyUI test reports offline, unexpected server, and HTTP failures', async () => {
  const signal = new AbortController().signal;
  await assert.rejects(testComfyConnection(saved.images.baseUrl, signal, async () => { throw new Error('offline'); }), /Could not reach ComfyUI/);
  await assert.rejects(testComfyConnection(saved.images.baseUrl, signal, async () => new Response('{}')), /valid ComfyUI/);
  await assert.rejects(testComfyConnection(saved.images.baseUrl, signal, async () => new Response('', { status: 503 })), /HTTP 503/);
});
