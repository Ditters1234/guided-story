import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { correctionApplySchema } from '#lib/story-corrections';
import { getRepository } from '#lib/server/repository';
import { runStoryJob } from '#lib/server/jobs';
import { readJson, failure } from '#lib/server/http';

export const POST:RequestHandler=async({params,request})=>{
  try{
    const input=correctionApplySchema.parse({...await readJson(request) as object,resultId:params.resultId}),repository=getRepository();
    const apply=()=>repository.applyCorrection(params.id,input);
    const story=await runStoryJob({kind:'correction-apply',storyId:params.id,requestId:input.requestId,expectedRevision:input.expectedRevision,targetId:params.resultId,lockKey:`story:${params.id}`,input},request.signal,async job=>{
      job.stage('validating');job.stage('committing');return apply();
    },apply);
    return json(story);
  }catch(e){return failure(e);}
};
