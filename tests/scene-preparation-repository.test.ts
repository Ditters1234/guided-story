import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {strFromU8,unzipSync} from 'fflate';
import {StoryRepository,type PreparationSourceKind} from '../src/lib/server/repository';
import {blankSetupPlan,type SetupDraft} from '../src/lib/setup';
import type {Story} from '../src/lib/story';
import {scenePreparationRequestSchema,type ScenePreparationProposal} from '../src/lib/scene-preparation';
import {prepareScenePreparation,scenePreparationSourceHash} from '../src/lib/server/scene-preparation';
import {jobFingerprint} from '../src/lib/server/jobs';

function setup(r:StoryRepository):SetupDraft{
  const draft=r.createSetup({premise:'Alex cares for a pony at a quiet stable.',castSize:1},randomUUID()),plan=blankSetupPlan();
  plan.canon.places=[{id:'stable',name:'Stable',description:'A clean working stable.',parentId:null}];
  Object.assign(plan.canon.characters[0],{id:'alex',name:'Alex',locationId:'stable'});
  plan.canon.items=[{id:'sugar',name:'Sugar cubes',description:'Small white pony treats.',quantity:1,ownerId:'alex',equipped:false,unlimited:true},{id:'brush',name:'Grooming brush',description:'A soft wooden brush.',quantity:1,ownerId:'stable',equipped:false}];
  plan.context.sceneBrief={...plan.context.sceneBrief,viewpointId:'alex',locationId:'stable',castIds:['alex'],purpose:'Visit the pony.'};
  plan.context.lore=[{id:'stable-routine',title:'Stable routine',text:'Quiet handling is customary. Current inventory governs supplies.',visibility:'relevant',keywords:['feeding'],relatedIds:['sugar']}];
  plan.factPins.fields=[{kind:'item',recordId:'sugar',field:'unlimited'},{kind:'item',recordId:'sugar',field:'quantity'},{kind:'item',recordId:'sugar',field:'ownerId'}];
  return r.saveSetup(draft.id,{expectedRevision:draft.revision,requestId:randomUUID(),input:draft.input,plan});
}
function publish(r:StoryRepository,draft=setup(r)):Story{
  return r.commitOpening(draft.id,draft.revision,randomUUID(),'scene-preparation-test',{mode:'continue',direction:'',draft:{title:'At the stable',chapterTitle:draft.plan!.chapterTitle,startsChapter:true,endOfChapter:false,viewpointId:'alex',paragraphs:['Alex stood in the stable and listened to the quiet yard.']},effects:[],memory:{summary:'Alex visited the stable.',facts:['Alex is in the stable.'],openQuestions:[],characterIds:['alex'],locationIds:['stable']}});
}
function proposed(source:Story,withCanon=true){
  const request=scenePreparationRequestSchema.parse({expectedRevision:source.revision,requestId:randomUUID(),direction:'Prepare a feeding scene using the existing treats and brush.',characterIds:['alex'],placeIds:['stable'],itemIds:['sugar','brush']});
  const result=prepareScenePreparation(source,request,{
    explanation:'PRIVATE PREPARATION PREVIEW: reuse the treats and brush and prepare only missing resources.',reusedIds:['sugar','brush'],
    places:withCanon?[{ref:'new-feed-room',name:'Feed room',description:'A small room for measured feed.',parentId:'stable'}]:[],
    items:withCanon?[{ref:'new-feed-bin',name:'Feed bin',description:'A covered bin for feed.',quantity:1,ownerId:'new-feed-room',isContainer:true},{ref:'new-pellets',name:'Pellet portions',description:'Individual measured portions.',quantity:12,ownerId:'new-feed-bin',isContainer:false}]:[],
    tasks:withCanon?[{ref:'new-feed-task',title:'Offer the evening ration',notes:'An optional future feeding task for Alex.'}]:[],
    lore:[{ref:'new-feeding-custom',title:'Feeding custom',text:'A quiet feeding routine is an optional scene opportunity.',keywords:['feeding'],relatedIds:withCanon?['alex','new-feed-room','new-pellets','sugar']:['alex','sugar']}],
    sceneBrief:{purpose:'Prepare a measured ration and spend a quiet moment at the stable.',tension:'Alex wants to avoid rushing.',stopAt:'The pony is settled.',viewpointId:'alex',locationId:withCanon?'new-feed-room':'stable',castIds:['alex']}
  });
  return {request,result,fingerprint:jobFingerprint(request)};
}
function retained(r:StoryRepository,kind:PreparationSourceKind,id:string,withCanon=true){
  const value=proposed(r.readPreparationSource(kind,id),withCanon);
  r.saveScenePreparation(kind,id,value.request.expectedRevision,value.request.requestId,value.fingerprint,value.result);
  return value;
}
const apply=(revision:number,resultId:string)=>({expectedRevision:revision,requestId:randomUUID(),resultId});

test('preparation previews persist/replay without changing setup or written story state',()=>{
  const r=new StoryRepository(':memory:');try{
    const draft=setup(r),story=publish(r);
    for(const [kind,id,before]of [['setup',draft.id,draft],['story',story.id,story]]as const){
      const saved=retained(r,kind,id);
      assert.deepEqual(kind==='setup'?r.readSetup(id):r.read(id),before);
      assert.deepEqual(r.scenePreparationResult(kind,id,saved.request.requestId,saved.fingerprint),saved.result);
      assert.deepEqual(r.readScenePreparation(kind,id,saved.result.id),saved.result);
      assert.deepEqual(r.listScenePreparations(kind,id),[saved.result]);
      assert.deepEqual(r.saveScenePreparation(kind,id,before.revision,saved.request.requestId,saved.fingerprint,{...saved.result,explanation:'Do not replace the retained proposal.'}),saved.result);
      assert.throws(()=>r.scenePreparationResult(kind,id,saved.request.requestId,'different-inputs'),/different scene preparation inputs/);
    }
  }finally{r.close();}
});

test('reviewed setup additions commit together with stable IDs and preserve existing records, settings and pins',()=>{
  const r=new StoryRepository(':memory:');try{
    const before=setup(r),saved=retained(r,'setup',before.id),input=apply(before.revision,saved.result.id),after=r.applyScenePreparation('setup',before.id,input)as SetupDraft;
    assert.equal(after.revision,before.revision+1);assert.equal(after.storyId,null);
    assert.equal(after.plan!.title,before.plan!.title);assert.equal(after.plan!.chapterTitle,before.plan!.chapterTitle);assert.deepEqual(after.input,before.input);assert.deepEqual(after.plan!.factPins,before.plan!.factPins);
    assert.deepEqual(after.plan!.canon.characters,before.plan!.canon.characters);
    assert.deepEqual(after.plan!.canon.items.slice(0,before.plan!.canon.items.length),before.plan!.canon.items);
    const [bin,portions]=saved.result.additions.items,room=saved.result.additions.places[0];
    assert.equal(after.plan!.canon.items.find(item=>item.id===portions.id)!.ownerId,bin.id);
    assert.equal(after.plan!.canon.items.find(item=>item.id===bin.id)!.ownerId,room.id);
    assert.equal(after.plan!.canon.characters[0].locationId,'stable');
    assert.equal(after.plan!.context.sceneBrief.locationId,room.id);
    assert.equal(after.plan!.canon.threads.at(-1)!.status,'open');assert.deepEqual(after.plan!.context.memories,[]);
    assert.equal(r.readScenePreparation('setup',before.id,saved.result.id).appliedRevision,after.revision);
    assert.deepEqual(r.applyScenePreparation('setup',before.id,input),after);
    assert.throws(()=>r.applyScenePreparation('setup',before.id,{...input,resultId:randomUUID()}),/different scene preparation apply inputs/);
    assert.throws(()=>r.applyScenePreparation('setup',before.id,apply(after.revision,saved.result.id)),/already applied/);
    assert.deepEqual(r.readSetup(before.id),after);
  }finally{r.close();}
});

test('written preparation preserves prose/history/memory/media and invalidates recovery only for canon additions',()=>{
  const r=new StoryRepository(':memory:');try{
    const before=publish(r),saved=retained(r,'story',before.id),input=apply(before.revision,saved.result.id),after=r.applyScenePreparation('story',before.id,input)as Story;
    assert.deepEqual(after.passages,before.passages);assert.deepEqual(after.context.memories,before.context.memories);assert.deepEqual(after.media,before.media);assert.deepEqual(after.preferences,before.preferences);assert.deepEqual(after.factPins,before.factPins);
    assert.equal(after.context.compaction.epoch,before.context.compaction.epoch+1);assert.equal(after.recovery!.valid,false);assert.deepEqual(after.recovery!.canon,before.recovery!.canon);
    assert.deepEqual(after.canon.items.filter(item=>before.canon.items.some(prior=>prior.id===item.id)),before.canon.items);
    assert.equal(after.canon.characters[0].locationId,'stable');assert.equal(after.canon.items.find(item=>item.id==='sugar')!.unlimited,true);
    assert.deepEqual(r.applyScenePreparation('story',before.id,input),after);
    const other=publish(r),loreOnly=retained(r,'story',other.id,false),planned=r.applyScenePreparation('story',other.id,apply(other.revision,loreOnly.result.id))as Story;
    assert.deepEqual(planned.canon,other.canon);assert.deepEqual(planned.recovery,other.recovery);assert.equal(planned.context.compaction.epoch,other.context.compaction.epoch);assert.deepEqual(planned.context.memories,other.context.memories);
  }finally{r.close();}
});

test('stale setup/story previews and stale saves reject atomically without changing retained proposals',()=>{
  const r=new StoryRepository(':memory:');try{
    const draft=setup(r),setupPreview=retained(r,'setup',draft.id),pendingSetup=proposed(r.readPreparationSource('setup',draft.id));
    const changedSetup=r.saveSetup(draft.id,{expectedRevision:draft.revision,requestId:randomUUID(),input:{...draft.input,title:'A changed title'},plan:draft.plan});
    assert.throws(()=>r.applyScenePreparation('setup',draft.id,apply(draft.revision,setupPreview.result.id)),/changed after this preview/);
    assert.throws(()=>r.saveScenePreparation('setup',draft.id,draft.revision,pendingSetup.request.requestId,pendingSetup.fingerprint,pendingSetup.result),/changed during scene preparation/);
    assert.deepEqual(r.readSetup(draft.id),changedSetup);assert.equal(r.readScenePreparation('setup',draft.id,setupPreview.result.id).appliedAt,null);
    const story=publish(r),storyPreview=retained(r,'story',story.id),pendingStory=proposed(r.readPreparationSource('story',story.id)),changedStory=r.mutate(story.id,{expectedRevision:story.revision,requestId:randomUUID(),action:{type:'story-title',title:'Changed story'}});
    assert.throws(()=>r.applyScenePreparation('story',story.id,apply(story.revision,storyPreview.result.id)),/changed after this preview/);
    assert.throws(()=>r.saveScenePreparation('story',story.id,story.revision,pendingStory.request.requestId,pendingStory.fingerprint,pendingStory.result),/changed during scene preparation/);
    assert.deepEqual(r.read(story.id),changedStory);assert.equal(r.readScenePreparation('story',story.id,storyPreview.result.id).appliedAt,null);
  }finally{r.close();}
});

test('invalid source metadata, record links and supply conversions cannot retain a preview or mutate canon',()=>{
  const r=new StoryRepository(':memory:');try{
    const draft=setup(r),value=proposed(r.readPreparationSource('setup',draft.id));
    const invalid:ScenePreparationProposal[]=[{...value.result,storyId:randomUUID()},{...value.result,sourceRevision:99},{...value.result,sourceHash:'0'.repeat(64)},{...value.result,appliedAt:new Date().toISOString()},structuredClone(value.result)];
    invalid.at(-1)!.additions.items[0].ownerId='missing-holder';
    for(const result of invalid){
      assert.throws(()=>r.saveScenePreparation('setup',draft.id,draft.revision,value.request.requestId,value.fingerprint,result));
      assert.deepEqual(r.listScenePreparations('setup',draft.id),[]);assert.deepEqual(r.readSetup(draft.id),draft);
    }
    const converted=structuredClone(value.result);Object.assign(converted.additions.items[1],{unlimited:true,quantity:1});
    assert.throws(()=>r.saveScenePreparation('setup',draft.id,draft.revision,value.request.requestId,value.fingerprint,converted));
    r.saveScenePreparation('setup',draft.id,draft.revision,value.request.requestId,value.fingerprint,value.result);
    assert.deepEqual(r.readSetup(draft.id),draft);
  }finally{r.close();}
});

test('preview and apply request reservations reject reuse by ordinary setup/story edits and preparation operations',()=>{
  const r=new StoryRepository(':memory:');try{
    const draft=setup(r),setupPreview=retained(r,'setup',draft.id);
    assert.throws(()=>r.saveSetup(draft.id,{expectedRevision:draft.revision,requestId:setupPreview.request.requestId,input:draft.input,plan:draft.plan}),/another operation/);
    assert.throws(()=>r.applyScenePreparation('setup',draft.id,{...apply(draft.revision,setupPreview.result.id),requestId:setupPreview.request.requestId}),/another scene preparation operation/);
    const story=publish(r),storyPreview=retained(r,'story',story.id);
    assert.throws(()=>r.mutate(story.id,{expectedRevision:story.revision,requestId:storyPreview.request.requestId,action:{type:'story-title',title:'Rejected reuse'}}),/different edit/);
    const appliedInput=apply(story.revision,storyPreview.result.id),after=r.applyScenePreparation('story',story.id,appliedInput)as Story;
    assert.throws(()=>r.scenePreparationResult('story',story.id,appliedInput.requestId,'fingerprint'),/another scene preparation operation/);
    assert.throws(()=>r.mutate(story.id,{expectedRevision:after.revision,requestId:appliedInput.requestId,action:{type:'story-title',title:'Rejected reuse'}}),/different edit/);
    const ordinaryStory=publish(r),ordinaryRequest=randomUUID(),changed=r.mutate(ordinaryStory.id,{expectedRevision:ordinaryStory.revision,requestId:ordinaryRequest,action:{type:'story-title',title:'An ordinary edit'}}),next=proposed(r.readPreparationSource('story',ordinaryStory.id));
    assert.throws(()=>r.saveScenePreparation('story',ordinaryStory.id,changed.revision,ordinaryRequest,next.fingerprint,next.result),/another story or setup operation/);
    assert.deepEqual(r.read(ordinaryStory.id),changed);assert.deepEqual(r.read(story.id),after);assert.deepEqual(r.readSetup(draft.id),draft);
  }finally{r.close();}
});

test('setup/story target kinds stay distinct after publication and previews cannot cross source IDs',()=>{
  const r=new StoryRepository(':memory:');try{
    const draft=setup(r),setupPreview=retained(r,'setup',draft.id),other=setup(r),story=publish(r,draft);
    assert.equal(story.id,draft.id);
    assert.throws(()=>r.readPreparationSource('setup',draft.id),/already a written story/);
    assert.throws(()=>r.applyScenePreparation('setup',draft.id,apply(draft.revision,setupPreview.result.id)),/already a written story/);
    assert.throws(()=>r.readScenePreparation('story',story.id,setupPreview.result.id),/unavailable/);
    assert.throws(()=>r.readScenePreparation('setup',other.id,setupPreview.result.id),/unavailable/);
    assert.throws(()=>r.scenePreparationResult('story',story.id,setupPreview.request.requestId,setupPreview.fingerprint),/another scene preparation operation/);
    const storyPreview=retained(r,'story',story.id);
    assert.throws(()=>r.readScenePreparation('setup',draft.id,storyPreview.result.id),/unavailable/);
    const after=r.applyScenePreparation('story',story.id,apply(story.revision,storyPreview.result.id))as Story;
    assert.equal(after.revision,story.revision+1);assert.equal(r.readSetup(draft.id).storyId,story.id);
    const empty=r.createSetup({premise:'An unwritten idea.'},randomUUID());assert.throws(()=>r.readPreparationSource('setup',empty.id),/Create or import a setup plan/);
  }finally{r.close();}
});

test('retained previews survive restart, stay outside portable archives, and applied additions roundtrip',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'storyweaver-scene-preparation-')),path=join(directory,'stories.sqlite');let r=new StoryRepository(path);
  try{
    const draft=setup(r),setupPreview=retained(r,'setup',draft.id),story=publish(r),storyPreview=retained(r,'story',story.id);
    assert.equal(strFromU8(unzipSync(r.exportSetup(draft.id))['setup.json']).includes('PRIVATE PREPARATION PREVIEW'),false);
    assert.equal(strFromU8(unzipSync(r.export(story.id))['story.json']).includes('PRIVATE PREPARATION PREVIEW'),false);
    r.close();r=new StoryRepository(path);
    assert.deepEqual(r.readScenePreparation('setup',draft.id,setupPreview.result.id),setupPreview.result);
    assert.deepEqual(r.readScenePreparation('story',story.id,storyPreview.result.id),storyPreview.result);
    const savedSetup=r.applyScenePreparation('setup',draft.id,apply(draft.revision,setupPreview.result.id))as SetupDraft,copy=r.importSetup(r.exportSetup(draft.id));
    assert.deepEqual(copy.plan,savedSetup.plan);assert.deepEqual(r.listScenePreparations('setup',copy.id),[]);
    const savedStory=r.applyScenePreparation('story',story.id,apply(story.revision,storyPreview.result.id))as Story,imported=await r.import(r.export(story.id));
    assert.deepEqual(imported.canon,savedStory.canon);assert.deepEqual(imported.context,savedStory.context);assert.deepEqual(r.listScenePreparations('story',imported.id),[]);
    r.removeFromLibrary('story',story.id,savedStory.revision,randomUUID());
    assert.throws(()=>r.readScenePreparation('story',story.id,storyPreview.result.id),/unavailable/);
    r.removeFromLibrary('setup',draft.id,savedSetup.revision,randomUUID());
    assert.throws(()=>r.readScenePreparation('setup',draft.id,setupPreview.result.id),/unavailable/);
  }finally{r.close();assert.equal(dirname(resolve(directory)),resolve(tmpdir()));rmSync(directory,{recursive:true,force:true});}
});

test('setup preparation hashes ignore ephemeral base timestamps but bind saved authoring fields',()=>{
  const r=new StoryRepository(':memory:');try{
    const draft=setup(r),first=r.readPreparationSource('setup',draft.id),second=r.readPreparationSource('setup',draft.id);
    second.updatedAt='2099-01-01T00:00:00.000Z';assert.equal(scenePreparationSourceHash(first),scenePreparationSourceHash(second));
    second.canon.items.find(item=>item.id==='sugar')!.description='A changed canonical description.';
    assert.notEqual(scenePreparationSourceHash(first),scenePreparationSourceHash(second));
  }finally{r.close();}
});
