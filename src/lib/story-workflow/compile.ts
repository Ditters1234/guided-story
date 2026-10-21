import { z } from 'zod';
import { builtInStoryNodes,defaultStoryWorkflow } from './default-graph';
import { validateWorkflow,type GraphIssue } from './validate';
import type { WorkflowDefinition } from './contracts';

export const presetReferenceSchema=z.strictObject({id:z.string().uuid(),revision:z.number().int().positive()});
export type PresetReference=z.infer<typeof presetReferenceSchema>;
const edgeKey=(edge:WorkflowDefinition['edges'][number])=>`${edge.from.node}.${edge.from.port}>${edge.to.node}.${edge.to.port}`;

/** Executable subset v1: the complete checked passage path, with 1–8 routed model nodes. */
export function inspectExecutableWorkflow(value:unknown){
  const validation=validateWorkflow(value,builtInStoryNodes),issues:GraphIssue[]=[...validation.issues],graph=validation.graph;
  if(!graph||issues.length)return {eligible:false,issues,graph};
  const report=(code:string,message:string,nodeId?:string)=>issues.push({code,message,...(nodeId?{nodeId}:{})});
  const expected=defaultStoryWorkflow(graph.mode),required=expected.nodes.filter(node=>node.type!=='model');
  for(const node of required){const actual=graph.nodes.find(candidate=>candidate.id===node.id);if(!actual||actual.type!==node.type||actual.version!==node.version)report('stage-shape',`Keep the built-in ${node.id} stage and its ID for this executable subset.`,node.id);}
  for(const node of graph.nodes)if(node.type!=='model'&&!required.some(expected=>expected.id===node.id&&expected.type===node.type))report('stage-shape',`Extra or renamed ${node.type} stages are not executable in this subset.`,node.id);
  const models=graph.nodes.filter(node=>node.type==='model'),modelIds=new Set(models.map(node=>node.id));
  if(models.length<1||models.length>8)report('model-count','Use between one and eight connected model nodes.');
  const expectedEdges=new Set(expected.edges.filter(edge=>edge.from.node!=='model').map(edgeKey));
  const actualEdges=new Set(graph.edges.filter(edge=>!modelIds.has(edge.from.node)).map(edgeKey));
  for(const edge of expectedEdges)if(!actualEdges.has(edge))report('check-path',`Keep the built-in check/repair/save connection ${edge}.`);
  for(const edge of actualEdges)if(!expectedEdges.has(edge))report('check-path',`Unsupported check-path connection ${edge}.`);
  const modelTargets=new Set(expected.edges.filter(edge=>edge.from.node==='model').map(edge=>`${edge.to.node}.${edge.to.port}`));
  for(const edge of graph.edges.filter(edge=>modelIds.has(edge.from.node)))if(edge.from.port!=='model'||!modelTargets.has(`${edge.to.node}.${edge.to.port}`))report('model-route','Model nodes may only feed the existing model inputs.',edge.from.node);
  for(const node of models)if(!graph.edges.some(edge=>edge.from.node===node.id))report('unused-model','Connect every model node to a model input before execution.',node.id);
  for(const binding of graph.bindings){
    if(!graph.nodes.some(node=>node.binding===binding.name))report('unused-binding',`Remove the unused ${binding.name} binding before execution.`);
    if(binding.kind==='model'&&binding.connectionRef!=='configured-text')report('model-binding',`${binding.name} must reference the configured text profile.`);
  }
  if(graph.bindings.filter(binding=>binding.kind==='source').length!==1)report('source-binding','Use exactly one saved-source binding.');
  return {eligible:issues.length===0,issues,graph};
}
