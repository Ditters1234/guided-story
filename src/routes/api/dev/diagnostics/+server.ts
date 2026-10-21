import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { getDiagnostics, logEvent, scrub } from '#lib/server/diagnostics';
import { failure, readJson } from '#lib/server/http';
const input = z.object({ entries: z.array(z.object({ level: z.enum(['debug', 'info', 'warn', 'error']), message: z.string().max(12000), data: z.unknown().optional() })).max(20) });
export const GET: RequestHandler = ({ url }) => {
  try {
    const store = getDiagnostics();
    const limit = url.searchParams.has('download') ? 2000 : Math.max(1, Math.min(2000, Number(url.searchParams.get('limit')) || 250));
    if (url.searchParams.has('trace')) return json(store.trace(url.searchParams.get('trace')!));
    const traces=store.traces();
    const payload = { logs: store.logs(0, limit), traces: url.searchParams.has('download') ? traces : traces.map(({ request, response, ...summary }) => summary), retention: { logs: 2000, traces: 100 }, instance: process.env.STORY_INSTANCE || 'dev' };
    return json(payload, url.searchParams.has('download') ? { headers: { 'Content-Disposition': 'attachment; filename="guided-story-diagnostics.json"' } } : undefined);
  } catch (e) { return failure(e); }
};
export const POST: RequestHandler = async ({ request }) => {
  try { const { entries } = input.parse(await readJson(request)); for (const e of entries) logEvent(e.level, 'browser-console', e.message, e.data); return json({ ok: true }); } catch (e) { return failure(e); }
};
export const DELETE: RequestHandler = ({ url }) => {
  try { if (url.searchParams.get('target') === 'traces') getDiagnostics().clearTraces(); else getDiagnostics().clearLogs(); return json({ ok: true }); } catch (e) { return failure(e); }
};
