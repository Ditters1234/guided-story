// Synthetic ranch probes using the saved local provider; never saves a real story.
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,join,sep} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve('test-results');mkdirSync(root,{recursive:true});
const scratch=mkdtempSync(join(root,'ranch-live-'));process.env.STORY_DATA_DIR=scratch;
const {ranchFixture,ranchVehicleFixture,ranchEffects,loading,travelling,unloading,quietDetail}=await import('../exports/ranch-scope-test/fixture.ts');
const {reviewInventory}=await import('../src/lib/server/inventory-review.ts');
const {getDiagnostics}=await import('../src/lib/server/diagnostics.ts');
const c=JSON.parse(readFileSync('config/connections.play.local.json','utf8'));c.text.timeoutSeconds=75;c.text.maxTokens=2048;c.text.contextTokens=32000;
const story=ranchFixture(),original=structuredClone(story),paragraphs=[loading,travelling,unloading],results=[];
try{
 if(process.argv.includes('--vehicle-generate')){
  const {generatePassage}=await import('../src/lib/server/story-generation.ts'),{preparePassageCommit}=await import('../src/lib/server/passage-commit.ts');
  const vehicleStory=ranchVehicleFixture(),originalVehicle=structuredClone(vehicleStory),start=Date.now();let realCalls=0;
  const prose='Alex drove the Loader Tractor from the Equipment Yard to North Pasture. He remained seated inside the Tractor Cab.';
  const proposal=await generatePassage({story:vehicleStory,mode:'continue',direction:'Drive to North Pasture and remain inside the cab.'},c,new AbortController().signal,()=>{},async(url,init)=>{
   const body=JSON.parse(String(init.body)),system=body.messages[0].content;
   if(system.startsWith('Return {effects:')||system.startsWith('Review inventory consistency.')){realCalls++;return fetch(url,init);}
   return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({title:'Inside the cab',chapterTitle:vehicleStory.passages[0].chapterTitle,viewpointId:'alex',endOfChapter:false,paragraphs:[prose,quietDetail]})},finish_reason:'stop'}]}));
  });
  const after=preparePassageCommit(vehicleStory,proposal).story;
  const result={model:c.text.model,realCalls,elapsedMs:Date.now()-start,fixedNarration:true,effects:proposal.effects,vehicleParent:after.canon.places.find(p=>p.id==='tractor').parentId,rancherLocation:after.canon.characters.find(p=>p.id==='alex').locationId,binHolder:after.canon.items.find(i=>i.id==='feed-bin').ownerId,sourceStoryUnchanged:true};
  writeFileSync(join(root,'ranch-live-vehicle-extraction.json'),JSON.stringify(result,null,2)+'\n');
  assert.equal(result.vehicleParent,'pasture');assert.equal(result.rancherLocation,'tractor-cab');assert.equal(result.binHolder,'tractor');assert.deepEqual(vehicleStory,originalVehicle);console.log(JSON.stringify(result));
 }else if(process.argv.includes('--vehicle')){
  const vehicleStory=ranchVehicleFixture(),prose='Alex drove the Loader Tractor from the Equipment Yard to North Pasture. He remained seated inside the Tractor Cab.';
  const movement={type:'place.update',placeId:'tractor',parentId:'pasture',evidence:prose};
  const cases=[{id:'vehicle-moves-cab-id-stable',effects:[movement],expectedConsistent:true},{id:'vehicle-place-move-omitted',effects:[],expectedConsistent:false},{id:'driver-incorrectly-outside',effects:[movement,{type:'character.move',characterId:'alex',locationId:'pasture',evidence:prose}],expectedConsistent:false}];
  for(const test of cases){const start=Date.now(),issues=await reviewInventory(vehicleStory,[prose],test.effects,{},c.text,c.context.overheadTokens,new AbortController().signal);const row={id:test.id,expectedConsistent:test.expectedConsistent,consistent:issues.length===0,issues,elapsedMs:Date.now()-start};results.push(row);console.log(JSON.stringify(row));writeFileSync(join(root,'ranch-live-vehicle-review.json'),JSON.stringify({model:c.text.model,results},null,2)+'\n');}
  for(const row of results)assert.equal(row.consistent,row.expectedConsistent,row.id);
 }else if(process.argv.includes('--followup')){
  const parkedStory=ranchFixture();parkedStory.canon.items.find(i=>i.id==='tractor').ownerId='alex';parkedStory.canon.characters.find(p=>p.id==='alex').locationId='pasture';
  const quote='Alex parked the Loader Tractor beside the Long Trough in North Pasture, climbed down and walked back to the Farmhouse Porch.';
  const walking={type:'character.move',characterId:'alex',locationId:'porch',evidence:quote},parking={type:'item.transfer',itemId:'tractor',fromOwnerId:'alex',toOwnerId:'pasture',evidence:quote};
  const prior=JSON.parse(readFileSync(join(root,'ranch-live-generation-before.json'),'utf8'));
  const cases=[{id:'parked-tractor-follows-walker',story:parkedStory,paragraphs:[quote],effects:[walking],expectedConsistent:false},{id:'parked-tractor-stays-behind',story:parkedStory,paragraphs:[quote],effects:[parking,walking],expectedConsistent:true},{id:'unsupported-ten-from-several',story,paragraphs:prior.paragraphs,effects:prior.effects,expectedConsistent:false}];
  for(const test of cases){const start=Date.now(),issues=await reviewInventory(test.story,test.paragraphs,test.effects,{},c.text,c.context.overheadTokens,new AbortController().signal);const row={id:test.id,expectedConsistent:test.expectedConsistent,consistent:issues.length===0,issues,elapsedMs:Date.now()-start};results.push(row);console.log(JSON.stringify(row));writeFileSync(join(root,'ranch-live-followup.json'),JSON.stringify({model:c.text.model,results},null,2)+'\n');}
  for(const row of results)assert.equal(row.consistent,row.expectedConsistent,row.id);
 }else if(process.argv.includes('--generate')){
  const {generatePassage}=await import('../src/lib/server/story-generation.ts'),{preparePassageCommit}=await import('../src/lib/server/passage-commit.ts');
  let calls=0;const start=Date.now();
  const proposal=await generatePassage({story,mode:'continue',direction:'Feed the cows. Complete the routine in this passage.'},c,new AbortController().signal,d=>console.log(JSON.stringify({stage:d.stage,elapsedMs:Date.now()-start})),async(...args)=>{calls++;return fetch(...args);});
  const after=preparePassageCommit(story,proposal).story;
  const {itemRootOwnerId}=await import('../src/lib/inventory.ts'),tractorRoot=itemRootOwnerId(after.canon,'tractor');
  const tractorLocation=after.canon.characters.find(p=>p.id===tractorRoot)?.locationId||tractorRoot;
  const result={model:c.text.model,calls,elapsedMs:Date.now()-start,paragraphs:proposal.draft.paragraphs,effects:proposal.effects,final:{feedstock:after.canon.items.find(i=>i.id==='feedstock'),feedStacks:after.canon.items.filter(i=>i.name==='Cattle pellets'),tractorHolder:after.canon.items.find(i=>i.id==='tractor').ownerId,tractorLocation,rancherLocation:after.canon.characters.find(p=>p.id==='alex').locationId},sourceStoryUnchanged:true};
  writeFileSync(join(root,'ranch-live-generation.json'),JSON.stringify(result,null,2)+'\n');
  assert.equal(tractorLocation,'pasture');assert.equal(after.canon.characters.find(p=>p.id==='alex').locationId,'pasture');
  assert.ok(after.canon.items.find(i=>i.id==='feedstock').quantity<100);assert.ok(after.canon.items.filter(i=>i.name==='Cattle pellets').reduce((sum,i)=>sum+i.quantity,0)<=100);
  assert.deepEqual(story,original);
  console.log(JSON.stringify({passed:true,calls,elapsedMs:result.elapsedMs,effects:proposal.effects.length}));
 }else{
  const cases=[{id:'complete-chain',effects:ranchEffects(),expectedConsistent:true},{id:'omitted-all-changes',effects:[],expectedConsistent:false},{id:'omitted-rancher-movement',effects:ranchEffects().filter(e=>e.type!=='character.move'),expectedConsistent:false},{id:'omitted-tractor-movement',effects:ranchEffects().filter(e=>!(e.type==='item.transfer'&&e.itemId==='tractor')),expectedConsistent:false}];
  for(const test of cases){
   const start=Date.now(),issues=await reviewInventory(story,paragraphs,test.effects,{summary:'Alex fed the cows. Six portions remain in the trough.'},c.text,c.context.overheadTokens,new AbortController().signal);
   const row={id:test.id,expectedConsistent:test.expectedConsistent,consistent:issues.length===0,issues,elapsedMs:Date.now()-start};results.push(row);console.log(JSON.stringify(row));
   writeFileSync(join(root,'ranch-live-review.json'),JSON.stringify({model:c.text.model,results,sourceStoryUnchanged:true},null,2)+'\n');
  }
  assert.deepEqual(story,original);for(const row of results)assert.equal(row.consistent,row.expectedConsistent,row.id);
 }
}finally{getDiagnostics().close();assert.ok(scratch.startsWith(root+sep+'ranch-live-'));rmSync(scratch,{recursive:true,force:true});}
