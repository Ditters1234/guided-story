import { json } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { captureServerConsole, logEvent } from '#lib/server/diagnostics';
import { readPrivateConnections } from '#lib/server/connections';
import { getJobs } from '#lib/server/jobs';

try { readPrivateConnections(); } catch { /* Config diagnostics are available from Settings. */ }
captureServerConsole();
getJobs();

export const handle: Handle = async ({ event, resolve }) => {
  const started = performance.now();
  if (event.url.pathname.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(event.request.method)) {
    const origin = event.request.headers.get('origin');
    if (event.request.headers.get('sec-fetch-site') === 'cross-site' || (origin && origin !== event.url.origin)) return json({ error: 'Use this application from its local address.' }, { status: 403 });
  }
  const response = await resolve(event);
  if (event.url.pathname.startsWith('/api/') && !event.url.pathname.startsWith('/api/dev/')) logEvent(response.status >= 500 ? 'error' : response.status >= 400 ? 'warn' : 'info', 'http', `${event.request.method} ${event.url.pathname} · ${response.status}`, { method: event.request.method, path: event.url.pathname, status: response.status, durationMs: Math.round(performance.now() - started) }, event.params.id);
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
};
