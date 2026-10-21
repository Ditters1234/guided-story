import type {Story} from '../story';
import {hasEntityPhrase,mentionedCharacters,resolveCharacterReference} from '../entity-scope';
import {memoryCurrent,memorySourceHash} from './context-state';

const ignored=new Set(['the','and','for','with','from','into','this','that','these','those','their','there','then','them','have','has','will','would','should','could','please','story','continue','naturally','next','passage','scene','about','without','while','only','some','more']);
// Conservative English inflections, not a semantic planner or domain vocabulary.
const stem=(word:string)=>word.length>5&&word.endsWith('ing')?word.slice(0,-3):word.length>4&&word.endsWith('ied')?word.slice(0,-3)+'y':word.length>4&&word.endsWith('ed')?word.slice(0,-2):word.length>4&&word.endsWith('ies')?word.slice(0,-3)+'y':word.length>3&&word.endsWith('s')&&!word.endsWith('ss')?word.slice(0,-1):word;
const terms=(text:string)=>new Set((text.normalize('NFKC').toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu)||[]).filter(word=>!ignored.has(word)).map(stem));
export type ActivitySource={id:string;kind:'lore'|'knowledge'|'memory'|'item'|'place';recordIds:string[]};
type VisibleRecord={id:string;kind:'item'|'place';name:string;text:string};
const maxSources=4,maxReferences=16;

/** Follow explicit references in goal-relevant existing evidence. No guessed tools,
 * no recursive neighborhood expansion, no ownership/location changes or new calls. */
export function activityScope(story:Story,goal:string,pov:string|undefined,visibleRecords:VisibleRecord[]=[]) {
 const query=terms(goal),sources:ActivitySource[]=[],ids=new Set<string>();let clipped=false;
 if(!query.size)return {ids,sources,clipped};
 const records=[...story.canon.characters,...story.canon.places,...story.canon.items];
 const existing=new Set(records.map(record=>record.id));
 const score=(text:string,keywords:string[]=[])=>{
  const words=terms(text),overlap=[...query].filter(word=>words.has(word)).length;
  const keywordScore=keywords.reduce((sum,key)=>{const keys=terms(key);return sum+(keys.size&&[...keys].every(word=>query.has(word))?4:0);},0);
  return keywordScore+(overlap>=Math.min(2,query.size)?overlap:0);
 };
 const candidates:{id:string;kind:ActivitySource['kind'];text:string;relatedIds:string[];score:number}[]=[];
 // These are records the ordinary scene selection already exposes. Follow named
 // references in their descriptions once; newly found records do not become seeds.
 for(const record of visibleRecords){
  const relevance=score(record.name+'\n'+record.text)||([...terms(record.name)].some(word=>query.has(word))?1:0);
  if(relevance)candidates.push({id:record.id,kind:record.kind,text:record.text,relatedIds:[],score:relevance});
 }
 for(const lore of story.context.lore)if(lore.visibility!=='hidden'){
  const relevance=score(lore.title+'\n'+lore.text,lore.keywords);
  if(relevance)candidates.push({id:lore.id,kind:'lore',text:lore.text,relatedIds:lore.relatedIds,score:relevance});
 }
 for(const knowledge of story.context.knowledge)if(knowledge.readerRevealed&&knowledge.truth==='established'&&pov&&knowledge.knownBy.includes(pov)&&(!knowledge.sourcePassageId||knowledge.sourceHash===memorySourceHash(story,[knowledge.sourcePassageId]))){
  const relevance=score(knowledge.fact);
  if(relevance)candidates.push({id:knowledge.id,kind:'knowledge',text:knowledge.fact,relatedIds:[],score:relevance});
 }
 for(const memory of story.context.memories)if(pov&&memory.characterIds.includes(pov)&&memoryCurrent(story,memory)&&memory.passageIds.every(id=>{const passage=story.passages.find(p=>p.id===id);return passage&&(passage.viewpointId||resolveCharacterReference(story.canon.characters,passage.viewpoint)?.id)===pov;})){
  // Open questions and summaries are not dependency facts. Consider only matching
  // fact sentences, so one matching fact cannot pull in the whole old scene.
  const facts=memory.facts.filter(fact=>score(fact)>0),relevance=Math.max(0,...facts.map(fact=>score(fact)));
  if(relevance)candidates.push({id:memory.id,kind:'memory',text:facts.join('\n'),relatedIds:[],score:relevance});
 }
 let inspected=0;
 for(const candidate of candidates.sort((a,b)=>b.score-a.score)){
  if(inspected++===24){clipped=true;break;}
  const references=[...new Set([...candidate.relatedIds,...mentionedCharacters(story.canon.characters,candidate.text),...records.filter(record=>hasEntityPhrase(candidate.text,record.name)||hasEntityPhrase(candidate.text,record.id)).map(record=>record.id)])].filter(id=>existing.has(id)&&id!==candidate.id);
  if(!references.length)continue;
  if(sources.length===maxSources){clipped=true;break;}
  const retained:string[]=[];
  for(const id of references){if(ids.has(id)||ids.size<maxReferences){ids.add(id);retained.push(id);}else clipped=true;}
  if(retained.length)sources.push({id:candidate.id,kind:candidate.kind,recordIds:retained});
 }
 return {ids,sources,clipped};
}
