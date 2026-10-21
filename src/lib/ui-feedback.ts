import { writable } from 'svelte/store';
import { redactClient } from './client-secrets';
import type { ActivitySnapshot } from './activity';

export type UiError = {
  id: string; message: string; source: string; at: string; lastAt: string;
  count: number; read: boolean; requestId?: string;
};
type ErrorInput = { message: string; source: string; id?: string; at?: string; requestId?: string };

// Browser-session history only. Never part of a story or its exports.
export function createErrorInbox() {
  const store = writable<UiError[]>([]), seen = new Set<string>();
  let sequence = 0, clearedAt = 0;
  const dismissedMessages = new Map<string, number>();
  function report(input: ErrorInput) {
    if (!input.message.trim() || (input.id && seen.has(input.id))) return;
    if (input.id) { seen.add(input.id); if (seen.size > 4000) seen.delete(seen.values().next().value!); }
    const message = String(redactClient(input.message)), source = String(redactClient(input.source, 160));
    const at = input.at || new Date().toISOString();
    if (input.id && Date.parse(at) <= Math.max(clearedAt, dismissedMessages.get(message) || 0)) return;
    store.update(entries => {
      const duplicate = entries.find(e => e.message === message && Math.abs(Date.parse(at) - Date.parse(e.lastAt)) < 15000);
      if (duplicate) return entries.map(e => e === duplicate ? { ...e, lastAt: at > e.lastAt ? at : e.lastAt, count: e.count + 1, read: false, requestId: e.requestId || input.requestId } : e);
      return [{ id: input.id || `ui-${++sequence}`, message, source, at, lastAt: at, count: 1, read: false, requestId: input.requestId }, ...entries].sort((a,b)=>b.lastAt.localeCompare(a.lastAt)).slice(0, 100);
    });
  }
  return {
    subscribe: store.subscribe, report,
    markRead() { store.update(entries => entries.map(e => e.read ? e : { ...e, read: true })); },
    dismiss(id: string) { store.update(entries => entries.filter(e => { if (e.id !== id) return true; dismissedMessages.set(e.message, Date.now()); return false; })); },
    clear() { clearedAt = Date.now(); dismissedMessages.clear(); store.set([]); },
    ingest(snapshot: ActivitySnapshot) {
      for (const request of snapshot.requests.filter(r => r.status === 'error')) report({ id: `request-${request.id}`, at: request.finishedAt || request.at, message: request.error || 'The API request failed. Select it in Requests for details.', source: 'API · ' + request.kind.replace(/-/g,' '), requestId: request.id });
      for (const job of snapshot.jobs.filter(j => j.error && !['cancelled','superseded'].includes(j.state))) report({ id: `job-${job.id}-${job.attempt}`, at: job.updatedAt, message: job.error!, source: 'Generation · ' + job.kind.replace(/-/g,' ') });
      // This tab already captures its console synchronously; its delayed transport must not replay dismissed errors.
      for (const entry of (snapshot.errors || []).filter(e => e.source !== 'browser-console')) report({ id: `log-${entry.id}`, at: entry.at, message: entry.message, source: 'Server · ' + entry.source, requestId: entry.requestId });
    }
  };
}
export const uiErrors = createErrorInbox();
export function reportUiError(message: string, source: string) {
  if (typeof window !== 'undefined') uiErrors.report({ message, source });
}
