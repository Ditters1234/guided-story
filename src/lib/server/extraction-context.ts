import type { Story } from '../story';
import { mentionedCharacters, mentionedItems, storyViewpoint,hasEntityPhrase } from '../entity-scope';
import { narrativeCharacterProfile } from './context-builder';
import { canonDirectory } from './canon-directory';

/** A compact reference directory permits remote/newly mentioned references without a world dump.
 * Full records are selected from actual prose; storage ancestors are included without siblings.
 * The authoritative world is never replaced by this projection. */
export function extractionContext(story:Story,paragraphs:string[],direction='') {
 const actualText=paragraphs.join('\n\n');
 const needsPrior=!paragraphs.length||/\b(?:it|its|them|this|that|these|those|he|she|they|him|her|his|hers|their)\b/i.test(actualText);
 const referenceEndingForPronouns=needsPrior?(story.passages.at(-1)?.paragraphs.join('\n\n').slice(-2000)||''):'';
 // Future direction is only a preflight hint. Actual extraction follows written
 // prose and a bounded prior ending for references, not unperformed author plans.
 const text=actualText+'\n'+referenceEndingForPronouns+'\n'+(paragraphs.length?'':direction);
 const cast=new Set([...story.context.sceneBrief.castIds,storyViewpoint(story).id,...mentionedCharacters(story.canon.characters,paragraphs.length?actualText:direction)]);
 const itemIds=new Set(mentionedItems(story.canon.items,text));
 for(const item of story.canon.items)if(item.equipped&&cast.has(item.ownerId))itemIds.add(item.id);
 for(const id of [...itemIds]){
  let item=story.canon.items.find(i=>i.id===id),seen=new Set<string>();
  while(item&&!seen.has(item.id)){seen.add(item.id);const parent=story.canon.items.find(i=>i.id===item!.ownerId);if(!parent)break;itemIds.add(parent.id);item=parent;}
 }
 const places=new Set([story.context.sceneBrief.locationId,...story.canon.characters.filter(c=>cast.has(c.id)).map(c=>c.locationId)]);
 for(const place of story.canon.places)if(hasEntityPhrase(text,place.name))places.add(place.id);
 for(const item of story.canon.items.filter(i=>itemIds.has(i.id)))places.add(item.ownerId);
 for(const id of [...places]){let place=story.canon.places.find(p=>p.id===id);const seen=new Set<string>();while(place&&!seen.has(place.id)){seen.add(place.id);places.add(place.id);place=story.canon.places.find(p=>p.id===place!.parentId);}}
 return {
  referenceEndingForPronouns,
  before:{characters:story.canon.characters.filter(c=>cast.has(c.id)).map(narrativeCharacterProfile),
   places:story.canon.places.filter(p=>places.has(p.id)).map(({visualDescription,...p})=>p),
   items:story.canon.items.filter(i=>itemIds.has(i.id)).map(({visualDescription,...i})=>i),
   relationships:story.canon.relationships.filter(r=>cast.has(r.fromId)&&cast.has(r.toId)),
   threads:story.canon.threads.filter(t=>text.toLocaleLowerCase().includes(t.title.toLocaleLowerCase())),funds:story.canon.funds,cargoNotes:story.canon.cargoNotes},
  directory:canonDirectory(story)
 };
}
