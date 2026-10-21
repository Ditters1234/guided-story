import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JobStore, runStoryJob, getJobs, cancelJob } from '../src/lib/server/jobs';
import { registerSecrets } from '../src/lib/server/diagnostics';
const input = () => ({ kind: 'recap', requestId: randomUUID(), storyId: randomUUID(), expectedRevision: 0, lockKey: 'story:' + randomUUID(), input: { passageId: 'first' } });

test('job restart interrupts text while retaining its draft and preserves resumable image handles', () => {
  const folder = mkdtempSync(join(tmpdir(), 'guided-jobs-')), path = join(folder, 'jobs.sqlite'); let store = new JobStore(path);
  try {
    const a = input(), b = { ...input(), kind: 'image-test' };
    const text = store.start(a).job, image = store.start(b).job;
    store.transition(text.id, 'generating'); store.transition(text.id, 'validating', { details: { draft: { summary: 'Unsaved draft' } } });
    store.transition(image.id, 'generating', { recoverable: true, details: { provider: { baseUrl: 'http://127.0.0.1:8188', promptId: 'original-prompt' } } });
    store.close(); store = new JobStore(path);
    assert.equal(store.read(text.id).state, 'interrupted'); assert.deepEqual(store.read(text.id).details.draft, { summary: 'Unsaved draft' });
    assert.equal(store.read(image.id).state, 'generating'); assert.equal((store.read(image.id).details.provider as { promptId: string }).promptId, 'original-prompt');
    const retry = store.start(a); assert.equal(retry.fresh, true); assert.equal(retry.job.attempt, 2);
    assert.throws(() => store.start({ ...a, input: { passageId: 'different' } }), /different generation inputs/);
  } finally { store.close(); for (const name of readdirSync(folder)) unlinkSync(join(folder, name)); rmdirSync(folder); }
});
test('jobs enforce per-story exclusion across generation kinds, phase order and secret redaction', () => {
  const store = new JobStore(':memory:'); registerSecrets('private-job-key');
  try {
    const a = input(), job = store.start(a).job;
    assert.throws(() => store.start({ ...a, requestId: randomUUID(), kind: 'continuity-memory' }), /already running/);
    assert.throws(() => store.transition(job.id, 'complete'), /Invalid job transition/);
    store.transition(job.id, 'generating'); store.transition(job.id, 'validating', { details: { apiKey: 'unknown-key', note: 'private-job-key' } }); store.transition(job.id, 'committing'); store.transition(job.id, 'complete');
    const text = JSON.stringify(store.read(job.id)); assert.ok(!text.includes('unknown-key')); assert.ok(!text.includes('private-job-key'));
    assert.equal(store.start(a).fresh, false); assert.equal(store.read(job.id).attempt, 1);
  } finally { store.close(); }
});
test('duplicate in-flight requests share one provider task and completed requests replay without calling it again', async () => {
  const a = input(); let calls = 0, release!: () => void;
  const gate = new Promise<void>(resolve => release = resolve);
  const task = async (job: Parameters<Parameters<typeof runStoryJob>[2]>[0]) => { calls++; await gate; job.stage('validating'); job.stage('committing'); return 7; };
  const first = runStoryJob(a, new AbortController().signal, task, () => 9);
  const second = runStoryJob(a, new AbortController().signal, task, () => 9);
  release(); assert.deepEqual(await Promise.all([first, second]), [7, 7]); assert.equal(calls, 1);
  assert.equal(await runStoryJob(a, new AbortController().signal, task, () => 9), 9); assert.equal(calls, 1);
});
test('cancellation is recorded and prevents a task from entering commit', async () => {
  const a = input(); let committing = false;
  const promise = runStoryJob(a, new AbortController().signal, async job => {
    await new Promise<void>(resolve => job.signal.addEventListener('abort', () => resolve(), { once: true }));
    job.stage('validating'); committing = true; job.stage('committing'); return 1;
  }, () => 0);
  const row = getJobs().find(a)!; cancelJob(row.id);
  await assert.rejects(promise, /cancelled/); assert.equal(committing, false); assert.equal(getJobs().read(row.id).state, 'cancelled');
});
