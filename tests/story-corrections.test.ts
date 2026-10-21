import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { unzipSync, strFromU8 } from 'fflate';
import { correctionRequestSchema, type CorrectionRequest } from '../src/lib/story-corrections';
import { recordCollections, type RecordKind } from '../src/lib/record-editing';
import { createSample } from '../src/lib/server/fixture';
import { StoryRepository } from '../src/lib/server/repository';
import { connectionSchema } from '../src/lib/server/connections';
import { generateCorrectionResult, prepareCorrectionResult } from '../src/lib/server/story-corrections';
import { applyCorrectionOperations } from '../src/lib/server/record-editing';
import { type Story } from '../src/lib/story';

const settings=()=>connectionSchema.parse({...JSON.parse(readFileSync('config/connections.example.json','utf8')),text:{baseUrl:'http://localhost:9999/v1',model:'test-model',apiKey:'test-correction-key',maxTokens:4096,contextTokens:100000,temperature:0.8,structuredOutput:'prompt'}});
const request=(story:Story,extra:Partial<CorrectionRequest>={}):CorrectionRequest=>({kind:'repair',expectedRevision:story.revision,requestId:randomUUID(),passageId:story.passages.at(-1)!.id,direction:'Mira traded her coveralls to Ren for his tool. Correct their inventory and clothing.',...extra});
const completion=(value:unknown,finish='stop')=>new Response(JSON.stringify({choices:[{message:{content:typeof value==='string'?value:JSON.stringify(value)},finish_reason:finish}]}));
const bare=(story:Story,kind:RecordKind,index=0):Record<string,unknown>=>{const value={...story.canon[recordCollections[kind]][index]} as unknown as Record<string,unknown>;delete value.id;if(kind==='character')for(const key of ['appearance','outfit','noNsfw','pinnedAppearance'])delete value[key];return value;};
const named=(kind:RecordKind)=>kind==='thread'?'title':'name';

test('correction requests reject ambiguous scopes, unsupported name rerolls and blank reports',()=>{
  const story=createSample(),base=request(story);
  assert.equal(correctionRequestSchema.safeParse(base).success,true);
  for(const extra of [{direction:''},{recordKind:'item'},{kind:'record',recordKind:'item'},{kind:'record',recordKind:'item',mode:'create',targetId:'fob'},{kind:'record',recordKind:'relationship',mode:'name',targetId:'crew-trust'},{kind:'repair',prose:'Replace the chapter'}])assert.equal(correctionRequestSchema.safeParse({...base,...extra}).success,false,JSON.stringify(extra));
  assert.equal(correctionRequestSchema.safeParse({...base,kind:'record',recordKind:'item',targetId:'fob'}).success,true);
});

test('a clothing trade proposes both inventories and wardrobe atomically, without changing prose, pictures or the input story',async()=>{
  const story=createSample();story.canon.items.find(item=>item.id==='tool')!.ownerId='ren';
  const before=structuredClone(story),mira=bare(story,'character',1),tool=bare(story,'item',2);
  const wardrobe={...(mira.wardrobe as object),upper_body:'',lower_body:'',accessories:'Utility belt'};
  const draft={explanation:'Record the completed exchange and remove only the traded coveralls from Mira’s current outfit.',world:null,edits:[
    {kind:'character',value:{...mira,id:'mira',wardrobe,outfitNotes:'Utility belt'}},
    {kind:'item',value:{...tool,id:'tool',ownerId:'mira',equipped:false}},
    {kind:'item',value:{id:null,name:'Olive work coveralls',description:'Mira’s coveralls, now received by Ren in the trade.',quantity:1,ownerId:'ren',equipped:false}}
  ]};
  let sent='';const proposal=await generateCorrectionResult(story,request(story),settings(),new AbortController().signal,()=>{},async(_url,init)=>{sent=String(init!.body);return completion(draft);});
  assert.deepEqual(story,before);assert.equal(proposal.operations.length,3);assert.equal(proposal.appliedAt,null);
  const addition=proposal.operations.find(op=>op.type==='record'&&op.create)!;assert.equal(addition.type,'record');if(addition.type==='record')assert.match(addition.edit.value.id!,/^[a-f0-9-]{36}$/);
  assert.ok(proposal.changes.some(change=>change.field==='ownerId'&&change.before==='Ren Calder'&&change.after==='Mira Sol'));
  assert.ok(proposal.changes.some(change=>change.field==='equipped'&&change.before==='Yes'&&change.after==='No'));
  const staged=applyCorrectionOperations(story,proposal.operations);assert.equal(staged.canon.items.find(item=>item.id==='tool')!.ownerId,'mira');assert.equal(staged.canon.items.at(-1)!.ownerId,'ren');assert.deepEqual(staged.passages,before.passages);assert.deepEqual(staged.media,before.media);
  assert.ok(sent.includes('a traded garment may need a NEW item'));assert.ok(sent.includes('Only characters may equip items'));assert.ok(sent.includes('currentCanon'));assert.ok(sent.includes('selectedChapter'));
});

test('in-story record revision, full design and app-assigned additions stay within one selected record',async()=>{
  const story=createSample(),before=structuredClone(story),c=settings();c.text.contextTokens=16384;
  for(const kind of ['character','place','item','relationship','thread'] as const){
    const index=kind==='character'?1:0,target=story.canon[recordCollections[kind]][index],value=bare(story,kind,index);
    if(kind==='character')value.notes='An engineer who keeps a careful log.';else if(kind==='place'||kind==='item')value.description='More precise current details.';else value.notes='More precise current details.';
    for(const mode of ['revise','full'] as const){const result=await generateCorrectionResult(story,request(story,{kind:'record',recordKind:kind,mode,targetId:target.id}),c,new AbortController().signal,()=>{},async()=>completion({explanation:'Update the selected details.',value}));assert.equal(result.operations.length,1);const op=result.operations[0];assert.equal(op.type,'record');if(op.type==='record'){assert.equal(op.edit.kind,kind);assert.equal(op.edit.value.id,target.id);assert.equal(op.create,false);}}
    const result=await generateCorrectionResult(story,request(story,{kind:'record',recordKind:kind,mode:'create',targetId:undefined}),c,new AbortController().signal,()=>{},async()=>completion({explanation:'Add the requested missing record.',value}));
    const op=result.operations[0];assert.equal(op.type,'record');if(op.type==='record'){assert.equal(op.create,true);assert.notEqual(op.edit.value.id,target.id);if(op.edit.kind==='character'){assert.equal(op.edit.value.noNsfw,true);assert.equal(op.edit.value.pinnedAppearance,false);}}
  }
  assert.deepEqual(story,before);
});

test('in-story name rerolls change only a name and reject reused names',async()=>{
  const story=createSample();
  for(const kind of ['character','place','item','thread'] as const){
    const current=story.canon[recordCollections[kind]][0],key=named(kind),input=request(story,{kind:'record',recordKind:kind,mode:'name',targetId:current.id});
    const result=await generateCorrectionResult(story,input,settings(),new AbortController().signal,()=>{},async()=>completion({explanation:'A fitting alternative name.',[key]:'New distinct name'}));
    assert.equal(result.changes.length,1);assert.equal(result.changes[0].field,key);
    await assert.rejects(()=>generateCorrectionResult(story,input,settings(),new AbortController().signal,()=>{},async()=>completion({explanation:'Same name.',[key]:(current as any)[key]})),/same name|already in use/i);
    await assert.rejects(()=>generateCorrectionResult(story,input,settings(),new AbortController().signal,()=>{},async()=>completion({explanation:'Extra field.',[key]:'New name',quantity:9})),/invalid|unrecognized/i);
  }
});

test('corrections reject out-of-scope targets, malformed graphs, pin changes and incomplete character profiles',()=>{
  const story=createSample(),before=structuredClone(story),item={...bare(story,'item'),id:'cargo'};
  const badEdits=[
    {kind:'item',value:{...item,ownerId:'missing-person'}},{kind:'item',value:{...item,ownerId:'hold',equipped:true}},
    {kind:'item',value:{...item,id:'model-invented-id'}},{kind:'item',value:{...item,quantity:0}},
    {kind:'place',value:{...bare(story,'place'),id:'halcyon',parentId:'bridge'}},
    {kind:'relationship',value:{...bare(story,'relationship'),id:'crew-trust',toId:'elias'}},
    {kind:'character',value:{...bare(story,'character'),id:'elias',wardrobe:{upper_body:'New coat',lower_body:'',footwear:'',accessories:''}}},
    {kind:'character',value:{...bare(story,'character',1),id:'mira',visual:{}}},
    {kind:'character',value:{...bare(story,'character',1),id:'mira',noNsfw:false}}
  ];
  for(const edit of badEdits)assert.throws(()=>prepareCorrectionResult(story,request(story),{explanation:'Proposed correction.',world:null,edits:[edit]}));
  const valid={kind:'item',value:{...item,description:'New cargo label'}};
  assert.throws(()=>prepareCorrectionResult(story,request(story,{kind:'record',recordKind:'item',targetId:'fob'}),{explanation:'Wrong target.',world:null,edits:[valid]}),/outside/i);
  assert.throws(()=>prepareCorrectionResult(story,request(story),{explanation:'Duplicate edits.',world:null,edits:[valid,valid]}),/duplicate/i);
  assert.throws(()=>prepareCorrectionResult(story,request(story),{explanation:'Nothing to change.',world:null,edits:[]}),/no record changes/i);
  assert.deepEqual(story,before);
});

test('correction proposals persist independently, apply once, invalidate recovery and refuse stale sources',async()=>{
  const repository=new StoryRepository(':memory:');try{
    const story=repository.create(),input=request(story),before=structuredClone(story),draft={explanation:'The fob was passed to Ren.',world:{funds:story.canon.funds,cargoNotes:'Corrected cargo notes.'},edits:[{kind:'item',value:{...bare(story,'item',1),id:'fob',ownerId:'ren'}}]};
    const proposal=prepareCorrectionResult(story,input,draft),saved=repository.saveCorrectionResult(story.id,story.revision,input.requestId,'fingerprint',proposal);
    assert.deepEqual(repository.read(story.id),before);assert.deepEqual(repository.correctionResult(story.id,input.requestId,'fingerprint'),saved);assert.throws(()=>repository.correctionResult(story.id,input.requestId,'different'),/different correction/i);
    const apply={expectedRevision:story.revision,requestId:randomUUID(),resultId:proposal.id},result=repository.applyCorrection(story.id,apply);
    assert.equal(result.revision,story.revision+1);assert.equal(result.canon.items.find(item=>item.id==='fob')!.ownerId,'ren');assert.equal(result.context.compaction.epoch,story.context.compaction.epoch+1);assert.equal(result.recovery!.valid,false);assert.deepEqual(result.passages,before.passages);assert.deepEqual(result.media,before.media);
    assert.deepEqual(repository.applyCorrection(story.id,apply),result);assert.equal(repository.readCorrectionResult(story.id,proposal.id).appliedRevision,result.revision);
    const freshInput=request(result),pending=prepareCorrectionResult(result,freshInput,{...draft,world:null,edits:[{kind:'item',value:{...bare(result,'item',1),id:'fob',description:'A revised description'}}]});repository.saveCorrectionResult(story.id,result.revision,freshInput.requestId,'pending',pending);
    repository.mutate(story.id,{expectedRevision:result.revision,requestId:randomUUID(),action:{type:'world',funds:1,cargoNotes:'Later live edit'}});
    assert.throws(()=>repository.applyCorrection(story.id,{expectedRevision:result.revision,requestId:randomUUID(),resultId:pending.id}),/changed after/i);
  }finally{repository.close();}
});

test('provider failure, cancellation, unsafe payloads and small budgets leave saved canon untouched',async()=>{
  const story=createSample(),before=structuredClone(story),input=request(story),valid={explanation:'Correct a description.',world:null,edits:[{kind:'item',value:{...bare(story,'item',1),id:'fob',description:'A new engraving.'}}]};
  const bad:typeof fetch[]=[async()=>completion('{broken'),async()=>completion(valid,'length'),async()=>completion({...valid,paragraphs:['Rewritten prose']}),async()=>new Response('{}',{status:401}),async()=>new Response(JSON.stringify({choices:[{message:{refusal:'Declined'},finish_reason:'stop'}]}))];
  for(const fetcher of bad)await assert.rejects(()=>generateCorrectionResult(story,input,settings(),new AbortController().signal,()=>{},fetcher));
  const abort=new AbortController();abort.abort();let calls=0;await assert.rejects(()=>generateCorrectionResult(story,input,settings(),abort.signal,()=>{},async()=>{calls++;return completion(valid);}),/cancel|abort/i);assert.equal(calls,0);
  const late=new AbortController();await assert.rejects(()=>generateCorrectionResult(story,input,settings(),late.signal,()=>{},async()=>{late.abort();return completion(valid);}),/cancel|abort/i);
  const tiny=settings();tiny.text.contextTokens=1024;await assert.rejects(()=>generateCorrectionResult(story,input,tiny,new AbortController().signal,()=>{},async()=>{calls++;return completion(valid);}),/context budget/i);assert.equal(calls,0);
  await assert.rejects(()=>generateCorrectionResult(story,{...input,expectedRevision:9},settings(),new AbortController().signal,()=>{},async()=>{calls++;return completion(valid);}),/story changed/i);assert.equal(calls,0);
  assert.deepEqual(story,before);
});

test('a repair fits the default context budget and retains strict per-record validation after compact transport',async()=>{
  const story=createSample(),c=settings();c.text.contextTokens=16384;let calls=0;
  const draft={explanation:'Correct the fob description.',world:null,edits:[{kind:'item',value:{...bare(story,'item',1),id:'fob',description:'A new engraving.'}}]};
  const result=await generateCorrectionResult(story,request(story,{direction:'Correct the access fob description.'}),c,new AbortController().signal,()=>{},async()=>{calls++;return completion(draft);});assert.equal(calls,1);assert.equal(result.changes.length,1);
  await assert.rejects(()=>generateCorrectionResult(story,request(story,{direction:'Correct the access fob description.'}),c,new AbortController().signal,()=>{},async()=>completion({...draft,edits:[{kind:'item',value:{id:'fob',description:'Missing quantity and owner'}}]})),/invalid|required|expected/i);
});

test('long chapter context omits only optional whole passages and reports coverage, keeping selected and latest prose intact',async()=>{
  const story=createSample(),c=settings();c.text.contextTokens=16384;
  story.passages[1].paragraphs=['An optional middle passage. '.repeat(1500)];
  const input=request(story,{passageId:story.passages[0].id,direction:'Correct the access fob description.'}),draft={explanation:'Correct the fob description.',world:null,edits:[{kind:'item',value:{...bare(story,'item',1),id:'fob',description:'A new engraving.'}}]};let sent:any;
  const result=await generateCorrectionResult(story,input,c,new AbortController().signal,()=>{},async(_url,init)=>{sent=JSON.parse(JSON.parse(String(init!.body)).messages[1].content);return completion(draft);});
  assert.deepEqual(sent.selectedChapter.map((source:any)=>source.id),[story.passages[0].id,story.passages[2].id]);assert.deepEqual(sent.selectedChapter[0].paragraphs,story.passages[0].paragraphs);assert.deepEqual(sent.selectedChapter[1].paragraphs,story.passages[2].paragraphs);
  assert.equal(result.coverage!.totalChapterPassages,3);assert.deepEqual(result.coverage!.includedPassageIds,[story.passages[0].id,story.passages[2].id]);assert.match(result.coverage!.warnings[0],/2 of 3 whole passages/);assert.ok(sent.currentCanon.items.some((item:any)=>item.id==='fob'));assert.equal(sent.directory.items.length,story.canon.items.length);
});

test('stored previews survive restart, remain scoped to their story, and stay outside exported story archives',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'storyweaver-correction-test-')),path=join(directory,'stories.sqlite');let repository=new StoryRepository(path);
  try{
    const story=repository.create(),other=repository.create(),input=request(story),proposal=prepareCorrectionResult(story,input,{explanation:'PRIVATE PREVIEW EXPLANATION',world:null,edits:[{kind:'item',value:{...bare(story,'item',1),id:'fob',ownerId:'ren'}}]});
    repository.saveCorrectionResult(story.id,story.revision,input.requestId,'restart',proposal);repository.close();repository=new StoryRepository(path);
    assert.deepEqual(repository.correctionResult(story.id,input.requestId,'restart'),proposal);assert.equal(repository.listCorrectionResults(story.id).length,1);
    assert.throws(()=>repository.applyCorrection(other.id,{expectedRevision:other.revision,requestId:randomUUID(),resultId:proposal.id}),/unavailable/i);assert.equal(repository.read(other.id).canon.items.find(item=>item.id==='fob')!.ownerId,'elias');
    const files=unzipSync(repository.export(story.id));assert.deepEqual(Object.keys(files).sort(),['manifest.json','story.json']);const exported=strFromU8(files['story.json']);assert.equal(exported.includes('PRIVATE PREVIEW EXPLANATION'),false);assert.equal(JSON.parse(exported).canon.items.find((item:any)=>item.id==='fob').ownerId,'elias');
    const applied=repository.applyCorrection(story.id,{expectedRevision:story.revision,requestId:randomUUID(),resultId:proposal.id});const imported=await repository.import(repository.export(story.id));assert.deepEqual(imported.canon,applied.canon);assert.equal(repository.listCorrectionResults(imported.id).length,0);
  }finally{repository.close();assert.ok(resolve(directory).startsWith(resolve(join(tmpdir(),'storyweaver-correction-test-'))));rmSync(directory,{recursive:true,force:true});}
});
