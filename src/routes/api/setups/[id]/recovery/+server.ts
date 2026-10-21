import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRepository } from '#lib/server/repository';
import { failure } from '#lib/server/http';
export const GET:RequestHandler=({params})=>{
 try{return json(getRepository().recoveryState('setup',params.id));}catch(e){return failure(e);}
};
