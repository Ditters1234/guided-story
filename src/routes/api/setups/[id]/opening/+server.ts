import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { generationRequestSchema } from '#lib/setup';
import { getRepository } from '#lib/server/repository';
import { readPrivateConnections } from '#lib/server/connections';
import { generatePassageEntry } from '#lib/server/passage-entry';
import { readJson, failure } from '#lib/server/http';
import { presetReferenceSchema } from '#lib/story-workflow/compile';
export const POST: RequestHandler = async ({ params, request }) => {
  try {
    const input=generationRequestSchema.extend({preset:presetReferenceSchema.optional()}).parse(await readJson(request));
    return json(await generatePassageEntry(getRepository(),'opening',params.id,{...input,direction:''},readPrivateConnections(),request.signal));
  } catch (e) { return failure(e); }
};
