import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readPrivateConnections } from '#lib/server/connections';
import { fetchProviderModels } from '#lib/server/provider-models';
import { failure } from '#lib/server/http';
export const GET: RequestHandler = async ({ request }) => {
  try { return json(await fetchProviderModels(readPrivateConnections().text, AbortSignal.any([request.signal, AbortSignal.timeout(15000)]))); }
  catch (e) { return failure(e); }
};
