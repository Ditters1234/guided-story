import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRepository } from '#lib/server/repository';
import { failure, readJson } from '#lib/server/http';
import { assertSourceIdle } from '#lib/server/jobs';

export const POST: RequestHandler = async ({params,request}) => {
  try{const input=await readJson(request);assertSourceIdle(params.id);return json(getRepository().forkPassage(params.id,params.passageId,input));}
  catch(error){return failure(error);}
};
