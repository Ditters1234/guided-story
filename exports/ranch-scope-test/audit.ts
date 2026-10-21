// Run: node --import tsx exports/ranch-scope-test/audit.ts
// Mock request audit + portable fixture, with isolated diagnostics and no provider/library access.
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,join,sep} from 'node:path';
import {zipSync,strToU8} from 'fflate';
import assert from 'node:assert/strict';
import {ranchFixture,ranchVehicleFixture,ranchEffects,loading,travelling,unloading,quietDetail} from './fixture';
const folder=resolve('exports/ranch-scope-test'),testRoot=resolve('test-results');mkdirSync(testRoot,{recursive:true});
const scratch=mkdtempSync(join(testRoot,'ranch-audit-'));process.env.STORY_DATA_DIR=scratch;
const {previewContinuationContext,generatePassage}=await import('../../src/lib/server/story-generation');
const {preparePassageCommit}=await import('../../src/lib/server/passage-commit');
const {connectionSchema}=await import('../../src/lib/server/connections');
const {estimateInputTokens}=await import('../../src/lib/server/token-budget');
const {getDiagnostics}=await import('../../src/lib/server/diagnostics');
const {StoryRepository}=await import('../../src/lib/server/repository');
const {applyStoryEffects}=await import('../../src/lib/story-effects');
const c=connectionSchema.parse(JSON.parse(readFileSync('config/connections.example.json','utf8')));c.text.model='mock-ranch-audit';
const story=ranchFixture(),original=structuredClone(story),paragraphs=[loading,travelling,unloading,quietDetail];
const respond=(value:unknown)=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(value)},finish_reason:'stop'}]}));
try{
 const scope=[];
 for(const test of ['no-routine','public-routine','flat-tyre']){
  const source=structuredClone(story);if(test==='no-routine')source.context.lore=[];
  if(test==='flat-tyre')source.canon.items.find(i=>i.id==='tractor')!.description='Its rear tyre is flat; it cannot be driven until repaired.';
  const report=previewContinuationContext(source,'Feed the cows.',c);
  scope.push({case:test,runnable:report.runnable,estimatedInputTokens:report.inputTokens,items:source.canon.items.filter(i=>report.sources.some(s=>s.id===i.id&&s.included)).map(i=>({id:i.id,name:i.name,ownerId:i.ownerId,quantity:i.quantity,description:i.description})),activeCharacters:report.selectedCharacterIds,places:report.selectedPlaceIds,warnings:report.warnings});
 }
 const flows=[];
 for(const omitted of [false,true]){
  const requests:unknown[]=[];let extractions=0;
  const proposal=await generatePassage({story,mode:'continue',direction:'Feed the cows.'},c,new AbortController().signal,()=>{},async(_url,init)=>{
   const body=JSON.parse(String(init!.body)),system=body.messages[0].content,review=system.startsWith('Review inventory consistency.'),extract=system.startsWith('Return {effects:');
   requests.push({stage:review?'inventory-review':extract?(++extractions===1?'extraction':'repair'):'narration',estimatedInputTokens:estimateInputTokens(body.messages,body.response_format?.json_schema?.schema),outputAllowance:body.max_tokens});
   if(review){const data=JSON.parse(body.messages[1].content),valid=data.after.items.some((i:{ownerId:string;quantity:number})=>i.ownerId==='trough'&&i.quantity===6);return respond({consistent:valid,issues:valid?[]:['The completed feed/transport chain is missing.']});}
   if(extract)return respond({effects:omitted&&extractions===1?[]:ranchEffects(),memory:{summary:'Alex feeds the cows. Six portions remain in the trough.',facts:[],openQuestions:[],characterIds:['alex'],locationIds:['pasture']}});
   return respond({title:'The feeding round',chapterTitle:story.passages[0].chapterTitle,viewpointId:'alex',endOfChapter:false,paragraphs});
  });
  const after=preparePassageCommit(story,proposal).story;assert.equal(after.canon.items.find(i=>i.id==='feedstock')!.quantity,90);
  flows.push({case:omitted?'omitted-effects-repair':'complete-effects',requests,final:{feedInShed:90,feedInTrough:6,consumed:4,tractorLocation:after.canon.items.find(i=>i.id==='tractor')!.ownerId,rancherLocation:after.canon.characters.find(p=>p.id==='alex')!.locationId}});
 }
 assert.deepEqual(story,original);
 const zip=zipSync({'manifest.json':strToU8(JSON.stringify({format:'guided-story-dev-1',media:[],exportedAt:new Date().toISOString()})),'story.json':strToU8(JSON.stringify(story))},{level:6});
 const vehicleStory=ranchVehicleFixture(),vehicleZip=zipSync({'manifest.json':strToU8(JSON.stringify({format:'guided-story-dev-1',media:[],exportedAt:new Date().toISOString()})),'story.json':strToU8(JSON.stringify(vehicleStory))},{level:6});
 const moving=applyStoryEffects(vehicleStory.canon,[{type:'place.update',placeId:'tractor',parentId:'pasture',evidence:'Alex drove the Loader Tractor to North Pasture.'}],'Alex drove the Loader Tractor to North Pasture.').canon;
 const interior=previewContinuationContext({...vehicleStory,canon:moving},'A quiet scene inside the Tractor Cab.',c);
 const vehicle={rancherLocation:moving.characters.find(p=>p.id==='alex')!.locationId,cabParent:moving.places.find(p=>p.id==='tractor-cab')!.parentId,tractorParent:moving.places.find(p=>p.id==='tractor')!.parentId,binHolder:moving.items.find(i=>i.id==='feed-bin')!.ownerId,selectedPlaces:interior.selectedPlaceIds,activeCharacters:interior.selectedCharacterIds,duplicateTractorItem:moving.items.some(i=>i.id==='tractor')};
 assert.equal(vehicle.rancherLocation,'tractor-cab');assert.equal(vehicle.tractorParent,'pasture');assert.equal(vehicle.duplicateTractorItem,false);
 const repo=new StoryRepository(':memory:');try{const imported=await repo.import(zip);assert.equal(imported.canon.items.length,story.canon.items.length);assert.equal(imported.context.lore[0].id,'feeding-routine');const importedVehicle=await repo.import(vehicleZip);assert.equal(importedVehicle.canon.places.find(p=>p.id==='tractor-cab')!.parentId,'tractor');}finally{repo.close();}
 writeFileSync(join(folder,'ranch-story.zip'),zip);writeFileSync(join(folder,'story.json'),JSON.stringify(story,null,2)+'\n');
 writeFileSync(join(folder,'ranch-vehicle-story.zip'),vehicleZip);writeFileSync(join(folder,'vehicle-story.json'),JSON.stringify(vehicleStory,null,2)+'\n');
 const result={realModelCalls:0,networkCalls:0,userLibraryChanged:false,archiveImportValidated:true,scope,flows,vehicle,limitations:'Mocked prose/completions verify request construction and state commits only. Token counts are conservative app estimates. Relevant references must already exist in visible descriptions, background, known facts or valid viewpoint memory; no universal activity planner or hidden-knowledge inference is tested.'};
 writeFileSync(join(folder,'audit.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}finally{getDiagnostics().close();assert.ok(scratch.startsWith(testRoot+sep+'ranch-audit-'));rmSync(scratch,{recursive:true,force:true});}
