import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ranchVehicleFixture,quietDetail} from '../exports/ranch-scope-test/fixture';
import {buildStoryContext} from '../src/lib/server/context-builder';
import {extractionContext} from '../src/lib/server/extraction-context';
import {needsInventoryReview,reviewInventory} from '../src/lib/server/inventory-review';
import {preparePassageCommit} from '../src/lib/server/passage-commit';
import {applyStoryEffects} from '../src/lib/story-effects';
import {connectionSchema} from '../src/lib/server/connections';
import {generatePassage} from '../src/lib/server/story-generation';
import type {StoryEffect} from '../src/lib/effect-types';

const driving='Alex drove the Loader Tractor from the Equipment Yard to North Pasture. He remained seated inside the Tractor Cab.';
const drive:StoryEffect={type:'place.update',placeId:'tractor',parentId:'pasture',evidence:driving};
const settings=()=>connectionSchema.parse({...JSON.parse(readFileSync('config/connections.example.json','utf8')),text:{baseUrl:'http://localhost:9999/v1',model:'mock',contextTokens:32000,maxTokens:4096,temperature:0.8,structuredOutput:'auto'}});
const completion=(value:unknown)=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(value)},finish_reason:'stop'}]}));

test('an occupied tractor is one moving place; changing its parent carries the cab, occupant and stored feed',()=>{
 const story=ranchVehicleFixture(),before=structuredClone(story);
 story.canon.items.push({id:'loaded-feed',name:'Loaded cattle pellets',description:'Ten portions in the bin.',ownerId:'feed-bin',quantity:10,equipped:false});
 const applied=applyStoryEffects(story.canon,[drive],driving).canon;
 assert.equal(applied.places.find(p=>p.id==='tractor')!.parentId,'pasture');assert.equal(applied.places.find(p=>p.id==='tractor-cab')!.parentId,'tractor');
 assert.equal(applied.characters.find(c=>c.id==='alex')!.locationId,'tractor-cab');assert.equal(applied.items.find(i=>i.id==='feed-bin')!.ownerId,'tractor');assert.equal(applied.items.find(i=>i.id==='loaded-feed')!.ownerId,'feed-bin');
 assert.ok(!applied.items.some(i=>i.id==='tractor'));assert.deepEqual(story.canon.places,before.canon.places);
 const moved={...story,canon:applied},r=buildStoryContext(moved,'A quiet conversation inside the Tractor Cab.',32000,4096);
 assert.deepEqual(r.selectedCharacterIds,['alex']);assert.ok(r.selectedPlaceIds.includes('tractor-cab'));assert.ok(r.selectedPlaceIds.includes('tractor'));assert.ok(r.selectedPlaceIds.includes('pasture'));assert.ok(!r.selectedPlaceIds.includes('yard'));
});

test('named vehicles and rooms enter extraction as places; people cannot be located inside an item',()=>{
 const story=ranchVehicleFixture(),context=extractionContext(story,[driving]);
 for(const id of ['tractor','tractor-cab','pasture'])assert.ok(context.before.places.some(p=>p.id===id),id);
 assert.ok(!context.before.items.some(i=>i.id==='tractor'));
 assert.throws(()=>applyStoryEffects(story.canon,[{type:'character.move',characterId:'alex',locationId:'feed-bin',evidence:driving}],driving),/invalid|location/i);
});

test('vehicle travel is checked even with no item effects; the verifier sees physical paths with a stable cab ID',async()=>{
 const story=ranchVehicleFixture();assert.equal(needsInventoryReview(story,[driving],[]),true);assert.equal(needsInventoryReview(story,['The journey was complete.'],[drive]),true);
 await reviewInventory(story,[driving],[drive],{},settings().text,1024,new AbortController().signal,async(_url,init)=>{
  const data=JSON.parse(JSON.parse(String(init!.body)).messages[1].content),person=data.peopleLocations.find((p:{id:string})=>p.id==='alex');
  assert.equal(person.before.at(-1).id,'tractor-cab');assert.equal(person.after.at(-1).id,'tractor-cab');
  assert.ok(person.before.some((p:{id:string})=>p.id==='yard'));assert.ok(person.after.some((p:{id:string})=>p.id==='pasture'));assert.ok(!person.after.some((p:{id:string})=>p.id==='yard'));
  return completion({consistent:true,issues:[]});
 });
});

test('exiting and walking home leaves the parked vehicle and feed bin at their place',()=>{
 const story=ranchVehicleFixture();story.canon.places.find(p=>p.id==='tractor')!.parentId='pasture';
 const quote='Alex climbed down from the Tractor Cab in North Pasture, parked the Loader Tractor there and walked to the Farmhouse Porch.';
 const after=preparePassageCommit(story,{mode:'continue',direction:'Park and walk home.',draft:{title:'Home',chapterTitle:story.passages[0].chapterTitle,startsChapter:false,endOfChapter:false,viewpointId:'alex',paragraphs:[quote]},effects:[{type:'character.move',characterId:'alex',locationId:'porch',evidence:quote}]}).story;
 assert.equal(after.canon.characters.find(c=>c.id==='alex')!.locationId,'porch');assert.equal(after.canon.places.find(p=>p.id==='tractor')!.parentId,'pasture');assert.equal(after.canon.items.find(i=>i.id==='feed-bin')!.ownerId,'tractor');
});

test('an omitted vehicle-place move is repaired without moving the driver out of the cab',async()=>{
 const story=ranchVehicleFixture();let extraction=0,review=0;
 const proposal=await generatePassage({story,mode:'continue',direction:'Drive to North Pasture.'},settings(),new AbortController().signal,()=>{},async(_url,init)=>{
  const body=JSON.parse(String(init!.body)),system=body.messages[0].content;
  if(system.startsWith('Review inventory consistency.')){review++;const data=JSON.parse(body.messages[1].content),vehicle=data.after.places.find((p:{id:string})=>p.id==='tractor'),valid=vehicle.parentId==='pasture';return completion({consistent:valid,issues:valid?[]:['The vehicle place did not move to North Pasture.']});}
  if(system.startsWith('Return {effects:')){extraction++;return completion({effects:extraction===1?[]:[drive],memory:{summary:'Alex drove to North Pasture and stayed in the cab.',facts:[],openQuestions:[],characterIds:['alex'],locationIds:['tractor-cab','pasture']}});}
  return completion({title:'Inside the cab',chapterTitle:story.passages[0].chapterTitle,viewpointId:'alex',endOfChapter:false,paragraphs:[driving,quietDetail]});
 });
 assert.equal(extraction,2);assert.equal(review,2);const after=preparePassageCommit(story,proposal).story;
 assert.equal(after.canon.places.find(p=>p.id==='tractor')!.parentId,'pasture');assert.equal(after.canon.characters.find(c=>c.id==='alex')!.locationId,'tractor-cab');
});
