import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchProviderModels } from '../src/lib/server/provider-models';
const settings = { baseUrl: 'http://127.0.0.1:8888/v1/', apiKey: 'private-model-list-key' };

test('model discovery uses saved credentials and returns distinct valid IDs', async () => {
  const mock: typeof fetch = async (url, init) => {
    assert.equal(url, 'http://127.0.0.1:8888/v1/models');
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer private-model-list-key');
    return new Response(JSON.stringify({ data: [{ id: 'model-b' }, { id: 'model-a' }, { id: 'model-b' }, { id: '' }, { name: 'invalid' }] }));
  };
  assert.deepEqual((await fetchProviderModels(settings, new AbortController().signal, mock)).models, ['model-a', 'model-b']);
});

test('model discovery distinguishes authentication failures, invalid lists and network failure', async () => {
  const signal = new AbortController().signal;
  await assert.rejects(fetchProviderModels(settings, signal, async () => new Response('', { status: 401 })), /rejected the saved key/);
  await assert.rejects(fetchProviderModels(settings, signal, async () => new Response('{}')), /compatible model list/);
  await assert.rejects(fetchProviderModels(settings, signal, async () => { throw new Error('connection refused'); }), /Could not reach/);
  assert.deepEqual((await fetchProviderModels(settings, signal, async () => new Response('{"data":[]}'))).models, []);
});
