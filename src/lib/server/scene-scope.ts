import {sceneBriefResourceIds,type Story} from '../story';
import {resolvedFactPins} from '../fact-pins';
import {storyViewpoint,resolveCharacterReference,mentionedCharacters,mentionedItems,hasEntityPhrase} from '../entity-scope';
import {itemRootOwnerId} from '../inventory';
import {activityScope} from './activity-scope';

/** Explicit reviewed resources survive generic prose briefs. Follow task/background
 * references once, without expanding a container's contents or activating people. */
function preparedResourceScope(story:Story,asking:boolean) {
 const allowed=sceneBriefResourceIds(story),ids=new Set(asking?[]:(story.context.sceneBrief.resourceIds||[]).filter(id=>allowed.has(id)));
 const records=[...story.canon.characters,...story.canon.places,...story.canon.items];
 const sources=[...story.canon.threads.filter(row=>ids.has(row.id)).map(row=>({text:row.notes,relatedIds:[] as string[]})),
  ...story.canon.relationships.filter(row=>ids.has(row.id)).map(row=>({text:row.notes,relatedIds:[row.fromId,row.toId]})),
  ...story.context.lore.filter(row=>row.visibility!=='hidden'&&ids.has(row.id)).map(row=>({text:row.text,relatedIds:row.relatedIds}))];
 let added=0,clipped=false;
 for(const source of sources){
  const references=new Set([...source.relatedIds,...mentionedCharacters(story.canon.characters,source.text),...records.filter(row=>hasEntityPhrase(source.text,row.name)||hasEntityPhrase(source.text,row.id)).map(row=>row.id)]);
  for(const id of references)if(allowed.has(id)&&!ids.has(id)){if(added===16){clipped=true;continue;}ids.add(id);added++;}
 }
 return {ids,clipped};
}

/** Shared selection for openings and continuations. Mentions are references, not
 * physical participants; storage selection follows ancestors, never contents. */
export function sceneScope(story:Story,searchText:string,direction:string,pins=resolvedFactPins(story),asking=false,placeMatch=(text:string,name:string)=>hasEntityPhrase(text,name)) {
 const brief=asking?{viewpointId:null,locationId:null,castIds:[] as string[]}:story.context.sceneBrief,last=story.passages.at(-1);
 const resources=preparedResourceScope(story,asking),resourceIds=resources.ids;
 const pov=asking?(last?.viewpointId?story.canon.characters.find(c=>c.id===last.viewpointId)?.id:resolveCharacterReference(story.canon.characters,last?.viewpoint||'')?.id):storyViewpoint(story).id;
 const locationId=brief.locationId||story.canon.characters.find(c=>c.id===pov)?.locationId;
 const castIds=new Set(brief.castIds.length?brief.castIds:story.canon.characters.filter(c=>c.locationId===locationId).map(c=>c.id));
 if(pov)castIds.add(pov);
 const referenceIds=new Set(mentionedCharacters(story.canon.characters,searchText));
 for(const person of story.canon.characters)if(resourceIds.has(person.id))referenceIds.add(person.id);
 if(asking)for(const id of referenceIds)castIds.add(id);
 const pinnedItems=new Set(pins.fields.filter(pin=>pin.kind==='item').map(pin=>pin.recordId!));
 const placeIds=new Set<string>();
 function addPlace(id:string|null|undefined){while(id&&!placeIds.has(id)){placeIds.add(id);id=story.canon.places.find(p=>p.id===id)?.parentId;}}
 addPlace(locationId);
 for(const place of story.canon.places)if(resourceIds.has(place.id))addPlace(place.id);
 for(const person of story.canon.characters)if(resourceIds.has(person.id))addPlace(person.locationId);
 for(const place of story.canon.places)if(placeMatch(direction,place.name))addPlace(place.id);
 const mentioned=new Set(mentionedItems(story.canon.items,searchText)),nouns=new Map<string,number>();
 for(const item of story.canon.items)if(mentioned.has(item.id)){const noun=item.name.toLocaleLowerCase().split(/\s+/).at(-1)!;nouns.set(noun,(nouns.get(noun)||0)+1);}
 const itemIds=new Set(story.canon.items.filter(item=>{
  const root=itemRootOwnerId(story.canon,item.id);
  const explicit=mentioned.has(item.id)&&(hasEntityPhrase(searchText,item.name)||nouns.get(item.name.toLocaleLowerCase().split(/\s+/).at(-1)!)===1||Boolean(root&&castIds.has(root)));
  return resourceIds.has(item.id)||pinnedItems.has(item.id)||explicit||(item.equipped&&castIds.has(item.ownerId))||item.ownerId===locationId;
 }).map(item=>item.id));
 const visibleRecords=[...story.canon.items.filter(i=>itemIds.has(i.id)).map(i=>({id:i.id,kind:'item' as const,name:i.name,text:i.description})),...story.canon.places.filter(p=>p.id===locationId||placeMatch(direction,p.name)).map(p=>({id:p.id,kind:'place' as const,name:p.name,text:p.description}))];
 const activity=asking?{ids:new Set<string>(),sources:[],clipped:false}:activityScope(story,direction+'\n'+story.context.sceneBrief.purpose,pov,visibleRecords);
 for(const person of story.canon.characters)if(activity.ids.has(person.id))referenceIds.add(person.id);
 for(const place of story.canon.places)if(activity.ids.has(place.id))addPlace(place.id);
 for(const item of story.canon.items)if(activity.ids.has(item.id))itemIds.add(item.id);
 for(const id of [...itemIds]){let item=story.canon.items.find(i=>i.id===id);const seen=new Set<string>();while(item&&!seen.has(item.id)){seen.add(item.id);const parent=story.canon.items.find(i=>i.id===item!.ownerId);if(!parent)break;itemIds.add(parent.id);item=parent;}}
 const selectedItems=story.canon.items.filter(item=>itemIds.has(item.id));
 for(const item of selectedItems){const root=itemRootOwnerId(story.canon,item.id);if(root&&story.canon.places.some(place=>place.id===root))addPlace(root);
  if(resourceIds.has(item.id)&&root){const owner=story.canon.characters.find(person=>person.id===root);if(owner){referenceIds.add(root);addPlace(owner.locationId);}}
 }
 return {pov,locationId,castIds,referenceIds,pinnedItems,placeIds,itemIds,selectedItems,activity,resourceIds,resourcesClipped:resources.clipped};
}

export function openingContext(story:Story,direction:string,factPins=resolvedFactPins(story)) {
 const brief=story.context.sceneBrief,search=[direction,brief.purpose,brief.tension,brief.stopAt].join('\n');
 const scope=sceneScope(story,search,direction,factPins);
 const {castIds,referenceIds,placeIds,itemIds}=scope;
 return {scope,referencedCharacters:story.canon.characters.filter(c=>referenceIds.has(c.id)&&!castIds.has(c.id)).map(c=>({id:c.id,name:c.name,role:c.role,locationId:c.locationId,noNsfw:c.noNsfw,referencedOnly:true})),
  lore:story.context.lore.filter(l=>l.visibility!=='hidden'&&(scope.resourceIds.has(l.id)||l.visibility==='always'||scope.activity.sources.some(source=>source.kind==='lore'&&source.id===l.id)||l.relatedIds.some(id=>castIds.has(id)||placeIds.has(id)||itemIds.has(id))||[l.title,...l.keywords].some(keyword=>hasEntityPhrase(search,keyword))))};
}
