import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { redact } from '../redaction';
import type { LogEntry, LogLevel, TraceEntry } from '../diagnostic-types';
import type { ActivityRequest } from '../activity';

type CaptureState = { secrets: Set<string>; store?: DiagnosticStore; installed: boolean; write?: typeof logEvent };
const shared = globalThis as typeof globalThis & { __guidedDiagnostics?: CaptureState };
const state = shared.__guidedDiagnostics ??= { secrets: new Set<string>(), installed: false };
export function registerSecrets(...values: (string | undefined)[]) { for (const v of values) if (v) state.secrets.add(v); }
export function scrub(value: unknown) { return redact(value, state.secrets); }

export class DiagnosticStore {
  private db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY AUTOINCREMENT, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS traces (id TEXT PRIMARY KEY, at TEXT NOT NULL, payload TEXT NOT NULL);`);
    // A restarted server cannot resume in-flight model calls.
    for (const row of this.db.prepare('SELECT id, payload FROM traces').all() as { id: string; payload: string }[]) {
      const trace: TraceEntry = JSON.parse(row.payload);
      if (trace.status === 'pending') { trace.status = 'error'; trace.error = 'Server restarted before this request completed.'; trace.finishedAt = new Date().toISOString(); this.db.prepare('UPDATE traces SET payload = ? WHERE id = ?').run(JSON.stringify(trace), row.id); }
    }
  }
  close() { this.db.close(); }
  append(entry: Omit<LogEntry, 'id' | 'at'>) {
    const safe = scrub({ ...entry, at: new Date().toISOString() }) as Omit<LogEntry, 'id'>;
    const result = this.db.prepare('INSERT INTO logs (payload) VALUES (?)').run(JSON.stringify(safe));
    this.db.exec('DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY id DESC LIMIT 2000)');
    return { ...safe, id: Number(result.lastInsertRowid) };
  }
  logs(after = 0, limit = 250): LogEntry[] {
    return (this.db.prepare('SELECT id, payload FROM logs WHERE id > ? ORDER BY id DESC LIMIT ?').all(after, Math.min(limit, 2000)) as { id: number; payload: string }[]).map(r => ({ ...(scrub(JSON.parse(r.payload)) as Omit<LogEntry, 'id'>), id: r.id }));
  }
  start(value: Pick<TraceEntry, 'kind' | 'request' | 'storyId' | 'storyRevision'>) {
    const trace = scrub({ ...value, id: randomUUID(), at: new Date().toISOString(), status: 'pending' }) as TraceEntry;
    this.db.prepare('INSERT INTO traces VALUES (?, ?, ?)').run(trace.id, trace.at, JSON.stringify(trace));
    this.pruneTraces();
    return trace.id;
  }
  finish(id: string, response?: unknown, error?: string) {
    const row = this.db.prepare('SELECT payload FROM traces WHERE id = ?').get(id) as { payload: string } | undefined;
    if (!row) return;
    const trace: TraceEntry = JSON.parse(row.payload);
    trace.finishedAt = new Date().toISOString(); trace.durationMs = Date.now() - Date.parse(trace.at);
    trace.status = error ? 'error' : 'complete'; trace.response = scrub(response); trace.error = error ? String(scrub(error)) : undefined;
    this.db.prepare('UPDATE traces SET payload = ? WHERE id = ?').run(JSON.stringify(trace), id);
    this.pruneTraces();
  }
  private pruneTraces(){this.db.exec("DELETE FROM traces WHERE json_extract(payload,'$.status')!='pending' AND id NOT IN (SELECT id FROM traces WHERE json_extract(payload,'$.status')!='pending' ORDER BY at DESC,rowid DESC LIMIT 100)");}
  trace(id:string):TraceEntry|null {const row=this.db.prepare('SELECT payload FROM traces WHERE id=?').get(id) as {payload:string}|undefined;return row?scrub(JSON.parse(row.payload)) as TraceEntry:null;}
  traces(): TraceEntry[] {
    let recent=0;
    return (this.db.prepare("SELECT payload,json_extract(payload,'$.status') status FROM traces ORDER BY at DESC,rowid DESC").all() as {payload:string;status:string}[]).filter(row=>row.status==='pending'||recent++<100).map(r=>scrub(JSON.parse(r.payload)) as TraceEntry);
  }
  activity(): ActivityRequest[] {
    // Exclude dry runs/state changes and never read or send prompt/response bodies during status polling.
    const rows=this.db.prepare(`SELECT id,at,
      json_extract(payload,'$.kind') kind,json_extract(payload,'$.status') status,
      json_extract(payload,'$.finishedAt') finishedAt,json_extract(payload,'$.durationMs') durationMs,
      json_extract(payload,'$.storyId') storyId,json_extract(payload,'$.storyRevision') storyRevision,
      json_extract(payload,'$.error') error,json_extract(payload,'$.request.endpoint') endpoint,
      json_extract(payload,'$.request.model') model,json_extract(payload,'$.request.stage') stage
      FROM traces WHERE json_type(payload,'$.request.endpoint')='text'
      ORDER BY CASE WHEN json_extract(payload,'$.status')='pending' THEN 0 ELSE 1 END, at DESC`).all();
    let recent=0;
    return rows.filter(row=>row.status==='pending'||recent++<20).map(row=>scrub(Object.fromEntries(Object.entries(row).filter(([,v])=>v!==null))) as ActivityRequest);
  }
  errors(): Pick<LogEntry,'id'|'at'|'message'|'source'|'requestId'>[] {
    // Keep polling cheap: no payloads, stack traces, prompts or response bodies.
    return this.db.prepare(`SELECT id,json_extract(payload,'$.at') at,substr(json_extract(payload,'$.message'),1,6000) message,
      json_extract(payload,'$.source') source,json_extract(payload,'$.requestId') requestId FROM logs
      WHERE json_extract(payload,'$.level')='error' AND json_extract(payload,'$.source') NOT IN ('http','browser-console')
      ORDER BY id DESC LIMIT 30`).all().map(row=>scrub(Object.fromEntries(Object.entries(row).filter(([,value])=>value!==null))) as Pick<LogEntry,'id'|'at'|'message'|'source'|'requestId'>);
  }
  clearLogs() { this.db.exec('DELETE FROM logs'); }
  clearTraces() { this.db.exec("DELETE FROM traces WHERE json_extract(payload, '$.status') != 'pending'"); }
}
export function getDiagnostics() {
  return state.store ??= new DiagnosticStore(process.env.NODE_TEST_CONTEXT ? ':memory:' : resolve(process.env.STORY_DATA_DIR || 'data/dev', 'diagnostics.sqlite'));
}
export function logEvent(level: LogLevel, source: string, message: string, data?: unknown, storyId?: string, requestId?: string) {
  try { return getDiagnostics().append({ level, source, message, data, storyId, requestId }); } catch { /* Diagnostic failure must not break story saves or recurse into console. */ }
}
export function beginTrace(kind: string, request: unknown, storyId?: string, storyRevision?: number) {
  try { return getDiagnostics().start({ kind, request, storyId, storyRevision }); } catch { return ''; }
}
export function endTrace(id: string, response?: unknown, error?: string) {
  try { getDiagnostics().finish(id, response, error); } catch { /* Best effort diagnostics. */ }
}
export function captureServerConsole() {
  state.write = logEvent;
  if (state.installed) return;
  state.installed = true;
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      const safe = scrub(args) as unknown[];
      original(...safe);
      if (safe.some(a => typeof a === 'string' && a.includes('/api/dev/diagnostics'))) return;
      state.write?.(method === 'log' ? 'info' : method, 'server-console', safe.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' '), safe);
    };
  }
}
