import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { JobRecord, JobState } from '../job-types';
import { StoryError } from '../errors';
import { logEvent, scrub } from './diagnostics';
import type { ActivityJob } from '../activity';
const pending = new Set<JobState>(['queued', 'generating', 'validating', 'committing']);
const transitions: Record<JobState, JobState[]> = { queued: ['generating', 'failed', 'cancelled', 'interrupted'], generating: ['validating', 'failed', 'cancelled', 'interrupted'], validating: ['committing', 'complete', 'failed', 'cancelled', 'interrupted'], committing: ['complete', 'failed', 'interrupted'], complete: [], failed: [], cancelled: [], interrupted: [] };
function canonical(value: unknown): unknown { if (Array.isArray(value)) return value.map(canonical); if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])); return value; }
export function jobFingerprint(value: unknown) { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
export type JobStart = { kind: string; requestId: string; storyId?: string; expectedRevision?: number; targetId?: string; lockKey: string; input: unknown };

export class JobStore {
  private db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, request_key TEXT UNIQUE NOT NULL, lock_key TEXT NOT NULL, state TEXT NOT NULL, updated_at TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_job ON jobs(lock_key) WHERE state IN ('queued','generating','validating','committing');`);
    const unfinished = this.db.prepare("SELECT payload FROM jobs WHERE state IN ('queued','generating','validating','committing')").all() as { payload: string }[];
    for (const row of unfinished) { const record: JobRecord = JSON.parse(row.payload); if (!record.recoverable) this.transition(record.id, 'interrupted', { error: 'Server stopped before this operation finished. No automatic resubmission was made.' }); }
  }
  close() { this.db.close(); }
  assertScopeIdle(id:string) {
    const active=this.db.prepare("SELECT payload FROM jobs WHERE state IN ('queued','generating','validating','committing')").all() as {payload:string}[];
    if(active.some(row=>{const j:JobRecord=JSON.parse(row.payload);return j.storyId===id||j.targetId===id||j.lockKey.endsWith(':'+id);}))throw new StoryError('Generation is still active for this story or setup. Finish or cancel it in Dev → Jobs before removing it.',409);
  }
  private key(input: Pick<JobStart, 'storyId' | 'requestId'>) { return `${input.storyId || 'application'}:${input.requestId}`; }
  private save(job: JobRecord) {
    const safe = scrub(JSON.parse(JSON.stringify(job))) as JobRecord;
    this.db.prepare('INSERT INTO jobs VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET state=excluded.state, updated_at=excluded.updated_at, payload=excluded.payload').run(safe.id, this.key(safe), safe.lockKey, safe.state, safe.updatedAt, JSON.stringify(safe));
    return safe;
  }
  read(id: string) { const row = this.db.prepare('SELECT payload FROM jobs WHERE id=?').get(id) as { payload: string } | undefined; if (!row) throw new StoryError('Generation job not found.', 404); return JSON.parse(row.payload) as JobRecord; }
  list(limit = 100): JobRecord[] { return (this.db.prepare('SELECT payload FROM jobs ORDER BY updated_at DESC, rowid DESC LIMIT ?').all(Math.min(Math.max(1, limit), 10000)) as { payload: string }[]).map(r => JSON.parse(r.payload)); }
  activity(): ActivityJob[] {
    // Return every active operation plus a small recent tail, without loading saved drafts/graphs.
    const columns=`id,state,updated_at updatedAt,json_extract(payload,'$.kind') kind,
      json_extract(payload,'$.storyId') storyId,json_extract(payload,'$.createdAt') createdAt,
      json_extract(payload,'$.recoverable') recoverable,json_extract(payload,'$.error') error,
      json_extract(payload,'$.attempt') attempt,json_extract(payload,'$.details.stage') stage`;
    const current=this.db.prepare(`SELECT ${columns} FROM jobs WHERE state IN ('queued','generating','validating','committing') ORDER BY updated_at DESC`).all();
    const recent=this.db.prepare(`SELECT ${columns} FROM jobs WHERE state NOT IN ('queued','generating','validating','committing') ORDER BY updated_at DESC,rowid DESC LIMIT 5`).all();
    return [...current,...recent].map(row=>scrub(Object.fromEntries(Object.entries({...row,recoverable:Boolean(row.recoverable)}).filter(([,v])=>v!==null))) as ActivityJob);
  }
  find(input: Pick<JobStart, 'storyId' | 'requestId'>) { const row = this.db.prepare('SELECT payload FROM jobs WHERE request_key=?').get(this.key(input)) as { payload: string } | undefined; return row ? JSON.parse(row.payload) as JobRecord : null; }
  start(input: JobStart) {
    const fingerprint = jobFingerprint({ kind: input.kind, expectedRevision: input.expectedRevision, targetId: input.targetId, input: input.input });
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const prior = this.find(input);
      if (prior && (prior.fingerprint !== fingerprint || prior.kind !== input.kind)) throw new StoryError('This request ID belongs to different generation inputs. Start a new request.', 409);
      if (prior && (pending.has(prior.state) || prior.state === 'complete')) { this.db.exec('COMMIT'); return { job: prior, fresh: false }; }
      const active = this.db.prepare("SELECT id FROM jobs WHERE lock_key=? AND state IN ('queued','generating','validating','committing')").get(input.lockKey);
      if (active) throw new StoryError('Another generation is already running for this story or test service. Inspect Dev → Jobs.', 409);
      const at = new Date().toISOString(), attempt = (prior?.attempt || 0) + 1;
      const job: JobRecord = { id: prior?.id || randomUUID(), kind: input.kind, storyId: input.storyId, requestId: input.requestId, expectedRevision: input.expectedRevision, targetId: input.targetId, lockKey: input.lockKey, fingerprint, state: 'queued', recoverable: false, attempt, createdAt: prior?.createdAt || at, updatedAt: at, history: [...(prior?.history || []), { at, state: 'queued' as const, attempt }].slice(-100), details: {} };
      const saved = this.save(job); this.db.exec('COMMIT'); return { job: saved, fresh: true };
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  transition(id: string, state: JobState, patch: { details?: Record<string, unknown>; error?: string; recoverable?: boolean } = {}) {
    const job = this.read(id);
    if (state !== job.state && !transitions[job.state].includes(state)) throw new StoryError(`Invalid job transition ${job.state} → ${state}.`, 409);
    job.state = state; job.updatedAt = new Date().toISOString();
    if (patch.error !== undefined) job.error = patch.error;
    if (patch.recoverable !== undefined) job.recoverable = patch.recoverable;
    if (patch.details) job.details = { ...job.details, ...patch.details };
    if (job.history.at(-1)?.state !== state) job.history = [...job.history, { at: job.updatedAt, state, attempt: job.attempt }].slice(-100);
    const saved = this.save(job); logEvent(state === 'failed' || state === 'interrupted' ? 'warn' : 'info', 'jobs', `${job.kind}: ${state}`, { jobId: id, attempt: job.attempt }, job.storyId, job.requestId); return saved;
  }
}
type Running = { promise: Promise<unknown>; controller: AbortController };
const shared = globalThis as typeof globalThis & { __guidedJobs?: { store?: JobStore; active: Map<string, Running> } };
const runtime = shared.__guidedJobs ??= { active: new Map<string, Running>() };
export function getJobs() { return runtime.store ??= new JobStore(process.env.NODE_TEST_CONTEXT ? ':memory:' : resolve(process.env.STORY_DATA_DIR || 'data/dev', 'jobs.sqlite')); }
/** A cancelled job can still be unwinding its provider promise. */
export function sourceJobIsActive(sourceId:string) {
  return [...runtime.active.keys()].some(id=>{const job=getJobs().read(id);return job.storyId===sourceId||job.targetId===sourceId||job.lockKey.endsWith(':'+sourceId);});
}
export function assertSourceIdle(sourceId:string) {
  getJobs().assertScopeIdle(sourceId);
  if(sourceJobIsActive(sourceId))throw new StoryError('An operation is still stopping. Wait for it to finish before removing stored history.',409);
}
export function cancelJob(id: string) {
  const job = getJobs().read(id), active = runtime.active.get(id);
  if (!pending.has(job.state)) return job;
  if (!active || job.recoverable) throw new StoryError('This provider job cannot be interrupted here. Image jobs continue on their original ComfyUI server.', 409);
  if (job.state === 'committing') throw new StoryError('The result is committing and can no longer be cancelled.', 409);
  active.controller.abort(); return getJobs().transition(id, 'cancelled', { error: 'Cancelled by the user. The prior story was kept.' });
}
export type JobContext = { id: string; signal: AbortSignal; stage: (state: 'validating' | 'committing', details?: Record<string, unknown>) => void };
export async function runStoryJob<T>(input: JobStart, signal: AbortSignal, task: (context: JobContext) => Promise<T>, replay: () => T): Promise<T> {
  const store = getJobs(), started = store.start(input), job = started.job;
  if (!started.fresh) {
    if (job.state === 'complete') return replay();
    const same = runtime.active.get(job.id); if (same) return same.promise as Promise<T>;
    throw new StoryError('This request is already running. Inspect Dev → Jobs before retrying.', 409);
  }
  const controller = new AbortController(), combined = AbortSignal.any([signal, controller.signal]);
  const promise = (async () => {
    try {
      if (combined.aborted) throw new StoryError('Generation was cancelled.', 408);
      store.transition(job.id, 'generating');
      const result = await task({ id: job.id, signal: combined, stage: (state, details) => {
        if (combined.aborted) throw new StoryError('Generation was cancelled before commit. Existing story records were kept.', 408);
        store.transition(job.id, state, { details });
      } });
      store.transition(job.id, 'complete'); return result;
    } catch (e) {
      const current = store.read(job.id);
      if (pending.has(current.state)) store.transition(job.id, combined.aborted ? 'cancelled' : 'failed', { error: e instanceof StoryError ? e.message : 'Generation failed. Inspect request diagnostics.' });
      throw e;
    } finally { runtime.active.delete(job.id); }
  })();
  runtime.active.set(job.id, { promise, controller }); return promise;
}
