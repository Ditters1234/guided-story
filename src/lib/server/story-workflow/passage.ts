import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { defaultStoryWorkflow, builtInStoryNodes } from '../../story-workflow/default-graph';
import { validateWorkflow } from '../../story-workflow/validate';
import { workflowRunSchema, type WorkflowSource } from '../../story-workflow/contracts';
import { chapterEndingSchema } from '../../settings';
import { recoveryActionSchema, type RetainedPassage, type RecoveryAction } from '../../passage-recovery';
import { setupDraftSchema, setupStoryBase } from '../../setup';
import type { WorkflowMode } from '../../story-workflow/contracts';
import type { Story } from '../../story';
import { StoryError } from '../../errors';
import type { PreparationSourceKind, StoryRepository } from '../repository';
import { connectionSchema } from '../connections';
import { runStoryJob, getJobs, jobFingerprint, type JobContext } from '../jobs';
import { recoveryHistoryHash, recoveryIssues, recoveryBaseline } from '../passage-recovery-state';
import { passageAdapters, validatePassagePayload, type Connections } from './adapters';
import { runStoryWorkflow, type NodeSeed } from './runner';
import type { StoredArtifact } from './store';
import { logEvent } from '../diagnostics';
import { presetReferenceSchema } from '../../story-workflow/compile';
import { checkpointWorkflow } from './checkpoint';
import { modelUsedForChecks } from './configuration';
import { compilePresetGraph,presetGraph,resolvePresetBindings } from './compile';

export const passageWorkflowInputSchema = z.strictObject({ expectedRevision: z.number().int().min(0), requestId: z.string().uuid(), direction: z.string().max(10000), chapterEnding: chapterEndingSchema.default('auto'),preset:presetReferenceSchema.optional() });
type Input = z.infer<typeof passageWorkflowInputSchema>;
export type WorkflowOptions = { fetcher?: typeof fetch; onDraft?: (event: unknown) => void; graph?: unknown };
const graphFor = (mode: WorkflowMode, value?: unknown) => {
  const expected = defaultStoryWorkflow(mode), graph = value ?? expected, validation = validateWorkflow(graph, builtInStoryNodes);
  if (!validation.valid) throw new StoryError(validation.issues.map(issue => issue.message).join(' '));
  if (jobFingerprint(validation.graph) !== jobFingerprint(expected)) throw new StoryError('Only the matching built-in passage workflow is executable.');
  return validation.graph!;
};
export const sourceIdentity = (story: Story, mode: WorkflowMode): WorkflowSource => ({ ...(mode==='replace'?{replacementBaselineHash:jobFingerprint(story.recovery)}:{}), kind: mode==='opening'?'setup':'story', id: story.id, revision: story.revision, factsHash: jobFingerprint(story.canon), historyHash: recoveryHistoryHash(story), constraintsHash: jobFingerprint({ pins: story.factPins, preferences: story.preferences, context: story.context, premise: story.premise, narrationStyle: story.narrationStyle, adultContent: story.adultContent }) });
export const configurationHash = (connections: Connections) => { const {apiKey: _key, ...text} = connections.text; return jobFingerprint({text,context:connections.context,prompts:connections.prompts}); };
const fingerprint = (input: unknown, graph: ReturnType<typeof graphFor>) => jobFingerprint({ input, graph });
const savedResult = (r:StoryRepository,kind:PreparationSourceKind,id:string,requestId:string,hash:string) => kind==='setup'?r.openingResult(id,requestId,hash):r.generatedPassageResult(id,requestId,hash);
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
    mode: graph.mode, source: sourceIdentity(source, graph.mode), status: 'running', acceptance: recovered ? 'recovered-review' : 'normal-generation', repairAttempts: 0, createdAt: now, updatedAt: now }), graph);
}

async function execute(repository: StoryRepository, source: Story, input: Input, connections: Connections, job: JobContext, graph: ReturnType<typeof graphFor>, requestFingerprint: string, options: WorkflowOptions,
  retry?: { retained: RetainedPassage; notes: string; issues: string[]; parents: StoredArtifact[] }) {
  const store = repository.workflows, run = start(repository, source, input.requestId, requestFingerprint, graph, Boolean(retry));
  let ready: RetainedPassage | undefined;
  const kind = graph.mode === 'opening' ? 'setup' : 'story';
  const adapters = passageAdapters({ repository, source, graph,mode:graph.mode, ...(kind==='setup'?{setup:repository.readSetup(source.id)}:{}), input, connections, job, fingerprint: requestFingerprint, onDraft: event => {getJobs().transition(job.id,'generating',{details:{draft:event}});options.onDraft?.(event);},
    ...(retry ? { retained: retry.retained, retry: {notes:retry.notes,issues:retry.issues}, onReady: (record:RetainedPassage) => { ready = record; } } : {}) });
  const seeds: Record<string, NodeSeed> | undefined = retry ? { retain: {outputs:{retained:retry.retained},parents:retry.parents} } : undefined;
  try {
    const outputs = await runStoryWorkflow({ graph, registry: builtInStoryNodes, adapters, store, runId: run.id, signal: job.signal, configurationFingerprint: configurationHash(connections), fetcher: options.fetcher ?? fetch,
      ...(retry ? {seeds,skip:['preflight','narrate','length','expand','content',...graph.nodes.filter(node=>node.type==='model'&&!modelUsedForChecks(graph,node.id)).map(node=>node.id)]} : {}) });
    const committed = outputs.get('commit')?.[0];
    if (committed) { store.finish(run.id, 'completed'); return committed.value as Story; }
    if (ready) { store.finish(run.id, 'awaiting-acceptance'); return ready; }
    const blocked = outputs.get('blocked')?.[0]?.value as {message:string;status:number}|undefined;
    throw new StoryError(blocked?.message ?? 'The workflow produced no accepted proposal. Its draft is retained.', blocked?.status ?? 502);
  } catch (error) {
    // A later summary failure cannot invalidate a durable commit or reviewed proposal.
    if (!retry) {
      const saved = savedResult(repository,kind,source.id,input.requestId,requestFingerprint);
      if (saved) { reconcileReceipt(repository,run.id); return saved; }
    }
    if(retry && ready && store.artifacts(run.id).some(a=>a.metadata.nodeId==='acceptance'&&a.metadata.port==='review')) {
      try {store.finish(run.id,'awaiting-acceptance');} catch {logEvent('warn','workflow','Checked proposal retained; workflow status needs reconciliation.',{runId:run.id});}
      return ready;
    }
    const retained = retry?.retained ?? repository.retainedGeneration(kind, source.id, input.requestId, requestFingerprint);
    if (retained) repository.blockRetained(kind, source.id, retained.id, input.requestId, job.signal.aborted ? [{category:'interrupted',message:'The update check was cancelled. The prose is kept; explicitly retry its world updates.'}] : recoveryIssues(error));
    store.finish(run.id, job.signal.aborted ? 'cancelled' : retained ? 'blocked' : 'failed');
    if (retained) throw new StoryError('The generated prose is retained below. Its world updates could not be saved. ' + (error instanceof Error ? error.message : 'Retry the world updates when ready.'), error instanceof StoryError ? error.status : 502);
    throw error;
  }
}

/** Built-in passage execution; the application entry point handles legacy replay and maintenance. */
export async function runPassageWorkflow(repository: StoryRepository, mode: WorkflowMode, storyId: string, value: unknown, configuration: Connections, signal: AbortSignal, options: WorkflowOptions = {}): Promise<Story> {
  const input = passageWorkflowInputSchema.parse(value), graph = input.preset?presetGraph(repository,input.preset,mode,storyId):graphFor(mode, options.graph), connections = structuredClone(connectionSchema.parse(configuration)), hash = fingerprint(input, graph);
  if(input.preset&&options.graph)throw new StoryError('Choose a saved preset reference without supplying another graph.');
  const kind = mode==='opening'?'setup':'story';
  const previous=repository.workflows.find(storyId,input.requestId),previousJob=getJobs().find({storyId,requestId:input.requestId});
  if(previous && previous.requestFingerprint!==hash)throw new StoryError('This request ID belongs to different workflow inputs.',409);
  // Refuse an uncertain/failed root request before creating another job attempt.
  // Replayed HTTP requests must preserve the cancellation/failure receipt too.
  if(previous && (['blocked','failed','cancelled','interrupted'].includes(previous.status) || previousJob && ['failed','cancelled','interrupted'].includes(previousJob.state)) && !savedResult(repository,kind,storyId,input.requestId,hash))throw new StoryError('This workflow request already started. Recover its draft or explicitly retry its world updates with a new request; no model call was resubmitted.',409);
  if(input.preset&&!previous)resolvePresetBindings(repository,graph,storyId,input.expectedRevision,connections,input.preset);
  const replay = () => {
    const saved=savedResult(repository,kind,storyId,input.requestId,hash);
    if(!saved)throw new StoryError('No committed workflow receipt is available. Inspect the retained run.',409);
    try{const run=repository.workflows.find(storyId,input.requestId);if(run)reconcileReceipt(repository,run.id);}catch{logEvent('warn','workflow','Saved passage replayed; workflow status needs inspection.');}
    return saved;
  };
  return runStoryJob({ kind:`story-workflow-${mode}`,storyId,requestId:input.requestId,expectedRevision:input.expectedRevision,lockKey:`${kind}:${storyId}`,input:{input,graph} },signal,async job => {
    const saved = savedResult(repository,kind,storyId,input.requestId,hash);
    if(saved){const run=repository.workflows.find(storyId,input.requestId);if(run)reconcileReceipt(repository,run.id);job.stage('validating');job.stage('committing');return saved;}
    if(input.preset)resolvePresetBindings(repository,graph,storyId,input.expectedRevision,connections,input.preset);
    const source=repository.readPreparationSource(kind,storyId);
    if(source.revision!==input.expectedRevision)throw new StoryError('The story changed. Reload before generating the next passage.',409);
    if(repository.listRetained(kind,storyId).length)throw new StoryError('A generated passage is already retained. Recover or discard it before generating another passage.',409);
    return await execute(repository,source,input,connections,job,graph,hash,options) as Story;
  },replay);
}

/** An explicit retry uses current saved facts and retained prose; never narrates. */
export async function retryPassageWorkflow(repository: StoryRepository, kind: PreparationSourceKind, storyId: string, draftId: string, value: RecoveryAction, configuration: Connections, signal: AbortSignal, options: WorkflowOptions = {}): Promise<RetainedPassage> {
  const mode=kind==='setup'?'opening':repository.readRetained(kind,storyId,draftId).content.mode;
  const retained=repository.readRetained(kind,storyId,draftId),root=repository.workflows.find(storyId,retained.requestId);
  const originalGraph=root?repository.workflows.definition(root.id):null;
  const pinned=Boolean(originalGraph?.id.startsWith('preset-'));
  if(pinned&&options.graph)throw new StoryError('A preset retry uses its original pinned definition; another graph cannot replace it.');
  const action=recoveryActionSchema.parse(value),graph=pinned?compilePresetGraph(originalGraph,mode,storyId):graphFor(mode,options.graph),connections=structuredClone(connectionSchema.parse(configuration)),hash=fingerprint({draftId,action},graph);
  return runStoryJob({kind:'story-workflow-retry',storyId,requestId:action.requestId,expectedRevision:action.expectedRevision,lockKey:`${kind}:${storyId}`,input:{draftId,action,graph}},signal,async job=>{
    const existing=repository.readRetained(kind,storyId,draftId);
    // Read/verify retained provenance before claiming the retry action.
    const original=repository.workflows.find(storyId,existing.requestId);
    const originalOutputs=original?repository.workflows.artifacts(original.id):[];
    const candidates=originalOutputs.filter(artifact=>artifact.metadata.nodeId==='retain');
    const content=originalOutputs.find(artifact=>artifact.metadata.nodeId==='content')??originalOutputs.find(artifact=>artifact.metadata.nodeId==='expand'&&artifact.metadata.port==='ready')??originalOutputs.find(artifact=>artifact.metadata.nodeId==='length'&&artifact.metadata.port==='ready');
    const parents=candidates.length?candidates:content?[content]:[];
    for(const parent of parents)validatePassagePayload(parent.metadata.nodeId,parent.metadata.port,parent.value);
    const begun=repository.beginRetainedRetry(kind,storyId,draftId,action);
    if(begun.replay){job.stage('validating');return begun.record;}
    try {
      const source=begun.source!;
      if(pinned)resolvePresetBindings(repository,graph,storyId,action.expectedRevision,connections,undefined,true);
      recoveryBaseline(source,begun.record.content); // Verify current viewpoint and latest history before any provider work.
      return await execute(repository,source,{requestId:action.requestId,expectedRevision:action.expectedRevision,direction:begun.record.content.direction,chapterEnding:'auto'},connections,job,graph,hash,options,
        {retained:begun.record,notes:action.notes,issues:begun.previousIssues!.map(issue=>issue.message),parents}) as RetainedPassage;
    }catch(error){repository.blockRetained(kind,storyId,draftId,action.requestId,recoveryIssues(error));throw error;}
  },()=>repository.readRetained(kind,storyId,draftId));
}

/** Explicit restart recovery promotes only a complete persisted content artifact. No provider is called. */
export async function recoverPassageWorkflowDraft(repository: StoryRepository, kind: PreparationSourceKind, storyId: string, originalRequestId: string, request: {requestId:string;expectedRevision:number}, signal: AbortSignal): Promise<RetainedPassage> {
  const input=z.strictObject({requestId:z.string().uuid(),expectedRevision:z.number().int().min(0)}).parse(request);
  return runStoryJob({kind:'story-workflow-recover-draft',storyId,requestId:input.requestId,expectedRevision:input.expectedRevision,lockKey:`${kind}:${storyId}`,input:{...input,originalRequestId}},signal,async job=>{
    const store=repository.workflows,run=store.find(storyId,originalRequestId);
    if(!run)throw new StoryError('Workflow run not found.',404);
    if(run.source.kind!==kind||store.definition(run.id).mode!==run.mode)throw new StoryError('This workflow belongs to a different source.',409);
    const previous=repository.retainedGeneration(kind,storyId,originalRequestId,run.requestFingerprint);
    if(previous){job.stage('validating');return previous;}
    if(repository.readPreparationSource(kind,storyId).revision!==input.expectedRevision)throw new StoryError('Saved facts changed. Reload before recovering this draft.',409);
    if(repository.listRetained(kind,storyId).length)throw new StoryError('Recover or discard the existing retained passage first.',409);
    const artifacts=store.artifacts(run.id),snapshot=artifacts.find(artifact=>artifact.metadata.nodeId==='source'),content=artifacts.find(artifact=>artifact.metadata.nodeId==='content')??artifacts.find(artifact=>artifact.metadata.nodeId==='expand'&&artifact.metadata.port==='ready')??artifacts.find(artifact=>artifact.metadata.nodeId==='length'&&artifact.metadata.port==='ready');
    if(!snapshot||!content)throw new StoryError('No complete passage content artifact is available. Partial/raw provider results remain local for inspection; nothing was resubmitted.',409);
    validatePassagePayload('source','source',snapshot.value);validatePassagePayload(content.metadata.nodeId,content.metadata.port,content.value);
    const prose=(content.value as {content:RetainedPassage['content']}).content;
    if(prose.mode!==(run.mode==='replace'?'replace':'continue'))throw new StoryError('This artifact has the wrong passage mode.');
    const original=kind==='setup'?setupStoryBase(setupDraftSchema.parse(snapshot.value)):snapshot.value as Story;
    original.revision=run.source.revision;
    recoveryBaseline(repository.readPreparationSource(kind,storyId),prose);
    job.stage('validating');job.stage('committing');
    store.interrupt(run.id);
    const record=repository.retainPassage(kind,storyId,originalRequestId,run.requestFingerprint,original,(content.value as {content:RetainedPassage['content']}).content);
    return repository.blockRetained(kind,storyId,record.id,originalRequestId,[{category:'interrupted',message:'The completed prose was recovered from workflow artifacts. Explicitly recheck its world updates before accepting it.'}]);
  },()=>{const run=repository.workflows.find(storyId,originalRequestId);if(!run)throw new StoryError('Workflow run not found.',404);const record=repository.retainedGeneration(kind,storyId,originalRequestId,run.requestFingerprint);if(!record)throw new StoryError('No recovered passage is available.',409);return record;});
}

/** Uses the existing full atomic acceptance/receipt checks after releasing the retry job. */
export async function acceptPassageWorkflow(repository: StoryRepository, kind: PreparationSourceKind, storyId: string, runId: string, draftId: string, value: RecoveryAction, signal: AbortSignal): Promise<Story> {
  const action=recoveryActionSchema.parse(value);
  const run=repository.workflows.read(runId);
  if(run.source.id!==storyId||run.source.kind!==kind||run.acceptance!=='recovered-review')throw new StoryError('This run does not belong to this recovered story proposal.',409);
  return runStoryJob({kind:'story-workflow-accept',storyId,requestId:action.requestId,expectedRevision:action.expectedRevision,lockKey:`${kind}:${storyId}`,input:{runId,draftId,action}},signal,async job=>{
    const store=repository.workflows,currentRun=store.read(runId);
    const record=repository.readRetained(kind,storyId,draftId);
    if(record.activeRequestId||!['awaiting-acceptance','completed','running'].includes(currentRun.status))throw new StoryError('This recovered workflow is not ready for acceptance.',409);
    const outputs=store.artifacts(runId),checked=outputs.find(output=>output.metadata.nodeId==='acceptance'&&output.metadata.port==='review');
    if(!checked)throw new StoryError('This run has no author-reviewed recovery result.',409);
    validatePassagePayload('acceptance','review',checked.value);
    const approved=checked.value as RetainedPassage;
    if(approved.id!==draftId||record.status!=='saved'&&(approved.version!==record.version||jobFingerprint(approved.proposal)!==jobFingerprint(record.proposal)))throw new StoryError('This workflow check was superseded. Accept the most recent successful retry instead.',409);
    job.stage('validating');job.stage('committing');
    if(currentRun.status==='completed')return repository.applyRetained(kind,storyId,draftId,action);
    store.resumeAcceptance(runId);
    const attempt=store.begin(runId,'commit',[checked],checked.metadata.configurationFingerprint,jobFingerprint(action));
    try {
      job.signal.throwIfAborted();
      const saved=repository.applyRetained(kind,storyId,draftId,action,committed=>{
        store.complete(attempt,[{port:'committed',type:'committed',value:committed}],'deterministic');
        store.finish(runId,'completed');
      },checkpointWorkflow(store,runId,record.requestId));
      return saved;
    }catch(error){store.stopAttempt(attempt,'failed',error);store.finish(runId,'awaiting-acceptance');throw error;}
  },()=>repository.applyRetained(kind,storyId,draftId,action));
}
