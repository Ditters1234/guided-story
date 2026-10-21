import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ranchFixture,ranchEffects,loading,travelling,unloading,quietDetail} from '../exports/ranch-scope-test/fixture';
import {buildStoryContext} from '../src/lib/server/context-builder';
import {openingContext} from '../src/lib/server/scene-scope';
import {extractionContext} from '../src/lib/server/extraction-context';
import {needsInventoryReview} from '../src/lib/server/inventory-review';
import {memorySourceHash} from '../src/lib/server/context-state';
import {generatePassage} from '../src/lib/server/story-generation';
import {preparePassageCommit} from '../src/lib/server/passage-commit';
import {connectionSchema} from '../src/lib/server/connections';

const report=(story=ranchFixture(),direction='Feed the cows.')=>buildStoryContext(story,direction,32000,4096);
const included=(r:ReturnType<typeof report>,id:string)=>r.sources.some(s=>s.id===id&&s.included);
const settings=()=>connectionSchema.parse({...JSON.parse(readFileSync('config/connections.example.json','utf8')),text:{baseUrl:'http://localhost:9999/v1',model:'mock',contextTokens:32000,maxTokens:4096,temperature:0.8,structuredOutput:'auto'}});
const completion=(value:unknown)=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(value)},finish_reason:'stop'}]}));

test('a short chore direction follows public routine references to current equipment without expanding unrelated stores or people',()=>{
 const story=ranchFixture(),before=structuredClone(story),r=report(story);
 for(const id of ['feedstock','tractor','trough','shed','pasture'])assert.ok(included(r,id),id);
 for(const id of ['paint','toolbox','spanner','secret-bin'])assert.ok(!included(r,id),id);
 assert.deepEqual(r.selectedCharacterIds,['alex']);assert.deepEqual(story,before);
 story.canon.items.find(i=>i.id==='tractor')!.description='Its rear tyre is flat; it cannot be driven until repaired.';
 assert.ok(JSON.stringify(report(story).messages).includes('cannot be driven until repaired'));
});

test('opening and continuation can use the same routine; a direction with no established dependencies does not invent them',()=>{
 const story=ranchFixture();story.passages=[];
 const opening=openingContext(story,'Feed the cows.');assert.ok(opening.scope.itemIds.has('tractor'));assert.ok(opening.scope.itemIds.has('trough'));
 const unlinked=report(ranchFixture(false));assert.ok(!included(unlinked,'tractor'));assert.ok(!included(unlinked,'trough'));
 assert.ok(!included(report(ranchFixture(),'Inspect the porch railing.'),'tractor'));
});

test('hidden lore, unknown facts, beliefs, possibilities and stale sources never establish task dependencies',()=>{
 const story=ranchFixture(false);
 story.context.lore.push({id:'hidden-routine',title:'Feeding cows',text:'Use the Concealed Seed Bin.',keywords:['feed','cows'],relatedIds:['secret-bin'],visibility:'hidden'});
 for(const [id,truth,knownBy,readerRevealed]of [['belief','belief',['alex'],true],['possible','possibility',['alex'],true],['unknown','established',['ben'],true],['unrevealed','established',['alex'],false]] as const)
  story.context.knowledge.push({id,fact:'Feeding cows uses the Loader Tractor.',truth,knownBy:[...knownBy],readerRevealed,sourcePassageId:null,sourceHash:null});
 story.context.memories.push({id:'stale-memory',passageIds:['morning-1'],summary:'Feeding cows.',facts:['Alex uses the Loader Tractor for feeding cows.'],openQuestions:[],characterIds:['alex'],locationIds:['yard'],sourceHash:'0'.repeat(64),createdAt:story.createdAt,source:'manual'});
 story.context.knowledge.push({id:'stale-knowledge',fact:'Feeding cows uses the Loader Tractor.',truth:'established',knownBy:['alex'],readerRevealed:true,sourcePassageId:'morning-1',sourceHash:'0'.repeat(64)});
 story.passages.unshift({...story.passages[0],id:'ben-earlier',viewpoint:'Ben Cooper',viewpointId:'ben',paragraphs:['Ben reviewed the morning feeding routine alone. Alex was elsewhere.']});
 story.context.memories.push({id:'other-viewpoint-memory',passageIds:['ben-earlier'],summary:'An earlier scene.',facts:['The Loader Tractor is used for feeding cows.'],openQuestions:[],characterIds:['alex','ben'],locationIds:['yard'],sourceHash:memorySourceHash(story,['ben-earlier']),createdAt:story.createdAt,source:'manual'});
 const r=report(story);assert.ok(!included(r,'tractor'));assert.ok(!included(r,'secret-bin'));
});

test('current established knowledge and surviving memory can link a task to records while preserving their current holders',()=>{
 for(const kind of ['knowledge','memory']){
  const story=ranchFixture(false),fact='Alex uses the Loader Tractor for feeding cows.';
  if(kind==='knowledge')story.context.knowledge.push({id:'known-routine',fact,truth:'established',knownBy:['alex'],readerRevealed:true,sourcePassageId:null,sourceHash:null});
  else story.context.memories.push({id:'past-routine',passageIds:['morning-1'],summary:'An earlier routine.',facts:[fact],openQuestions:[],characterIds:['alex'],locationIds:['yard'],sourceHash:memorySourceHash(story,['morning-1']),createdAt:story.createdAt,source:'manual'});
  story.canon.items.find(i=>i.id==='tractor')!.ownerId='south-field';
  const r=report(story);assert.ok(included(r,'tractor'),kind);assert.ok(r.messages.map(m=>m.content).join('\n').includes('"ownerId":"south-field"'));
 }
});

test('loading, pouring, filling, transport and consumption cannot silently bypass verification when effects are omitted',()=>{
 const story=ranchFixture();
 for(const text of [loading,travelling,unloading,'Alex filled the Long Trough with cattle pellets.','The dairy cows consumed six portions of cattle pellets.','Alex carried the cattle pellets into the shed.'])assert.equal(needsInventoryReview(story,[text],[]),true,text);
 assert.equal(needsInventoryReview(story,['The tractor has a feed bin. The trough is empty. Alex considered the morning.'],[]),false);
});

test('compound load, travel, unload and eating conserve feed and update both vehicle and rancher locations',()=>{
 const story=ranchFixture(),original=structuredClone(story),paragraphs=[loading,travelling,unloading];
 const input=extractionContext(story,paragraphs);for(const id of ['feedstock','tractor','trough'])assert.ok(input.before.items.some(i=>i.id===id));
 const {story:after}=preparePassageCommit(story,{mode:'continue',direction:'Feed the cows.',draft:{title:'Morning feeding',chapterTitle:story.passages[0].chapterTitle,startsChapter:false,endOfChapter:false,viewpointId:'alex',paragraphs},effects:ranchEffects()});
 assert.equal(after.canon.items.find(i=>i.id==='feedstock')!.quantity,90);assert.equal(after.canon.items.find(i=>i.id==='tractor')!.ownerId,'pasture');
 const delivered=after.canon.items.filter(i=>i.name==='Cattle pellets'&&i.id!=='feedstock');assert.equal(delivered.length,1);assert.equal(delivered[0].ownerId,'trough');assert.equal(delivered[0].quantity,6);
 assert.equal(after.canon.characters.find(c=>c.id==='alex')!.locationId,'pasture');assert.deepEqual(story,original);
});

test('generation catches a completely omitted chore update, repairs once and commits the complete movement chain',async()=>{
 const story=ranchFixture(),paragraphs=[loading,travelling,unloading,quietDetail];let extraction=0,review=0;
 const proposal=await generatePassage({story,mode:'continue',direction:'Feed the cows.'},settings(),new AbortController().signal,()=>{},async(_url,init)=>{
  const body=JSON.parse(String(init!.body)),system=body.messages[0].content;
  if(system.startsWith('Review inventory consistency.')){
   review++;const data=JSON.parse(body.messages[1].content),valid=data.after.items.some((i:{ownerId:string;quantity:number})=>i.ownerId==='trough'&&i.quantity===6);
   assert.equal(data.before.people.find((p:{id:string})=>p.id==='alex').locationId,'porch');
   assert.equal(data.after.people.find((p:{id:string})=>p.id==='alex').locationId,valid?'pasture':'porch');
   assert.ok(data.after.places.some((p:{id:string;name:string})=>p.id==='pasture'&&p.name==='North Pasture'));
   return completion({consistent:valid,issues:valid?[]:['Loading, tractor travel, unloading and feed consumption are missing.']});
  }
  if(system.startsWith('Return {effects:')){extraction++;return completion({effects:extraction===1?[]:ranchEffects(),memory:{summary:'Alex fed the cows; six portions remain in the trough.',facts:[],openQuestions:[],characterIds:['alex'],locationIds:['pasture']}});}
  return completion({title:'The feeding round',chapterTitle:story.passages[0].chapterTitle,viewpointId:'alex',endOfChapter:false,paragraphs});
 });
 assert.equal(extraction,2);assert.equal(review,2);
 const after=preparePassageCommit(story,proposal).story;assert.equal(after.canon.items.find(i=>i.id==='feedstock')!.quantity,90);assert.equal(after.canon.items.find(i=>i.id==='tractor')!.ownerId,'pasture');
});

test('goal expansion is bounded, reports clipping, and never expands linked containers into their contents',()=>{
 const story=ranchFixture();story.context.lore[0].relatedIds.push('toolbox');
 const small=report(story);assert.ok(included(small,'toolbox'));assert.ok(!included(small,'spanner'));
 for(let n=0;n<24;n++){
  story.canon.items.push({id:`supply-${n}`,name:`Routine Supply ${n}`,description:'A routine supply.',ownerId:'shed',quantity:1,equipped:false});
  story.context.lore[0].relatedIds.push(`supply-${n}`);
 }
 const scope=openingContext(story,'Feed the cows.').scope;assert.ok(scope.activity.ids.size<=16);assert.equal(scope.activity.clipped,true);
 assert.ok(report(story).warnings.some(w=>w.includes('bounded selection limit')));
});

test('the mechanism handles another activity using existing links, and linked IDs survive record renames',()=>{
 const story=ranchFixture(false);
 story.canon.items.find(i=>i.id==='tractor')!.name='Kitchen Stove';story.canon.items.find(i=>i.id==='trough')!.name='Cooking Pot';story.canon.items.find(i=>i.id==='feedstock')!.name='Oat Flakes';
 story.context.lore.push({id:'breakfast-routine',title:'Breakfast preparation',text:'Prepare breakfast using the stove, oats and pot.',keywords:['breakfast'],relatedIds:['tractor','trough','feedstock','shed'],visibility:'relevant'});
 const r=report(story,'Prepare breakfast.');for(const id of ['tractor','trough','feedstock'])assert.ok(included(r,id),id);
 assert.ok(!included(r,'cows'));assert.ok(!included(r,'spanner'));
 story.canon.items.find(i=>i.id==='tractor')!.name='Old Reliable';assert.ok(report(story,'Prepare breakfast.').messages.map(m=>m.content).join('\n').includes('Old Reliable'));
});

test('a linked remote helper remains a reference, and future intent alone never changes any inventory',()=>{
 const story=ranchFixture(),before=structuredClone(story.canon);story.context.lore[0].relatedIds.push('ben');
 const r=report(story);assert.ok(included(r,'ben:reference'));assert.ok(!r.selectedCharacterIds.includes('ben'));assert.deepEqual(story.canon,before);
 const future=extractionContext(story,['Alex planned to feed the cows after lunch. The morning round had not started.'],'Feed the cows.');
 assert.deepEqual(story.canon,before);assert.ok(!future.before.items.some(i=>i.id==='tractor'));
});

test('the chore can span passages: the next scene follows actual movement and a loaded container retains its contents',()=>{
 let story=ranchFixture();
 const commit=(paragraphs:string[],effects:ReturnType<typeof ranchEffects>)=>preparePassageCommit(story,{mode:'continue',direction:'Feed the cows.',draft:{title:'The next step',chapterTitle:story.passages[0].chapterTitle,startsChapter:false,endOfChapter:false,viewpointId:'alex',paragraphs},effects});
 const loaded=commit([loading],[ranchEffects()[0]]),loadId=loaded.assigned['new-load'];story=loaded.story;
 assert.equal(story.canon.items.find(i=>i.id===loadId)!.ownerId,'tractor');
 story=commit([travelling],ranchEffects().slice(1,3)).story;
 assert.equal(story.canon.items.find(i=>i.id===loadId)!.ownerId,'tractor');
 const next=report(story,'Continue the feeding round.');assert.ok(next.selectedPlaceIds.includes('pasture'));assert.ok(!next.selectedPlaceIds.includes('porch'));
 story=commit([unloading],ranchEffects().slice(3).map(effect=>'itemId'in effect?{...effect,itemId:loadId}:effect)).story;
 assert.equal(story.canon.items.find(i=>i.id===loadId)!.ownerId,'trough');assert.equal(story.canon.items.find(i=>i.id===loadId)!.quantity,6);assert.equal(story.canon.items.find(i=>i.id==='feedstock')!.quantity,90);
});

test('ordinary visible item descriptions can supply dependencies without a separate routine entry or recursive expansion',()=>{
 const story=ranchFixture(false);
 story.canon.items.find(i=>i.id==='cows')!.description='The cows eat Cattle pellets delivered by the Loader Tractor into the Long Trough.';
 story.canon.items.find(i=>i.id==='tractor')!.description='The Workshop Toolbox is stored beside this machine.';
 const r=report(story);for(const id of ['feedstock','tractor','trough'])assert.ok(included(r,id),id);
 assert.ok(!included(r,'toolbox'));assert.ok(!included(r,'spanner'));assert.ok(!included(r,'secret-bin'));
});

test('parking before walking away leaves the tractor in the pasture instead of following its former holder',async()=>{
 const story=ranchFixture();story.canon.items.find(i=>i.id==='tractor')!.ownerId='alex';story.canon.characters.find(c=>c.id==='alex')!.locationId='pasture';
 const parked='Alex parked the Loader Tractor beside the Long Trough in North Pasture, climbed down and walked back to the Farmhouse Porch.';
 assert.equal(needsInventoryReview(story,[parked],[]),true);
 let extraction=0,review=0;
 const proposal=await generatePassage({story,mode:'continue',direction:'Park the tractor and walk home.'},settings(),new AbortController().signal,()=>{},async(_url,init)=>{
  const body=JSON.parse(String(init!.body)),system=body.messages[0].content;
  if(system.startsWith('Review inventory consistency.')){
   review++;const data=JSON.parse(body.messages[1].content),position=data.containerLocations.find((i:{id:string})=>i.id==='tractor');
   assert.equal(position.before.locationId,'pasture');const valid=position.after.locationId==='pasture';
   return completion({consistent:valid,issues:valid?[]:['The parked tractor incorrectly follows Alex home.']});
  }
  if(system.startsWith('Return {effects:')){
   extraction++;return completion({effects:[...(extraction===1?[]:[{type:'item.transfer',itemId:'tractor',fromOwnerId:'alex',toOwnerId:'pasture',evidence:parked}]),{type:'character.move',characterId:'alex',locationId:'porch',evidence:parked}],memory:{summary:'Alex parked the tractor and walked home.',facts:[],openQuestions:[],characterIds:['alex'],locationIds:['pasture','porch']}});
  }
  return completion({title:'The walk home',chapterTitle:story.passages[0].chapterTitle,viewpointId:'alex',endOfChapter:false,paragraphs:[parked,quietDetail]});
 });
 assert.equal(extraction,2);assert.equal(review,2);const after=preparePassageCommit(story,proposal).story;
 assert.equal(after.canon.items.find(i=>i.id==='tractor')!.ownerId,'pasture');assert.equal(after.canon.characters.find(c=>c.id==='alex')!.locationId,'porch');
});
