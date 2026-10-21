import type { Story, Character } from './story';
import { StoryError } from './errors';

const normalized=(text:string)=>text.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const words=(text:string)=>normalized(text).split(' ').filter(Boolean);
const phrase=(text:string,name:string)=>` ${normalized(text)} `.includes(` ${normalized(name)} `);
export const hasEntityPhrase=phrase;

/** Full names/IDs take precedence. A short name must identify exactly one person. */
export function resolveCharacterReference(characters:Character[],reference:string):Character|undefined {
 const key=normalized(reference);
 if(!key)return undefined;
 const exact=characters.filter(c=>c.id===reference||normalized(c.name)===key);
 if(exact.length===1)return exact[0];
 const candidates=characters.filter(c=>words(c.name).includes(key));
 return candidates.length===1?candidates[0]:undefined;
}

export function storyViewpoint(story:Pick<Story,'canon'|'passages'|'context'>):Character {
 const explicit=story.context.sceneBrief.viewpointId;
 if(explicit){const person=story.canon.characters.find(c=>c.id===explicit);if(person)return person;throw new StoryError('The scene viewpoint no longer exists. Choose a viewpoint in Scene direction.');}
 const previousId=story.passages.at(-1)?.viewpointId;
 if(previousId){const person=story.canon.characters.find(c=>c.id===previousId);if(person)return person;throw new StoryError('The previous viewpoint character no longer exists. Choose a viewpoint in Scene direction.');}
 const previous=story.passages.at(-1)?.viewpoint;
 if(previous?.trim()){
  const person=resolveCharacterReference(story.canon.characters,previous);
  if(person)return person;
  throw new StoryError('The previous viewpoint is ambiguous or no longer matches the cast. Choose a viewpoint in Scene direction.');
 }
 const person=story.canon.characters[0];
 if(!person)throw new StoryError('The story needs a viewpoint character.');
 return person;
}

/** Capture identifiable legacy viewpoints before an authorized cast edit/commit.
 * Historical display names/prose stay untouched; ambiguous legacy names are never guessed. */
export function rememberPassageViewpoints(story:Pick<Story,'canon'|'passages'>) {
 for(const passage of story.passages)if(!passage.viewpointId){const person=resolveCharacterReference(story.canon.characters,passage.viewpoint);if(person)passage.viewpointId=person.id;}
}

/** Mentions are references, never proof of presence. No shared-surname word matching. */
export function mentionedCharacters(characters:Character[],text:string):string[] {
 return characters.filter(c=>phrase(text,c.name)||(() => {
  const first=words(c.name)[0];
  return Boolean(first&&characters.filter(other=>words(other.name)[0]===first).length===1&&phrase(text,first));
 })()).map(c=>c.id);
}

/** Broad candidate lookup for extraction: retain ambiguous object nouns for resolution. */
export function mentionedItems(items:Story['canon']['items'],text:string):string[] {
 const exact=items.filter(item=>phrase(text,item.name));
 // Remove exact spans before generic noun lookup. A numbered/full reference must
 // not make every same-noun record eligible; a separate generic mention still can.
 let remaining=` ${normalized(text)} `;
 for(const name of [...new Set(exact.map(item=>normalized(item.name)))].sort((a,b)=>b.length-a.length))remaining=remaining.replaceAll(` ${name} `,' ');
 const textWords=new Set(words(remaining)),exactIds=new Set(exact.map(item=>item.id));
 return items.filter(item=>exactIds.has(item.id)||words(item.name).filter(w=>w.length>=3).slice(-1).some(w=>textWords.has(w)||textWords.has(w+'s')||textWords.has(w+'es')||(w.endsWith('y')&&textWords.has(w.slice(0,-1)+'ies'))||(w.endsWith('brush')&&textWords.has('brush')))).map(item=>item.id);
}
