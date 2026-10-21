import type { StoryRepository } from './repository';
import type { WorkflowMode } from '../story-workflow/contracts';
import type { Connections } from './story-workflow/adapters';
import { passageWorkflowInputSchema, runPassageWorkflow, type WorkflowOptions } from './story-workflow/passage';
import { generateRetainedPassage } from './passage-recovery';
import { maintainMemoryAfterPassage } from './memory-compaction';
import { getJobs, runStoryJob, jobFingerprint } from './jobs';
import { StoryError } from '../errors';

/** Shared HTTP/application entry. Legacy receipts and in-flight jobs retain their identity. */
export async function generatePassageEntry(r:StoryRepository,mode:WorkflowMode,id:string,value:unknown,c:Connections,signal:AbortSignal,options:WorkflowOptions & {engine?:'workflow'|'legacy'}={}) {
  const input=passageWorkflowInputSchema.parse(value),kind=mode==='opening'?'setup':'story';
  const legacyInput=mode==='opening'?{expectedRevision:input.expectedRevision,requestId:input.requestId}:{...input,mode};
  const hash=jobFingerprint(legacyInput),priorJob=getJobs().find({storyId:id,requestId:input.requestId});
  const workflow=r.workflows.find(id,input.requestId);
  if(input.preset&&priorJob&&!priorJob.kind.startsWith('story-workflow-'))throw new StoryError('This request belongs to an earlier generation path. Use a new explicit request for a preset.',409);
  const legacyResult=()=>kind==='setup'?r.openingResult(id,input.requestId,hash):r.generatedPassageResult(id,input.requestId,hash);
  // Prefer durable identity over the configured default when replaying a request.
  const legacy=!input.preset&&!workflow && (priorJob ? !priorJob.kind.startsWith('story-workflow-') : Boolean(legacyResult()||r.retainedGeneration(kind,id,input.requestId,hash)) || (options.engine ?? process.env.STORY_PASSAGE_ENGINE)==='legacy');
  const saved=legacy ? await runStoryJob({kind:mode==='opening'?'story-opening':mode==='replace'?'story-replacement':'story-narration',storyId:id,requestId:input.requestId,expectedRevision:input.expectedRevision,lockKey:`${kind}:${id}`,input:legacyInput},signal,async job=>{
    const prior=legacyResult();if(prior){job.stage('validating');job.stage('committing');return prior;}
    const source=r.readPreparationSource(kind,id);
    if(source.revision!==input.expectedRevision)throw new StoryError('The story or setup changed. Reload before generating.',409);
    return generateRetainedPassage({repository:r,kind,id,requestId:input.requestId,fingerprint:hash},kind==='setup'?{setup:r.readSetup(id)}:{story:source,mode:mode==='replace'?'replace':'continue',direction:input.direction,chapterEnding:input.chapterEnding},c,job.signal,event=>{getJobs().transition(job.id,'generating',{details:{draft:event}});options.onDraft?.(event);},proposal=>{
      job.stage('validating',{proposal});job.stage('committing');
      return kind==='setup'?r.commitOpening(id,input.expectedRevision,input.requestId,hash,proposal):r.commitGeneratedPassage(id,{expectedRevision:input.expectedRevision,requestId:input.requestId,proposal},hash);
    },options.fetcher);
  },()=>legacyResult()||(()=>{throw new StoryError('No committed passage result is available. Reload the story or setup.',409);})())
    : await runPassageWorkflow(r,mode,id,input,c,signal,options);
  // The passage job has finished and released its lock before conditional maintenance.
  return maintainMemoryAfterPassage(saved,signal,input.requestId,{repository:r,connections:c,fetcher:options.fetcher});
}
