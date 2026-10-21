import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSample} from '../src/lib/server/fixture';
import {preparePassageCommit} from '../src/lib/server/passage-commit';
import {storyViewpoint,mentionedItems} from '../src/lib/entity-scope';
import {emptyContext} from '../src/lib/context-types';
import {reviewInventory,needsInventoryReview} from '../src/lib/server/inventory-review';
import {extractionContext} from '../src/lib/server/extraction-context';
import {connectionSchema} from '../src/lib/server/connections';
import {generatePassage} from '../src/lib/server/story-generation';
import type {StoryEffect} from '../src/lib/effect-types';
import {StoryRepository} from '../src/lib/server/repository';
import {applyCorrectionOperations} from '../src/lib/server/record-editing';
import {randomUUID} from 'node:crypto';

const settings=()=>connectionSchema.parse({...JSON.parse(readFileSync('config/connections.example.json','utf8')),text:{baseUrl:'http://localhost:9999/v1',model:'mock',contextTokens:32000,maxTokens:4096,temperature:0.8,structuredOutput:'auto'}});
const completion=(value:unknown)=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(value)},finish_reason:'stop'}]}));
function fixture(){const story=createSample();story.origin='generated';story.passages.at(-1)!.endOfChapter=false;story.preferences.passageWords=100;return story;}
const detail='The table stood beneath the window, where the rain made a steady sound against the glass. Mira checked the written list and waited for the captain to answer. Ren watched quietly beside the console. The ship had no departure order, and the officer on the screen had offered no further explanation. Nobody interrupted the pause. There was enough time to settle this small matter before discussing the next decision.';

test('a saved viewpoint survives character renaming without rewriting historical prose',()=>{
 const story=fixture();
 const result=preparePassageCommit(story,{mode:'continue',direction:'',draft:{title:'Waiting',startsChapter:false,endOfChapter:false,viewpointId:'ren',paragraphs:['Ren watched the dark viewport.']},effects:[]}).story;
 assert.equal(result.passages.at(-1)!.viewpointId,'ren');
 result.context=emptyContext();result.canon.characters.find(c=>c.id==='ren')!.name='Rowan Calder';
 assert.equal(storyViewpoint(result).id,'ren');assert.equal(result.passages.at(-1)!.viewpoint,'Ren Calder');
});

test('legacy viewpoint identities are retained before manual and reviewed renames and survive story archives',async()=>{
 const repository=new StoryRepository(':memory:');
 try{
  for(const type of ['character','record-save'] as const){
   const original=repository.create(),person=original.canon.characters.find(c=>c.id==='elias')!;
   const renamed=repository.mutate(original.id,{expectedRevision:original.revision,requestId:randomUUID(),action:type==='character'?{type,character:{...person,name:'Ari Voss'}}:{type,edit:{kind:'character',value:{...person,name:'Ari Voss'}}}});
   assert.deepEqual(renamed.passages.map(p=>p.paragraphs),original.passages.map(p=>p.paragraphs));
   assert.equal(renamed.passages.at(-1)!.viewpointId,'elias');
   const imported=await repository.import(repository.export(renamed.id));imported.context=emptyContext();assert.equal(storyViewpoint(imported).name,'Ari Voss');
  }
  const original=fixture(),before=structuredClone(original),person=original.canon.characters.find(c=>c.id==='elias')!;
  const corrected=applyCorrectionOperations(original,[{type:'record',create:false,edit:{kind:'character',value:{...person,name:'Ari Voss'}}}]);corrected.context=emptyContext();
  assert.equal(storyViewpoint(corrected).name,'Ari Voss');assert.deepEqual(original,before);
 }finally{repository.close();}
});

test('read-only questions do not require a resolvable narrative viewpoint',async()=>{
 const {buildStoryContext}=await import('../src/lib/server/context-builder');
 const story=fixture();story.context=emptyContext();story.passages.at(-1)!.viewpoint='A formerly named character';
 assert.throws(()=>storyViewpoint(story),/ambiguous|no longer/);
 const report=buildStoryContext(story,'Who owns the access fob?',32000,1536,undefined,undefined,{purpose:'ask'});
 assert.equal(report.runnable,true);assert.ok(JSON.stringify(report.messages).includes('Access fob'));
});

test('an exact numbered item does not select its whole series; an additional generic mention retains ambiguity',()=>{
 const story=fixture();for(let n=1;n<=20;n++)story.canon.items.push({id:`fitting-${n}`,name:`Reserve fitting ${n}`,description:'An ordinary fitting.',ownerId:'hold',quantity:1,equipped:false});
 assert.deepEqual(mentionedItems(story.canon.items,'Mira examined Reserve fitting 7.'),['fitting-7']);
 const generic=mentionedItems(story.canon.items,'Mira examined Reserve fitting 7 and compared it with the other fittings.');
 assert.equal(generic.filter(id=>id.startsWith('fitting-')).length,20);
});

test('partial-stack verification receives the new recipient stack and its ref mapping',async()=>{
 const story=fixture(),quote='Elias gave Ren three of his ten brass cartridges.';
 story.canon.items.push({id:'cartridges',name:'Brass cartridges',description:'Ten marked cartridges.',ownerId:'elias',quantity:10,equipped:false});
 const effects:StoryEffect[]=[{type:'item.split',ref:'new-cartridges',itemId:'cartridges',expectedQuantity:10,quantity:3,ownerId:'ren',evidence:quote}];
 let checked=false;
 const issues=await reviewInventory(story,[quote],effects,{summary:quote},settings().text,1024,new AbortController().signal,async(_url,init)=>{
  const data=JSON.parse(JSON.parse(String(init!.body)).messages[1].content),items=data.after.items.filter((i:{name:string})=>i.name==='Brass cartridges');
  assert.equal(items.length,2);assert.equal(items.reduce((sum:number,i:{quantity:number})=>sum+i.quantity,0),10);
  assert.equal(items.find((i:{ownerId:string})=>i.ownerId==='ren').id,data.assignedIds['new-cartridges']);checked=true;
  return completion({consistent:true,issues:[]});
 });
 assert.equal(checked,true);assert.deepEqual(issues,[]);assert.equal(story.canon.items.find(i=>i.id==='cartridges')!.quantity,10);
});

test('extraction has bounded prior referent context and does not promote a future direction into full records',()=>{
 const story=fixture();story.canon.characters.push({...story.canon.characters[0],id:'mara',name:'Mara Vale',locationId:'glass'});
 story.canon.items.push({id:'letter',name:'Sealed letter',description:'A sealed letter.',ownerId:'ren',quantity:1,equipped:false});
 story.passages.at(-1)!.paragraphs=['Ren held the sealed letter beside the table.'];
 const context=extractionContext(story,['He gave it to Mira.'],'Mention Mara Vale next chapter.');
 assert.ok(context.before.items.some(i=>i.id==='letter'));
 assert.ok(context.referenceEndingForPronouns.includes('Ren held the sealed letter'));
 assert.ok(!context.before.characters.some(c=>c.id==='mara'));assert.ok(context.directory.characters.some(c=>c[0]==='mara'));
 story.passages.at(-1)!.paragraphs=['Mara Vale once described a distant wheel in a letter.'];
 const explicit=extractionContext(story,['Ren discussed the sealed letter with Mira.'],'Mention Mara Vale next chapter.');
 assert.equal(explicit.referenceEndingForPronouns,'');assert.ok(!explicit.before.characters.some(c=>c.id==='mara'));
});

test('a correct partial handoff completes generation without a spurious repair',async()=>{
 const story=fixture(),quote='Elias gave Ren three of his ten brass cartridges.';
 story.canon.items.push({id:'cartridges',name:'Brass cartridges',description:'Marked cartridges.',ownerId:'elias',quantity:10,equipped:false});
 let narration=0,extraction=0,review=0;
 const proposal=await generatePassage({story,mode:'continue',direction:'Share three cartridges.'},settings(),new AbortController().signal,()=>{},async(_url,init)=>{
  const body=JSON.parse(String(init!.body)),system=body.messages[0].content;
  if(system.startsWith('Review inventory consistency.')){review++;const after=JSON.parse(body.messages[1].content).after.items;const valid=after.some((i:{ownerId:string;quantity:number})=>i.ownerId==='ren'&&i.quantity===3);return completion({consistent:valid,issues:valid?[]:['The recipient stack is missing.']});}
  if(system.startsWith('Return {effects:')){extraction++;return completion({effects:[{type:'item.split',ref:'new-cartridges',itemId:'cartridges',expectedQuantity:10,quantity:3,ownerId:'ren',evidenceId:'source-0'}],memory:{summary:quote,facts:[quote],openQuestions:[],characterIds:['elias','ren'],locationIds:['bridge']}});}
  narration++;return completion({title:'Shared supplies',chapterTitle:story.passages.at(-1)!.chapterTitle,viewpointId:'elias',endOfChapter:false,paragraphs:[quote,detail]});
 });
 assert.equal(narration,1);assert.equal(extraction,1);assert.equal(review,1);
 const after=preparePassageCommit(story,proposal).story;
 assert.equal(after.canon.items.find(i=>i.id==='cartridges')!.quantity,7);assert.equal(after.canon.items.find(i=>i.ownerId==='ren'&&i.name==='Brass cartridges')!.quantity,3);
});

test('inventory action detection skips the noun places but retains completed placed/laid/slid/set handoffs',()=>{
 const story=fixture();story.canon.items.push({id:'brush',name:'Wooden hairbrush',description:'A brush.',ownerId:'elias',quantity:1,equipped:false},{id:'letter',name:'Sealed letter',description:'A letter.',ownerId:'ren',quantity:1,equipped:false});
 assert.equal(needsInventoryReview(story,['The letter remained sealed, and nobody changed places or possessions.'],[]),false);
 for(const verb of ['placed','laid','slid','set','places'])assert.equal(needsInventoryReview(story,[`Elias ${verb} the wooden hairbrush on the table.`],[]),true,verb);
});
