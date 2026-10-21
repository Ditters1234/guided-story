import { json } from '@sveltejs/kit';
import { recoveryActionSchema } from '../passage-recovery';
import { getRepository, type PreparationSourceKind } from './repository';
import { retryRetainedPassage } from './passage-recovery';
import { getJobs, runStoryJob } from './jobs';
import { readPrivateConnections } from './connections';
import { readJson, failure } from './http';
import { maintainMemoryAfterPassage } from './memory-compaction';

export async function recoveryEndpoint(kind:PreparationSourceKind,verb:'retry'|'apply'|'discard',id:string,draftId:string,request:Request) {
  try{
    const input=recoveryActionSchema.parse(await readJson(request)),repository=getRepository();
    if(verb==='retry'){
      const result=await runStoryJob({kind:'passage-update-retry',storyId:id,targetId:draftId,requestId:input.requestId,expectedRevision:input.expectedRevision,lockKey:`${kind}:${id}`,input},request.signal,job=>retryRetainedPassage({repository,kind,id},draftId,input,readPrivateConnections(),job.signal,event=>getJobs().transition(job.id,'generating',{details:{draft:event}}),()=>{job.stage('validating');job.stage('committing');}),()=>repository.readRetained(kind,id,draftId));
      return json(result);
    }
    getJobs().assertScopeIdle(id);
    if(verb==='discard')return json(repository.discardRetained(kind,id,draftId,input));
    const saved=repository.applyRetained(kind,id,draftId,input);
    return json(await maintainMemoryAfterPassage(saved,request.signal,repository.readRetained(kind,id,draftId).requestId));
  }catch(error){return failure(error);}
}
