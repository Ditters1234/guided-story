import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { StoryRepository, type Mutation } from '../src/lib/server/repository';
import { JobStore } from '../src/lib/server/jobs';
import { blankSetupPlan } from '../src/lib/setup';
import { sampleContinuationProposal } from '../src/lib/server/fixture';
import { validateStory, type Story } from '../src/lib/story';
import { buildStoryContext } from '../src/lib/server/context-builder';

const command=(s:Story,action:Mutation['action']):Mutation=>({expectedRevision:s.revision,requestId:randomUUID(),action});
function cleanup(folder:string){const target=resolve(folder);assert.ok(target.startsWith(resolve(tmpdir())+'\\'));rmSync(target,{recursive:true,force:true});}

test('record edits atomically correct ship travel, possessions and relationships, with current context and portable persistence',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'story-records-')),file=join(folder,'library.sqlite');let r=new StoryRepository(file);
  try{
    let s=r.create(),prose=structuredClone(s.passages);
    s=r.mutate(s.id,command(s,{type:'record-save',edit:{kind:'place',value:{...s.canon.places.find(p=>p.id==='wayward')!,parentId:'glass',description:'Docked at the Glass Belt.'}}}));
    assert.equal(s.canon.places.find(p=>p.id==='bridge')!.parentId,'wayward');assert.equal(s.recovery!.valid,false);assert.equal(s.context.compaction.epoch,1);
    s=r.mutate(s.id,command(s,{type:'record-save',edit:{kind:'item',value:{...s.canon.items.find(i=>i.id==='fob')!,name:'Bridge key',description:'A corrected access credential.',quantity:2,ownerId:'mira',equipped:true}}}));
    s=r.mutate(s.id,command(s,{type:'record-save',edit:{kind:'relationship',value:{...s.canon.relationships[0],notes:'Elias now trusts Ren with the manifest.'}}}));
    assert.deepEqual(s.passages,prose);const prompt=JSON.stringify(buildStoryContext(s,'Mira checks the Bridge key.',40000,4096).messages);
    assert.ok(prompt.includes('Bridge key'));assert.ok(prompt.includes('Docked at the Glass Belt.'));
    const copy=await r.import(r.export(s.id));assert.deepEqual(copy.canon,s.canon);
    r.close();r=new StoryRepository(file);assert.deepEqual(r.read(s.id).canon,s.canon);
  }finally{r.close();cleanup(folder);}
});

test('new records use assigned IDs, default nonsexual cast preferences, and deduplicate retries without reviving removed IDs',()=>{
  const r=new StoryRepository(':memory:');try{
    let s=r.create();const action={type:'record-save',edit:{kind:'character',value:{id:null,name:'Ada',role:'Doctor',notes:'',appearance:'',outfit:'',locationId:'bridge'}}} as Mutation['action'];
    const input=command(s,action);s=r.mutate(s.id,input);const ada=s.canon.characters.find(c=>c.name==='Ada')!;assert.ok(ada.id);assert.equal(ada.noNsfw,true);assert.deepEqual(r.mutate(s.id,input),s);
    assert.throws(()=>r.mutate(s.id,command(s,{type:'record-save',edit:{kind:'character',value:{...ada,id:'invented-id'}}})),/no longer exists/);
    s=r.mutate(s.id,command(s,{type:'record-remove',kind:'character',id:ada.id}));assert.throws(()=>r.mutate(s.id,command(s,{type:'record-save',edit:{kind:'character',value:ada}})),/no longer exists/);
  }finally{r.close();}
});

test('invalid containment, owners, equipment, quantities and relationship endpoints roll back without invalidating recovery',()=>{
  const r=new StoryRepository(':memory:');try{
    const s=r.create(),before=JSON.stringify(s);const actions:Mutation['action'][]=[
      {type:'record-save',edit:{kind:'place',value:{...s.canon.places.find(p=>p.id==='wayward')!,parentId:'bridge'}}},
      {type:'record-save',edit:{kind:'item',value:{...s.canon.items[0],ownerId:'missing'}}},
      {type:'record-save',edit:{kind:'item',value:{...s.canon.items[0],equipped:true}}},
      {type:'record-save',edit:{kind:'item',value:{...s.canon.items[0],quantity:0}}},
      {type:'record-save',edit:{kind:'relationship',value:{id:null,fromId:'elias',toId:'elias',notes:''}}},
      {type:'record-save',edit:{kind:'place',value:{id:null,name:'   ',description:'',parentId:null}}}
    ];
    for(const action of actions){assert.throws(()=>r.mutate(s.id,command(s,action)));assert.equal(JSON.stringify(r.read(s.id)),before);}
  }finally{r.close();}
});

test('record removals explain dependencies instead of silently moving or deleting live records',()=>{
  const r=new StoryRepository(':memory:');try{
    let s=r.create();assert.throws(()=>r.mutate(s.id,command(s,{type:'record-remove',kind:'place',id:'wayward'})),/contained places/);
    assert.throws(()=>r.mutate(s.id,command(s,{type:'record-remove',kind:'place',id:'bridge'})),/cast members/);
    assert.throws(()=>r.mutate(s.id,command(s,{type:'record-remove',kind:'character',id:'elias'})),/possessions.*relationships/);
    const thread=s.canon.threads[0];s=r.mutate(s.id,command(s,{type:'record-save',edit:{kind:'thread',value:{...thread,title:'A corrected question',status:'resolved'}}}));
    s=r.mutate(s.id,command(s,{type:'record-remove',kind:'thread',id:thread.id}));assert.ok(!s.canon.threads.some(t=>t.id===thread.id));
  }finally{r.close();}
});

test('removing a cast record detaches live context but preserves photographic identity, original files and written history',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'story-record-media-')),r=new StoryRepository(':memory:',false,join(folder,'media'));
  try{
    let s=r.create();const png=await sharp({create:{width:32,height:32,channels:3,background:'#54766a'}}).png().toBuffer();
    s=await r.addMedia(s.id,png,{expectedRevision:s.revision,requestId:randomUUID(),caption:'Ren at the controls',category:'portrait',subjectIds:['ren'],passageId:s.passages[0].id,parentId:null,status:'canonical'});
    s=r.mutate(s.id,command(s,{type:'media-select',characterId:'ren',assetId:s.media.assets[0].id,selection:'portrait'}));
    s=r.mutate(s.id,command(s,{type:'record-remove',kind:'relationship',id:s.canon.relationships[0].id}));
    const c=structuredClone(s.context);c.sceneBrief.viewpointId='ren';c.sceneBrief.castIds=['ren'];c.knowledge.push({id:'known-by-ren',fact:'Ren heard a knock.',truth:'belief',knownBy:['ren'],readerRevealed:true,sourcePassageId:null,sourceHash:null});
    s=r.mutate(s.id,command(s,{type:'context',context:c}));const prose=structuredClone(s.passages),snapshots=structuredClone(s.media.assets[0].snapshots);
    s=r.mutate(s.id,command(s,{type:'record-remove',kind:'character',id:'ren'}));
    assert.deepEqual(s.passages,prose);assert.deepEqual(s.media.assets[0].snapshots,snapshots);assert.ok(s.media.assets[0].subjectIds.includes('ren'));assert.equal(s.media.portraits.ren,undefined);
    assert.equal(s.context.sceneBrief.viewpointId,null);assert.deepEqual(s.context.knowledge.at(-1)!.knownBy,[]);validateStory(s);assert.deepEqual(r.mediaStore.original(s.media.assets[0]),png);
    const imported=await r.import(r.export(s.id));assert.deepEqual(imported.media.assets[0].snapshots,snapshots);
  }finally{r.close();cleanup(folder);}
});

test('stale manual edits cannot overwrite a newer record and story renaming preserves recovery and memory epoch',()=>{
  const r=new StoryRepository(':memory:');try{
    const s=r.create(),next=r.mutate(s.id,command(s,{type:'story-title',title:'A new title'}));
    assert.deepEqual(next.canon,s.canon);assert.deepEqual(next.recovery,s.recovery);assert.equal(next.context.compaction.epoch,s.context.compaction.epoch);
    assert.throws(()=>r.mutate(s.id,command(s,{type:'record-remove',kind:'item',id:'fob'})),/another tab/);assert.ok(r.read(s.id).canon.items.some(i=>i.id==='fob'));
    const same=r.mutate(next.id,command(next,{type:'record-save',edit:{kind:'item',value:next.canon.items[0]}}));assert.deepEqual(same.recovery,next.recovery);assert.equal(same.context.compaction.epoch,next.context.compaction.epoch);
  }finally{r.close();}
});

test('library deletion is scoped, revision checked, durable and replayable, and shared picture originals remain usable',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'story-library-')),file=join(folder,'library.sqlite');let r=new StoryRepository(file);
  try{
    let s=r.create();const png=await sharp({create:{width:32,height:32,channels:3,background:'#526a77'}}).png().toBuffer();
    s=await r.addMedia(s.id,png,{expectedRevision:s.revision,requestId:randomUUID(),caption:'Crew',category:'portrait',subjectIds:['elias'],passageId:null,parentId:null,status:'canonical'});
    const copy=await r.import(r.export(s.id)),id=randomUUID();assert.throws(()=>r.removeFromLibrary('story',s.id,0,id),/changed/);assert.equal(r.list().length,2);
    r.removeFromLibrary('story',s.id,s.revision,id);r.removeFromLibrary('story',s.id,s.revision,id);assert.throws(()=>r.read(s.id),/could not be found/);
    assert.deepEqual(r.mediaStore.original(r.read(copy.id).media.assets[0]),png);assert.throws(()=>r.commitGeneratedPassage(s.id,{expectedRevision:s.revision,requestId:randomUUID(),proposal:sampleContinuationProposal('')}),/could not be found/);
    r.close();r=new StoryRepository(file);r.removeFromLibrary('story',s.id,s.revision,id);assert.equal(r.list().length,1);assert.equal(r.read(copy.id).id,copy.id);
  }finally{r.close();cleanup(folder);}
});

test('discarded setups cannot receive late generations and deleting a written story also removes its linked setup',()=>{
  const r=new StoryRepository(':memory:');try{
    let d=r.createSetup({premise:'A crew on a ship.'},randomUUID());const plan=blankSetupPlan();
    r.removeFromLibrary('setup',d.id,0,randomUUID());assert.throws(()=>r.commitGeneratedSetup(d.id,0,randomUUID(),'late',plan),/not found/);
    d=r.createSetup({premise:'A fresh crew.'},randomUUID());d=r.saveSetup(d.id,{expectedRevision:0,requestId:randomUUID(),input:d.input,plan});
    const story=r.commitOpening(d.id,d.revision,randomUUID(),'opening',{mode:'continue',direction:'',draft:{title:'A beginning',chapterTitle:plan.chapterTitle,startsChapter:true,endOfChapter:false,viewpointId:plan.canon.characters[0].id,paragraphs:['The crew prepared to leave.']},effects:[]});
    assert.throws(()=>r.removeFromLibrary('setup',d.id,r.readSetup(d.id).revision,randomUUID()),/already a written story/);
    r.removeFromLibrary('story',story.id,story.revision,randomUUID());assert.throws(()=>r.readSetup(d.id),/not found/);assert.equal(r.listSetups().length,0);
  }finally{r.close();}
});

test('library removal waits for active text, setup and image jobs, while unrelated and finished jobs do not block it',()=>{
  const jobs=new JobStore(':memory:');try{
    for(const lockKey of ['story:book','setup:book','illustrations:book']){
      const {job}=jobs.start({kind:'qa',requestId:randomUUID(),lockKey,input:{}});assert.throws(()=>jobs.assertScopeIdle('book'),/still active/);assert.doesNotThrow(()=>jobs.assertScopeIdle('other'));
      jobs.transition(job.id,'cancelled');assert.doesNotThrow(()=>jobs.assertScopeIdle('book'));
    }
  }finally{jobs.close();}
});
