import { z } from 'zod';
import { workflowDefinitionSchema, type WorkflowDefinition } from './contracts';
import { builtInStoryNodes } from './default-graph';
import { validateWorkflow, type GraphIssue } from './validate';

export const presetContentSchema=z.strictObject({name:z.string().trim().min(1).max(160),description:z.string().max(2000),definition:workflowDefinitionSchema});
export const presetSaveSchema=z.strictObject({requestId:z.string().uuid(),expectedRevision:z.number().int().min(0),content:presetContentSchema});
export const portablePresetSchema=z.strictObject({format:z.literal('guided-story-workflow-preset'),version:z.literal(1),content:presetContentSchema});
export type PresetContent=z.infer<typeof presetContentSchema>;
export type WorkflowPreset={id:string;revision:number;createdAt:string;updatedAt:string;content:PresetContent};
export const supportedNode=(type:string)=>Object.hasOwn(builtInStoryNodes,type)?builtInStoryNodes[type]:undefined;

/** Draft diagnostics, not an execution authorization. Runtime bindings resolve later. */
export function assessPreset(definition:WorkflowDefinition){
  const structural=validateWorkflow(definition,builtInStoryNodes),bindings:GraphIssue[]=[];
  for(const binding of definition.bindings){
    if(binding.kind==='source'&&!binding.sourceId)bindings.push({code:'unbound-source',message:`${binding.name}: choose a saved ${binding.sourceKind} before future execution.`});
    if(binding.kind==='model'&&binding.connectionRef!=='configured-text')bindings.push({code:'unbound-model',message:`${binding.name}: model connection reference is unavailable. Choose configured-text.`});
  }
  for(const type of ['source','retain','acceptance','commit'])if(definition.nodes.filter(node=>node.type===type).length!==1)structural.issues.push({code:'required-stage',message:`A passage workflow needs exactly one ${type} stage.`});
  return {structuralValid:structural.issues.length===0,issues:structural.issues,bindings,requiresRuntimeValidation:true as const};
}
/** Portable definitions retain connection references, never source IDs or copied facts. */
export function exportPreset(content:PresetContent){
  const copy=presetContentSchema.parse(content);
  copy.definition.bindings=copy.definition.bindings.map(binding=>binding.kind==='source'?{name:binding.name,kind:'source',sourceKind:binding.sourceKind}:{...binding,connectionRef:binding.connectionRef==='configured-text'?'configured-text':'unbound'});
  return portablePresetSchema.parse({format:'guided-story-workflow-preset',version:1,content:copy});
}
export function importPreset(value:unknown):PresetContent {
  // Imported source identifiers are deliberately detached on this computer too.
  return exportPreset(portablePresetSchema.parse(value).content).content;
}
export function addBuiltIn(definition:WorkflowDefinition,type:string):WorkflowDefinition {
  if(!Object.hasOwn(builtInStoryNodes,type))throw new Error('Choose a supported built-in node.');
  const copy=structuredClone(definition);if(copy.nodes.length>=100)throw new Error('A draft supports at most 100 nodes.');
  let id=type,index=2;while(copy.nodes.some(node=>node.id===id))id=`${type}-${index++}`;
  const binding=builtInStoryNodes[type].binding;
  copy.nodes.push({id,type,version:1,...(binding?{binding:copy.bindings.find(value=>value.kind===binding)?.name}:{})});return copy;
}
export function removeBuiltIn(definition:WorkflowDefinition,id:string):WorkflowDefinition {
  if(definition.nodes.length<=1)throw new Error('Keep at least one node in the draft.');
  const copy=structuredClone(definition);copy.nodes=copy.nodes.filter(node=>node.id!==id);copy.edges=copy.edges.filter(edge=>edge.from.node!==id&&edge.to.node!==id);return copy;
}
