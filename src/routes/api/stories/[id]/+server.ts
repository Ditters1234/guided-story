import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRepository, mutationSchema } from '#lib/server/repository';
import { failure, readJson } from '#lib/server/http';
import { libraryRemovalSchema } from '#lib/record-editing';
import { assertSourceIdle } from '#lib/server/jobs';

export const GET: RequestHandler = ({ params }) => { try { return json(getRepository().read(params.id)); } catch (e) { return failure(e); } };
export const PATCH: RequestHandler = async ({ params, request }) => { try { const input = mutationSchema.parse(await readJson(request)); return json(getRepository().mutate(params.id, input)); } catch (e) { return failure(e); } };
export const DELETE: RequestHandler = async ({params,request}) => {
  try{const input=libraryRemovalSchema.parse(await readJson(request));assertSourceIdle(params.id);getRepository().removeFromLibrary('story',params.id,input.expectedRevision,input.requestId);return json({removed:true});}catch(e){return failure(e);}
};
