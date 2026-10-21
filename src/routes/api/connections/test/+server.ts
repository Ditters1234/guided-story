import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { connectionSchema, readPrivateConnections } from '#lib/server/connections';
import { fetchProviderModels } from '#lib/server/provider-models';
import { testComfyConnection } from '#lib/server/comfy-connection';
import { failure, readJson } from '#lib/server/http';
const schema = z.discriminatedUnion('target', [
  z.object({ target: z.literal('text'), text: connectionSchema.shape.text.pick({ baseUrl: true, apiKey: true }) }),
  z.object({ target: z.literal('images'), images: connectionSchema.shape.images.pick({ baseUrl: true }) })
]);
export const POST: RequestHandler = async ({ request }) => {
  try {
    const input = schema.parse(await readJson(request));
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(15000)]);
    if (input.target === 'images') return json(await testComfyConnection(input.images.baseUrl, signal));
    return json(await fetchProviderModels({ ...input.text, apiKey: input.text.apiKey ?? readPrivateConnections().text.apiKey }, signal));
  } catch (e) { return failure(e); }
};
