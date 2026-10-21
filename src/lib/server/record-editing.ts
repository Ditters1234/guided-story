import { randomUUID } from 'node:crypto';
import { canonSchema, validateCanonicalState, pruneSceneBriefResources, type Story } from '../story';
import { recordCollections, type RecordKind, type RecordEdit } from '../record-editing';
import { StoryError } from '../errors';
import { correctionOperationSchema, type CorrectionOperation } from '../story-corrections';
import { z } from 'zod';
import { assertFactPinsUnchanged } from '../fact-pins';
import { rememberPassageViewpoints } from '../entity-scope';

/** Stage a reviewed correction as one graph; never expose a half-applied trade. */
export function applyCorrectionOperations(story:Story,input:CorrectionOperation[]):Story {
  const operations=z.array(correctionOperationSchema).min(1).max(30).parse(input),staged=structuredClone(story),seen=new Set<string>();
  if(operations.some(op=>op.type==='record'&&op.edit.kind==='character'&&story.canon.characters.find(c=>c.id===op.edit.value.id)?.name!==op.edit.value.name))rememberPassageViewpoints(staged);
  for(const op of operations){
    if(op.type==='world'){
      if(seen.has('world'))throw new StoryError('A correction can update world notes only once.');
      seen.add('world');staged.canon.funds=op.funds;staged.canon.cargoNotes=op.cargoNotes;continue;
    }
    const {edit}=op,id=edit.value.id!,key=`record:${id}`;
    if(seen.has(key))throw new StoryError('A correction contains duplicate changes for the same record.');
    seen.add(key);
    const rows=staged.canon[recordCollections[edit.kind]],index=rows.findIndex(r=>r.id===id);
    const exists=Object.values(recordCollections).some(collection=>staged.canon[collection].some(r=>r.id===id));
    if(op.create){
      if(!z.string().uuid().safeParse(id).success||exists)throw new StoryError('A new correction record needs a unique application-assigned ID.');
    }else if(index<0)throw new StoryError('A correction record no longer exists. Generate a fresh preview.',409);
    const value={...edit.value,id};
    if(('name' in value&&!value.name.trim())||('title' in value&&!value.title.trim()))throw new StoryError('A correction needs a record name or title.');
    if(edit.kind==='relationship'&&edit.value.fromId===edit.value.toId)throw new StoryError('Choose two different cast members for a relationship.');
    if(edit.kind==='character'){
      const person=edit.value,prior=story.canon.characters.find(c=>c.id===id);
      if(op.create&&(person.noNsfw!==true||person.pinnedAppearance!==false))throw new StoryError('New AI cast records keep the default content preferences.');
      if(prior){
        if(person.noNsfw!==prior.noNsfw||person.pinnedAppearance!==prior.pinnedAppearance)throw new StoryError('AI corrections cannot change character content preferences or pins.');
        if(prior.pinnedAppearance&&(['visual','wardrobe','injuries','appearanceNotes','outfitNotes'] as const).some(field=>JSON.stringify(person[field])!==JSON.stringify(prior[field])))throw new StoryError('This character’s appearance and outfit are pinned. Unpin them manually before proposing a physical correction.');
      }
    }
    if(edit.kind==='item'){
      const prior=story.canon.items.find(item=>item.id===id);
      if(Boolean(edit.value.unlimited)!==Boolean(prior?.unlimited))throw new StoryError('Only the reader can change Always available supply mode in the item editor.');
    }
    if(op.create)(rows as {id:string}[]).push(value);else (rows as {id:string}[])[index]=value;
  }
  staged.canon=canonSchema.parse(staged.canon);
  try{validateCanonicalState(staged.canon);}catch(e){throw new StoryError(e instanceof Error?e.message:'The correction has invalid references.');}
  assertFactPinsUnchanged(story,staged.canon);
  return staged;
}

export function saveRecord(story: Story, edit: RecordEdit) {
  const rows = story.canon[recordCollections[edit.kind]], value = {...edit.value,id:edit.value.id || randomUUID()};
  if (('name' in value && !value.name.trim()) || ('title' in value && !value.title.trim())) throw new StoryError('Enter a name or title.');
  if (edit.kind==='relationship' && edit.value.fromId===edit.value.toId) throw new StoryError('Choose two different cast members for a relationship.');
  if (edit.kind==='item' && edit.value.equipped && !story.canon.characters.some(c=>c.id===edit.value.ownerId)) throw new StoryError('Only a cast member can equip an item.');
  const index=rows.findIndex(r=>r.id===edit.value.id);
  if (edit.value.id && index<0) throw new StoryError('This record no longer exists. Reload the saved story.',404);
  if(edit.kind==='character'&&index>=0&&story.canon.characters.find(c=>c.id===edit.value.id)?.name!==edit.value.name)rememberPassageViewpoints(story);
  // The discriminated schema supplies exactly the corresponding record shape.
  if (index<0) (rows as {id:string}[]).push(value); else (rows as {id:string}[])[index]=value;
  try{validateCanonicalState(story.canon);}catch(e){throw new StoryError(e instanceof Error?e.message:'Check the record references.');}
  return value.id;
}

export function removeRecord(story: Story, kind: RecordKind, id: string) {
  const rows=story.canon[recordCollections[kind]], index=rows.findIndex(r=>r.id===id);
  if(index<0) throw new StoryError('This record no longer exists.',404);
  const blockers:string[]=[];
  if(kind==='character'){
    if(story.canon.characters.length===1)blockers.push('Keep at least one cast member.');
    if(story.canon.items.some(i=>i.ownerId===id))blockers.push('Transfer their possessions first.');
    if(story.canon.relationships.some(r=>r.fromId===id||r.toId===id))blockers.push('Remove their relationships first.');
  }
  if(kind==='place'){
    if(story.canon.places.length===1)blockers.push('Keep at least one place.');
    if(story.canon.places.some(p=>p.parentId===id))blockers.push('Move its contained places first.');
    if(story.canon.characters.some(c=>c.locationId===id))blockers.push('Move its cast members first.');
    if(story.canon.items.some(i=>i.ownerId===id))blockers.push('Transfer its possessions first.');
  }
  if(kind==='item'&&story.canon.items.some(item=>item.ownerId===id))blockers.push('Move the container’s contents elsewhere before removing it.');
  if(blockers.length)throw new StoryError(blockers.join(' '),409);
  // Historical prose, event receipts and photographs remain intact. Only live references are detached.
  if(['character','place','item'].includes(kind)){
    const record=rows[index], person=story.canon.characters.find(c=>c.id===id);
    for(const asset of story.media.assets)if(asset.subjectIds.includes(id)&&!asset.snapshots.some(s=>s.id===id))asset.snapshots.push({id,name:'name' in record?record.name:id,appearance:person?.appearance||'',outfit:person?.outfit||''});
    delete story.media.portraits[id];delete story.media.references[id];
    const brief=story.context.sceneBrief;
    if(brief.viewpointId===id)brief.viewpointId=null;if(brief.locationId===id)brief.locationId=null;
    brief.castIds=brief.castIds.filter(v=>v!==id);
    for(const l of story.context.lore)l.relatedIds=l.relatedIds.filter(v=>v!==id);
    for(const k of story.context.knowledge)k.knownBy=k.knownBy.filter(v=>v!==id);
    for(const m of story.context.memories){m.characterIds=m.characterIds.filter(v=>v!==id);m.locationIds=m.locationIds.filter(v=>v!==id);}
  }
  rows.splice(index,1);
  pruneSceneBriefResources(story);
}
