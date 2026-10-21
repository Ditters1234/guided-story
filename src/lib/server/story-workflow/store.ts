import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { workflowRunSchema, workflowArtifactSchema, nodeAttemptSchema, workflowDefinitionSchema, type WorkflowRun, type WorkflowArtifact, type NodeAttempt, type WorkflowDefinition } from '../../story-workflow/contracts';
import { StoryError } from '../../errors';
import { jobFingerprint } from '../jobs';
import { scrub } from '../diagnostics';

export type StoredArtifact = { metadata: WorkflowArtifact; value: unknown };
const terminal = new Set<WorkflowRun['status']>(['completed', 'awaiting-acceptance', 'blocked', 'failed', 'cancelled', 'interrupted']);
const json = (value: unknown) => JSON.stringify(z.json().parse(JSON.parse(JSON.stringify(value))));

/** Uses the repository's connection. Constructed lazily on first workflow use. */
export class StoryWorkflowStore {
  constructor(private db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_runs(id TEXT PRIMARY KEY,source_id TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,payload TEXT NOT NULL,definition TEXT NOT NULL,UNIQUE(source_id,request_id));
      CREATE TABLE IF NOT EXISTS workflow_attempts(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,node_id TEXT NOT NULL,attempt_number INTEGER NOT NULL,payload TEXT NOT NULL,UNIQUE(run_id,node_id,attempt_number));
      CREATE TABLE IF NOT EXISTS workflow_artifacts(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,payload_key TEXT UNIQUE NOT NULL,metadata TEXT NOT NULL,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS workflow_provider_io(id TEXT PRIMARY KEY,attempt_id TEXT NOT NULL,request TEXT NOT NULL,response TEXT,status INTEGER,error TEXT);
    `);
  }
  private transaction<T>(action: () => T): T {
    if (this.db.isTransaction) return action(); // The canonical save owns the outer transaction.
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = action(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  find(sourceId: string, requestId: string): WorkflowRun | null {
    const row = this.db.prepare('SELECT payload FROM workflow_runs WHERE source_id=? AND request_id=?').get(sourceId, requestId) as { payload: string } | undefined;
    return row ? workflowRunSchema.parse(JSON.parse(row.payload)) : null;
  }
  read(id: string): WorkflowRun {
    const row = this.db.prepare('SELECT payload FROM workflow_runs WHERE id=?').get(id) as { payload: string } | undefined;
    if (!row) throw new StoryError('Workflow run not found.', 404);
    return workflowRunSchema.parse(JSON.parse(row.payload));
  }
  definition(id: string): WorkflowDefinition {
    this.read(id);
    const row = this.db.prepare('SELECT definition FROM workflow_runs WHERE id=?').get(id) as { definition: string };
    return workflowDefinitionSchema.parse(JSON.parse(row.definition));
  }
  start(run: WorkflowRun, graph: WorkflowDefinition): WorkflowRun {
    const valid = workflowRunSchema.parse(run), definition = workflowDefinitionSchema.parse(graph);
    return this.transaction(() => {
      const prior = this.find(valid.source.id, valid.requestId);
      if (prior) {
        if (prior.requestFingerprint !== valid.requestFingerprint) throw new StoryError('This request ID belongs to different workflow inputs.', 409);
        throw new StoryError('This workflow request was already started. Inspect its retained artifacts; no provider request was resubmitted.', 409);
      }
      this.db.prepare('INSERT INTO workflow_runs VALUES(?,?,?,?,?,?)').run(valid.id, valid.source.id, valid.requestId, valid.requestFingerprint, json(valid), json(definition));
      return valid;
    });
  }
  finish(id: string, status: WorkflowRun['status']) {
    const run = this.read(id);
    if (terminal.has(run.status) && run.status !== status && !(run.status === 'awaiting-acceptance' && status === 'completed')) throw new StoryError('A terminal workflow run cannot restart.', 409);
    run.status = status; run.updatedAt = new Date().toISOString();
    this.db.prepare('UPDATE workflow_runs SET payload=? WHERE id=?').run(json(workflowRunSchema.parse(run)), id);
    return run;
  }
  attempts(runId: string): NodeAttempt[] {
    this.read(runId);
    return (this.db.prepare('SELECT payload FROM workflow_attempts WHERE run_id=? ORDER BY rowid').all(runId) as { payload: string }[]).map(row => nodeAttemptSchema.parse(JSON.parse(row.payload)));
  }
  begin(runId: string, nodeId: string, inputs: StoredArtifact[], configurationFingerprint: string, operationFingerprint?: string): NodeAttempt {
    const run = this.read(runId), node = this.definition(runId).nodes.find(node => node.id === nodeId);
    if (run.status !== 'running' || !node) throw new StoryError('The workflow node is not available to execute.', 409);
    const number = this.attempts(runId).filter(attempt => attempt.nodeId === nodeId).length + 1;
    const attempt = nodeAttemptSchema.parse({ schemaVersion: 1, id: randomUUID(), runId, nodeId, implementationVersion: node.version, attempt: number, status: 'running',
      inputArtifactIds: inputs.map(input => input.metadata.id), outputArtifactIds: [],
      inputFingerprint: jobFingerprint({ request: run.requestFingerprint, source: run.source, node, operationFingerprint, inputs: inputs.map(input => [input.metadata.id, input.metadata.contentHash]) }), configurationFingerprint });
    this.db.prepare('INSERT INTO workflow_attempts VALUES(?,?,?,?,?)').run(attempt.id, runId, nodeId, number, json(attempt));
    return attempt;
  }
  markRepair(runId: string) {
    const run = this.read(runId);run.repairAttempts++;
    this.db.prepare('UPDATE workflow_runs SET payload=? WHERE id=?').run(json(workflowRunSchema.parse(run)),runId);
  }
  complete(attempt: NodeAttempt, values: { port: string; type: WorkflowArtifact['type']; value: unknown }[], origin: WorkflowArtifact['origin']): StoredArtifact[] {
    return this.transaction(() => {
      const run = this.read(attempt.runId), graph = this.definition(run.id);
      const node = graph.nodes.find(node => node.id === attempt.nodeId)!;
      const saved = this.attempts(run.id).find(item => item.id === attempt.id);
      if (run.status !== 'running' || saved?.status !== 'running' || node.version !== attempt.implementationVersion) throw new StoryError('Workflow attempt is no longer active.', 409);
      const artifacts = values.map(output => {
        const value = JSON.parse(json(output.value));
        const metadata = workflowArtifactSchema.parse({ schemaVersion: 1, id: randomUUID(), runId: run.id, attemptId: attempt.id, nodeId: node.id, port: output.port, type: output.type,
          workflowVersion: run.workflowVersion, implementationVersion: node.version, source: run.source, inputFingerprint: attempt.inputFingerprint, configurationFingerprint: attempt.configurationFingerprint,
          inputArtifactIds: attempt.inputArtifactIds, origin, contentHash: jobFingerprint(value), payloadKey: randomUUID(), payloadSchemaVersion: 1, createdAt: new Date().toISOString() });
        this.db.prepare('INSERT INTO workflow_artifacts VALUES(?,?,?,?,?)').run(metadata.id, run.id, metadata.payloadKey, json(metadata), json(value));
        return { metadata, value };
      });
      this.saveAttempt({ ...saved, status: 'completed', outputArtifactIds: artifacts.map(output => output.metadata.id) });
      return artifacts;
    });
  }
  private saveAttempt(attempt: NodeAttempt) {
    this.db.prepare('UPDATE workflow_attempts SET payload=? WHERE id=?').run(json(nodeAttemptSchema.parse(attempt)), attempt.id);
  }
  stopAttempt(attempt: NodeAttempt, status: 'skipped' | 'failed' | 'cancelled' | 'interrupted', error?: unknown) {
    const saved = this.attempts(attempt.runId).find(item => item.id === attempt.id) ?? attempt;
    this.saveAttempt({ ...saved, status, ...(error ? { error: String(scrub(error instanceof Error ? error.message : error)).slice(0, 10000) } : {}) });
  }
  artifact(id: string): StoredArtifact {
    const row = this.db.prepare('SELECT metadata,value FROM workflow_artifacts WHERE id=?').get(id) as { metadata: string; value: string } | undefined;
    if (!row) throw new StoryError('Workflow artifact not found.', 404);
    const metadata = workflowArtifactSchema.parse(JSON.parse(row.metadata)), value: unknown = JSON.parse(row.value);
    if (metadata.contentHash !== jobFingerprint(value)) throw new StoryError('Workflow artifact integrity check failed. No provider work was started.', 409);
    return { metadata, value };
  }
  artifacts(runId: string): StoredArtifact[] {
    this.read(runId);
    return (this.db.prepare('SELECT id FROM workflow_artifacts WHERE run_id=? ORDER BY rowid').all(runId) as { id: string }[]).map(row => this.artifact(row.id));
  }
  beginProvider(attempt: NodeAttempt, requestBody: string) {
    const id = randomUUID();
    // No request headers, URLs, API keys or private connection objects are saved.
    this.db.prepare('INSERT INTO workflow_provider_io VALUES(?,?,?,NULL,NULL,NULL)').run(id, attempt.id, requestBody);
    this.saveAttempt({ ...attempt, providerRequestId: id }); return id;
  }
  endProvider(id: string, response: string | null, status: number | null, error?: string) {
    this.db.prepare('UPDATE workflow_provider_io SET response=?,status=?,error=? WHERE id=?').run(response, status, error ?? null, id);
  }
  providerIO(runId: string): { id: string; attempt_id: string; request: string; response: string | null; status: number | null; error: string | null }[] {
    this.read(runId);
    return this.db.prepare('SELECT io.* FROM workflow_provider_io io JOIN workflow_attempts a ON a.id=io.attempt_id WHERE a.run_id=? ORDER BY io.rowid').all(runId) as ReturnType<StoryWorkflowStore['providerIO']>;
  }
  /** Explicit restart reconciliation; called only while owning the existing job lock. */
  interrupt(runId: string) {
    return this.transaction(() => {
      const run = this.read(runId);
      if (terminal.has(run.status)) return run;
      for (const attempt of this.attempts(runId)) if (attempt.status === 'running' || attempt.status === 'queued') this.stopAttempt(attempt, 'interrupted', 'Server stopped; this attempt was not resubmitted.');
      this.db.prepare("UPDATE workflow_provider_io SET error='Interrupted; completion is unknown and was not resubmitted.' WHERE attempt_id IN (SELECT id FROM workflow_attempts WHERE run_id=?) AND response IS NULL AND error IS NULL").run(runId);
      return this.finish(runId, 'interrupted');
    });
  }
  interruptSource(sourceId: string) {
    const rows = this.db.prepare("SELECT id FROM workflow_runs WHERE source_id=? AND json_extract(payload,'$.status') IN ('queued','running')").all(sourceId) as {id:string}[];
    for (const row of rows) this.interrupt(row.id);
  }
  /** Latest successful check for an existing draft; acceptance rechecks its version. */
  reviewRun(kind:'setup'|'story',sourceId:string,draftId:string) {
    const rows=this.db.prepare("SELECT id FROM workflow_runs WHERE source_id=? AND json_extract(payload,'$.source.kind')=? AND json_extract(payload,'$.acceptance')='recovered-review' ORDER BY rowid DESC").all(sourceId,kind) as {id:string}[];
    for(const row of rows)if(this.artifacts(row.id).some(a=>a.metadata.nodeId==='acceptance'&&a.metadata.port==='review'&&(a.value as {id?:string}).id===draftId))return this.read(row.id);
    return null;
  }
  resumeAcceptance(id: string) {
    const run = this.read(id);
    if (run.acceptance !== 'recovered-review' || !['awaiting-acceptance','running'].includes(run.status)) throw new StoryError('This workflow is not awaiting author acceptance.',409);
    run.status='running';run.updatedAt=new Date().toISOString();
    this.db.prepare('UPDATE workflow_runs SET payload=? WHERE id=?').run(json(workflowRunSchema.parse(run)),id);
  }
  settleCommitted(id: string) {
    const run=this.read(id);
    if(run.status==='completed')return run;
    // A canonical receipt is reconciled only when its atomic commit artifact exists.
    if(run.status!=='running'||!this.artifacts(id).some(artifact=>artifact.metadata.nodeId==='commit'))return run;
    const graph=this.definition(id),attempts=this.attempts(id);
    for(const node of graph.nodes)if(!attempts.some(attempt=>attempt.nodeId===node.id))this.stopAttempt(this.begin(id,node.id,[],jobFingerprint({receipt:true})),'skipped');
    return this.finish(id,'completed');
  }
}
