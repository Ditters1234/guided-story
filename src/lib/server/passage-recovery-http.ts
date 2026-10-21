import { json } from '@sveltejs/kit';
import { recoveryActionSchema } from '../passage-recovery';
import { getRepository, type PreparationSourceKind } from './repository';
import { retryPassageWorkflow, acceptPassageWorkflow } from './story-workflow/passage';
import { getJobs } from './jobs';
import { readPrivateConnections } from './connections';
import { readJson, failure } from './http';
import { maintainMemoryAfterPassage } from './memory-compaction';

export async function recoveryEndpoint(kind:PreparationSourceKind,verb:'retry'|'apply'|'discard',id:string,draftId:string,request:Request) {
  try{
    const input=recoveryActionSchema.parse(await readJson(request)),repository=getRepository();
    if(verb==='retry'){
      const result=await retryPassageWorkflow(repository,kind,id,draftId,input,readPrivateConnections(),request.signal);
      return json(result);
    }
    getJobs().assertScopeIdle(id);
    if(verb==='discard')return json(repository.discardRetained(kind,id,draftId,input));
    const run=repository.workflows.reviewRun(kind,id,draftId);
    const saved=run?await acceptPassageWorkflow(repository,kind,id,run.id,draftId,input,request.signal):repository.applyRetained(kind,id,draftId,input);
    return json(await maintainMemoryAfterPassage(saved,request.signal,repository.readRetained(kind,id,draftId).requestId));
  }catch(error){return failure(error);}
}
