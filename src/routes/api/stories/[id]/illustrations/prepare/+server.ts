import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prepareIllustration } from '#lib/server/story-illustrations';
import { failure,readJson } from '#lib/server/http';
export const POST: RequestHandler=async({params,request})=>{try{return json(await prepareIllustration(params.id,await readJson(request),request.signal));}catch(e){return failure(e);}};
