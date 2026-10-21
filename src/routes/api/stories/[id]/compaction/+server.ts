import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { getRepository } from '#lib/server/repository';
import { compactionPlan } from '#lib/server/context-state';
import { runCompaction } from '#lib/server/memory-compaction';
import { readPrivateConnections } from '#lib/server/connections';
import { readJson, failure } from '#lib/server/http';
import { StoryError } from '#lib/errors';
const schema = z.object({ expectedRevision: z.number().int().min(0), requestId: z.string().uuid() });
export const GET: RequestHandler = async ({ params }) => {
  try { const story = getRepository().read(params.id), c = readPrivateConnections(); return json({ ...compactionPlan(story, c.context.recentChapters), automatic: c.context.autoCompact }); }
  catch (e) { return failure(e); }
};
export const POST: RequestHandler = async ({ params, request }) => {
  try {
    const input = schema.parse(await readJson(request)), r = getRepository();
    const prior = r.compactionResult(params.id, input.requestId); if (prior) return json(prior);
    const story = r.read(params.id);
    if (story.revision !== input.expectedRevision) throw new StoryError('The story changed. Reload before rebuilding memory.', 409);
    return json(await runCompaction(story, input.requestId, request.signal));
  } catch (e) { return failure(e); }
};
