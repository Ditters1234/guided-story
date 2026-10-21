import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { getRepository } from '#lib/server/repository';
import { readJson, failure } from '#lib/server/http';
const schema=z.strictObject({expectedRevision:z.number().int().min(0),requestId:z.string().uuid()});
export const POST: RequestHandler = async ({params,request}) => {
  try { const input=schema.parse(await readJson(request));return json(getRepository().acceptPolish(params.id,params.resultId,input.expectedRevision,input.requestId)); } catch(e) { return failure(e); }
};
