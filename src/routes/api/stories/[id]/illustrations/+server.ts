import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { startIllustration } from '#lib/server/story-illustrations';
import { listStoryImages } from '#lib/server/image-tests';
import { getRepository } from '#lib/server/repository';
import { failure,readJson } from '#lib/server/http';
export const GET: RequestHandler=({params})=>{try{getRepository().read(params.id);return json({jobs:listStoryImages(params.id)});}catch(e){return failure(e);}};
export const POST: RequestHandler=async({params,request})=>{try{return json(await startIllustration(params.id,await readJson(request)));}catch(e){return failure(e);}};
