import { z } from 'zod';
import { StoryError } from '../../errors';
import { builtInStoryNodes, defaultStoryWorkflow } from '../../story-workflow/default-graph';
import { checkedSourceIsCurrent } from '../../story-workflow/contracts';
import type { RetainedPassage } from '../../passage-recovery';
import type { StoryRepository } from '../repository';
import { getJobs, jobFingerprint, sourceJobIsActive, assertSourceIdle } from '../jobs';
import { scrubWorkflow } from '../diagnostics';
import { recoveryBaseline } from '../passage-recovery-state';
import { configurationHash, sourceIdentity } from './passage';
import type { Connections } from './adapters';
import { estimateInputTokens } from '../token-budget';
import { inspectExecutableWorkflow } from '../../story-workflow/compile';

export const runIdSchema=z.string().uuid();
export const listRunsSchema=z.strictObject({before:z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),limit:z.coerce.number().int().min(1).max(100).default(25)});
export const removeDetailsSchema=z.strictObject({expectedVersion:z.string().regex(/^[a-f0-9]{64}$/)});
const display=<T>(value:T):T=>scrubWorkflow(JSON.parse(JSON.stringify(value))) as T;
const parse=(text:string)=>{try{return JSON.parse(text);}catch{return text;}};
const object=(value:unknown):Record<string,any>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,any>:{};
function sentReferences(requests:unknown[]) {
  const found=new Map<string,{kind:string;id:string;name:string;scope:string;quantity?:number}>();
  const names:Record<string,string>={characters:'character',people:'character',places:'place',locations:'place',items:'item',relationships:'relationship',threads:'thread'};
  const collect=(value:unknown,scope:string)=>{for(const [key,rows] of Object.entries(object(value))){if(!names[key]||!Array.isArray(rows))continue;for(const row of rows){const record=object(row),id=Array.isArray(row)?row[0]:record.id,name=Array.isArray(row)?row[1]:record.name??record.title??id;if(typeof id==='string')found.set(`${scope}:${names[key]}:${id}`,{kind:names[key],id,name:String(name),scope,...(typeof record.quantity==='number'?{quantity:record.quantity}:{})});}}};
  for(const request of requests)for(const message of object(request).messages??[]){if(message.role!=='user'||typeof message.content!=='string')continue;const data=object(parse(message.content));collect(data.canon??data.before,'scoped record');collect(data.directory,'compact reference');collect({characters:data.referencedCharacters},'reference only');}
  return [...found.values()];
}

function retainedForRun(r:StoryRepository,id:string):RetainedPassage|null {
  const store=r.workflows,run=store.read(id);
  const original=r.retainedGeneration(run.source.kind,run.source.id,run.requestId,run.requestFingerprint);
  if(original)return original;
  const seed=store.metadata(id).find(a=>a.nodeId==='retain'&&a.port==='retained');
  if(!seed)return null;
  const value=object(store.artifact(seed.id).value);
  try{return r.readRetained(run.source.kind,run.source.id,value.id);}catch(error){if(error instanceof StoryError&&error.status===404)return null;throw error;}
}
function sourceTitle(r:StoryRepository,kind:'setup'|'story',id:string) {
  try{return kind==='setup'?r.readSetup(id).plan?.title||'Untitled setup':r.read(id).title;}catch{return 'Removed source';}
}
export function listWorkflowRuns(r:StoryRepository,value:unknown) {
  const {limit,before}=listRunsSchema.parse(value),rows=r.workflows.list(limit,before);
  const titles=new Map<string,string>();
  return display({runs:rows.map(row=>{const key=`${row.run.source.kind}:${row.run.source.id}`;if(!titles.has(key))titles.set(key,sourceTitle(r,row.run.source.kind,row.run.source.id));return {...row,title:titles.get(key)!};}),next:rows.length===limit?rows.at(-1)!.cursor:null});
}

/** Read-only: never resumes a run or changes the saved source. */
export function inspectWorkflowRun(r:StoryRepository,idValue:string,configuration:Connections|null) {
  const id=runIdSchema.parse(idValue),store=r.workflows,run=store.read(id),definition=store.definition(id),attempts=store.attempts(id),artifacts=store.metadata(id),removedAt=store.removedAt(id);
  const job=getJobs().find({storyId:run.source.id,requestId:run.requestId});
  let active=sourceJobIsActive(run.source.id);
  try{getJobs().assertScopeIdle(run.source.id);}catch{active=true;}
  let current:null|ReturnType<typeof sourceIdentity>=null,sourceRevision:number|null=null,publishedStoryId:string|null=null;
  const changes:string[]=[];
  try {
    if(run.source.kind==='setup')publishedStoryId=r.readSetup(run.source.id).storyId;
    if(!publishedStoryId){const source=r.readPreparationSource(run.source.kind,run.source.id);sourceRevision=source.revision;current=sourceIdentity(source,run.mode);}
  } catch {changes.push('The saved source is no longer available. Historical prose remains readable in its stored outputs.');}
  if(publishedStoryId)changes.push('This opening has already been published. Open the saved story; it cannot be published again.');
  if(current){
    if(current.historyHash!==run.source.historyHash)changes.push('Written history changed. Keep the prose for reading or copying; it cannot be retried against different history.');
    if(current.replacementBaselineHash!==run.source.replacementBaselineHash)changes.push('The latest rewrite baseline changed. A previous rewrite cannot replace the current ending.');
    if(current.factsHash!==run.source.factsHash)changes.push('Saved world facts changed. Re-extract and recheck world updates from retained prose before acceptance.');
    if(current.constraintsHash!==run.source.constraintsHash)changes.push('Author constraints or context changed. Recheck the retained prose against current pins and preferences.');
    if(current.revision!==run.source.revision&&!changes.length)changes.push('The saved revision changed. A checked proposal must be rechecked before acceptance.');
  }
  const expected=defaultStoryWorkflow(run.mode);
  const implementationChanged=definition.id.startsWith('preset-')?!inspectExecutableWorkflow(definition).eligible:definition.version!==expected.version||definition.nodes.some(node=>builtInStoryNodes[node.type]?.version!==node.version);
  if(implementationChanged)changes.push('This workflow implementation is historical. A supported retry uses the current built-in operations.');
  const configurationChanged=configuration&&attempts.length?attempts[0].configurationFingerprint!==configurationHash(configuration):null;
  if(configurationChanged)changes.push('Model or request settings changed. A new explicit check uses the current settings; stored model results remain historical results.');
  const retained=removedAt?null:retainedForRun(r,id);
  const complete=artifacts.find(a=>a.nodeId==='content')??artifacts.find(a=>a.nodeId==='expand'&&a.port==='ready')??artifacts.find(a=>a.nodeId==='length'&&a.port==='ready');
  let canRecover=Boolean(!removedAt&&!retained&&!active&&current&&complete&&current.historyHash===run.source.historyHash&&!store.hasOpenRetained(run.source.id));
  if(canRecover){try{const content=object(store.artifact(complete!.id).value).content;recoveryBaseline(r.readPreparationSource(run.source.kind,run.source.id),content);}catch{canRecover=false;}}
  const ownReview=artifacts.find(a=>a.nodeId==='acceptance'&&a.port==='review');
  let reviewState:'current'|'superseded'|'saved'|null=null;
  if(ownReview&&retained){const reviewed=object(store.artifact(ownReview.id).value);reviewState=retained.status==='saved'?'saved':retained.status==='ready'&&retained.version===reviewed.version&&jobFingerprint(retained.proposal)===jobFingerprint(reviewed.proposal)?'current':'superseded';if(reviewState==='superseded')changes.push('This reviewed proposal was superseded by a later check or draft change. Retry the current retained prose before accepting updates.');}
  const latestReview=retained?store.reviewRun(run.source.kind,run.source.id,retained.id):null;
  const recoveryOpen=retained&&!['saved','discarded'].includes(retained.status)?{id:retained.id,status:retained.status,version:retained.version,latestReviewId:latestReview?.id??null}:null;
  const dependent=store.dependentRun(id);
  const removalReason=removedAt?'These details have already been removed.':active?'Wait for the active generation or check to finish.':store.hasOpenRetained(run.source.id)?'Recover or discard the retained passage before removing history.':dependent?'A later run uses these artifacts. Remove that later run’s details first.':null;
  const abandoned=run.status==='running'&&job&&['interrupted','failed','cancelled'].includes(job.state);
  return display({run,definition,title:sourceTitle(r,run.source.kind,run.source.id),version:store.inspectionVersion(id),removedAt,sourceRevision,publishedStoryId,active,changes,
    reviewState,sourceCurrent:current?checkedSourceIsCurrent(run.source,current):false,configurationChanged,implementationChanged,
    displayStatus:abandoned?'interrupted':run.status,
    recovery:{retained:recoveryOpen,closedStatus:retained&&!recoveryOpen?retained.status:null,canRecover},removal:{allowed:!removalReason,reason:removalReason,dependentRunId:dependent},
    nodes:definition.nodes.map(node=>{const history=attempts.filter(a=>a.nodeId===node.id),last=history.at(-1),outputs=artifacts.filter(a=>a.nodeId===node.id);const status=removedAt?'removed':abandoned&&last?.status==='running'?'interrupted':last?.status==='completed'&&outputs.some(a=>a.type==='blocked')?'blocked':last?.status==='completed'&&outputs.some(a=>a.port==='repair')?'repair-needed':last?.status??'not-reached';return {...node,status,attempts:history,artifacts:outputs,inputs:builtInStoryNodes[node.type]?.inputs??{},outputs:builtInStoryNodes[node.type]?.outputs??{},providerCeiling:builtInStoryNodes[node.type]?.providerCalls??0};})});
}
export type WorkflowInspection=ReturnType<typeof inspectWorkflowRun>;
export type WorkflowRunList=ReturnType<typeof listWorkflowRuns>;

/** Each inspector request loads only one attempt's resolved payloads and model bodies. */
export function inspectWorkflowNode(r:StoryRepository,idValue:string,nodeId:string,attemptId?:string) {
  const id=runIdSchema.parse(idValue),store=r.workflows,graph=store.definition(id);
  if(!graph.nodes.some(node=>node.id===nodeId))throw new StoryError('Workflow node not found.',404);
  if(store.removedAt(id))throw new StoryError('This run’s detailed history was removed. Its request receipt is still kept.',410);
  const attempts=store.attempts(id).filter(a=>a.nodeId===nodeId),attempt=attemptId?attempts.find(a=>a.id===runIdSchema.parse(attemptId)):attempts.at(-1);
  if(attemptId&&!attempt)throw new StoryError('This attempt does not belong to the selected node.',404);
  const inputs=attempt?.inputArtifactIds.map(key=>store.artifact(key))??[],outputs=attempt?.outputArtifactIds.map(key=>store.artifact(key))??[];
  const provider=attempt?store.attemptIO(id,attempt.id).map(io=>{const request=object(parse(io.request)),response=io.response===null?null:parse(io.response);let inputTokens:number|null=null;
    if(Array.isArray(request.messages))inputTokens=estimateInputTokens(request.messages,request.response_format?.json_schema?.schema);
    return {id:io.id,status:io.status,error:io.error,request,response,usage:object(response).usage??null,estimatedInputTokens:inputTokens,outputTokenCeiling:request.max_tokens??null,complete:io.response!==null};}):[];
  const checks=outputs.flatMap(output=>{const value=object(output.value);return Array.isArray(value.checks)?value.checks:[];});
  const issues=outputs.flatMap(output=>{const value=object(output.value);return Array.isArray(value.issues)?value.issues:[];});
  const selection=inputs.concat(outputs).flatMap(output=>{const value=object(output.value);return value.contextReport?[value.contextReport]:[];});
  const references=sentReferences([...provider.map(call=>call.request),...inputs.concat(outputs).filter(a=>['narration-request','extraction-request'].includes(a.metadata.type)).map(a=>a.value)]);
  return display({nodeId,attempt:attempt??null,inputs,outputs,provider,checks,issues,selection,references});
}
export type WorkflowNodeInspection=ReturnType<typeof inspectWorkflowNode>;

export function removeWorkflowDetails(r:StoryRepository,idValue:string,value:unknown) {
  const id=runIdSchema.parse(idValue),input=removeDetailsSchema.parse(value),run=r.workflows.read(id);
  assertSourceIdle(run.source.id);
  r.workflows.removeDetails(id,input.expectedVersion);
  return {removedAt:r.workflows.removedAt(id)};
}
