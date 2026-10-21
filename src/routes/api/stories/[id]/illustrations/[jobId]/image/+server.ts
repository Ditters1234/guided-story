import type { RequestHandler } from './$types';
import { storyImageFile } from '#lib/server/image-tests';
import { failure } from '#lib/server/http';
export const GET: RequestHandler=({params,url})=>{try{const f=storyImageFile(params.id,params.jobId,Number(url.searchParams.get('index')||0));return new Response(new Uint8Array(f.bytes),{headers:{'Content-Type':f.type,'Cache-Control':'private, no-store'}});}catch(e){return failure(e);}};
