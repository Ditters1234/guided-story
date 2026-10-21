import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { acceptIllustration } from '#lib/server/story-illustrations';
import { failure,readJson } from '#lib/server/http';
export const POST: RequestHandler=async({params,request})=>{try{return json(await acceptIllustration(params.id,params.jobId,await readJson(request)));}catch(e){return failure(e);}};
