import type { RequestHandler } from './$types';
import { getRepository } from '#lib/server/repository';
import { novelMarkdown } from '#lib/server/novel-export';
import { failure } from '#lib/server/http';
export const GET:RequestHandler=({params})=>{
  try{const story=getRepository().read(params.id);return new Response(novelMarkdown(story),{headers:{'Content-Type':'text/markdown; charset=utf-8','Content-Disposition':`attachment; filename="storyweaver-novel.md"; filename*=UTF-8''${encodeURIComponent(story.title.slice(0,100)+'.md').replace(/'/g,'%27')}`,'Cache-Control':'no-store'}});}catch(e){return failure(e);}
};
