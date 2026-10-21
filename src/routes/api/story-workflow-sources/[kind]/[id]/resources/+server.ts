import { json } from '@sveltejs/kit';
import {z} from 'zod';
import type {RequestHandler} from './$types';
import {getRepository} from '#lib/server/repository';
import {failure} from '#lib/server/http';
import {workflowSourceOptions} from '#lib/story-workflow/sources';
import {StoryError} from '#lib/errors';
export const GET:RequestHandler=({params,url})=>{
  try{
    const kind=z.enum(['setup','story']).parse(params.kind),source=getRepository().readPreparationSource(kind,params.id),mode=url.searchParams.get('mode')??(kind==='setup'?'opening':'continue');
    if(!['opening','continue','replace'].includes(mode)||(mode==='opening')!==(kind==='setup'))throw new StoryError('Choose a matching saved source and passage mode.');
    if(mode==='replace'&&!source.recovery?.valid)throw new StoryError('This story has no valid latest replacement baseline.',409);
    const value=mode==='replace'?{...source,canon:source.recovery!.canon}:source;
    return json({id:source.id,revision:source.revision,resources:workflowSourceOptions(value)});
  }catch(error){return failure(error);}
};
