import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readStoryImage,removeStoryImage } from '#lib/server/image-tests';
import { failure } from '#lib/server/http';
export const GET: RequestHandler=async({params})=>{try{return json(await readStoryImage(params.id,params.jobId));}catch(e){return failure(e);}};
export const DELETE: RequestHandler=({params})=>{try{removeStoryImage(params.id,params.jobId);return json({ok:true});}catch(e){return failure(e);}};
