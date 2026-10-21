import type { NodeAttempt, NodeRegistry, WorkflowDefinition } from '../../story-workflow/contracts';
import { validateWorkflow } from '../../story-workflow/validate';
import { StoryError } from '../../errors';
import type { StoredArtifact, StoryWorkflowStore } from './store';

export type NodeContext = { inputs: Record<string, StoredArtifact[]>; signal: AbortSignal; fetcher: typeof fetch; attempt: NodeAttempt; persist: (outputs:Record<string,unknown>)=>void };
export type NodeAdapter = {
  execute(context: NodeContext): Promise<Record<string, unknown>> | Record<string, unknown>;
  validate(port: string, value: unknown): void;
};
export type NodeSeed = { outputs: Record<string, unknown>; parents: StoredArtifact[] };

/** Sequential DAG execution. Missing conditional outputs settle downstream nodes as skipped. */
export async function runStoryWorkflow(options: {
  graph: WorkflowDefinition; registry: NodeRegistry; adapters: Record<string, NodeAdapter>; store: StoryWorkflowStore;
  runId: string; configurationFingerprint: string; signal: AbortSignal; fetcher: typeof fetch;
  seeds?: Record<string, NodeSeed>; skip?: string[];
}) {
  const { graph, registry, adapters, store, runId, signal } = options;
  const validation = validateWorkflow(graph, registry);
  if (!validation.valid) throw new StoryError(validation.issues.map(issue => issue.message).join(' '));
  // Validate the complete executable set before a single provider can be called.
  for (const node of graph.nodes) if (!Object.hasOwn(adapters, node.type)) throw new StoryError(`No trusted adapter for ${node.type}.`);
  const pending = new Set(graph.nodes.map(node => node.id)), settled = new Set<string>();
  const results = new Map<string, StoredArtifact[]>();
  while (pending.size) {
    let advanced = false;
    for (const node of graph.nodes) {
      if (!pending.has(node.id)) continue;
      const edges = graph.edges.filter(edge => edge.to.node === node.id);
      if (edges.some(edge => !settled.has(edge.from.node))) continue;
      const inputs: Record<string, StoredArtifact[]> = {};
      for (const [name] of Object.entries(registry[node.type].inputs)) inputs[name] = edges.filter(edge => edge.to.port === name).flatMap(edge => (results.get(edge.from.node) ?? []).filter(output => output.metadata.port === edge.from.port));
      const seed = options.seeds?.[node.id];
      const missing = Object.values(inputs).some(values => values.length === 0);
      const parents = [...Object.values(inputs).flat(), ...(seed?.parents ?? [])];
      const attempt = store.begin(runId, node.id, parents, options.configurationFingerprint);
      if (options.skip?.includes(node.id) || (missing && !seed)) {
        store.stopAttempt(attempt, 'skipped'); results.set(node.id, []);
      } else {
        try {
          signal.throwIfAborted();
          if (node.type === 'repair') store.markRepair(runId);
          if (Object.values(inputs).some(values => values.length > 1)) throw new StoryError('An exclusive workflow input produced multiple candidates. Nothing was saved.');
          let calls = 0;
          const fetcher: typeof fetch = async (url, init) => {
            if (++calls > registry[node.type].providerCalls) throw new StoryError('This node exceeded its provider request ceiling.');
            signal.throwIfAborted();
            const ioId = store.beginProvider(attempt, String(init?.body ?? ''));
            try {
              const response = await options.fetcher(url, init);
              if(!response.body){store.endProvider(ioId,'',response.status);return response;}
              const reader=response.body.getReader(),chunks:Uint8Array[]=[];let bytes=0,done=false;
              // Capture as the existing transport consumes the response. No unbounded clone/tee.
              const body=new ReadableStream<Uint8Array>({
                async pull(controller){
                  try{
                    const next=await reader.read();
                    if(next.done){
                      done=true;
                      if(bytes<=500_000){const all=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.length;}store.endProvider(ioId,new TextDecoder().decode(all),response.status);}
                      else store.endProvider(ioId,null,response.status,'The response exceeded the existing transport limit.');
                      controller.close();return;
                    }
                    bytes+=next.value.length;if(bytes<=500_000)chunks.push(next.value);
                    controller.enqueue(next.value);
                  }catch(error){store.endProvider(ioId,null,response.status,'The complete provider response could not be retained.');controller.error(error);}
                },
                async cancel(){if(!done)store.endProvider(ioId,null,response.status,'The response was interrupted or exceeded the transport limit.');await reader.cancel();}
              });
              return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
            } catch (error) { store.endProvider(ioId, null, null, 'The provider request did not complete.'); throw error; }
          };
          let persisted:StoredArtifact[]|undefined;
          const persist=(outputs:Record<string,unknown>)=>{
            if(persisted)throw new StoryError('A workflow node can persist its outputs only once.');
            const values = Object.entries(outputs).map(([port, value]) => {
              const definition = registry[node.type].outputs;
              if (!Object.hasOwn(definition, port)) throw new StoryError(`Node ${node.id} produced an unknown output port.`);
              adapters[node.type].validate(port, value);
              return { port, type: definition[port].type, value };
            });
            persisted=store.complete(attempt,values,calls?'model':'deterministic');
          };
          const outputs = seed?.outputs ?? await adapters[node.type].execute({ inputs, signal, fetcher, attempt, persist });
          if(!persisted)persist(outputs);
          results.set(node.id,persisted!);
        } catch (error) {
          store.stopAttempt(attempt, signal.aborted ? 'cancelled' : 'failed', error);
          throw error;
        }
      }
      settled.add(node.id); pending.delete(node.id); advanced = true;
    }
    if (!advanced) throw new StoryError('Workflow dependencies cannot settle. No new provider request was submitted.');
  }
  return results;
}
