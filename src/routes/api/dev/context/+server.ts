import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { getRepository } from '#lib/server/repository';
import { previewContinuationContext } from '#lib/server/story-generation';
import { readPrivateConnections } from '#lib/server/connections';
import { beginTrace, endTrace, scrub } from '#lib/server/diagnostics';
import { failure, readJson } from '#lib/server/http';
const inputSchema = z.object({ storyId: z.string().min(1).max(100), direction: z.string().max(10000).default('') });
export const POST: RequestHandler = async ({ request }) => {
  try {
    const input = inputSchema.parse(await readJson(request)), story = getRepository().read(input.storyId), settings = readPrivateConnections();
    const report = previewContinuationContext(story, input.direction, settings);
    const trace = beginTrace('context-preview', { note: 'Dry run: no model request', direction: input.direction, ...report }, story.id, story.revision);
    endTrace(trace, { runnable: report.runnable, inputBytes: report.inputBytes, inputTokens: report.inputTokens, budgetMethod: report.budgetMethod, included: report.sources.filter(s => s.included).length });
    return json(scrub(report));
  } catch (e) { return failure(e); }
};
