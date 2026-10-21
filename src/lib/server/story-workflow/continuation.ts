/** Compatibility entry points for continuation callers. All modes share the passage runner. */
import type { StoryRepository } from '../repository';
import type { RecoveryAction } from '../../passage-recovery';
import type { Connections } from './adapters';
import { passageWorkflowInputSchema, runPassageWorkflow, retryPassageWorkflow, recoverPassageWorkflowDraft, acceptPassageWorkflow, type WorkflowOptions } from './passage';
export const continuationWorkflowInputSchema = passageWorkflowInputSchema;
export const runContinuationWorkflow = (r:StoryRepository,id:string,value:unknown,c:Connections,signal:AbortSignal,options:WorkflowOptions={}) => runPassageWorkflow(r,'continue',id,value,c,signal,options);
export const retryContinuationWorkflow = (r:StoryRepository,id:string,draftId:string,value:RecoveryAction,c:Connections,signal:AbortSignal,options:WorkflowOptions={}) => retryPassageWorkflow(r,'story',id,draftId,value,c,signal,options);
export const recoverContinuationWorkflowDraft = (r:StoryRepository,id:string,originalRequestId:string,value:{requestId:string;expectedRevision:number},signal:AbortSignal) => recoverPassageWorkflowDraft(r,'story',id,originalRequestId,value,signal);
export const acceptContinuationWorkflow = (r:StoryRepository,id:string,runId:string,draftId:string,value:RecoveryAction,signal:AbortSignal) => acceptPassageWorkflow(r,'story',id,runId,draftId,value,signal);
