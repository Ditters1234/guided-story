import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRepository } from '#lib/server/repository';
import { readJson, failure } from '#lib/server/http';
import { libraryRemovalSchema } from '#lib/record-editing';
import { assertSourceIdle } from '#lib/server/jobs';
export const GET: RequestHandler = ({ params }) => { try { return json(getRepository().readSetup(params.id)); } catch (e) { return failure(e); } };
export const PATCH: RequestHandler = async ({ params, request }) => { try { return json(getRepository().saveSetup(params.id, await readJson(request))); } catch (e) { return failure(e); } };
export const DELETE: RequestHandler = async ({params,request}) => {
  try{const input=libraryRemovalSchema.parse(await readJson(request));assertSourceIdle(params.id);getRepository().removeFromLibrary('setup',params.id,input.expectedRevision,input.requestId);return json({removed:true});}catch(e){return failure(e);}
};
