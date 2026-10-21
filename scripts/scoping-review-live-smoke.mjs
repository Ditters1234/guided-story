// Synthetic neutral ownership checks against the saved local model; no library mutation.
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
const testRoot=resolve('test-results');mkdirSync(testRoot,{recursive:true});
const scratch=mkdtempSync(join(testRoot,'scoping-live-'));process.env.STORY_DATA_DIR=scratch;
const {createSample}=await import('../src/lib/server/fixture.ts');
const {reviewInventory}=await import('../src/lib/server/inventory-review.ts');
const {getDiagnostics}=await import('../src/lib/server/diagnostics.ts');
const c=JSON.parse(readFileSync('config/connections.play.local.json','utf8'));
c.text.timeoutSeconds=Math.min(c.text.timeoutSeconds||180,90);
const story=createSample();story.canon.items.push({id:'brush',name:'Wooden hairbrush',description:'One wooden hairbrush.',ownerId:'elias',quantity:1,equipped:false});
const handover='Elias handed the wooden hairbrush to Ren, who took it and held it in his hand.';
const kept='Elias put the wooden hairbrush back in his own satchel. Ren kept his hands at his sides.';
const transfer=quote=>({type:'item.transfer',itemId:'brush',fromOwnerId:'elias',toOwnerId:'ren',evidence:quote});
const create=quote=>({type:'item.create',ref:'new-brush',name:'Wooden hairbrush',description:'A wooden hairbrush.',ownerId:'ren',quantity:1,equipped:false,evidence:quote});
const second='Ren bought a second wooden hairbrush from a vendor. Elias kept his original wooden hairbrush.';
const cases=[
 {id:'omitted-transfer',quote:handover,effects:[],expectedConsistent:false},
 {id:'correct-transfer',quote:handover,effects:[transfer(handover)],expectedConsistent:true},
 {id:'unsupported-transfer',quote:kept,effects:[transfer(kept)],expectedConsistent:false},
 {id:'duplicate-instead-of-transfer',quote:handover,effects:[create(handover)],expectedConsistent:false},
 {id:'genuine-second-object',quote:second,effects:[create(second)],expectedConsistent:true}
];
const results=[];
try{
 for(const test of process.argv.includes('--repair')||process.argv.includes('--split')?[]:cases){const start=Date.now();const issues=await reviewInventory(story,[test.quote],test.effects,{summary:test.quote,facts:[],openQuestions:[],characterIds:['elias','ren'],locationIds:['bridge']},c.text,c.context.overheadTokens,new AbortController().signal);
  const result={id:test.id,expectedConsistent:test.expectedConsistent,consistent:issues.length===0,issues,elapsedMs:Date.now()-start};results.push(result);console.log(JSON.stringify(result));
  writeFileSync(join(testRoot,'scoping-live-review.json'),JSON.stringify({model:c.text.model,results},null,2)+'\n');
 }
 for(const result of results)assert.equal(result.consistent,result.expectedConsistent,result.id);
 if(process.argv.includes('--split')){
  story.canon.items.push({id:'cartridges',name:'Brass cartridges',description:'Ten marked cartridges.',ownerId:'elias',quantity:10,equipped:false});
  const quote='Elias gave Ren three of his ten brass cartridges.';
  const packed='Ren bought a new empty canvas bag and held it open. Elias put three of his ten brass cartridges inside it.';
  const split=(quantity,ownerId='ren')=>({type:'item.split',ref:'new-part',itemId:'cartridges',expectedQuantity:10,quantity,ownerId,evidence:ownerId==='ren'?quote:packed});
  const splitCases=[{id:'correct-partial-stack',quote,effects:[split(3)],expectedConsistent:true},{id:'wrong-partial-quantity',quote,effects:[split(4)],expectedConsistent:false},{id:'partial-stack-new-container',quote:packed,effects:[{type:'item.create',ref:'new-bag',name:'Canvas bag',description:'An empty canvas bag.',ownerId:'ren',quantity:1,equipped:false,isContainer:true,evidence:packed},split(3,'new-bag')],expectedConsistent:true}];
  const splitResults=[];
  for(const test of splitCases){const start=Date.now();const issues=await reviewInventory(story,[test.quote],test.effects,{summary:test.quote,facts:[],openQuestions:[]},c.text,c.context.overheadTokens,new AbortController().signal);const result={id:test.id,expectedConsistent:test.expectedConsistent,consistent:issues.length===0,issues,elapsedMs:Date.now()-start};splitResults.push(result);console.log(JSON.stringify(result));writeFileSync(join(testRoot,'scoping-phase-two-live.json'),JSON.stringify({model:c.text.model,results:splitResults},null,2)+'\n');}
  for(const result of splitResults)assert.equal(result.consistent,result.expectedConsistent,result.id);
  console.log('PASS: local model accepts conserved partial stacks and new container paths, and rejects a wrong moved quantity.');
 }else if(process.argv.includes('--repair')){
  const {generatePassage}=await import('../src/lib/server/story-generation.ts');
  const {preparePassageCommit}=await import('../src/lib/server/passage-commit.ts');
  story.origin='generated';story.passages.at(-1).endOfChapter=false;story.preferences.passageWords=100;
  const original=structuredClone(story),stages=[];let extractions=0,realCalls=0;
  const detail='The narrow room was quiet beneath the steady sound of rain against the window. Mira watched from the console while the captain checked the written list. Neither of them spoke for several seconds. The waiting ship had no departure order yet, and the officer on the screen had offered no further explanation. There was time to finish this small matter before anyone made another decision.';
  const mock=value=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(value)},finish_reason:'stop'}]}));
  const start=Date.now();
  const proposal=await generatePassage({story,mode:'continue',direction:'Complete the hairbrush handover.'},c,new AbortController().signal,d=>stages.push(d.stage),async(url,init)=>{
   const body=JSON.parse(String(init.body)),system=body.messages[0].content;
   if(system.startsWith('Return {effects:')&&++extractions===1)return mock({effects:[],memory:{summary:'Ren received the hairbrush from Elias.',facts:['Ren now holds the hairbrush.'],openQuestions:[],characterIds:['elias','ren'],locationIds:['bridge']}});
   if(system.startsWith('Review inventory consistency.')||system.startsWith('Return {effects:')){realCalls++;return fetch(url,init);}
   return mock({title:'A borrowed brush',chapterTitle:story.passages.at(-1).chapterTitle,viewpointId:'elias',endOfChapter:false,paragraphs:[handover,detail]});
  });
  const saved=preparePassageCommit(story,proposal).story;
  assert.equal(saved.canon.items.find(i=>i.id==='brush').ownerId,'ren');assert.equal(saved.canon.items.filter(i=>i.name==='Wooden hairbrush').length,1);assert.deepEqual(story,original);assert.equal(realCalls,3);assert.ok(stages.includes('repairing-inventory'));
  const result={model:c.text.model,realCalls,elapsedMs:Date.now()-start,stages,brushOwnerId:'ren',brushRecords:1,sourceStoryUnchanged:true};writeFileSync(join(testRoot,'scoping-live-repair.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
  console.log('PASS: live review rejected a deliberately omitted handover; live extraction repair and recheck produced one brush held by Ren.');
 }else console.log('PASS: local model catches missing, unsupported and duplicate transfers; accepts a correct handover and a genuine second object.');
}finally{getDiagnostics().close();assert.ok(scratch.startsWith(testRoot+'\\scoping-live-'));rmSync(scratch,{recursive:true,force:true});}
