import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRepository } from '#lib/server/repository';
import { failure,readJson } from '#lib/server/http';
export const GET:RequestHandler=({url})=>{try{return json({presets:getRepository().workflowPresets.list(url.searchParams.get('archived')==='1')});}catch(error){return failure(error);}};
export const POST:RequestHandler=async({request})=>{try{return json(getRepository().workflowPresets.save(null,await readJson(request)),{status:201});}catch(error){return failure(error);}};
