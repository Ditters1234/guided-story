import { z } from 'zod';
import type { WorkflowDefinition } from './contracts';
import { supportedNode } from './presets';

export const workflowGroups=[{id:'sources',name:'Sources and models'},{id:'prose',name:'Prose'},{id:'checks',name:'World updates and checks'},{id:'save',name:'Acceptance and recovery'}] as const;
export type WorkflowGroup=typeof workflowGroups[number]['id'];
export function nodeGroup(type:string):WorkflowGroup{
  if(['source','model','prepare'].includes(type))return 'sources';
  if(['preflight','narrate','length','expand','content','retain'].includes(type))return 'prose';
  if(['acceptance','commit','blocked'].includes(type))return 'save';return 'checks';
}
export const authorLayoutSchema=z.strictObject({version:z.literal(1),positions:z.array(z.strictObject({id:z.string().min(1).max(100),x:z.number().finite().min(0).max(10000),y:z.number().finite().min(50).max(30000)})).max(100),collapsed:z.array(z.enum(['sources','prose','checks','save'])).max(4)});
export type AuthorLayout=z.infer<typeof authorLayoutSchema>;
export const emptyAuthorLayout=():AuthorLayout=>({version:1,positions:[],collapsed:[]});
export function readAuthorLayout(value:unknown,graph:WorkflowDefinition):AuthorLayout{
  const parsed=authorLayoutSchema.safeParse(value);if(!parsed.success)return emptyAuthorLayout();
  if(new Set(parsed.data.positions.map(p=>p.id)).size!==parsed.data.positions.length||new Set(parsed.data.collapsed).size!==parsed.data.collapsed.length)return emptyAuthorLayout();
  return {...parsed.data,positions:parsed.data.positions.filter(p=>graph.nodes.some(n=>n.id===p.id))};
}
export function authorNodeHeight(type:string){const node=supportedNode(type);return 112+(Object.keys(node?.inputs??{}).length+Object.keys(node?.outputs??{}).length)*26;}
export function authorPositions(graph:WorkflowDefinition,layout:AuthorLayout){
  const rows=new Map<WorkflowGroup,number>();
  return new Map(graph.nodes.map(node=>{const group=nodeGroup(node.type),y=rows.get(group)??70;rows.set(group,y+authorNodeHeight(node.type)+24);const saved=layout.positions.find(p=>p.id===node.id);return [node.id,saved?{x:saved.x,y:saved.y}:{x:20+workflowGroups.findIndex(g=>g.id===group)*330,y}];}));
}
