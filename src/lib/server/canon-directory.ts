import type {Story} from '../story';

/** Compact exact-ID lookup; descriptions and profiles stay in scoped full records. */
export function canonDirectory(story:Story) {
 return {characters:story.canon.characters.map(c=>[c.id,c.name,c.locationId]),places:story.canon.places.map(p=>[p.id,p.name,p.parentId]),
  items:story.canon.items.map(i=>[i.id,i.name,i.ownerId,i.quantity,i.equipped,Boolean(i.isContainer),Boolean(i.unlimited)]),relationships:story.canon.relationships.map(r=>[r.id,r.fromId,r.toId]),threads:story.canon.threads.map(t=>[t.id,t.title,t.status])};
}
