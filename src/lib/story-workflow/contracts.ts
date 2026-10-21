import { z } from 'zod';

const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const workflowModeSchema = z.enum(['opening', 'continue', 'replace']);
export type WorkflowMode = z.infer<typeof workflowModeSchema>;
export type PortType = 'source' | 'model' | 'prepared' | 'narration-request' | 'narration' | 'content' | 'retained' | 'extraction-request' | 'proposal' | 'checked' | 'repair' | 'blocked' | 'approved' | 'committed';
export type Port = { type: PortType; alternatives?: true };
export type NodeDefinition = {
  version: 1;
  inputs: Record<string, Port>;
  outputs: Record<string, Port>;
  binding?: 'source' | 'model';
  // A ceiling per invocation, not permission to invoke an optional stage.
  providerCalls: 0 | 1;
  invocation: 'always' | 'short-passage' | 'inventory-trigger' | 'repair-needed' | 'unresolved';
  owners: readonly string[];
};
export type NodeRegistry = Readonly<Record<string, NodeDefinition>>;

const bindingSchema = z.discriminatedUnion('kind', [
  z.strictObject({ name: id, kind: z.literal('source'), sourceKind: z.enum(['setup', 'story']), sourceId: id.optional() }),
  // Connection IDs are references resolved server-side, never URLs or credentials.
  z.strictObject({ name: id, kind: z.literal('model'), connectionRef: id })
]);
export const workflowDefinitionSchema = z.strictObject({
  schemaVersion: z.literal(1), id, version: z.number().int().positive(), mode: workflowModeSchema,
  bindings: z.array(bindingSchema).min(2).max(32),
  nodes: z.array(z.strictObject({ id, type: id, version: z.literal(1), binding: id.optional() })).min(1).max(100),
  edges: z.array(z.strictObject({
    from: z.strictObject({ node: id, port: id }), to: z.strictObject({ node: id, port: id })
  })).max(500),
  policy: z.strictObject({ repairLimit: z.literal(1), acceptance: z.literal('existing-policy'), scheduling: z.literal('serial-per-source') })
});
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;

// Layout is independently versioned and never changes execution or story revision.
export const workflowLayoutSchema = z.strictObject({
  schemaVersion: z.literal(1), workflowId: id, workflowVersion: z.number().int().positive(),
  positions: z.array(z.strictObject({ nodeId: id, x: z.number().finite(), y: z.number().finite() })).max(100)
});
export type WorkflowLayout = z.infer<typeof workflowLayoutSchema>;

export const workflowSourceSchema = z.strictObject({
  kind: z.enum(['setup', 'story']), id, revision: z.number().int().min(0),
  factsHash: hash, historyHash: hash, constraintsHash: hash,
  replacementBaselineHash: hash.optional()
});
export type WorkflowSource = z.infer<typeof workflowSourceSchema>;

export const workflowIssueSchema = z.strictObject({
  category: z.enum(['schema', 'reference', 'quantity', 'pin', 'evidence', 'consistency', 'budget', 'stale', 'request', 'interrupted']),
  message: z.string().min(1).max(6000), entityIds: z.array(id).max(100)
});
export const workflowCheckSchema = z.strictObject({
  kind: z.enum(['deterministic', 'model']), status: z.enum(['pass', 'issues', 'blocked', 'not-required']),
  issues: z.array(workflowIssueSchema).max(100)
}).superRefine((check, ctx) => {
  const success = check.status === 'pass' || check.status === 'not-required';
  if (success !== (check.issues.length === 0)) ctx.addIssue({ code: 'custom', message: 'Passing/not-required checks have no issues; failed/blocked checks must explain the issue.' });
});
export type WorkflowCheck = z.infer<typeof workflowCheckSchema>;
export const workflowRunSchema = z.strictObject({
  schemaVersion: z.literal(1), id: z.string().uuid(), workflowId: id, workflowVersion: z.number().int().positive(),
  requestId: z.string().uuid(), requestFingerprint: hash, mode: workflowModeSchema, source: workflowSourceSchema,
  status: z.enum(['queued', 'running', 'awaiting-acceptance', 'completed', 'blocked', 'failed', 'cancelled', 'interrupted']),
  acceptance: z.enum(['normal-generation', 'recovered-review']), repairAttempts: z.number().int().min(0).max(1),
  // Waiting for review must release the job/lock; the future runner enforces this.
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime()
}).superRefine((run, ctx) => {
  if ((run.mode === 'opening') !== (run.source.kind === 'setup')) ctx.addIssue({ code: 'custom', message: 'Opening requires a setup source; continuation/replacement require a story.' });
  if (run.mode === 'replace' && !run.source.replacementBaselineHash) ctx.addIssue({ code: 'custom', message: 'Replacement requires its pre-event baseline fingerprint.' });
  if (run.status === 'awaiting-acceptance' && run.acceptance !== 'recovered-review') ctx.addIssue({ code: 'custom', message: 'Only recovered proposals wait for explicit author acceptance.' });
});
export type WorkflowRun = z.infer<typeof workflowRunSchema>;

export const nodeAttemptSchema = z.strictObject({
  schemaVersion: z.literal(1), id: z.string().uuid(), runId: z.string().uuid(), nodeId: id,
  implementationVersion: z.number().int().positive(), attempt: z.number().int().positive(),
  status: z.enum(['queued', 'running', 'completed', 'skipped', 'blocked', 'failed', 'cancelled', 'interrupted']),
  inputArtifactIds: z.array(z.string().uuid()), outputArtifactIds: z.array(z.string().uuid()),
  inputFingerprint: hash, configurationFingerprint: hash,
  // Zero for deterministic or skipped stages. No automatic restart of a model attempt.
  providerRequestId: z.string().uuid().optional(), error: z.string().max(10000).optional()
});
export type NodeAttempt = z.infer<typeof nodeAttemptSchema>;

export const workflowArtifactSchema = z.strictObject({
  schemaVersion: z.literal(1), id: z.string().uuid(), runId: z.string().uuid(), attemptId: z.string().uuid(),
  nodeId: id, port: id,
  type: z.enum(['source', 'model', 'prepared', 'narration-request', 'narration', 'content', 'retained', 'extraction-request', 'proposal', 'checked', 'repair', 'blocked', 'approved', 'committed']),
  workflowVersion: z.number().int().positive(), implementationVersion: z.number().int().positive(),
  source: workflowSourceSchema, inputFingerprint: hash, configurationFingerprint: hash, contentHash: hash,
  inputArtifactIds: z.array(z.string().uuid()), origin: z.enum(['deterministic', 'model']),
  // Opaque key for a complete, immutable, server-local payload, never a diagnostics trace.
  payloadKey: z.string().uuid(), payloadSchemaVersion: z.number().int().positive(), createdAt: z.iso.datetime()
});
export type WorkflowArtifact = z.infer<typeof workflowArtifactSchema>;

/** Reusing a result and issuing a new model request are separate authorizations. */
export function artifactReuse(artifact: WorkflowArtifact, current: {
  workflowVersion: number; implementationVersion: number; inputFingerprint: string; configurationFingerprint: string;
}): 'reuse-deterministic' | 'retained-model-result' | 'stale' {
  if (artifact.workflowVersion !== current.workflowVersion || artifact.implementationVersion !== current.implementationVersion || artifact.inputFingerprint !== current.inputFingerprint || artifact.configurationFingerprint !== current.configurationFingerprint) return 'stale';
  return artifact.origin === 'model' ? 'retained-model-result' : 'reuse-deterministic';
}

/** Only explicit effects retries may reuse prose across saved-fact/constraint edits. */
export function effectsRetryDisposition(original: WorkflowSource, current: WorkflowSource, mode: WorkflowMode): 'reextract-and-recheck' | 'refuse-history-change' {
  if (original.kind !== current.kind || original.id !== current.id || current.revision < original.revision || original.historyHash !== current.historyHash || original.replacementBaselineHash !== current.replacementBaselineHash || (mode === 'opening') !== (current.kind === 'setup') || (mode === 'replace' && !current.replacementBaselineHash)) return 'refuse-history-change';
  return 'reextract-and-recheck';
}

/** Acceptance is always against current facts, history, constraints and revision. */
export function checkedSourceIsCurrent(checked: WorkflowSource, current: WorkflowSource): boolean {
  return checked.kind === current.kind && checked.id === current.id && checked.revision === current.revision && checked.factsHash === current.factsHash && checked.historyHash === current.historyHash && checked.constraintsHash === current.constraintsHash && checked.replacementBaselineHash === current.replacementBaselineHash;
}

export function checkedResultIsCurrent(checked: Pick<WorkflowArtifact, 'source' | 'inputFingerprint' | 'configurationFingerprint'>, current: Pick<WorkflowArtifact, 'source' | 'inputFingerprint' | 'configurationFingerprint'>): boolean {
  return checkedSourceIsCurrent(checked.source, current.source) && checked.inputFingerprint === current.inputFingerprint && checked.configurationFingerprint === current.configurationFingerprint;
}
