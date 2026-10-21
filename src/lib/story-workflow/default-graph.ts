import type { NodeDefinition, NodeRegistry, Port, PortType, WorkflowDefinition, WorkflowMode } from './contracts';

const port = (type: PortType): Port => ({ type });
const alternative = (type: PortType): Port => ({ type, alternatives: true });
function definition(inputs: Record<string, Port>, outputs: Record<string, Port>, owners: string[], options: Partial<Pick<NodeDefinition, 'binding' | 'providerCalls' | 'invocation'>> = {}): NodeDefinition {
  return { version: 1, inputs, outputs, owners, providerCalls: 0, invocation: 'always', ...options };
}
const generation = 'src/lib/server/story-generation.ts#generatePassage';
const extraction = 'src/lib/server/story-generation.ts#extractPassageUpdates';
const review = 'src/lib/server/inventory-review.ts#reviewInventory';
const commit = ['src/lib/server/repository.ts#commitGeneratedPassage', 'src/lib/server/repository.ts#commitOpening', 'src/lib/server/repository.ts#applyRetained'];

// Descriptors only. Importing this registry never reads configuration/canon or calls a provider.
export const builtInStoryNodes: NodeRegistry = Object.freeze({
  source: definition({}, { source: port('source') }, ['src/lib/server/repository.ts#readPreparationSource'], { binding: 'source' }),
  model: definition({}, { model: port('model') }, ['src/lib/server/connections.ts#readPrivateConnections'], { binding: 'model' }),
  prepare: definition({ source: port('source') }, { prepared: port('prepared') }, [generation, 'src/lib/server/passage-recovery-state.ts#recoveryBaseline']),
  preflight: definition({ prepared: port('prepared'), model: port('model') }, { request: port('narration-request') }, [generation, 'src/lib/server/context-builder.ts#buildStoryContext']),
  narrate: definition({ request: port('narration-request'), model: port('model') }, { narration: port('narration') }, [generation], { providerCalls: 1 }),
  length: definition({ narration: port('narration'), prepared: port('prepared') }, { ready: port('content'), short: port('narration') }, [generation]),
  expand: definition({ short: port('narration'), prepared: port('prepared'), request: port('narration-request'), model: port('model') }, { ready: port('content') }, [generation], { providerCalls: 1, invocation: 'short-passage' }),
  content: definition({ candidates: alternative('content') }, { content: port('content') }, [generation]),
  retain: definition({ content: port('content'), source: port('source') }, { retained: port('retained') }, ['src/lib/server/passage-recovery.ts#generateRetainedPassage', 'src/lib/server/repository.ts#retainPassage']),
  'extraction-preflight': definition({ retained: port('retained'), prepared: port('prepared'), model: port('model') }, { request: port('extraction-request') }, [extraction]),
  extract: definition({ request: port('extraction-request'), model: port('model') }, { proposal: port('proposal') }, [extraction], { providerCalls: 1 }),
  validate: definition({ proposal: port('proposal'), retained: port('retained'), prepared: port('prepared') }, { candidate: port('proposal'), repair: port('repair') }, [extraction, 'src/lib/server/evidence-sources.ts#resolveEffectEvidence', 'src/lib/story-effects.ts#applyStoryEffects']),
  review: definition({ candidate: port('proposal'), prepared: port('prepared'), model: port('model') }, { checked: port('checked'), repair: port('repair') }, [extraction, review], { providerCalls: 1, invocation: 'inventory-trigger' }),
  'repair-input': definition({ issues: alternative('repair') }, { repair: port('repair') }, [extraction]),
  repair: definition({ repair: port('repair'), request: port('extraction-request'), model: port('model') }, { proposal: port('proposal') }, [extraction], { providerCalls: 1, invocation: 'repair-needed' }),
  revalidate: definition({ proposal: port('proposal'), retained: port('retained'), prepared: port('prepared') }, { candidate: port('proposal'), blocked: port('blocked') }, [extraction]),
  rereview: definition({ candidate: port('proposal'), prepared: port('prepared'), model: port('model') }, { checked: port('checked'), blocked: port('blocked') }, [extraction, review], { providerCalls: 1, invocation: 'inventory-trigger' }),
  acceptance: definition({ candidates: alternative('checked'), source: port('source') }, { approved: port('approved'), review: port('retained') }, ['src/lib/server/passage-recovery.ts#retryRetainedPassage', ...commit]),
  commit: definition({ approved: port('approved'), source: port('source') }, { committed: port('committed') }, [...commit, 'src/lib/server/passage-commit.ts#preparePassageCommit']),
  blocked: definition({ issues: alternative('blocked'), retained: port('retained') }, { draft: port('blocked') }, ['src/lib/server/repository.ts#blockRetained'], { invocation: 'unresolved' })
});

/** Immutable default behavior expressed as a DAG, with the single repair unrolled. */
export function defaultStoryWorkflow(mode: WorkflowMode): WorkflowDefinition {
  // Registering a future built-in must not silently change this fixture.
  const types = ['source', 'model', 'prepare', 'preflight', 'narrate', 'length', 'expand', 'content', 'retain', 'extraction-preflight', 'extract', 'validate', 'review', 'repair-input', 'repair', 'revalidate', 'rereview', 'acceptance', 'commit', 'blocked'];
  const nodes = types.map(type => ({ id: type, type, version: 1 as const,
    ...(type === 'source' ? { binding: 'current-source' } : type === 'model' ? { binding: 'text-profile' } : {}) }));
  const edges: WorkflowDefinition['edges'] = [];
  const connect = (from: string, output: string, to: string, input: string) => edges.push({ from: { node: from, port: output }, to: { node: to, port: input } });
  connect('source', 'source', 'prepare', 'source');
  for (const node of ['preflight', 'length', 'expand', 'extraction-preflight', 'validate', 'review', 'revalidate', 'rereview']) connect('prepare', 'prepared', node, 'prepared');
  for (const node of ['preflight', 'narrate', 'expand', 'extraction-preflight', 'extract', 'review', 'repair', 'rereview']) connect('model', 'model', node, 'model');
  connect('preflight', 'request', 'narrate', 'request');
  connect('preflight', 'request', 'expand', 'request');
  connect('narrate', 'narration', 'length', 'narration');
  connect('length', 'short', 'expand', 'short');
  connect('length', 'ready', 'content', 'candidates');
  connect('expand', 'ready', 'content', 'candidates');
  connect('content', 'content', 'retain', 'content');
  for (const node of ['retain', 'acceptance', 'commit']) connect('source', 'source', node, 'source');
  for (const node of ['extraction-preflight', 'validate', 'revalidate', 'blocked']) connect('retain', 'retained', node, 'retained');
  for (const node of ['extract', 'repair']) connect('extraction-preflight', 'request', node, 'request');
  connect('extract', 'proposal', 'validate', 'proposal');
  connect('validate', 'candidate', 'review', 'candidate');
  for (const node of ['validate', 'review']) connect(node, 'repair', 'repair-input', 'issues');
  connect('repair-input', 'repair', 'repair', 'repair');
  connect('repair', 'proposal', 'revalidate', 'proposal');
  connect('revalidate', 'candidate', 'rereview', 'candidate');
  for (const node of ['review', 'rereview']) connect(node, 'checked', 'acceptance', 'candidates');
  for (const node of ['revalidate', 'rereview']) connect(node, 'blocked', 'blocked', 'issues');
  connect('acceptance', 'approved', 'commit', 'approved');
  return { schemaVersion: 1, id: `default-story-${mode}`, version: 2, mode,
    bindings: [{ name: 'current-source', kind: 'source', sourceKind: mode === 'opening' ? 'setup' : 'story' }, { name: 'text-profile', kind: 'model', connectionRef: 'configured-text' }],
    nodes, edges, policy: { repairLimit: 1, acceptance: 'existing-policy', scheduling: 'serial-per-source' } };
}
