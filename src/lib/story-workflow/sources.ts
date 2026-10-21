import type { Story } from '../story';
export function workflowSourceOptions(story:Pick<Story,'canon'|'context'>){
  const c=story.canon,names=new Map(c.characters.map(row=>[row.id,row.name]));
  return [...c.characters.map(row=>({id:row.id,name:row.name,kind:'Character'})),...c.places.map(row=>({id:row.id,name:row.name,kind:'Place'})),...c.items.map(row=>({id:row.id,name:row.name,kind:'Item'})),...c.relationships.map(row=>({id:row.id,name:`${names.get(row.fromId)??row.fromId} → ${names.get(row.toId)??row.toId}`,kind:'Relationship'})),...c.threads.map(row=>({id:row.id,name:row.title,kind:'Task'})),...story.context.lore.filter(row=>row.visibility!=='hidden').map(row=>({id:row.id,name:row.title,kind:'Background'}))];
}
