import { workflowDefinitionSchema, type NodeRegistry, type WorkflowDefinition } from './contracts';

export type GraphIssue = { code: string; message: string; nodeId?: string };
export function validateWorkflow(value: unknown, registry: NodeRegistry): { valid: boolean; issues: GraphIssue[]; graph?: WorkflowDefinition } {
  const parsed = workflowDefinitionSchema.safeParse(value);
  if (!parsed.success) return { valid: false, issues: parsed.error.issues.map(issue => ({ code: 'schema', message: `${issue.path.join('.')}: ${issue.message}` })) };
  const graph = parsed.data, issues: GraphIssue[] = [];
  const report = (code: string, message: string, nodeId?: string) => issues.push({ code, message, ...(nodeId ? { nodeId } : {}) });
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const bindings = new Map(graph.bindings.map(binding => [binding.name, binding]));
  if (nodes.size !== graph.nodes.length) report('duplicate-node', 'Node IDs must be unique.');
  if (bindings.size !== graph.bindings.length) report('duplicate-binding', 'Binding names must be unique.');
  if (graph.nodes.filter(node => node.type === 'repair').length > graph.policy.repairLimit) report('repair-limit', 'The graph can contain at most one repair operation.');
  for (const node of graph.nodes) {
    const definition = Object.hasOwn(registry, node.type) ? registry[node.type] : undefined;
    if (!definition) { report('unknown-node', `Unknown built-in node type: ${node.type}.`, node.id); continue; }
    if (definition.version !== node.version) report('node-version', `Unsupported implementation version for ${node.type}.`, node.id);
    const binding = node.binding ? bindings.get(node.binding) : undefined;
    if (definition.binding && (!binding || binding.kind !== definition.binding)) report('binding', `Node requires a ${definition.binding} binding.`, node.id);
    if (!definition.binding && node.binding) report('binding', 'This node does not accept an external binding.', node.id);
    if (binding?.kind === 'source' && binding.sourceKind !== (graph.mode === 'opening' ? 'setup' : 'story')) report('source-mode', `${graph.mode} has the wrong source kind.`, node.id);
  }
  const connections = new Set<string>(), incoming = new Map<string, number>(), adjacency = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    const key = `${edge.from.node}.${edge.from.port}>${edge.to.node}.${edge.to.port}`;
    if (connections.has(key)) report('duplicate-edge', `Duplicate connection: ${key}.`);
    connections.add(key);
    const from = nodes.get(edge.from.node), to = nodes.get(edge.to.node);
    if (!from || !to) { report('missing-node', `Connection refers to an unknown node: ${key}.`); continue; }
    const output = Object.hasOwn(registry, from.type) ? registry[from.type].outputs[edge.from.port] : undefined;
    const input = Object.hasOwn(registry, to.type) ? registry[to.type].inputs[edge.to.port] : undefined;
    if (!output || !input || !Object.hasOwn(registry[from.type]?.outputs ?? {}, edge.from.port) || !Object.hasOwn(registry[to.type]?.inputs ?? {}, edge.to.port)) report('missing-port', `Unknown port in ${key}.`);
    else {
      if (output.type !== input.type) report('port-type', `${key}: ${output.type} cannot feed ${input.type}.`, to.id);
      const portKey = `${to.id}.${edge.to.port}`;
      incoming.set(portKey, (incoming.get(portKey) ?? 0) + 1);
      if (!input.alternatives && incoming.get(portKey)! > 1) report('multiple-inputs', `${portKey} accepts one connection.`, to.id);
    }
    const next = adjacency.get(from.id) ?? new Set<string>(); next.add(to.id); adjacency.set(from.id, next);
  }
  for (const node of graph.nodes) {
    const definition = Object.hasOwn(registry, node.type) ? registry[node.type] : undefined;
    if (!definition) continue;
    for (const port of Object.keys(definition.inputs)) if (!incoming.has(`${node.id}.${port}`)) report('required-input', `Missing required input: ${node.id}.${port}.`, node.id);
  }
  // A bounded repair is unrolled in the fixture. No executable cycles in v1.
  const visiting = new Set<string>(), visited = new Set<string>();
  function visit(nodeId: string): boolean {
    if (visiting.has(nodeId)) return false;
    if (visited.has(nodeId)) return true;
    visiting.add(nodeId);
    for (const next of adjacency.get(nodeId) ?? []) if (!visit(next)) return false;
    visiting.delete(nodeId); visited.add(nodeId); return true;
  }
  for (const nodeId of nodes.keys()) if (!visit(nodeId)) { report('cycle', 'Workflow cycles are unsupported; use the explicit one-repair path.'); break; }
  return { valid: issues.length === 0, issues, graph };
}
