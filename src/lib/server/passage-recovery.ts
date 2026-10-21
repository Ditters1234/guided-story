import type { StoryRepository, PreparationSourceKind } from './repository';
import { generatePassage, extractPassageUpdates } from './story-generation';
import { recoveryBaseline, recoveryIssues } from './passage-recovery-state';
import type { RecoveryAction, RetainedPassage } from '../passage-recovery';
import type { PassageContent } from '../passage-proposal';
import type { Story } from '../story';
import { resolvedFactPins } from '../fact-pins';
import { StoryError } from '../errors';

type GenerationSource=Parameters<typeof generatePassage>[0];
type Connections=Parameters<typeof generatePassage>[1];
type Scope={repository:StoryRepository;kind:PreparationSourceKind;id:string;requestId:string};
function captureUpdates(scope:Scope,record:RetainedPassage,source:Story,event:unknown) {
  if(event&&typeof event==='object'&&'stage'in event&&event.stage==='extracted-effects'&&'effects'in event&&Array.isArray(event.effects))scope.repository.updateRetainedEffects(scope.kind,scope.id,record.id,scope.requestId,source,event.effects);
}
function blocked(scope:Scope,record:RetainedPassage,error:unknown,signal:AbortSignal) {
  scope.repository.blockRetained(scope.kind,scope.id,record.id,scope.requestId,signal.aborted?[{category:'interrupted',message:'The update check was cancelled. The prose is kept; retry its updates when you are ready.'}]:recoveryIssues(error));
}
/** Save complete prose before extraction starts, including failures at final commit. */
export async function generateRetainedPassage(scope:Scope&{fingerprint:string},source:GenerationSource,connections:Connections,signal:AbortSignal,onDraft:(event:unknown)=>void,commit:(proposal:Awaited<ReturnType<typeof generatePassage>>)=>Story,fetcher:typeof fetch=fetch) {
  const existing=scope.repository.retainedGeneration(scope.kind,scope.id,scope.requestId,scope.fingerprint);
  if(existing)throw new StoryError('This request already has retained prose. Use “Retry world updates” below, or discard that draft before generating a new passage.',409);
  if(scope.repository.listRetained(scope.kind,scope.id).length)throw new StoryError('A generated passage is already retained. Recover or discard it before generating another passage.',409);
  const snapshot=scope.repository.readPreparationSource(scope.kind,scope.id);
  let record:RetainedPassage|undefined;
  try{
    const proposal=await generatePassage(source,connections,signal,event=>{
      if(event&&typeof event==='object'&&'stage'in event&&event.stage==='retained-content'&&'content'in event)record=scope.repository.retainPassage(scope.kind,scope.id,scope.requestId,scope.fingerprint,snapshot,event.content as PassageContent);
      if(record)captureUpdates(scope,record,recoveryBaseline(snapshot,record.content),event);
      onDraft(event);
    },fetcher);
    signal.throwIfAborted();
    return commit(proposal);
  }catch(error){if(record){blocked(scope,record,error,signal);throw new StoryError('The generated prose is retained below. Its world updates could not be saved. '+(error instanceof Error?error.message:'Retry the world updates when ready.'),error instanceof StoryError?error.status:502);}throw error;}
}
/** Explicit retry: current saved facts, immutable prose, the normal bounded checks. */
export async function retryRetainedPassage(scope:Omit<Scope,'requestId'>,draftId:string,input:RecoveryAction,connections:Connections,signal:AbortSignal,onDraft:(event:unknown)=>void=()=>{},beforeReady:()=>void=()=>{},fetcher:typeof fetch=fetch) {
  const begun=scope.repository.beginRetainedRetry(scope.kind,scope.id,draftId,input);
  if(begun.replay){beforeReady();return begun.record;}
  const record=begun.record,source=begun.source!,active={...scope,requestId:input.requestId};
  try{
    const baseline=recoveryBaseline(source,record.content);
    const proposal=await extractPassageUpdates(baseline,record.content,connections,signal,event=>{captureUpdates(active,record,baseline,event);onDraft(event);},fetcher,{notes:input.notes,issues:begun.previousIssues!.map(issue=>issue.message)},resolvedFactPins(source));
    signal.throwIfAborted();beforeReady();
    return scope.repository.readyRetained(scope.kind,scope.id,draftId,input.requestId,source,proposal);
  }catch(error){blocked(active,record,error,signal);throw error;}
}
