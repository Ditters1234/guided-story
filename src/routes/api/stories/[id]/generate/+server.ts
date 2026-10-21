import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { generationRequestSchema } from '#lib/setup';
import { getRepository } from '#lib/server/repository';
import { readPrivateConnections } from '#lib/server/connections';
import { generatePassageEntry } from '#lib/server/passage-entry';
import { readJson, failure } from '#lib/server/http';
import { chapterEndingSchema } from '#lib/settings';
const schema = generationRequestSchema.extend({ mode: z.enum(['continue','replace']), direction: z.string().max(10000), chapterEnding: chapterEndingSchema.default('auto') });
export const POST: RequestHandler = async ({ params, request }) => {
  try {
    const {mode,...input}=schema.parse(await readJson(request));
    return json(await generatePassageEntry(getRepository(),mode,params.id,input,readPrivateConnections(),request.signal));
  } catch (e) { return failure(e); }
};
