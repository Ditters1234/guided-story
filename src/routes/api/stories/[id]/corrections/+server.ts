import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { correctionRequestSchema } from '#lib/story-corrections';
import { getRepository } from '#lib/server/repository';
import { runCorrection } from '#lib/server/story-corrections';
import { readJson, failure } from '#lib/server/http';

export const GET:RequestHandler=({params})=>{
  try{return json({results:getRepository().listCorrectionResults(params.id)});}catch(e){return failure(e);}
};
export const POST:RequestHandler=async({params,request})=>{
  try{return json(await runCorrection(params.id,correctionRequestSchema.parse(await readJson(request)),request.signal));}catch(e){return failure(e);}
};
