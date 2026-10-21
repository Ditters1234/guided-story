import { estimateInputTokens } from '../src/lib/server/token-budget';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { StoryRepository } from '../src/lib/server/repository';
import { generateEditorResult } from '../src/lib/server/story-editor';
import { validateWording } from '../src/lib/server/editor-state';
import { connectionSchema } from '../src/lib/server/connections';
import { createSample } from '../src/lib/server/fixture';
import { memoryCurrent, memorySourceHash, chapterMemoryCurrent, bookMemoryCurrent } from '../src/lib/server/context-state';
import { recapSourceHash } from '../src/lib/server/recap-state';
import { compactMemory } from '../src/lib/server/memory-compaction';
import { longStory } from './memory-fixture';
import { editorRequestSchema, type EditorRequest, type PolishResult } from '../src/lib/editor';
import { jobFingerprint } from '../src/lib/server/jobs';
import { generatePassage, previewContinuationContext } from '../src/lib/server/story-generation';
const settings=()=>connectionSchema.parse({...JSON.parse(readFileSync('config/connections.example.json','utf8')),text:{baseUrl:'http://localhost:9999/v1',model:'qa',maxTokens:4096,contextTokens:16384,temperature:0.8,structuredOutput:'prompt'}});
const signal=()=>new AbortController().signal;
const completion=(result:unknown)=>new Response(JSON.stringify({choices:[{message:{content:typeof result==='string'?result:JSON.stringify(result)},finish_reason:'stop'}]}));
const request=(story:ReturnType<typeof createSample>,kind:'ask'|'polish',text='',passageId=story.passages[0].id):EditorRequest=>({kind,text,expectedRevision:story.revision,requestId:randomUUID(),passageId});
function polishProvider(paragraphs:string[], review={equivalent:true,issues:[] as string[]}, calls:string[]=[]):typeof fetch {
  return async(_,init)=>{const body=JSON.parse(String(init!.body));calls.push(body.messages[0].content);return completion(body.messages[0].content.startsWith('Review a proposed')?review:{paragraphs});};
}
const archive=(story:ReturnType<typeof createSample>)=>zipSync({'manifest.json':strToU8(JSON.stringify({format:'guided-story-dev-1',media:[]})),'story.json':strToU8(JSON.stringify(story))});
test('story questions use current records and retrieved written sources, exclude hidden plans and never mutate the story',async()=>{
  const r=new StoryRepository(':memory:');
  try{
    const fixture=longStory(8,1);fixture.context.sceneBrief.purpose='PLANNING SECRET: blow up the ship next.';
    const story=await r.import(archive(fixture)),before=JSON.stringify(story),input=request(story,'ask','Who received the fob beside the cobalt ledger?','p-8-2');let sent='';
    const result=await generateEditorResult(story,input,settings(),signal(),()=>{},async(_,init)=>{sent=String(init!.body);return completion({answer:'Mira received the access fob. The ledger’s purpose is unresolved.',uncertain:false,sources:[{passageId:'p-1-1',quote:'Elias handed the access fob to Mira beside the cobalt ledger.'}]});});
    assert.equal(result.kind,'ask');assert.ok(sent.includes('Story question contract'));assert.ok(!sent.includes('Write the next passage'));
    for(const hidden of ['PLANNING SECRET','HIDDEN REVEAL','SECRET KNOWLEDGE','UNWRITTEN FUTURE'])assert.ok(!sent.includes(hidden));
    r.saveEditorResult(story.id,story.revision,input.requestId,jobFingerprint(input),result);
    assert.equal(JSON.stringify(r.read(story.id)),before);assert.equal(r.listEditorResults(story.id).length,1);
    assert.deepEqual(r.editorResult(story.id,input.requestId,jobFingerprint(input)),result);assert.throws(()=>r.editorResult(story.id,input.requestId,'different'),/different editor inputs/);
  }finally{r.close();}
});

test('Ask spends its bounded prose budget on question sources rather than duplicating the latest ending',async()=>{
  const story=longStory(2,15),c=settings(),input=request(story,'ask','Who has the access fob now? Quote the written line where Elias handed it to Mira.',story.passages.at(-1)!.id);
  story.passages[1].paragraphs[0]='Mira turned the fob over beside Elias, then checked the station access panel.';
  story.passages.at(-1)!.paragraphs[0]='Mira slid the fob into the access panel while Elias watched.';
  let sent='',sourceIds:string[]=[];
  const result=await generateEditorResult(story,input,c,signal(),details=>{
    if(details.stage==='question-context'){
      const report=details.report as import('../src/lib/context-types').ContextReport;
      assert.ok(!report.sources.some(s=>s.id==='recent-prose'&&s.included));
      assert.equal(report.sources.find(s=>s.id==='fob')?.required,true);
      sourceIds=report.answerSourceIds;
    }
  },async(_,init)=>{sent=String(init!.body);return completion({answer:'Mira has it; Elias handed it to her earlier.',uncertain:false,sources:[{passageId:'p-1-1',quote:'Elias handed the access fob to Mira beside the cobalt ledger.'}]});});
  assert.equal(result.kind,'ask');assert.ok(sourceIds.includes('p-1-1'));assert.ok(sent.includes('Elias handed the access fob to Mira beside the cobalt ledger.'));
});

test('Ask retrieves current remote possessions with short names even when historical prose describes an old owner',async()=>{
  const story=longStory(4,15),fob=story.canon.items.find(i=>i.id==='fob')!;fob.name='Fob';fob.ownerId='glass';
  let required=false;
  const result=await generateEditorResult(story,request(story,'ask','Who has the fob now?'),settings(),signal(),details=>{
    if(details.stage==='question-context'){
      const report=details.report as import('../src/lib/context-types').ContextReport;
      required=!!report.sources.find(s=>s.id==='fob'&&s.included&&s.required);
    }
  },async(_,init)=>{
    const body=JSON.parse(String(init!.body));assert.ok(body.messages[0].content.includes(JSON.stringify(fob)));
    return completion({answer:'The fob is currently at the Glass Belt; the current record overrides earlier possession.',uncertain:false,sources:[]});
  });
  assert.equal(result.kind,'ask');assert.equal(required,true);
});
test('answers reject fabricated source IDs, unsupported quotes, extra state changes and malformed JSON',async()=>{
  const story=createSample(),input=request(story,'ask','What happened in the first passage?');
  for(const result of [
    {answer:'A guess.',uncertain:false,sources:[{passageId:'invented',quote:'A fabricated source quote.'}]},
    {answer:'A guess.',uncertain:false,sources:[{passageId:input.passageId,quote:'The captain destroyed the entire ship.'}]},
    {answer:'A change.',uncertain:false,sources:[],effects:[{type:'funds.change'}]},'{broken answer'
  ])await assert.rejects(generateEditorResult(story,input,settings(),signal(),()=>{},async()=>completion(result)),/source|quote|invalid|incomplete/);
});
test('editor requests fit the complete source and review before calling a provider; cancellation leaves no result',async()=>{
  const story=createSample(),c=settings();c.text.contextTokens=1024;let calls=0;
  const provider:typeof fetch=async()=>{calls++;return completion({});};
  for(const kind of ['ask','polish'] as const)await assert.rejects(generateEditorResult(story,request(story,kind,'Help me with this story.'),c,signal(),()=>{},provider),/budget|allowance/);
  assert.equal(calls,0);
  const controller=new AbortController();controller.abort();
  await assert.rejects(generateEditorResult(story,request(story,'ask','What is the cargo?'),settings(),controller.signal,()=>{},async()=>{throw new Error('aborted');}));
  assert.equal(story.revision,0);
});
test('polish has a draft and independent meaning review before a preview exists, and preserves quoted dialogue',async()=>{
  const story=createSample(),input=request(story,'polish','Improve rhythm.'),p=story.passages[0],draft=p.paragraphs.map(s=>s.replace('watched its docking lights','studied its docking lights')),calls:string[]=[];
  const result=await generateEditorResult(story,input,settings(),signal(),()=>{},polishProvider(draft,undefined,calls));
  assert.equal(result.kind,'polish');assert.equal(calls.length,2);assert.ok(calls[1].startsWith('Review a proposed'));assert.equal(story.revision,0);assert.deepEqual(story.passages[0].paragraphs,p.paragraphs);
});
test('polish rejects changed dialogue, numbers, source evidence, names or semantic review failures',async()=>{
  const story=longStory(3,1),p=story.passages[0];p.paragraphs.push('“Keep the ledger sealed,” Mira said. The code was 42.');
  const original=p.paragraphs;
  for(const changed of [original.map(s=>s.replace('Keep the ledger sealed','Open the ledger now')),original.map(s=>s.replace('42','43')),original.map(s=>s.replace('handed the access fob to Mira','kept the access fob'))]){
    const calls:string[]=[];await assert.rejects(generateEditorResult(story,request(story,'polish','Improve prose.'),settings(),signal(),()=>{},polishProvider(changed,undefined,calls)),/dialogue|number|source quote/);assert.equal(calls.length,1);
  }
  const changed=original.map(s=>s.replace('The bridge hummed','The bridge thrummed'));
  await assert.rejects(generateEditorResult(story,request(story,'polish','Make the captain betray the crew.'),settings(),signal(),()=>{},polishProvider(changed,{equivalent:false,issues:['A new betrayal was introduced.']})),/betrayal|changed/);
  assert.throws(()=>validateWording(createSample(),createSample().passages[0],{paragraphs:['All people left.']}),/dialogue|name/);
});
test('accepted earlier-passage wording changes no canon or recovery; current notes rebase, stale notes stay stale and chapter/book/recap expire',async()=>{
  const r=new StoryRepository(':memory:');
  try{
    const fixture=longStory(5,1),c=settings();fixture.context.sceneBrief.scope='next-passage';fixture.context.sceneBrief.clearAfterPassage=true;fixture.context.sceneBrief.purpose='Keep this brief for the next generated scene.';
    fixture.context.compaction=(await compactMemory(fixture,c.text,signal(),c.context,async()=>completion({summary:'The crew checked the route.',facts:['Mira received the fob.'],openQuestions:['What does the ledger unlock?'],characterIds:['elias','mira'],locationIds:['bridge']}))).compaction;
    fixture.context.memories.push({...fixture.context.memories[0],id:'already-stale',sourceHash:'0'.repeat(64)});
    fixture.context.knowledge.push({id:'fob-knowledge',fact:'Mira received the fob.',truth:'established',knownBy:['mira'],readerRevealed:true,sourcePassageId:'p-1-1',sourceHash:memorySourceHash(fixture,['p-1-1'])});
    fixture.recap={text:'The crew inspected its route.',sourceHash:recapSourceHash(fixture),throughPassageId:fixture.passages.at(-1)!.id,passageCount:fixture.passages.length,source:'generated',updatedAt:fixture.updatedAt,stale:false};
    let story=await r.import(archive(fixture));const before=structuredClone(story),input=request(story,'polish','Improve rhythm.'),draft=story.passages[0].paragraphs.map(s=>s.replace('The bridge hummed','The bridge thrummed'));
    const result=await generateEditorResult(story,input,c,signal(),()=>{},polishProvider(draft));r.saveEditorResult(story.id,story.revision,input.requestId,jobFingerprint(input),result);
    assert.deepEqual(r.read(story.id),before);
    const acceptId=randomUUID();story=r.acceptPolish(story.id,result.id,story.revision,acceptId);
    assert.deepEqual(story.canon,before.canon);assert.deepEqual(story.recovery,before.recovery);assert.deepEqual(story.media,before.media);assert.equal(story.passages.length,before.passages.length);assert.deepEqual(story.context.sceneBrief,before.context.sceneBrief);
    assert.deepEqual(story.passages.slice(1),before.passages.slice(1));assert.deepEqual(story.passages[0].generation,before.passages[0].generation);
    assert.ok(memoryCurrent(story,story.context.memories[0]));assert.equal(story.context.memories.at(-1)!.sourceHash,'0'.repeat(64));
    assert.equal(story.context.knowledge.find(k=>k.id==='fob-knowledge')!.sourceHash,memorySourceHash(story,['p-1-1']));
    assert.equal(chapterMemoryCurrent(story,story.context.compaction.chapters[0]),false);assert.equal(chapterMemoryCurrent(story,story.context.compaction.chapters[1]),true);assert.equal(bookMemoryCurrent(story),false);assert.equal(story.recap!.stale,true);
    assert.deepEqual(r.acceptPolish(story.id,result.id,before.revision,acceptId),story);assert.deepEqual(r.acceptPolish(story.id,result.id,story.revision,randomUUID()),story);
    const copy=await r.import(r.export(story.id));assert.deepEqual(copy.passages,story.passages);assert.equal(r.listEditorResults(copy.id).length,0);
  }finally{r.close();}
});
test('stale or cross-story previews cannot overwrite a newer save or bypass review',async()=>{
  const r=new StoryRepository(':memory:');try{
    let story=r.create(),other=r.create(),input=request(story,'polish','Tighten prose.'),draft=story.passages[0].paragraphs.map(s=>s.replace('watched its docking lights','studied its docking lights'));
    const result=await generateEditorResult(story,input,settings(),signal(),()=>{},polishProvider(draft));assert.equal(result.kind,'polish');
    assert.throws(()=>r.saveEditorResult(story.id,0,input.requestId,jobFingerprint(input),{...result,review:{equivalent:false,issues:['Changed events.']}} as PolishResult),/invalid source\/review/);
    r.saveEditorResult(story.id,0,input.requestId,jobFingerprint(input),result);
    assert.throws(()=>r.acceptPolish(other.id,result.id,0,randomUUID()),/unavailable/);
    story=r.mutate(story.id,{expectedRevision:0,requestId:randomUUID(),action:{type:'world',funds:100,cargoNotes:'A manual correction.'}});
    assert.throws(()=>r.acceptPolish(story.id,result.id,story.revision,randomUUID()),/changed after/);
    assert.equal(r.read(story.id).canon.funds,100);assert.deepEqual(r.read(story.id).passages,story.passages);
  }finally{r.close();}
});
test('a latest passage polished after an inventory transfer still replaces from its correct pre-event baseline',async()=>{
  const r=new StoryRepository(':memory:');try{
    let story=r.create();story=r.mutate(story.id,{expectedRevision:0,requestId:randomUUID(),action:{type:'sample-continue',direction:''}});
    assert.equal(story.canon.items.find(i=>i.id==='fob')!.ownerId,'ren');
    const passage=story.passages.at(-1)!,input=request(story,'polish','Improve rhythm.',passage.id),draft=passage.paragraphs.map(s=>s.replace('Ren could hear Mira counting','Ren heard Mira counting'));
    const result=await generateEditorResult(story,input,settings(),signal(),()=>{},polishProvider(draft));r.saveEditorResult(story.id,story.revision,input.requestId,jobFingerprint(input),result);story=r.acceptPolish(story.id,result.id,story.revision,randomUUID());
    assert.equal(story.recovery!.valid,true);story=r.mutate(story.id,{expectedRevision:story.revision,requestId:randomUUID(),action:{type:'sample-replace',passageId:passage.id}});
    assert.equal(story.canon.items.find(i=>i.id==='fob')!.ownerId,'elias');assert.equal(story.passages.length,4);
  }finally{r.close();}
});
test('accepted pictures retain immutable source provenance and current status when wording is polished',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'story-editor-media-')),r=new StoryRepository(':memory:',false,join(folder,'media'));
  try{
    let story=r.create();const png=await sharp({create:{width:32,height:32,channels:3,background:'#527172'}}).png().toBuffer();
    story=await r.addMedia(story.id,png,{expectedRevision:0,requestId:randomUUID(),caption:'A story moment.',category:'scene',subjectIds:['elias'],passageId:story.passages[0].id,parentId:null,status:'canonical'});
    const before=structuredClone(story.media),input=request(story,'polish','Tighten prose.'),draft=story.passages[0].paragraphs.map(s=>s.replace('watched its docking lights','studied its docking lights'));
    const result=await generateEditorResult(story,input,settings(),signal(),()=>{},polishProvider(draft));r.saveEditorResult(story.id,story.revision,input.requestId,jobFingerprint(input),result);story=r.acceptPolish(story.id,result.id,story.revision,randomUUID());
    assert.deepEqual(story.media,before);assert.equal(createHash('sha256').update(r.mediaStore.original(story.media.assets[0])).digest('hex'),story.media.assets[0].hash);
  }finally{r.close();const target=resolve(folder);assert.ok(target.startsWith(resolve(tmpdir())));rmSync(target,{recursive:true,force:true});}
});
test('one-shot scene briefs are planning only and clear on successful passage commit, not ask or polish',async()=>{
  const r=new StoryRepository(':memory:');try{
    let story=r.create();story=r.mutate(story.id,{expectedRevision:0,requestId:randomUUID(),action:{type:'scene-brief',brief:{...story.context.sceneBrief,purpose:'Follow Mira next.',scope:'next-passage',clearAfterPassage:true}}});
    assert.equal(story.recovery!.valid,true);const input=request(story,'ask','Who is Mira?');
    const answer=await generateEditorResult(story,input,settings(),signal(),()=>{},async()=>completion({answer:'Mira is the engineer.',uncertain:false,sources:[]}));r.saveEditorResult(story.id,story.revision,input.requestId,jobFingerprint(input),answer);
    assert.equal(r.read(story.id).context.sceneBrief.purpose,'Follow Mira next.');
    story=r.mutate(story.id,{expectedRevision:story.revision,requestId:randomUUID(),action:{type:'sample-continue',direction:''}});
    assert.equal(story.context.sceneBrief.purpose,'');assert.equal(story.context.sceneBrief.castIds.length,0);
    assert.throws(()=>r.mutate(story.id,{expectedRevision:story.revision,requestId:randomUUID(),action:{type:'scene-brief',brief:{...story.context.sceneBrief,viewpointId:'invented'}}}),/scene brief reference/);
  }finally{r.close();}
});
test('editor schemas exclude raw effect mutation and accept-only payloads cannot act as polish previews',()=>{
  assert.equal(editorRequestSchema.safeParse({expectedRevision:0,requestId:randomUUID(),passageId:'p',kind:'ask',text:'',effects:[]}).success,false);
  assert.equal(editorRequestSchema.safeParse({expectedRevision:0,requestId:randomUUID(),passageId:'p',kind:'polish',text:'x'.repeat(2001)}).success,false);
});
test('a saved scene viewpoint is enforced before effects, and a failed narration keeps its one-shot brief',async()=>{
  const story=createSample();story.preferences.passageWords=100;story.context.sceneBrief.viewpointId='mira';story.context.sceneBrief.scope='next-passage';story.context.sceneBrief.clearAfterPassage=true;
  let calls=0;
  await assert.rejects(generatePassage({story,mode:'continue',direction:''},settings(),signal(),()=>{},async()=>{calls++;return completion({title:'A different viewpoint',chapterTitle:'Unusual cargo',viewpointId:'elias',endOfChapter:false,paragraphs:['Elias watched the station.']});}),/selected scene viewpoint/);
  assert.equal(calls,1);assert.equal(story.context.sceneBrief.clearAfterPassage,true);assert.equal(story.passages.length,3);
});
test('continuation selection reserves the actual narrator/schema contract before optional long-story memories',async()=>{
  const story=longStory(6,1),c=settings();story.preferences.passageWords=100;
  for(const m of story.context.memories)m.summary='Historical detail about this passage. '.repeat(100);
  const preview=previewContinuationContext(story,'Continue the inspection.',c);
  assert.equal(preview.runnable,true);assert.ok(preview.sources.find(s=>s.id==='task-contract')?.included);assert.ok(preview.sources.some(s=>s.kind==='memory'&&!s.included));
  let narrationCalls=0;
  await generatePassage({story,mode:'continue',direction:'Continue the inspection.'},c,signal(),()=>{},async(_,init)=>{
    const body=JSON.parse(String(init!.body));
    assert.ok(estimateInputTokens(body.messages)+body.max_tokens+c.context.overheadTokens<=c.text.contextTokens);
    if(body.messages[0].content.startsWith('Return {effects:'))return completion({effects:[],memory:{summary:'The crew continued.',facts:[],openQuestions:[],characterIds:['elias'],locationIds:['bridge']}});
    narrationCalls++;assert.deepEqual(body.messages,preview.messages);
    return completion({title:'The inspection',chapterTitle:'Chapter 6',viewpointId:'elias',endOfChapter:false,paragraphs:[('Elias checked the navigation panel while Mira compared the readings with the chart. ').repeat(8)]});
  });
  assert.equal(narrationCalls,1);
});
