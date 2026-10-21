import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRepository } from '#lib/server/repository';
import { failure } from '#lib/server/http';
export const GET:RequestHandler=({params})=>{try{return json({revisions:getRepository().workflowPresets.revisions(params.id)});}catch(error){return failure(error);}};
