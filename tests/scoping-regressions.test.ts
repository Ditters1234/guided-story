import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSample} from '../src/lib/server/fixture';
import {buildStoryContext} from '../src/lib/server/context-builder';
import {extractionContext} from '../src/lib/server/extraction-context';
import {resolveCharacterReference,storyViewpoint} from '../src/lib/entity-scope';
import {emptyContext} from '../src/lib/context-types';
import {connectionSchema} from '../src/lib/server/connections';
import {generatePassage} from '../src/lib/server/story-generation';
import {preparePassageCommit} from '../src/lib/server/passage-commit';

const settings=()=>connectionSchema.parse({...JSON.parse(readFileSync('config/connections.example.json','utf8')),text:{baseUrl:'http://localhost:9999/v1',model:'mock',contextTokens:32000,maxTokens:4096,temperature:0.8,structuredOutput:'auto'}});
const completion=(value:unknown)=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(value)},finish_reason:'stop'}]}));
function fixture(){const story=createSample();story.origin='generated';story.passages.at(-1)!.endOfChapter=false;story.preferences.passageWords=100;story.canon.items.push({id:'brush',name:'Wooden hairbrush',description:'A single hairbrush.',ownerId:'elias',quantity:1,equipped:false});return story;}
const detail='The narrow room was quiet beneath the steady sound of rain against the window. Mira watched from the console while the captain checked the written list. Neither of them spoke for several seconds. The waiting ship had no departure order yet, and the officer on the screen had offered no further explanation. There was time to finish this small matter before anyone made another decision.';
const handover='Elias handed the wooden hairbrush to Ren, who accepted it and held it in his hand.';

test('viewpoint uses exact full names, stable IDs and unique short names; ambiguous names fail instead of selecting the first cast member',()=>{
 const story=fixture();story.context=emptyContext();
 story.canon.characters.push({...story.canon.characters[0],id:'mara',name:'Mara Voss',locationId:'glass'});
 story.passages.at(-1)!.viewpoint='Mara Voss';assert.equal(storyViewpoint(story).id,'mara');
 const report=buildStoryContext(story,'Continue.',32000,4096);assert.equal(report.selectedPlaceIds[0],'glass');
 story.passages.at(-1)!.viewpoint='Ren';assert.equal(storyViewpoint(story).id,'ren');
 assert.equal(resolveCharacterReference(story.canon.characters,'ELIAS VOSS')!.id,'elias');
 assert.equal(resolveCharacterReference(story.canon.characters,'mara')!.id,'mara');
 story.passages.at(-1)!.viewpoint='Voss';assert.throws(()=>storyViewpoint(story),/ambiguous/);
 story.context.sceneBrief.viewpointId='ren';assert.equal(storyViewpoint(story).id,'ren');
});

test('absent references remain compact; shared surnames and incidental name words do not activate unrelated people',()=>{
 const story=fixture();story.canon.characters.push({...story.canon.characters[0],id:'mara',name:'Mara Voss',notes:'REMOTE-BIOGRAPHY',locationId:'glass'},{...story.canon.characters[0],id:'soren',name:'Soren Voss',locationId:'glass'},{...story.canon.characters[0],id:'ward',name:'Ines Ward',locationId:'glass'});
 const report=buildStoryContext(story,'Elias remembers Mara Voss discussing an ordinary ward.',32000,4096),text=JSON.stringify(report.messages);
 assert.deepEqual(report.selectedCharacterIds,['elias','mira','ren']);
 assert.ok(report.sources.find(s=>s.id==='mara:reference')?.included);assert.ok(!text.includes('REMOTE-BIOGRAPHY'));
 assert.ok(!report.sources.find(s=>s.id==='soren:reference')?.included);assert.ok(!report.sources.find(s=>s.id==='ward:reference')?.included);
});

test('nested item references retain holders without siblings or ancestor-owned freight; equipped items remain available',()=>{
 const story=fixture();story.canon.items.push({id:'bag',name:'Canvas bag',description:'A bag.',ownerId:'elias',quantity:1,equipped:false,isContainer:true},{id:'wallet',name:'Document wallet',description:'An inner wallet.',ownerId:'bag',quantity:1,equipped:false,isContainer:true},{id:'ticket',name:'Ferry ticket',description:'One ticket.',ownerId:'wallet',quantity:1,equipped:false},{id:'receipt',name:'Boot receipt',description:'Unused receipt.',ownerId:'wallet',quantity:1,equipped:false},{id:'ship-spare',name:'Reserve rivet',description:'Remote freight.',ownerId:'wayward',quantity:1,equipped:false});
 const report=buildStoryContext(story,'Examine the ferry ticket.',32000,4096);
 for(const id of ['ticket','wallet','bag','tool'])assert.ok(report.sources.find(s=>s.id===id)?.included,id);
 for(const id of ['receipt','ship-spare'])assert.equal(report.sources.find(s=>s.id===id)?.included,false,id);
 const extracted=extractionContext(story,['Elias handed the ferry ticket to Ren.']);
 assert.ok(extracted.before.items.some(i=>i.id==='wallet'));assert.ok(!extracted.before.items.some(i=>i.id==='receipt'));
 assert.ok(extracted.directory.items.some(i=>i[0]==='receipt'));
});

test('large-world continuation scopes actual extraction and completes under 32k without shipping remote biographies/descriptions',async()=>{
 const story=fixture();story.canon.items=story.canon.items.filter(i=>i.id!=='brush');
 for(let n=0;n<21;n++)story.canon.characters.push({...story.canon.characters[0],id:`remote-${n}`,name:`Observer ${n}`,locationId:'glass',notes:'REMOTE-PROFILE '.repeat(150)});
 for(let n=0;n<167;n++)story.canon.items.push({id:`spare-${n}`,name:`Remote component ${n}`,description:'REMOTE-DESCRIPTION '.repeat(80),ownerId:'glass',quantity:1,equipped:false});
 let calls=0,extract:any;
 const before=structuredClone(story);
 const proposal=await generatePassage({story,mode:'continue',direction:'Continue the quiet conversation.'},settings(),new AbortController().signal,()=>{},async(_url,init)=>{
  calls++;const body=JSON.parse(String(init!.body));
  if(body.messages[0].content.startsWith('Return {effects:')){extract=JSON.parse(body.messages[1].content);assert.ok(!body.messages[1].content.includes('REMOTE-PROFILE'));assert.ok(!body.messages[1].content.includes('REMOTE-DESCRIPTION'));return completion({effects:[],memory:{summary:'The crew discussed the delay.',facts:[],openQuestions:[],characterIds:['elias'],locationIds:['bridge']}});}
  return completion({title:'Quiet',chapterTitle:story.passages.at(-1)!.chapterTitle,viewpointId:'elias',endOfChapter:false,paragraphs:[detail]});
 });
 assert.equal(calls,2);assert.equal(extract.directory.characters.length,24);assert.equal(extract.directory.items.length,170);assert.ok(extract.before.items.length<10);
 assert.deepEqual(story,before);assert.equal(preparePassageCommit(story,proposal).story.passages.length,4);
});

test('an impossible state-update directory is refused before narration, without a provider call',async()=>{
 const story=fixture();for(let n=0;n<500;n++)story.canon.items.push({id:`remote-${n}`,name:`Distant ${n} `+'unrelated '.repeat(16),description:'',ownerId:'glass',quantity:1,equipped:false});
 let calls=0;await assert.rejects(()=>generatePassage({story,mode:'continue',direction:''},settings(),new AbortController().signal,()=>{},async()=>{calls++;return completion({});}),/state-update context.*Nothing was generated/);assert.equal(calls,0);
});

for(const scenario of ['omitted','unsupported','duplicate','partial-exchange'] as const)test(`inventory reconciliation repairs ${scenario} changes without regenerating prose`,async()=>{
 const story=fixture(),before=structuredClone(story),fob=story.canon.items.find(i=>i.id==='fob')!;
 if(scenario==='partial-exchange'){fob.ownerId='ren';before.canon.items.find(i=>i.id==='fob')!.ownerId='ren';}
 const quote=scenario==='unsupported'?'Elias put the wooden hairbrush back in his own satchel. Ren kept his hands at his sides.':handover+(scenario==='partial-exchange'?' In return, Ren handed Elias the access fob.':'');
 let narrations=0,extractions=0,reviews=0;
 const stages:unknown[]=[];
 const proposal=await generatePassage({story,mode:'continue',direction:'Continue the scene.'},settings(),new AbortController().signal,d=>stages.push(d),async(_url,init)=>{
  const body=JSON.parse(String(init!.body)),system=body.messages[0].content;
  const transfer={type:'item.transfer',itemId:'brush',fromOwnerId:'elias',toOwnerId:'ren',evidenceId:'source-0'};
  if(system.startsWith('Review inventory consistency.')){
   reviews++;const data=JSON.parse(body.messages[1].content),brushes=data.after.items.filter((i:any)=>i.name==='Wooden hairbrush');
   const valid=scenario==='unsupported'?brushes[0].ownerId==='elias':brushes.length===1&&brushes[0].ownerId==='ren'&&(scenario!=='partial-exchange'||data.after.items.find((i:any)=>i.id==='fob')?.ownerId==='elias');
   return completion({consistent:valid,issues:valid?[]:['The ownership changes do not match the completed handover(s).']});
  }
  if(system.startsWith('Return {effects:')){
   extractions++;let effects:unknown[]=extractions===1?(scenario==='omitted'?[]:scenario==='duplicate'?[{type:'item.create',ref:'new-brush',name:'Wooden hairbrush',description:'A brush.',quantity:1,ownerId:'ren',equipped:false,evidenceId:'source-0'}]:[transfer]):scenario==='unsupported'?[]:[transfer];
   if(scenario==='partial-exchange'&&extractions===2)effects.push({type:'item.transfer',itemId:'fob',fromOwnerId:'ren',toOwnerId:'elias',evidenceId:'source-0'});
   return completion({effects,memory:{summary:scenario==='unsupported'?'Elias kept his brush.':'The handover was completed.',facts:[],openQuestions:[],characterIds:['elias','ren'],locationIds:['bridge']}});
  }
  narrations++;return completion({title:'A handover',chapterTitle:story.passages.at(-1)!.chapterTitle,viewpointId:'elias',endOfChapter:false,paragraphs:[quote,detail]});
 });
 assert.equal(narrations,1);assert.equal(extractions,2);assert.equal(reviews,2);assert.ok(JSON.stringify(stages).includes('repairing-inventory'));
 const committed=preparePassageCommit(story,proposal).story;
 assert.equal(committed.canon.items.find(i=>i.id==='brush')!.ownerId,scenario==='unsupported'?'elias':'ren');assert.equal(committed.canon.items.filter(i=>i.name==='Wooden hairbrush').length,1);assert.deepEqual(story,before);
});

test('persistent disagreement and reviewer failure preserve the original story and bound retries',async()=>{
 for(const fail of [false,true]){
  const story=fixture(),before=structuredClone(story);let reviews=0,extractions=0,narrations=0;
  await assert.rejects(()=>generatePassage({story,mode:'continue',direction:''},settings(),new AbortController().signal,()=>{},async(_url,init)=>{
   const system=JSON.parse(String(init!.body)).messages[0].content;
   if(system.startsWith('Review inventory consistency.')){reviews++;return fail?new Response('',{status:503}):completion({consistent:false,issues:['The brush handover was omitted.']});}
   if(system.startsWith('Return {effects:')){extractions++;return completion({effects:[],memory:{summary:'Ren received the brush.',facts:[],openQuestions:[],characterIds:['ren'],locationIds:['bridge']}});}
   narrations++;return completion({title:'A handover',chapterTitle:story.passages.at(-1)!.chapterTitle,viewpointId:'elias',endOfChapter:false,paragraphs:[handover,detail]});
  }),fail?/HTTP 503/:/still disagree after a repair attempt/);
  assert.equal(narrations,1);assert.equal(reviews,fail?1:2);assert.equal(extractions,fail?1:2);assert.deepEqual(story,before);
 }
});

test('cancelling inventory verification cannot return a committable generated proposal',async()=>{
 const story=fixture(),before=structuredClone(story),controller=new AbortController();let reviews=0;
 await assert.rejects(()=>generatePassage({story,mode:'continue',direction:''},settings(),controller.signal,()=>{},async(_url,init)=>{
  const system=JSON.parse(String(init!.body)).messages[0].content;
  if(system.startsWith('Review inventory consistency.')){reviews++;controller.abort();return completion({consistent:true,issues:[]});}
  if(system.startsWith('Return {effects:'))return completion({effects:[],memory:{summary:'Ren received the brush.',facts:[],openQuestions:[],characterIds:['ren'],locationIds:['bridge']}});
  return completion({title:'A handover',chapterTitle:story.passages.at(-1)!.chapterTitle,viewpointId:'elias',endOfChapter:false,paragraphs:[handover,detail]});
 }),/cancelled/);
 assert.equal(reviews,1);assert.deepEqual(story,before);
});
