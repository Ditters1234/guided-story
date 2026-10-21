import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { zipSync, unzipSync, strFromU8, strToU8 } from 'fflate';
import sharp from 'sharp';
import { StoryRepository } from '../src/lib/server/repository';
import { runPassageWorkflow, retryPassageWorkflow, acceptPassageWorkflow } from '../src/lib/server/story-workflow/passage';
import { workflowFixture, workflowSetupFixture, generationInput, workflowSettings, scriptedProvider, scene, memory } from './workflow-fixture';
import { defaultStoryWorkflow } from '../src/lib/story-workflow/default-graph';
import { exportPreset } from '../src/lib/story-workflow/presets';
import { continuationPresetFromCheckpoint } from '../src/lib/passage-checkpoints';

const signal=()=>new AbortController().signal;
const forkInput=(r:StoryRepository,id:string,passageId:string)=>({requestId:randomUUID(),expectedRevision:r.read(id).revision,checkpoint:r.passageCheckpoints.info(r.read(id),passageId)!.checkpoint,title:'A different morning'});
const generate=(r:StoryRepository,s:ReturnType<StoryRepository['read']>,options={})=>runPassageWorkflow(r,'continue',s.id,generationInput(s.revision),workflowSettings(),signal(),{fetcher:scriptedProvider(options).fetcher});

test('fork restores historical canon, prose, context and constraints, without later events or provider calls',async()=>{
  const {repository:r,story}=workflowFixture();try{
    const first=story.passages[0],original=r.passageCheckpoints.info(story,first.id)!;
    let later=r.mutate(story.id,{expectedRevision:story.revision,requestId:randomUUID(),action:{type:'world',funds:999,cargoNotes:'Future secret'}});
    later=await generate(r,later);
    later=r.mutate(later.id,{expectedRevision:later.revision,requestId:randomUUID(),action:{type:'preferences',title:later.title,premise:'Later premise',narrationStyle:'Later style',artStyle:'Later art',adultContent:true,preferences:{...later.preferences,contentNotes:'Later preferences'}}});
    const before=r.read(story.id),fork=r.forkPassage(story.id,first.id,{...forkInput(r,story.id,first.id),checkpoint:original.checkpoint});
    assert.notEqual(fork.id,story.id);assert.equal(fork.revision,0);assert.deepEqual(fork.passages,story.passages);assert.deepEqual(fork.canon,story.canon);assert.deepEqual(fork.context,story.context);assert.deepEqual(fork.factPins,story.factPins);assert.deepEqual(fork.preferences,story.preferences);assert.equal(fork.premise,story.premise);assert.deepEqual(fork.recovery,story.recovery);
    assert.equal(fork.branchOrigin!.checkpoint,original.checkpoint);assert.equal(r.listRetained('story',fork.id).length,0);assert.deepEqual(r.read(story.id),before);
    const continued=await generate(r,fork);assert.equal(continued.passages.length,2);assert.deepEqual(r.read(story.id),before);
  }finally{r.close();}
});

test('fork requests are atomic and idempotent, reject stale/cross-passage inputs and never reuse deleted results',()=>{
  const {repository:r,story}=workflowFixture();try{
    const id=story.passages[0].id,input=forkInput(r,story.id,id),before=r.list().length;
    assert.throws(()=>r.forkPassage(story.id,id,{...input,expectedRevision:999}),/changed/);assert.equal(r.list().length,before);
    assert.throws(()=>r.forkPassage(story.id,id,{...input,checkpoint:'0'.repeat(64)}),/checkpoint changed/);
    const fork=r.forkPassage(story.id,id,input);assert.deepEqual(r.forkPassage(story.id,id,input),fork);assert.equal(r.list().length,before+1);
    assert.throws(()=>r.forkPassage(story.id,id,{...input,title:'Other'}),/different inputs/);
    r.removeFromLibrary('story',fork.id,fork.revision,randomUUID());assert.throws(()=>r.forkPassage(story.id,id,input),/not be found/);assert.equal(r.list().length,before);
  }finally{r.close();}
});

test('new stories on old fixtures capture only newly accepted passage state; missing history stays unavailable',async()=>{
  const r=new StoryRepository(':memory:');try{const sample=r.create();assert.equal(r.passageCheckpoints.info(sample,sample.passages[0].id),null);assert.throws(()=>r.forkPassage(sample.id,sample.passages[0].id,{requestId:randomUUID(),expectedRevision:0,checkpoint:'0'.repeat(64),title:'No invented state'}),/No saved world/);}finally{r.close();}
});

test('checkpoint workflow pins immutable preset graph, safe model settings and survives diagnostic cleanup',async()=>{
  const {repository:r,story}=workflowFixture();try{
    const graph=defaultStoryWorkflow('continue');graph.bindings[0]={name:'current-source',kind:'source',sourceKind:'story',sourceId:story.id};
    const preset=r.workflowPresets.save(null,{requestId:randomUUID(),expectedRevision:0,content:{name:'Scene workflow',description:'',definition:graph}}),input={...generationInput(story.revision),preset:{id:preset.id,revision:preset.revision}},c=workflowSettings(),provider=scriptedProvider();
    const saved=await runPassageWorkflow(r,'continue',story.id,input,c,signal(),{fetcher:provider.fetcher}),pid=saved.passages.at(-1)!.id,info=r.passageCheckpoints.info(saved,pid)!;
    assert.deepEqual(info.workflow!.acceptance.definition,preset.content.definition);assert.equal(info.workflow!.acceptance.model!.contextTokens,32000);assert.deepEqual(provider.stages,['narrate','extract']);
    r.workflowPresets.save(preset.id,{requestId:randomUUID(),expectedRevision:1,content:{...preset.content,name:'Changed later'}});
    const run=r.workflows.find(story.id,input.requestId)!;r.workflows.removeDetails(run.id,r.workflows.inspectionVersion(run.id));assert.deepEqual(r.passageCheckpoints.info(saved,pid),info);
    const bytes=r.export(story.id),files=unzipSync(bytes),text=strFromU8(files['passage-checkpoints.json']);assert.ok(!text.includes(c.text.apiKey!));assert.ok(!text.includes(c.text.baseUrl));assert.ok(!text.includes('messages'));
    const portable=exportPreset({name:'Recorded',description:'',definition:info.workflow!.acceptance.definition});assert.equal(portable.content.definition.bindings.some(b=>b.kind==='source'&&b.sourceId),false);
    const imported=await r.import(bytes);assert.deepEqual(r.passageCheckpoints.info(imported,pid)!.workflow,info.workflow);assert.equal(r.forkPassage(imported.id,pid,forkInput(r,imported.id,pid)).passages.length,2);
  }finally{r.close();}
});

test('historical title edits keep original checkpoint prose; replacement captures its own new state',async()=>{
  const {repository:r,story}=workflowFixture();try{
    const first=story.passages[0],second=await generate(r,story);
    let renamed=r.mutate(story.id,{expectedRevision:second.revision,requestId:randomUUID(),action:{type:'rename',passageId:first.id,title:'Later retitle',chapterTitle:'Later chapter title'}});
    assert.equal(r.passageCheckpoints.info(renamed,first.id)!.differsFromCurrent,true);
    const fork=r.forkPassage(story.id,first.id,forkInput(r,story.id,first.id));assert.deepEqual(fork.passages,story.passages);
    // A direct validated replacement isolates history behavior from narration.
    const replaced=r.commitGeneratedPassage(story.id,{expectedRevision:renamed.revision,requestId:randomUUID(),proposal:{mode:'replace',passageId:renamed.passages.at(-1)!.id,direction:'Alternate quiet scene',draft:{...scene(),chapterTitle:'Later chapter title',startsChapter:false,title:'Alternate'},effects:[],memory}});
    const checkpoint=r.passageCheckpoints.info(replaced,replaced.passages.at(-1)!.id)!;assert.equal(checkpoint.title,'Alternate');assert.equal(checkpoint.differsFromCurrent,false);assert.equal(r.forkPassage(story.id,replaced.passages.at(-1)!.id,forkInput(r,story.id,replaced.passages.at(-1)!.id)).passages.at(-1)!.title,'Alternate');
  }finally{r.close();}
});

test('effects-only recovery records original narration and checked acceptance independently',async()=>{
  const {repository:r,setup}=workflowSetupFixture();try{
    const original=generationInput(setup.revision);
    await assert.rejects(runPassageWorkflow(r,'opening',setup.id,original,workflowSettings(),signal(),{fetcher:scriptedProvider({malformed:true}).fetcher}),/retained/);
    assert.equal(r.list().length,0);
    const draft=r.listRetained('setup',setup.id)[0],action={requestId:randomUUID(),expectedRevision:setup.revision,expectedVersion:draft.version,notes:''};
    const provider=scriptedProvider(),checked=await retryPassageWorkflow(r,'setup',setup.id,draft.id,action,workflowSettings(),signal(),{fetcher:provider.fetcher});assert.deepEqual(provider.stages,['extract']);
    const run=r.workflows.find(setup.id,action.requestId)!,input={requestId:randomUUID(),expectedRevision:setup.revision,expectedVersion:checked.version,notes:''};
    const saved=await acceptPassageWorkflow(r,'setup',setup.id,run.id,draft.id,input,signal()),info=r.passageCheckpoints.info(saved,saved.passages[0].id)!;
    assert.equal(info.workflow!.generation!.runId,r.workflows.find(setup.id,original.requestId)!.id);assert.equal(info.workflow!.acceptance.runId,run.id);
    assert.deepEqual(await acceptPassageWorkflow(r,'setup',setup.id,run.id,draft.id,input,signal()),saved);
  }finally{r.close();}
});

test('checkpoint save failure rolls back canonical save and can retry without partial metadata',()=>{
  const {repository:r,story}=workflowFixture();try{
    const store=r.passageCheckpoints,capture=store.capture.bind(store),before=store.archive(story.id),input={expectedRevision:story.revision,requestId:randomUUID(),proposal:{mode:'continue' as const,direction:'',draft:{...scene(),startsChapter:false},effects:[],memory}};
    store.capture=(...args)=>{capture(...args);throw Error('Injected checkpoint failure');};
    assert.throws(()=>r.commitGeneratedPassage(story.id,input),/Injected/);assert.deepEqual(r.read(story.id),story);assert.deepEqual(store.archive(story.id),before);
    store.capture=capture;const saved=r.commitGeneratedPassage(story.id,input);assert.equal(saved.passages.length,2);assert.ok(store.info(saved,saved.passages.at(-1)!.id));
  }finally{r.close();}
});

test('fork checkpoint-copy failure rolls back the new library entry and receipt together',()=>{
  const {repository:r,story}=workflowFixture();try{
    const pid=story.passages[0].id,input=forkInput(r,story.id,pid),store=r.passageCheckpoints,load=store.load.bind(store),before=r.list();
    store.load=(...args)=>{load(...args);throw Error('Injected fork copy failure');};
    assert.throws(()=>r.forkPassage(story.id,pid,input),/Injected/);assert.deepEqual(r.list(),before);assert.deepEqual(r.read(story.id),story);
    store.load=load;const fork=r.forkPassage(story.id,pid,input);assert.deepEqual(r.forkPassage(story.id,pid,input),fork);assert.ok(store.info(fork,pid));
  }finally{r.close();}
});

test('recorded opening workflow adapts to a fork only as an explicit saved continuation preset',async()=>{
  const {repository:r,setup}=workflowSetupFixture();try{
    const first=await runPassageWorkflow(r,'opening',setup.id,generationInput(setup.revision),workflowSettings(),signal(),{fetcher:scriptedProvider().fetcher}),pid=first.passages[0].id;
    const fork=r.forkPassage(first.id,pid,forkInput(r,first.id,pid)),info=r.passageCheckpoints.info(fork,pid)!,original=structuredClone(info.workflow);
    const content=continuationPresetFromCheckpoint(info,fork.id);assert.equal(content.definition.mode,'continue');assert.ok(content.definition.bindings.some(b=>b.kind==='source'&&b.sourceId===fork.id&&b.sourceKind==='story'));assert.deepEqual(info.workflow,original);
    const preset=r.workflowPresets.save(null,{expectedRevision:0,requestId:randomUUID(),content}),provider=scriptedProvider();
    const saved=await runPassageWorkflow(r,'continue',fork.id,{...generationInput(0),preset:{id:preset.id,revision:1}},workflowSettings(),signal(),{fetcher:provider.fetcher});assert.equal(saved.passages.length,2);assert.deepEqual(provider.stages,['narrate','extract']);assert.equal(r.read(first.id).passages.length,1);
  }finally{r.close();}
});

test('checkpoint history and forks survive restart and original source deletion',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'passage-checkpoint-test-')),path=join(folder,'library.sqlite');let r:StoryRepository|undefined;
  try{const fixture=workflowFixture(path);r=fixture.repository;const saved=await generate(r,fixture.story),pid=saved.passages[0].id,input=forkInput(r,saved.id,pid),fork=r.forkPassage(saved.id,pid,input);r.close();r=new StoryRepository(path);
    assert.equal(r.passageCheckpoints.info(r.read(fork.id),pid)!.checkpoint,input.checkpoint);r.removeFromLibrary('story',saved.id,saved.revision,randomUUID());assert.equal(Object.keys(r.passageCheckpoints.archive(saved.id).objects).length,0);assert.equal(r.forkPassage(fork.id,pid,forkInput(r,fork.id,pid)).passages.length,1);
  }finally{r?.close();assert.equal(resolve(folder).startsWith(resolve(tmpdir())+'\\'),true);rmSync(folder,{recursive:true});}
});

test('archives reject corrupt, unreferenced, dangling and credential-bearing checkpoint objects before inserting a story',async()=>{
  const {repository:r,story}=workflowFixture();try{
    const saved=await generate(r,story),files=unzipSync(r.export(story.id)),original=JSON.parse(strFromU8(files['passage-checkpoints.json'])),before=r.list().length;
    for(const mutate of [
      (a:any)=>{a.objects[Object.keys(a.objects)[0]]='tampered';},
      (a:any)=>{a.objects[createHash('sha256').update(JSON.stringify('orphan')).digest('hex')]='orphan';},
      (a:any)=>{a.heads[saved.passages[0].id]='0'.repeat(64);},
      (a:any)=>{const entry=Object.entries(a.objects).find(([,v]:any)=>v?.acceptance);const [key,value]=entry! as [string,any];value.acceptance.model.apiKey='synthetic forbidden credential';const next=createHash('sha256').update(JSON.stringify(value)).digest('hex');delete a.objects[key];a.objects[next]=value;for(const [k,node] of Object.entries(a.objects) as [string,any][])if(node?.workflow===key){node.workflow=next;const changed=createHash('sha256').update(JSON.stringify(node)).digest('hex');delete a.objects[k];a.objects[changed]=node;for(const pid of Object.keys(a.heads))if(a.heads[pid]===k)a.heads[pid]=changed;} }
    ]){const archive=structuredClone(original);mutate(archive);await assert.rejects(r.import(zipSync({...files,'passage-checkpoints.json':strToU8(JSON.stringify(archive))})));assert.equal(r.list().length,before);}
  }finally{r.close();}
});

test('historical image metadata and original bytes travel even after removal from the current gallery',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'passage-checkpoint-media-')),path=join(folder,'library.sqlite');const {repository:r,story}=workflowFixture(path);
  try{const bytes=await sharp({create:{width:64,height:64,channels:3,background:'#336699'}}).png().toBuffer();
    let saved=await r.addMedia(story.id,bytes,{expectedRevision:story.revision,requestId:randomUUID(),caption:'Earlier image',category:'scene',subjectIds:['alex'],passageId:story.passages[0].id,parentId:null,status:'canonical'});
    saved=await generate(r,saved);const pid=saved.passages.at(-1)!.id,asset=saved.media.assets[0];saved=r.mutate(saved.id,{expectedRevision:saved.revision,requestId:randomUUID(),action:{type:'media-remove',assetId:asset.id}});
    const imported=await r.import(r.export(saved.id));assert.equal(imported.media.assets.length,0);const fork=r.forkPassage(imported.id,pid,forkInput(r,imported.id,pid));assert.equal(fork.media.assets[0].id,asset.id);assert.deepEqual(r.mediaStore.original(fork.media.assets[0]),bytes);
  }finally{r.close();assert.equal(resolve(folder).startsWith(resolve(tmpdir())+'\\'),true);rmSync(folder,{recursive:true});}
});

test('shared workflow and history objects are deduplicated and checkpoint payloads stay outside the ordinary story',async()=>{
  const {repository:r,story}=workflowFixture();try{const first=await generate(r,story),a=r.passageCheckpoints.archive(story.id),second=await generate(r,first),b=r.passageCheckpoints.archive(story.id);
    assert.ok(Object.keys(b.objects).length-Object.keys(a.objects).length<12);assert.equal('checkpoints'in second,false);assert.equal('workflow'in second.passages.at(-1)!,false);
    assert.equal(Object.values(b.objects).filter((value:any)=>value?.id==='default-story-continue'&&value?.nodes).length,1,'Identical workflow definitions are stored once across passages and checks');
    const head=b.objects[b.heads[second.passages.at(-1)!.id]] as any;assert.equal(head.previous,b.heads[first.passages.at(-1)!.id]);
  }finally{r.close();}
});

test('shared historical image bytes cannot hide inconsistent metadata in a different checkpoint',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'passage-checkpoint-image-claims-')),path=join(folder,'library.sqlite');const {repository:r,story}=workflowFixture(path);
  const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
  function replaceObject(archive:any,key:string,value:any){
    const next=digest(value);delete archive.objects[key];archive.objects[next]=value;
    const replace=(value:any):any=>value===key?next:Array.isArray(value)?value.map(replace):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([name,v])=>[name,replace(v)])):value;
    for(const [parent,object] of Object.entries(archive.objects))if(parent!==next){const changed=replace(object);if(JSON.stringify(changed)!==JSON.stringify(object))replaceObject(archive,parent,changed);}
    for(const id of Object.keys(archive.heads))if(archive.heads[id]===key)archive.heads[id]=next;
  }
  try{const bytes=await sharp({create:{width:64,height:64,channels:3,background:'#336699'}}).png().toBuffer();
    let saved=await r.addMedia(story.id,bytes,{expectedRevision:story.revision,requestId:randomUUID(),caption:'Earlier caption',category:'scene',subjectIds:['alex'],passageId:story.passages[0].id,parentId:null,status:'canonical'});saved=await generate(r,saved);
    saved=r.mutate(saved.id,{expectedRevision:saved.revision,requestId:randomUUID(),action:{type:'media-edit',assetId:saved.media.assets[0].id,edit:{caption:'Later caption',category:'scene',subjectIds:['alex'],status:'canonical'}}});saved=await generate(r,saved);
    const files=unzipSync(r.export(saved.id)),archive=JSON.parse(strFromU8(files['passage-checkpoints.json'])),head=archive.objects[archive.heads[saved.passages.at(-1)!.id]],key=head.state.media,value=structuredClone(archive.objects[key]);value.assets[0].width=65;replaceObject(archive,key,value);
    const before=r.list().length;await assert.rejects(r.import(zipSync({...files,'passage-checkpoints.json':strToU8(JSON.stringify(archive))})),/image metadata/);assert.equal(r.list().length,before);
  }finally{r.close();assert.equal(resolve(folder).startsWith(resolve(tmpdir())+'\\'),true);rmSync(folder,{recursive:true});}
});
