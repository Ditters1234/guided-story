import type {Story} from '../story';
import type {CorrectionRequest} from '../story-corrections';
import {recordCollections} from '../record-editing';
import {hasEntityPhrase,mentionedCharacters,mentionedItems} from '../entity-scope';
import {narrativeCharacterProfile} from './context-builder';

/** Full records for the requested correction, plus a compact lookup directory.
 * Directory-only records may be link targets, never guessed full-record edits. */
export function correctionContext(story:Story,input:CorrectionRequest,sourceText='') {
 const text=input.direction+'\n'+(input.kind==='repair'?sourceText:'');
 const explicitReportedItems=story.canon.items.filter(i=>hasEntityPhrase(input.direction,i.name)||hasEntityPhrase(input.direction,i.id));
 // In a single-record editor, "this notebook" identifies the selected notebook;
 // it must not expand every notebook in the world. Repairs retain noun ambiguity.
 // Replacement wording is not another event/entity mention. With exact reported
 // item targets, use those targets plus candidates from the actual source prose;
 // do not expand a repeated noun in the requested new description into every item.
 const itemReferences=input.kind==='repair'?[...mentionedItems(story.canon.items,sourceText),...(explicitReportedItems.length?explicitReportedItems.map(i=>i.id):mentionedItems(story.canon.items,input.direction))]:[];
 const selected={character:new Set(mentionedCharacters(story.canon.characters,text)),place:new Set<string>(),item:new Set(itemReferences),relationship:new Set<string>(),thread:new Set<string>()};
 for(const kind of Object.keys(recordCollections) as (keyof typeof recordCollections)[])for(const row of story.canon[recordCollections[kind]]){
  if(hasEntityPhrase(text,row.id)||('name' in row&&hasEntityPhrase(text,row.name))||('title' in row&&hasEntityPhrase(text,row.title)))selected[kind].add(row.id);
 }
 if(input.recordKind&&input.targetId)selected[input.recordKind].add(input.targetId);
 for(const row of story.canon.relationships)if(selected.relationship.has(row.id)){selected.character.add(row.fromId);selected.character.add(row.toId);}
 if(input.kind==='repair'){
  for(const row of story.canon.items)if(row.equipped&&selected.character.has(row.ownerId))selected.item.add(row.id);
  for(const row of story.canon.relationships)if(selected.character.has(row.fromId)&&selected.character.has(row.toId))selected.relationship.add(row.id);
 }
 // Follow immediate holders to their root. Never expand a bag into all contents.
 for(const id of [...selected.item]){
  let item=story.canon.items.find(i=>i.id===id);const seen=new Set<string>();
  while(item&&!seen.has(item.id)){
   seen.add(item.id);const parent=story.canon.items.find(i=>i.id===item!.ownerId);
   if(parent){selected.item.add(parent.id);item=parent;continue;}
   if(story.canon.characters.some(c=>c.id===item!.ownerId))selected.character.add(item.ownerId);
   else selected.place.add(item.ownerId);
   break;
  }
 }
 for(const person of story.canon.characters)if(selected.character.has(person.id))selected.place.add(person.locationId);
 for(const id of [...selected.place]){let place=story.canon.places.find(p=>p.id===id);const seen=new Set<string>();while(place&&!seen.has(place.id)){seen.add(place.id);selected.place.add(place.id);place=story.canon.places.find(p=>p.id===place!.parentId);}}
 const canon={characters:story.canon.characters.filter(c=>selected.character.has(c.id)).map(narrativeCharacterProfile),
  places:story.canon.places.filter(p=>selected.place.has(p.id)).map(({visualDescription,...p})=>p),
  items:story.canon.items.filter(i=>selected.item.has(i.id)).map(({visualDescription,...i})=>i),
  relationships:story.canon.relationships.filter(r=>selected.relationship.has(r.id)),threads:story.canon.threads.filter(t=>selected.thread.has(t.id)),funds:story.canon.funds,cargoNotes:story.canon.cargoNotes};
 return {canon,selected};
}
