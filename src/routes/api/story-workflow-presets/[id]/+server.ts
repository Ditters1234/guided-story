import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRepository } from '#lib/server/repository';
import { failure,readJson } from '#lib/server/http';
export const GET:RequestHandler=({params})=>{try{return json(getRepository().workflowPresets.read(params.id));}catch(error){return failure(error);}};
export const PATCH:RequestHandler=async({params,request})=>{try{return json(getRepository().workflowPresets.save(params.id,await readJson(request)));}catch(error){return failure(error);}};
