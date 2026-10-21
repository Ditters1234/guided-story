import { test } from 'node:test';
import assert from 'node:assert/strict';
import { get } from 'svelte/store';
import { createErrorInbox } from '../src/lib/ui-feedback';
import { registerClientSecret, setClientDraftSecret, redactClient } from '../src/lib/client-secrets';
import { DiagnosticStore, registerSecrets } from '../src/lib/server/diagnostics';
import type { ActivitySnapshot } from '../src/lib/activity';

const snapshot = (at: string): ActivitySnapshot => ({ at, activeRequests: 0, activeJobs: 0, jobs: [], requests: [{ id: 'failed-request', kind: 'story-question', at, finishedAt: at, status: 'error', endpoint: 'http://localhost/v1', error: 'The provider is unavailable.' }] });

test('error inbox redacts secrets, groups errors, bounds history, and tracks unread state', () => {
  setClientDraftSecret('s'); setClientDraftSecret('secure-draft-key');
  assert.equal(redactClient('Story saved. secure-draft-key'), 'Story saved. [redacted]');
  setClientDraftSecret(''); assert.equal(redactClient('Story saved.'), 'Story saved.');
  registerClientSecret('ui-private-key');
  const inbox = createErrorInbox();
  inbox.report({ message: 'ui-private-key failed. Bearer another-private-value', source: 'Settings' });
  inbox.report({ message: 'ui-private-key failed. Bearer another-private-value', source: 'Browser' });
  assert.equal(get(inbox).length, 1); assert.equal(get(inbox)[0].count, 2);
  assert.ok(!JSON.stringify(get(inbox)).includes('ui-private-key')); assert.ok(!JSON.stringify(get(inbox)).includes('another-private-value'));
  inbox.markRead(); assert.equal(get(inbox)[0].read, true);
  inbox.report({ message: 'ui-private-key failed. Bearer another-private-value', source: 'Settings' });
  assert.equal(get(inbox)[0].read, false);
  for (let i = 0; i < 110; i++) inbox.report({ message: 'Different error ' + i, source: 'Test' });
  assert.equal(get(inbox).length, 100);
});

test('polling, dismissal and clear cannot resurrect old errors, including a delayed first poll', () => {
  const inbox = createErrorInbox(), at = new Date(Date.now() - 1000).toISOString(), data = snapshot(at);
  inbox.ingest(data); inbox.ingest(data); assert.equal(get(inbox).length, 1); assert.equal(get(inbox)[0].count, 1);
  inbox.dismiss(get(inbox)[0].id); inbox.ingest(data); assert.equal(get(inbox).length, 0);
  const delayed = createErrorInbox();
  delayed.report({ message: 'The provider is unavailable.', source: 'Story editor', at }); delayed.clear(); delayed.ingest(data);
  assert.equal(get(delayed).length, 0);
  delayed.ingest({ ...data, errors: [{ id: 7, at: new Date().toISOString(), source: 'browser-console', message: 'Delayed browser transport' }] });
  assert.equal(get(delayed).length, 0);
  delayed.report({ message: 'A new user attempt failed.', source: 'Story editor' }); assert.equal(get(delayed).length, 1);
});

test('bottom activity includes bounded redacted server errors without bulky log data', () => {
  registerSecrets('bottom-server-private-key');
  const store = new DiagnosticStore(':memory:');
  try {
    store.append({ level: 'info', source: 'server-console', message: 'Successful work' });
    store.append({ level: 'error', source: 'http', message: 'POST /api/stories · 500' });
    for (let i = 0; i < 35; i++) store.append({ level: 'error', source: 'server-console', message: `Failure ${i}: bottom-server-private-key`, data: { request: 'PRIVATE_BODY_MARKER' } });
    const rows = store.errors(), text = JSON.stringify(rows);
    assert.equal(rows.length, 30); assert.ok(rows[0].message.includes('34')); assert.ok(rows.every(row => !('data' in row)));
    for (const hidden of ['bottom-server-private-key', 'PRIVATE_BODY_MARKER', 'Successful work', 'POST /api/stories']) assert.ok(!text.includes(hidden));
  } finally { store.close(); }
});
