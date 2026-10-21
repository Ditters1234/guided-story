import { StoryError } from '../../errors';
import { inspectExecutableWorkflow,type PresetReference } from '../../story-workflow/compile';
import type { WorkflowDefinition,WorkflowMode } from '../../story-workflow/contracts';
import type { StoryRepository } from '../repository';
import type { Connections } from './adapters';
import { validateWorkflowConfiguration } from './configuration';

export function compilePresetGraph(value:unknown,mode:WorkflowMode,sourceId:string):WorkflowDefinition {
  const result=inspectExecutableWorkflow(value);
  if(!result.eligible||!result.graph)throw new StoryError(result.issues.map(issue=>issue.message).join(' '));
  const graph=result.graph,binding=graph.bindings.find(binding=>binding.kind==='source');
  if(graph.mode!==mode||binding?.kind!=='source'||binding.sourceKind!==(mode==='opening'?'setup':'story')||binding.sourceId!==sourceId)throw new StoryError('The preset must be bound to this saved source and passage mode. Reload or choose another preset.',409);
  return graph;
}
export function presetGraph(repository:StoryRepository,reference:PresetReference,mode:WorkflowMode,sourceId:string){
  return compilePresetGraph(repository.workflowPresets.readVersion(reference.id,reference.revision).content.definition,mode,sourceId);
}
/** Repeat under the source job lock immediately before starting a new run. */
export function resolvePresetBindings(repository:StoryRepository,graph:WorkflowDefinition,sourceId:string,expectedRevision:number,configuration:Connections,reference?:PresetReference,effectsOnly=false){
  compilePresetGraph(graph,graph.mode,sourceId);
  if(reference){const preset=repository.workflowPresets.read(reference.id);if(preset.archived||preset.revision!==reference.revision)throw new StoryError('The selected workflow preset changed or was archived. Refresh and select its current revision before generating.',409);}
  const source=repository.readPreparationSource(graph.mode==='opening'?'setup':'story',sourceId);
  if(source.revision!==expectedRevision)throw new StoryError('The story or setup changed. Reload before generating.',409);
  validateWorkflowConfiguration(graph,source,configuration,{effectsOnly});
  return source;
}
