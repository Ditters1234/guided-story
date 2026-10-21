import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defaultStoryWorkflow, builtInStoryNodes } from '../src/lib/story-workflow/default-graph';
import { validateWorkflow } from '../src/lib/story-workflow/validate';
import { artifactReuse, checkedResultIsCurrent, effectsRetryDisposition, workflowArtifactSchema, workflowCheckSchema, workflowDefinitionSchema, workflowRunSchema, type WorkflowSource } from '../src/lib/story-workflow/contracts';

const hash = (letter = 'a') => letter.repeat(64);
const source = (): WorkflowSource => ({ kind: 'story', id: 'story-1', revision: 4, factsHash: hash(), historyHash: hash('b'), constraintsHash: hash('c') });
const artifact = () => workflowArtifactSchema.parse({
  schemaVersion: 1, id: randomUUID(), runId: randomUUID(), attemptId: randomUUID(), nodeId: 'extract', port: 'proposal', type: 'proposal',
  workflowVersion: 1, implementationVersion: 1, source: source(), inputFingerprint: hash('d'), configurationFingerprint: hash('e'), contentHash: hash('f'),
  inputArtifactIds: [randomUUID()], origin: 'model', payloadKey: randomUUID(), payloadSchemaVersion: 1, createdAt: '2026-10-21T12:00:00.000Z'
});

test('default opening/continuation/replacement graphs validate and roundtrip without secrets, layout or story copies', () => {
  for (const mode of ['opening', 'continue', 'replace'] as const) {
    const graph = defaultStoryWorkflow(mode), result = validateWorkflow(JSON.parse(JSON.stringify(graph)), builtInStoryNodes);
    assert.deepEqual(result.issues, []); assert.equal(result.valid, true);
    assert.deepEqual(result.graph, graph);
    assert.equal(graph.nodes.filter(n => n.type === 'repair').length, 1);
    assert.equal(graph.nodes.filter(n => n.type === 'commit').length, 1);
    assert.equal(graph.bindings[0].kind === 'source' && graph.bindings[0].sourceKind, mode === 'opening' ? 'setup' : 'story');
    assert.equal(workflowDefinitionSchema.safeParse({ ...graph, canon: {} }).success, false);
    assert.equal(workflowDefinitionSchema.safeParse({ ...graph, positions: [] }).success, false);
    assert.equal(workflowDefinitionSchema.safeParse({ ...graph, bindings: [...graph.bindings, { name: 'private', kind: 'model', connectionRef: 'configured-text', apiKey: 'private' }] }).success, false);
  }
});

test('graph validation diagnoses broken ports, missing inputs, duplicate wiring and unknown bindings/nodes', () => {
  const scenarios: [string, (graph: ReturnType<typeof defaultStoryWorkflow>) => void][] = [
    ['required-input', g => { g.edges = g.edges.filter(e => !(e.to.node === 'narrate' && e.to.port === 'request')); }],
    ['missing-port', g => { g.edges[0].from.port = 'absent'; }],
    ['schema', g => { g.edges[0].from.port = '__proto__'; }],
    ['missing-node', g => { g.edges[0].from.node = 'absent'; }],
    ['port-type', g => { g.edges.find(e => e.to.node === 'narrate' && e.to.port === 'request')!.from = { node: 'source', port: 'source' }; }],
    ['duplicate-edge', g => { g.edges.push(structuredClone(g.edges[0])); }],
    ['multiple-inputs', g => { g.edges.push({ from: { node: 'source', port: 'source' }, to: { node: 'prepare', port: 'source' } }); }],
    ['unknown-node', g => { g.nodes[0].type = 'external-script'; }],
    ['unknown-node', g => { g.nodes[0].type = 'constructor'; }],
    ['binding', g => { g.nodes[0].binding = 'missing'; }],
    ['source-mode', g => { const b = g.bindings[0]; if (b.kind === 'source') b.sourceKind = 'setup'; }],
    ['duplicate-node', g => { g.nodes.push(structuredClone(g.nodes[0])); }],
    ['duplicate-binding', g => { g.bindings.push(structuredClone(g.bindings[0])); }],
    ['repair-limit', g => { g.nodes.push({ id: 'second-repair', type: 'repair', version: 1 }); }],
    ['cycle', g => { g.edges.push({ from: { node: 'blocked', port: 'draft' }, to: { node: 'blocked', port: 'issues' } }); }]
  ];
  for (const [code, mutate] of scenarios) {
    const graph = defaultStoryWorkflow('continue'); mutate(graph);
    const result = validateWorkflow(graph, builtInStoryNodes);
    assert.equal(result.valid, false, code); assert.ok(result.issues.some(issue => issue.code === code), `${code}: ${JSON.stringify(result.issues)}`);
  }
  const future = { ...defaultStoryWorkflow('continue'), schemaVersion: 2 };
  assert.equal(validateWorkflow(future, builtInStoryNodes).issues[0].code, 'schema');
});

test('registered operations map to existing owners and separate configuration/deterministic work from possible provider requests', () => {
  for (const definition of Object.values(builtInStoryNodes)) for (const owner of definition.owners) {
    const [file, symbol] = owner.split('#');
    assert.ok(readFileSync(file, 'utf8').includes(`${symbol}(`) || readFileSync(file, 'utf8').includes(`${symbol} (`), owner);
  }
  assert.equal(builtInStoryNodes.model.providerCalls, 0);
  assert.equal(builtInStoryNodes.preflight.providerCalls, 0);
  assert.equal(builtInStoryNodes.validate.providerCalls, 0);
  assert.equal(builtInStoryNodes.commit.providerCalls, 0);
  assert.equal(builtInStoryNodes.expand.invocation, 'short-passage');
  assert.equal(builtInStoryNodes.review.invocation, 'inventory-trigger');
  assert.equal(builtInStoryNodes.rereview.invocation, 'inventory-trigger');
  assert.equal(Object.values(builtInStoryNodes).reduce((sum, node) => sum + node.providerCalls, 0), 6);
});

test('artifact reuse checks implementation/input/model fingerprints and never treats model outputs as a fresh deterministic request', () => {
  const output = artifact();
  const current = { workflowVersion: 1, implementationVersion: 1, inputFingerprint: output.inputFingerprint, configurationFingerprint: output.configurationFingerprint };
  assert.equal(artifactReuse(output, current), 'retained-model-result');
  assert.equal(artifactReuse({ ...output, origin: 'deterministic' }, current), 'reuse-deterministic');
  for (const changed of [{ workflowVersion: 2 }, { implementationVersion: 2 }, { inputFingerprint: hash() }, { configurationFingerprint: hash() }]) assert.equal(artifactReuse(output, { ...current, ...changed }), 'stale');
  assert.equal(workflowArtifactSchema.safeParse({ ...output, payloadKey: '../diagnostics' }).success, false);
  assert.equal(workflowArtifactSchema.safeParse({ ...output, apiKey: 'private' }).success, false);
});

test('effects retries preserve prose across saved-fact corrections while stale proposals, history and unused guidance cannot be accepted', () => {
  const original = source(), corrected = { ...original, revision: 5, factsHash: hash('d'), constraintsHash: hash('e') };
  assert.equal(effectsRetryDisposition(original, corrected, 'continue'), 'reextract-and-recheck');
  const checked = { source: original, inputFingerprint: hash(), configurationFingerprint: hash() };
  assert.equal(checkedResultIsCurrent(checked, { ...checked, source: corrected }), false);
  assert.equal(checkedResultIsCurrent(checked, { ...checked, inputFingerprint: hash('b') }), false, 'changed/unsubmitted guidance invalidates the check');
  assert.equal(checkedResultIsCurrent(checked, { ...checked, configurationFingerprint: hash('b') }), false);
  assert.equal(checkedResultIsCurrent(checked, checked), true);
  for (const changed of [{ id: 'other-story' }, { revision: 1 }, { historyHash: hash('f') }, { replacementBaselineHash: hash('f') }]) assert.equal(effectsRetryDisposition(original, { ...corrected, ...changed }, 'continue'), 'refuse-history-change');
  assert.equal(effectsRetryDisposition(original, corrected, 'replace'), 'refuse-history-change');
  const replacement = { ...original, replacementBaselineHash: hash('f') };
  assert.equal(effectsRetryDisposition(replacement, { ...corrected, replacementBaselineHash: hash('f') }, 'replace'), 'reextract-and-recheck');
});

test('run contracts distinguish recovered review and reject missing replacement provenance or an extra repair', () => {
  const run = { schemaVersion: 1, id: randomUUID(), workflowId: 'default-story-continue', workflowVersion: 1, requestId: randomUUID(), requestFingerprint: hash(), mode: 'continue', source: source(), status: 'running', acceptance: 'normal-generation', repairAttempts: 0, createdAt: '2026-10-21T12:00:00.000Z', updatedAt: '2026-10-21T12:00:00.000Z' };
  assert.equal(workflowRunSchema.safeParse(run).success, true);
  assert.equal(workflowRunSchema.safeParse({ ...run, status: 'awaiting-acceptance' }).success, false);
  assert.equal(workflowRunSchema.safeParse({ ...run, status: 'awaiting-acceptance', acceptance: 'recovered-review' }).success, true);
  assert.equal(workflowRunSchema.safeParse({ ...run, mode: 'replace' }).success, false);
  assert.equal(workflowRunSchema.safeParse({ ...run, mode: 'opening' }).success, false);
  assert.equal(workflowRunSchema.safeParse({ ...run, repairAttempts: 2 }).success, false);
  assert.equal(workflowCheckSchema.safeParse({ kind: 'model', status: 'not-required', issues: [] }).success, true);
  assert.equal(workflowCheckSchema.safeParse({ kind: 'model', status: 'blocked', issues: [] }).success, false);
  const issue = { category: 'consistency', message: 'The item holder disagrees with the prose.', entityIds: ['sugar'] };
  assert.equal(workflowCheckSchema.safeParse({ kind: 'model', status: 'issues', issues: [issue] }).success, true);
  assert.equal(workflowCheckSchema.safeParse({ kind: 'deterministic', status: 'pass', issues: [issue] }).success, false);
});
