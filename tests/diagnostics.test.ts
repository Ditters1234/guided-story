import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../src/lib/redaction';
import { DiagnosticStore, registerSecrets } from '../src/lib/server/diagnostics';

test('redaction handles credential fields, bearer text, registered values, nested errors and circular objects', () => {
  const cyclic: Record<string, unknown> = { apiKey: 'should-never-appear', Authorization: 'Bearer another-private-value', nested: { tokenNote: 'remember local-private-value', password: 'password-value' }, error: new Error('local-private-value failed') }; cyclic.self = cyclic;
  const safe = JSON.stringify(redact(cyclic, ['local-private-value']));
  for (const secret of ['should-never-appear', 'another-private-value', 'local-private-value', 'password-value']) assert.ok(!safe.includes(secret));
  assert.ok(safe.includes('[redacted]')); assert.ok(safe.includes('[circular]'));
  assert.ok(!String(redact('Authorization=Bearer secret-at-the-end')).includes('secret-at-the-end'));
});

test('persisted log and request records redact secrets before storage and keep request/result provenance', () => {
  const store = new DiagnosticStore(':memory:'); registerSecrets('private-diagnostic-secret');
  try {
    store.append({ level: 'error', source: 'test', message: 'Request private-diagnostic-secret failed', data: { apiKey: 'another-secret' } });
    const id = store.start({ kind: 'recap', storyId: 'sample', storyRevision: 4, request: { messages: ['private-diagnostic-secret'], headers: { Authorization: 'Bearer header-secret' } } });
    store.finish(id, { content: 'A safe result', apiKey: 'result-secret' });
    const text = JSON.stringify({ logs: store.logs(), traces: store.traces() });
    for (const secret of ['private-diagnostic-secret', 'another-secret', 'header-secret', 'result-secret']) assert.ok(!text.includes(secret));
    assert.equal(store.traces()[0].status, 'complete'); assert.equal(store.traces()[0].storyRevision, 4);
    store.clearLogs(); assert.equal(store.logs().length, 0); assert.equal(store.traces().length, 1);
    store.clearTraces(); assert.equal(store.traces().length, 0);
  } finally { store.close(); }
});
