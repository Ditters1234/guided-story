import type { WorkflowDefinition } from '../../story-workflow/contracts';
import { sceneBriefResourceIds, type Story } from '../../story';
import { StoryError } from '../../errors';
import type { Connections } from './adapters';

export function modelConfiguration(graph:WorkflowDefinition,nodeId:string,base:Connections):Connections{
  const node=graph.nodes.find(n=>n.id===nodeId),config=node?.config;
  if(!node||node.type!=='model')throw new StoryError('Missing configured model node.');
  const overrides=config?.kind==='model'?config:undefined;
  if(overrides?.maxTokens!==undefined&&overrides.maxTokens>base.text.maxTokens)throw new StoryError('Workflow output tokens exceed the configured text-profile limit. Lower the node limit or change Settings explicitly.');
  const {kind:_kind,...settings}=overrides??{kind:'model'};
  return {...base,text:{...base.text,...settings}};
}
export function stageModelNode(graph:WorkflowDefinition,stageId:string){return graph.edges.find(e=>e.to.node===stageId&&e.to.port==='model')?.from.node;}
export function modelUsedForChecks(graph:WorkflowDefinition,id:string){return graph.edges.some(edge=>edge.from.node===id&&['extraction-preflight','extract','review','repair','rereview'].includes(edge.to.node));}
export function stageConfiguration(graph:WorkflowDefinition,stageId:string,base:Connections){
  const id=stageModelNode(graph,stageId);return id?modelConfiguration(graph,id,base):base;
}
export function sourceReferences(graph:WorkflowDefinition){const config=graph.nodes.find(n=>n.type==='source')?.config;return config?.kind==='source'?config.resourceIds:[];}
export function validateWorkflowConfiguration(graph:WorkflowDefinition,source:Story,base:Connections,options:{effectsOnly?:boolean}={}){
  for(const node of graph.nodes.filter(n=>n.type==='model'&&(!options.effectsOnly||modelUsedForChecks(graph,n.id))))if(!modelConfiguration(graph,node.id,base).text.model.trim())throw new StoryError('The preset needs a configured text model. Save one in Settings or choose it explicitly on the model node.');
  // Original narration references remain provenance, not prerequisites for rechecking
  // retained prose against corrected current facts. No narration is being requested.
  if(options.effectsOnly)return;
  const available=sceneBriefResourceIds(graph.mode==='replace'&&source.recovery?.valid?{...source,canon:source.recovery.canon}:source);
  if(sourceReferences(graph).some(id=>!available.has(id)))throw new StoryError('A workflow source reference is missing or hidden. Reload and choose current visible references.',409);
  if(new Set([...source.context.sceneBrief.resourceIds??[],...sourceReferences(graph)]).size>250)throw new StoryError('The saved scene and workflow together exceed 250 explicit references.');
}
