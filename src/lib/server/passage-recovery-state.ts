import { createHash } from 'node:crypto';
import type { Story } from '../story';
import { pruneSceneBriefResources } from '../story';
import type { PassageContent } from '../passage-proposal';
import type { RecoveryIssue, RetainedPassage } from '../passage-recovery';
import { hasEntityPhrase } from '../entity-scope';
import { inventoryPath } from '../inventory';
import { StoryError } from '../errors';
import { restoreLoreItemLinks } from './lore-references';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const recoveryHistoryHash=(story:Story)=>hash(story.passages);
export function recoverySourceHash(story:Story){const {createdAt,updatedAt,...stable}=story;return hash(stable);}
export function recoveryBaseline(source:Story,content:PassageContent):Story {
  const story=structuredClone(source);
  if(!story.canon.characters.some(person=>person.id===content.draft.viewpointId))throw new StoryError('The retained passage’s viewpoint is no longer in the saved cast. Its prose is kept, but these updates cannot be accepted.',409);
  if(content.mode==='replace'){
    if(!story.recovery?.valid||story.passages.at(-1)?.id!==content.passageId)throw new StoryError('The latest-passage recovery point changed. The retained rewrite is kept for reading or copying; it cannot replace this saved history.',409);
    story.canon=structuredClone(story.recovery.canon);restoreLoreItemLinks(story.context.lore,story.recovery.loreLinks,story.canon);pruneSceneBriefResources(story);story.passages=story.passages.slice(0,-1);
  }
  return story;
}
export function recoveryIssues(error:unknown):RecoveryIssue[]{
  if(error&&typeof error==='object'&&'issues'in error&&Array.isArray(error.issues)&&error.issues.every(issue=>typeof issue==='string'))return error.issues.slice(0,16).map(message=>({category:'consistency',message:message.slice(0,6000)}));
  const detail=(error instanceof Error?error.message:'The world-update check could not finish.').slice(0,10000);
  if(/invalid effect fields|invalid passage effects|Check these fields/i.test(detail))return [{category:'validation',message:'The model returned an invalid world update. Review the affected saved records and attempted changes below, then retry the updates.',detail}];
  if(/transfer disagrees.*owner/i.test(detail))return [{category:'validation',message:'An item is being moved from a holder that does not match its saved holder.',detail}];
  return [{category:/changed|recovery point/i.test(detail)?'stale':/pins|quantity|reference|ownership|evidence|proposal/i.test(detail)?'validation':'request',message:detail.slice(0,6000)}];
}
export function recoveryFacts(story:Story,content:PassageContent,effects:unknown[]):RetainedPassage['facts'] {
  const text=content.draft.paragraphs.join('\n'),ids=new Set(effects.flatMap(effect=>effect&&typeof effect==='object'?Object.entries(effect).filter(([key,value])=>key!=='evidence'&&key!=='evidenceId'&&typeof value==='string').map(([,value])=>String(value)):[]));
  return [
    ...story.canon.items.filter(row=>ids.has(row.id)||hasEntityPhrase(text,row.name)).map(row=>({id:row.id,kind:'item' as const,name:row.name,detail:`${row.unlimited?'Always available supply':`Counted quantity: ${row.quantity}`} · ${row.isContainer?'Container · ':''}Held/stored: ${inventoryPath(story.canon,row.ownerId)}. ${row.description}`})),
    ...story.canon.characters.filter(row=>ids.has(row.id)||hasEntityPhrase(text,row.name)).map(row=>({id:row.id,kind:'character' as const,name:row.name,detail:`Location: ${inventoryPath(story.canon,row.locationId)}`})),
    ...story.canon.places.filter(row=>ids.has(row.id)||hasEntityPhrase(text,row.name)).map(row=>({id:row.id,kind:'place' as const,name:row.name,detail:`Inside: ${row.parentId?inventoryPath(story.canon,row.parentId):'Independent place'}`}))
  ].slice(0,60).map(row=>({...row,detail:row.detail.slice(0,5000)}));
}
