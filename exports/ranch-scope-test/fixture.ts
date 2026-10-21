import {createSample} from '../../src/lib/server/fixture';
import {normalizeCharacterProfile} from '../../src/lib/character-profile';
import {emptyContext} from '../../src/lib/context-types';
import {emptyFactPins} from '../../src/lib/fact-pins';
import {validateStory,type Story} from '../../src/lib/story';
import type {StoryEffect} from '../../src/lib/effect-types';

/** Synthetic task-dependency fixture. Never opens or changes a saved library. */
export function ranchFixture(routine=true):Story {
 const story=createSample(),now='2026-10-20T12:00:00.000Z';
 story.title='The morning feed';story.premise='Alex runs a cattle ranch. Places and possessions stay where recorded until an evidenced action moves them.';story.origin='generated';
 story.narrationStyle='Grounded rural fiction with clear physical action and ordinary working details.';story.artStyle='Natural light and realistic rural surroundings.';
 story.preferences.passageWords=100;story.preferences.contentNotes='';story.preferences.writingGuide='';story.preferences.person='third-limited';
 story.canon={characters:[normalizeCharacterProfile({...structuredClone(story.canon.characters[0]),id:'alex',name:'Alex Morrow',role:'Rancher',notes:'Knows the ranch feeding routine.',locationId:'porch',noNsfw:true,pinnedAppearance:false}),normalizeCharacterProfile({...structuredClone(story.canon.characters[0]),id:'ben',name:'Ben Cooper',role:'Ranch hand',notes:'Working at the distant fence.',locationId:'south-field',noNsfw:true,pinnedAppearance:false})],
  places:[{id:'ranch',name:'Morrow Ranch',description:'A working cattle ranch.',parentId:null},{id:'porch',name:'Farmhouse Porch',description:'Alex starts here.',parentId:'ranch'},
   {id:'shed',name:'Feed Shed',description:'Storage for cattle pellets.',parentId:'ranch'},{id:'yard',name:'Equipment Yard',description:'Machinery parking.',parentId:'ranch'},
   {id:'pasture',name:'North Pasture',description:'The dairy herd and its trough.',parentId:'ranch'},{id:'south-field',name:'South Field',description:'Distant fence repairs.',parentId:'ranch'},
   {id:'vault',name:'Buried Vault',description:'A concealed chamber.',parentId:'ranch'}],
  items:[{id:'feedstock',name:'Cattle pellets',description:'Dry pellets measured in whole portions.',ownerId:'shed',quantity:100,equipped:false},
   {id:'tractor',name:'Loader Tractor',description:'A working tractor with a feed bin.',ownerId:'yard',quantity:1,equipped:false,isContainer:true},
   {id:'trough',name:'Long Trough',description:'A fixed feeding trough.',ownerId:'pasture',quantity:1,equipped:false,isContainer:true},
   {id:'cows',name:'Dairy cows',description:'The twelve cows in the north pasture.',ownerId:'pasture',quantity:12,equipped:false},
   {id:'paint',name:'Red Paint Tin',description:'Fence maintenance paint.',ownerId:'shed',quantity:1,equipped:false},
   {id:'toolbox',name:'Workshop Toolbox',description:'A closed box of tools.',ownerId:'yard',quantity:1,equipped:false,isContainer:true},
   {id:'spanner',name:'Metric Spanner',description:'An unrelated maintenance tool.',ownerId:'toolbox',quantity:1,equipped:false},
   {id:'secret-bin',name:'Concealed Seed Bin',description:'A secret seed stock.',ownerId:'vault',quantity:1,equipped:false,isContainer:true}],relationships:[],threads:[],funds:0,cargoNotes:''};
 story.context=emptyContext();story.factPins=emptyFactPins();story.summaryCache=[];story.recap=null;
 if(routine)story.context.lore.push({id:'feeding-routine',title:'Morning feeding',text:'For feeding the cows, Alex normally loads Cattle pellets from the Feed Shed into the Loader Tractor, drives to North Pasture and unloads into the Long Trough. This describes a routine, not an event completed today.',keywords:['feed','cows','feeding'],relatedIds:['feedstock','tractor','trough','shed','pasture'],visibility:'relevant'});
 story.passages=[{id:'morning-1',title:'Morning',chapter:1,chapterTitle:'The morning round',viewpoint:'Alex Morrow',viewpointId:'alex',paragraphs:['Alex stood on the farmhouse porch and studied the clear morning sky. The yard was quiet.'],direction:'',endOfChapter:false,createdAt:now}];
 story.recovery={passageId:'morning-1',canon:structuredClone(story.canon),valid:true};
 return validateStory(story);
}

export const loading='Alex loaded ten portions of cattle pellets from the Feed Shed into the Loader Tractor.';
export const travelling='Alex drove the Loader Tractor from the Equipment Yard to North Pasture.';
export const unloading='Alex poured all ten loaded portions of cattle pellets into the Long Trough. The cows ate four portions. Six portions remained in the trough.';
export const quietDetail='The morning air was cool beneath a clear sky. Alex watched the herd crowd around the rail and checked the space beside the gate. There was no reason to hurry. The animals settled into a steady rhythm while the light strengthened across the field, and the farmhouse remained visible beyond the track. Ben was still working at the distant fence.';
export function ranchEffects():StoryEffect[] {return [
 {type:'item.split',ref:'new-load',itemId:'feedstock',expectedQuantity:100,quantity:10,ownerId:'tractor',evidence:loading},
 {type:'item.transfer',itemId:'tractor',fromOwnerId:'yard',toOwnerId:'pasture',evidence:travelling},
 {type:'character.move',characterId:'alex',locationId:'pasture',evidence:travelling},
 {type:'item.transfer',itemId:'new-load',fromOwnerId:'tractor',toOwnerId:'trough',evidence:unloading},
 {type:'item.quantity',itemId:'new-load',expectedQuantity:10,quantity:6,evidence:unloading}
];}

/** Occupied vehicles are places; storage bins are components, not duplicate vehicles. */
export function ranchVehicleFixture():Story {
 const story=ranchFixture();story.title='The morning feed — tractor cab';
 story.canon.items=story.canon.items.filter(i=>i.id!=='tractor');
 story.canon.places.push({id:'tractor',name:'Loader Tractor',description:'A working tractor with a cab and a feed bin.',parentId:'yard'},{id:'tractor-cab',name:'Tractor Cab',description:'The driver seat and controls inside the Loader Tractor.',parentId:'tractor'});
 story.canon.items.push({id:'feed-bin',name:'Tractor Feed Bin',description:'The loader bin used to carry cattle pellets.',ownerId:'tractor',quantity:1,equipped:false,isContainer:true});
 story.canon.characters.find(c=>c.id==='alex')!.locationId='tractor-cab';
 story.context.lore[0].relatedIds.push('feed-bin');
 story.context.lore[0].text='For feeding the cows, Alex normally loads Cattle pellets from the Feed Shed into the Tractor Feed Bin, drives the Loader Tractor to North Pasture and unloads into the Long Trough. The Tractor Cab moves with the tractor. This describes a routine, not an event completed today.';
 story.passages[0].paragraphs=['Alex waited inside the Tractor Cab of the Loader Tractor in the Equipment Yard. The feed bin was empty.'];
 story.recovery!.canon=structuredClone(story.canon);return validateStory(story);
}
