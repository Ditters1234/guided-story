import { z } from 'zod';
import type { Canon } from './story';
import type { ContextData } from './context-types';

export type WorldNodeKind='place'|'character'|'item'|'lore'|'thread'|'relationship';
export type WorldNode={key:string;id:string;kind:WorldNodeKind;name:string;text:string;parent:string|null;connection:string;hidden:boolean;tags:string[]};
export type WorldMapModel=ReturnType<typeof buildWorldMap>;
export const worldKey=(kind:WorldNodeKind,id:string)=>`${kind}:${id}`;

/** Author navigation only. Never supplies model context or invents a physical link. */
export function buildWorldMap(canon:Canon,context:ContextData) {
  const nodes=new Map<string,WorldNode>(),byId=new Map<string,string>(),children=new Map<string,WorldNode[]>(),related=new Map<string,string[]>();
  const add=(kind:WorldNodeKind,id:string,name:string,text:string,parent:string|null,connection:string,tags:string[]=[],hidden=false)=>{
    const node={key:worldKey(kind,id),kind,id,name,text,parent,connection,tags,hidden};nodes.set(node.key,node);byId.set(id,node.key);return node;
  };
  for(const place of canon.places)add('place',place.id,place.name,place.description,place.parentId?worldKey('place',place.parentId):null,place.parentId?'Inside location':'Root location');
  for(const person of canon.characters)add('character',person.id,person.name,[person.role,person.notes].join('\n'),worldKey('place',person.locationId),'Currently present at');
  for(const item of canon.items){const holder=canon.characters.some(p=>p.id===item.ownerId)?'character':canon.places.some(p=>p.id===item.ownerId)?'place':'item';add('item',item.id,item.name,item.description,worldKey(holder,item.ownerId),holder==='character'?'Held directly by':'Stored directly in',[item.isContainer?'Container':'',item.unlimited?'Always available':`Counted quantity ${item.quantity}`,item.equipped?'Worn / equipped':''].filter(Boolean));}
  for(const lore of context.lore){const node=add('lore',lore.id,lore.title,lore.text,null,'Related background',[],lore.visibility==='hidden');for(const id of lore.relatedIds){const list=related.get(id)??[];list.push(node.key);related.set(id,list);}}
  for(const thread of canon.threads)add('thread',thread.id,thread.title,thread.notes,null,'Future task / story thread',[thread.status]);
  for(const relationship of canon.relationships){const from=canon.characters.find(p=>p.id===relationship.fromId)?.name??relationship.fromId,to=canon.characters.find(p=>p.id===relationship.toId)?.name??relationship.toId,node=add('relationship',relationship.id,`${from} → ${to}`,relationship.notes,null,'Directional relationship');for(const id of [relationship.fromId,relationship.toId]){const list=related.get(id)??[];list.push(node.key);related.set(id,list);}}
  const physical=[...nodes.values()].filter(node=>['place','character','item'].includes(node.kind));
  for(const node of physical)if(node.parent){const list=children.get(node.parent)??[];list.push(node);children.set(node.parent,list);}
  const roots=physical.filter(node=>node.kind==='place'&&!node.parent);
  const sceneReferences=(context.sceneBrief.resourceIds??[]).map(id=>byId.get(id)).filter((key):key is string=>Boolean(key));
  return {nodes,byId,children,related,physical,roots,sceneReferences,brief:context.sceneBrief};
}
export function worldPath(model:WorldMapModel,key:string):WorldNode[] {
  const path:WorldNode[]=[],seen=new Set<string>();let node=model.nodes.get(key);
  while(node&&!seen.has(node.key)){seen.add(node.key);path.unshift(node);node=node.parent?model.nodes.get(node.parent):undefined;}
  return path;
}
export function worldSearch(model:WorldMapModel,query:string,hidden=false) {
  const text=query.trim().toLocaleLowerCase();if(!text)return [];
  return [...model.nodes.values()].filter(node=>(hidden||!node.hidden)&&[node.name,node.id,node.text,node.tags.join(' '),worldPath(model,node.key).map(p=>p.name).join(' / ')].join('\n').toLocaleLowerCase().includes(text));
}
export type WorldRow={node:WorldNode;depth:number;hasChildren:boolean;open:boolean;path:string};
export function projectWorldMap(model:WorldMapModel,expanded:ReadonlySet<string>,options:{query?:string;focus?:string|null;hidden?:boolean;limit?:number}={}) {
  const matches=worldSearch(model,options.query??'',options.hidden),searching=Boolean(options.query?.trim()),allowed=new Set<string>();
  if(searching)for(const match of matches)for(const parent of worldPath(model,match.key))allowed.add(parent.key);
  const focusPath=options.focus?worldPath(model,options.focus):[],focusAncestors=new Set(focusPath.map(node=>node.key));
  const roots=model.roots.filter(node=>!focusPath.length||focusAncestors.has(node.key));
  const rows:WorldRow[]=[],seen=new Set<string>(),stack=roots.slice().reverse().map(node=>({node,depth:0}));let total=0;
  while(stack.length){const {node,depth}=stack.pop()!;if(seen.has(node.key)||searching&&!allowed.has(node.key))continue;seen.add(node.key);total++;
    const children=(model.children.get(node.key)??[]).filter(child=>!options.focus||node.key===options.focus||!focusAncestors.has(node.key)||focusAncestors.has(child.key));
    const open=searching?children.some(child=>allowed.has(child.key)):expanded.has(node.key);
    if(rows.length<(options.limit??120))rows.push({node,depth,hasChildren:(model.children.get(node.key)?.length??0)>0,open,path:worldPath(model,node.key).map(p=>p.name).join(' / ')});
    if(open)for(const child of children.slice().reverse())stack.push({node:child,depth:depth+1});
  }
  return {rows,total,matches,referenceMatches:searching?matches.filter(node=>!['place','character','item'].includes(node.kind)):[]};
}
export function sceneFocus(model:WorldMapModel,fallbackViewpointId?:string) {
  const brief=model.brief,id=brief.locationId??model.nodes.get(worldKey('character',brief.viewpointId??fallbackViewpointId??''))?.parent?.slice('place:'.length);
  return id&&model.nodes.has(worldKey('place',id))?worldKey('place',id):null;
}
export function focusExpansion(model:WorldMapModel,key:string) {return new Set(worldPath(model,key).map(node=>node.key));}

const positionSchema=z.strictObject({key:z.string().min(1).max(120),x:z.number().finite().min(0).max(50000),y:z.number().finite().min(0).max(50000)});
export const worldLayoutSchema=z.strictObject({version:z.literal(1),mode:z.enum(['diagram','list']),expanded:z.array(z.string().max(120)).max(6000),positions:z.array(positionSchema).max(6000)}).refine(value=>new Set(value.positions.map(position=>position.key)).size===value.positions.length,'Duplicate layout positions.');
export type WorldLayout=z.infer<typeof worldLayoutSchema>;
export const emptyWorldLayout=():WorldLayout=>({version:1,mode:'diagram',expanded:[],positions:[]});
export function readWorldLayout(value:unknown,model:WorldMapModel):WorldLayout {
  const parsed=worldLayoutSchema.safeParse(value);if(!parsed.success)return emptyWorldLayout();
  return {...parsed.data,expanded:parsed.data.expanded.filter(key=>model.nodes.has(key)),positions:parsed.data.positions.filter(position=>model.nodes.has(position.key))};
}
export function sceneReferenceIds(context:ContextData,node:WorldNode):string[] {
  if(node.hidden)throw new Error('Hidden author background cannot be added to scene references.');
  const ids=context.sceneBrief.resourceIds??[];
  if(ids.includes(node.id))return [...ids];
  if(ids.length>=250)throw new Error('The scene already has 250 reviewed references. Remove one in the scene brief first.');
  return [...ids,node.id];
}
