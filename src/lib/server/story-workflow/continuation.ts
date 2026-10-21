import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { defaultStoryWorkflow, builtInStoryNodes } from '../../story-workflow/default-graph';
import { validateWorkflow } from '../../story-workflow/validate';
import { workflowRunSchema, type WorkflowSource } from '../../story-workflow/contracts';
import { chapterEndingSchema } from '../../settings';
import { recoveryActionSchema, type RetainedPassage, type RecoveryAction } from '../../passage-recovery';
import type { Story } from '../../story';
import { StoryError } from '../../errors';
import type { StoryRepository } from '../repository';
import { connectionSchema } from '../connections';
import { runStoryJob, jobFingerprint, type JobContext } from '../jobs';
import { recoveryHistoryHash, recoveryIssues, recoveryBaseline } from '../passage-recovery-state';
import { continuationAdapters, validateContinuationPayload, type Connections } from './adapters';
import { runStoryWorkflow, type NodeSeed } from './runner';
import type { StoredArtifact } from './store';
import { logEvent } from '../diagnostics';

export const continuationWorkflowInputSchema = z.strictObject({ expectedRevision: z.number().int().min(0), requestId: z.string().uuid(), direction: z.string().max(10000), chapterEnding: chapterEndingSchema.default('auto') });
type Input = z.infer<typeof continuationWorkflowInputSchema>;
type Options = { fetcher?: typeof fetch; onDraft?: (event: unknown) => void; graph?: unknown };
const graphFor = (value?: unknown) => {
  const expected = defaultStoryWorkflow('continue'), graph = value ?? expected, validation = validateWorkflow(graph, builtInStoryNodes);
  if (!validation.valid) throw new StoryError(validation.issues.map(issue => issue.message).join(' '));
  if (jobFingerprint(validation.graph) !== jobFingerprint(expected)) throw new StoryError('Only the built-in continuation workflow is executable in this slice.');
  return validation.graph!;
};
const sourceIdentity = (story: Story): WorkflowSource => ({ kind: 'story', id: story.id, revision: story.revision, factsHash: jobFingerprint(story.canon), historyHash: recoveryHistoryHash(story), constraintsHash: jobFingerprint({ pins: story.factPins, preferences: story.preferences, context: story.context, premise: story.premise, narrationStyle: story.narrationStyle, adultContent: story.adultContent }) });
const configurationHash = (connections: Connections) => { const {apiKey: _key, ...text} = connections.text; return jobFingerprint({text,context:connections.context,prompts:connections.prompts}); };
const fingerprint = (input: unknown, graph: ReturnType<typeof graphFor>) => jobFingerprint({ input, graph });
function reconcileReceipt(repository:StoryRepository,runId:string){
  try{repository.workflows.settleCommitted(runId);}
  catch{logEvent('warn','workflow','Passage committed; workflow status reconciliation needs retry.',{runId});}
}

function start(repository: StoryRepository, source: Story, requestId: string, requestFingerprint: string, graph: ReturnType<typeof graphFor>, recovered: boolean) {
  const store = repository.workflows, previous = store.find(source.id, requestId);
  if (previous) {
    if (previous.requestFingerprint !== requestFingerprint) throw new StoryError('This request ID belongs to different workflow inputs.', 409);
    store.interrupt(previous.id);
    throw new StoryError('This workflow request already started. Recover its draft or explicitly retry the world updates with a new request; no model call was resubmitted.', 409);
  }
  store.interruptSource(source.id);
  const now = new Date().toISOString();
  return store.start(workflowRunSchema.parse({ schemaVersion: 1, id: randomUUID(), workflowId: graph.id, workflowVersion: graph.version, requestId, requestFingerprint,
    mode: 'continue', source: sourceIdentity(source), status: 'running', acceptance: recovered ? 'recovered-review' : 'normal-generation', repairAttempts: 0, createdAt: now, updatedAt: now }), graph);
}

async function execute(repository: StoryRepository, source: Story, input: Input, connections: Connections, job: JobContext, graph: ReturnType<typeof graphFor>, requestFingerprint: string, options: Options,
  retry?: { retained: RetainedPassage; notes: string; issues: string[]; parents: StoredArtifact[] }) {
  const store = repository.workflows, run = start(repository, source, input.requestId, requestFingerprint, graph, Boolean(retry));
  let ready: RetainedPassage | undefined;
  const adapters = continuationAdapters({ repository, source, input, connections, job, fingerprint: requestFingerprint, onDraft: options.onDraft ?? (() => {}),
    ...(retry ? { retained: retry.retained, retry: {notes:retry.notes,issues:retry.issues}, onReady: (record:RetainedPassage) => { ready = record; } } : {}) });
  const seeds: Record<string, NodeSeed> | undefined = retry ? { retain: {outputs:{retained:retry.retained},parents:retry.parents} } : undefined;
  try {
    const outputs = await runStoryWorkflow({ graph, registry: builtInStoryNodes, adapters, store, runId: run.id, signal: job.signal, configurationFingerprint: configurationHash(connections), fetcher: options.fetcher ?? fetch,
      ...(retry ? {seeds,skip:['preflight','narrate','length','expand','content']} : {}) });
    const committed = outputs.get('commit')?.[0];
    if (committed) { store.finish(run.id, 'completed'); return committed.value as Story; }
    if (ready) { store.finish(run.id, 'awaiting-acceptance'); return ready; }
    const blocked = outputs.get('blocked')?.[0]?.value as {message:string;status:number}|undefined;
    throw new StoryError(blocked?.message ?? 'The workflow produced no accepted proposal. Its draft is retained.', blocked?.status ?? 502);
  } catch (error) {
    // A lost artifact write after commit must never report the saved passage as unsaved.
    if (!retry) {
      const saved = repository.generatedPassageResult(source.id, input.requestId, requestFingerprint);
      if (saved) { reconcileReceipt(repository,run.id); return saved; }
    }
    const retained = retry?.retained ?? repository.retainedGeneration('story', source.id, input.requestId, requestFingerprint);
    if (retained) repository.blockRetained('story', source.id, retained.id, input.requestId, job.signal.aborted ? [{category:'interrupted',message:'The update check was cancelled. The prose is kept; explicitly retry its world updates.'}] : recoveryIssues(error));
    store.finish(run.id, job.signal.aborted ? 'cancelled' : retained ? 'blocked' : 'failed');
    if (retained) throw new StoryError('The generated prose is retained below. Its world updates could not be saved. ' + (error instanceof Error ? error.message : 'Retry the world updates when ready.'), error instanceof StoryError ? error.status : 502);
    throw error;
  }
}

/** Experimental entry point; production routes continue to use generateRetainedPassage. */
export async function runContinuationWorkflow(repository: StoryRepository, storyId: string, value: unknown, configuration: Connections, signal: AbortSignal, options: Options = {}): Promise<Story> {
  const input = continuationWorkflowInputSchema.parse(value), graph = graphFor(options.graph), connections = structuredClone(connectionSchema.parse(configuration)), hash = fingerprint(input, graph);
  const replay = () => {
    const saved=repository.generatedPassageResult(storyId,input.requestId,hash);
    if(!saved)throw new StoryError('No committed workflow receipt is available. Inspect the retained run.',409);
    try{const run=repository.workflows.find(storyId,input.requestId);if(run)reconcileReceipt(repository,run.id);}catch{logEvent('warn','workflow','Saved passage replayed; workflow status needs inspection.');}
    return saved;
  };
  return runStoryJob({ kind:'story-workflow-continuation',storyId,requestId:input.requestId,expectedRevision:input.expectedRevision,lockKey:`story:${storyId}`,input:{input,graph} },signal,async job => {
    const saved = repository.generatedPassageResult(storyId,input.requestId,hash);
    if(saved){const run=repository.workflows.find(storyId,input.requestId);if(run)reconcileReceipt(repository,run.id);job.stage('validating');job.stage('committing');return saved;}
    const source=repository.read(storyId);
    if(source.revision!==input.expectedRevision)throw new StoryError('The story changed. Reload before generating the next passage.',409);
    if(repository.listRetained('story',storyId).length)throw new StoryError('A generated passage is already retained. Recover or discard it before generating another passage.',409);
    return await execute(repository,source,input,connections,job,graph,hash,options) as Story;
  },replay);
}

/** An explicit retry uses current saved facts and retained prose; never narrates. */
export async function retryContinuationWorkflow(repository: StoryRepository, storyId: string, draftId: string, value: RecoveryAction, configuration: Connections, signal: AbortSignal, options: Options = {}): Promise<RetainedPassage> {
  const action=recoveryActionSchema.parse(value),graph=graphFor(options.graph),connections=structuredClone(connectionSchema.parse(configuration)),hash=fingerprint({draftId,action},graph);
  return runStoryJob({kind:'story-workflow-retry',storyId,requestId:action.requestId,expectedRevision:action.expectedRevision,lockKey:`story:${storyId}`,input:{draftId,action,graph}},signal,async job=>{
    const existing=repository.readRetained('story',storyId,draftId);
    if(existing.content.mode!=='continue')throw new StoryError('Opening/replacement workflow recovery is not implemented in this slice.');
    // Read/verify retained provenance before claiming the retry action.
    const original=repository.workflows.find(storyId,existing.requestId);
    const originalOutputs=original?repository.workflows.artifacts(original.id):[];
    const candidates=originalOutputs.filter(artifact=>artifact.metadata.nodeId==='retain');
    const content=originalOutputs.find(artifact=>artifact.metadata.nodeId==='content')??originalOutputs.find(artifact=>artifact.metadata.nodeId==='expand'&&artifact.metadata.port==='ready')??originalOutputs.find(artifact=>artifact.metadata.nodeId==='length'&&artifact.metadata.port==='ready');
    const parents=candidates.length?candidates:content?[content]:[];
    for(const parent of parents)validateContinuationPayload(parent.metadata.nodeId,parent.metadata.port,parent.value);
    const begun=repository.beginRetainedRetry('story',storyId,draftId,action);
    if(begun.replay){job.stage('validating');return begun.record;}
    try {
      const source=recoveryBaseline(begun.source!,begun.record.content);
      return await execute(repository,source,{requestId:action.requestId,expectedRevision:action.expectedRevision,direction:begun.record.content.direction,chapterEnding:'auto'},connections,job,graph,hash,options,
        {retained:begun.record,notes:action.notes,issues:begun.previousIssues!.map(issue=>issue.message),parents}) as RetainedPassage;
    }catch(error){repository.blockRetained('story',storyId,draftId,action.requestId,recoveryIssues(error));throw error;}
  },()=>repository.readRetained('story',storyId,draftId));
}

/** Explicit restart recovery promotes only a complete persisted content artifact. No provider is called. */
export async function recoverContinuationWorkflowDraft(repository: StoryRepository, storyId: string, originalRequestId: string, request: {requestId:string;expectedRevision:number}, signal: AbortSignal): Promise<RetainedPassage> {
  const input=z.strictObject({requestId:z.string().uuid(),expectedRevision:z.number().int().min(0)}).parse(request);
  return runStoryJob({kind:'story-workflow-recover-draft',storyId,requestId:input.requestId,expectedRevision:input.expectedRevision,lockKey:`story:${storyId}`,input:{...input,originalRequestId}},signal,async job=>{
    const store=repository.workflows,run=store.find(storyId,originalRequestId);
    if(!run)throw new StoryError('Workflow run not found.',404);
    if(run.mode!=='continue'||store.definition(run.id).mode!=='continue')throw new StoryError('Only continuation workflow drafts can be recovered in this slice.');
    const previous=repository.retainedGeneration('story',storyId,originalRequestId,run.requestFingerprint);
    if(previous){job.stage('validating');return previous;}
    if(repository.read(storyId).revision!==input.expectedRevision)throw new StoryError('Saved facts changed. Reload before recovering this draft.',409);
    if(repository.listRetained('story',storyId).length)throw new StoryError('Recover or discard the existing retained passage first.',409);
    const artifacts=store.artifacts(run.id),snapshot=artifacts.find(artifact=>artifact.metadata.nodeId==='source'),content=artifacts.find(artifact=>artifact.metadata.nodeId==='content')??artifacts.find(artifact=>artifact.metadata.nodeId==='expand'&&artifact.metadata.port==='ready')??artifacts.find(artifact=>artifact.metadata.nodeId==='length'&&artifact.metadata.port==='ready');
    if(!snapshot||!content)throw new StoryError('No complete passage content artifact is available. Partial/raw provider results remain local for inspection; nothing was resubmitted.',409);
    validateContinuationPayload('source','source',snapshot.value);validateContinuationPayload(content.metadata.nodeId,content.metadata.port,content.value);
    if((content.value as {content:RetainedPassage['content']}).content.mode!=='continue')throw new StoryError('This artifact is not a continuation.');
    job.stage('validating');job.stage('committing');
    store.interrupt(run.id);
    const record=repository.retainPassage('story',storyId,originalRequestId,run.requestFingerprint,snapshot.value as Story,(content.value as {content:RetainedPassage['content']}).content);
    return repository.blockRetained('story',storyId,record.id,originalRequestId,[{category:'interrupted',message:'The completed prose was recovered from workflow artifacts. Explicitly recheck its world updates before accepting it.'}]);
  },()=>{const run=repository.workflows.find(storyId,originalRequestId);if(!run)throw new StoryError('Workflow run not found.',404);const record=repository.retainedGeneration('story',storyId,originalRequestId,run.requestFingerprint);if(!record)throw new StoryError('No recovered passage is available.',409);return record;});
}

/** Uses the existing full atomic acceptance/receipt checks after releasing the retry job. */
export async function acceptContinuationWorkflow(repository: StoryRepository, storyId: string, runId: string, draftId: string, value: RecoveryAction, signal: AbortSignal): Promise<Story> {
  const action=recoveryActionSchema.parse(value);
  const run=repository.workflows.read(runId);
  if(run.source.id!==storyId||run.acceptance!=='recovered-review')throw new StoryError('This run does not belong to this recovered story proposal.',409);
  return runStoryJob({kind:'story-workflow-accept',storyId,requestId:action.requestId,expectedRevision:action.expectedRevision,lockKey:`story:${storyId}`,input:{runId,draftId,action}},signal,async job=>{
    const store=repository.workflows,currentRun=store.read(runId);
    const record=repository.readRetained('story',storyId,draftId);
    if(record.activeRequestId||!['awaiting-acceptance','completed','running'].includes(currentRun.status))throw new StoryError('This recovered workflow is not ready for acceptance.',409);
    const outputs=store.artifacts(runId),checked=outputs.find(output=>output.metadata.nodeId==='acceptance'&&output.metadata.port==='review');
    if(!checked)throw new StoryError('This run has no author-reviewed recovery result.',409);
    validateContinuationPayload('acceptance','review',checked.value);
    const approved=checked.value as RetainedPassage;
    if(approved.id!==draftId||record.status!=='saved'&&(approved.version!==record.version||jobFingerprint(approved.proposal)!==jobFingerprint(record.proposal)))throw new StoryError('This workflow check was superseded. Accept the most recent successful retry instead.',409);
    job.stage('validating');job.stage('committing');
    if(currentRun.status==='completed')return repository.applyRetained('story',storyId,draftId,action);
    store.resumeAcceptance(runId);
    const attempt=store.begin(runId,'commit',[checked],checked.metadata.configurationFingerprint,jobFingerprint(action));
    try {
      job.signal.throwIfAborted();
      const saved=repository.applyRetained('story',storyId,draftId,action,committed=>{
        store.complete(attempt,[{port:'committed',type:'committed',value:committed}],'deterministic');
        store.finish(runId,'completed');
      });
      return saved;
    }catch(error){store.stopAttempt(attempt,'failed',error);store.finish(runId,'awaiting-acceptance');throw error;}
  },()=>repository.applyRetained('story',storyId,draftId,action));
}
