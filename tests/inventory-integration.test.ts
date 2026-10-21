import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { StoryRepository, type Mutation } from '../src/lib/server/repository';
import { createSample, sampleContinuationProposal, sampleReplacementProposal } from '../src/lib/server/fixture';
import { itemRootOwnerId } from '../src/lib/inventory';
import { buildStoryContext } from '../src/lib/server/context-builder';
import { assertFactPinsUnchanged, resolvedFactPins } from '../src/lib/fact-pins';
import { applyStoryEffects } from '../src/lib/story-effects';
import { applyCorrectionOperations } from '../src/lib/server/record-editing';
import { prepareCorrectionResult } from '../src/lib/server/story-corrections';
import { normalizeSetup } from '../src/lib/server/story-generation';

const request=(expectedRevision:number,action:Mutation['action']):Mutation=>({expectedRevision,requestId:randomUUID(),action});
function inventoryStory(){
  const story=createSample();story.canon.items.push(
    {id:'pack',name:'Canvas pack',description:'An old canvas pack.',quantity:1,ownerId:'elias',equipped:true,isContainer:true},
    {id:'pouch',name:'Drawstring pouch',description:'An inner pouch.',quantity:1,ownerId:'pack',equipped:false,isContainer:true},
    {id:'cells',name:'Power cells',description:'Standard sealed power cells.',quantity:10,ownerId:'pouch',equipped:false}
  );story.recovery!.canon=structuredClone(story.canon);return story;
}
async function importInventory(repository:StoryRepository){
  const {zipSync,strToU8}=await import('fflate');
  return repository.import(zipSync({'manifest.json':strToU8(JSON.stringify({format:'guided-story-dev-1',media:[]})),'story.json':strToU8(JSON.stringify(inventoryStory()))}));
}

test('manual splits conserve quantities, replay safely, reject stale/invalid requests and survive archives',async()=>{
  const repository=new StoryRepository(':memory:');
  try{
    const original=await importInventory(repository),epoch=original.context.compaction.epoch;
    const input=request(original.revision,{type:'item-split',itemId:'cells',quantity:3,ownerId:'mira'}),saved=repository.mutate(original.id,input);
    const created=saved.canon.items.find(item=>!original.canon.items.some(before=>before.id===item.id))!;
    assert.match(created.id,/^[a-f\d-]{36}$/i);assert.equal(created.name,'Power cells');assert.equal(created.description,'Standard sealed power cells.');
    assert.equal(created.ownerId,'mira');assert.equal(created.equipped,false);assert.equal(created.quantity,3);
    assert.equal(saved.canon.items.find(item=>item.id==='cells')!.quantity,7);assert.equal(saved.canon.items.filter(item=>item.name==='Power cells').reduce((sum,item)=>sum+item.quantity,0),10);
    assert.deepEqual(saved.passages,original.passages);assert.equal(saved.recovery!.valid,false);assert.equal(saved.context.compaction.epoch,epoch+1);
    assert.deepEqual(repository.mutate(saved.id,input),saved);
    assert.throws(()=>repository.mutate(saved.id,request(original.revision,{type:'item-split',itemId:'cells',quantity:1,ownerId:'mira'})),/changed in another tab/);
    for(const [quantity,ownerId]of [[7,'mira'],[1,'missing']] as const){assert.throws(()=>repository.mutate(saved.id,request(saved.revision,{type:'item-split',itemId:'cells',quantity,ownerId})));assert.deepEqual(repository.read(saved.id),saved);}
    const copy=await repository.import(repository.export(saved.id));assert.deepEqual(copy.canon,saved.canon);assert.equal(itemRootOwnerId(copy.canon,'cells'),'elias');
  }finally{repository.close();}
});

test('manual container edits and removal keep nested inventories intact and reject broken graphs atomically',async()=>{
  const repository=new StoryRepository(':memory:');
  try{
    const original=await importInventory(repository),pack=original.canon.items.find(item=>item.id==='pack')!;
    assert.throws(()=>repository.mutate(original.id,request(original.revision,{type:'record-remove',kind:'item',id:'pack'})),/contents elsewhere/);
    assert.throws(()=>repository.mutate(original.id,request(original.revision,{type:'record-save',edit:{kind:'item',value:{...pack,isContainer:false}}})),/container/);
    assert.throws(()=>repository.mutate(original.id,request(original.revision,{type:'transfer',itemId:'pack',ownerId:'pouch'})),/contain/);
    assert.deepEqual(repository.read(original.id),original);
    const moved=repository.mutate(original.id,request(original.revision,{type:'transfer',itemId:'pack',ownerId:'mira'}));
    assert.equal(itemRootOwnerId(moved.canon,'cells'),'mira');assert.equal(moved.canon.items.find(item=>item.id==='cells')!.ownerId,'pouch');
    assert.deepEqual(moved.canon.items.filter(item=>item.id!=='pack'),original.canon.items.filter(item=>item.id!=='pack'));
  }finally{repository.close();}
});

test('evidenced generated splits commit with prose and latest replacement restores the original stack',async()=>{
  const repository=new StoryRepository(':memory:');
  try{
    const original=await importInventory(repository),proposal=sampleContinuationProposal('Give Mira three cells.');
    const quote='Elias took three power cells from the pouch and gave them to Mira.';
    proposal.draft.paragraphs=[quote];proposal.effects=[{type:'item.split',ref:'new-mira-cells',itemId:'cells',expectedQuantity:10,quantity:3,ownerId:'mira',evidence:quote}];
    const saved=repository.commitGeneratedPassage(original.id,{expectedRevision:original.revision,requestId:randomUUID(),proposal});
    const assigned=saved.passages.at(-1)!.generation!.assignedIds['new-mira-cells'];assert.ok(assigned);assert.equal(saved.canon.items.find(item=>item.id===assigned)!.quantity,3);
    assert.equal(saved.canon.items.find(item=>item.id==='cells')!.quantity,7);
    const replaced=repository.commitGeneratedPassage(saved.id,{expectedRevision:saved.revision,requestId:randomUUID(),proposal:sampleReplacementProposal(saved,saved.passages.at(-1)!.id)});
    assert.equal(replaced.canon.items.find(item=>item.id==='cells')!.quantity,10);assert.equal(replaced.canon.items.some(item=>item.id===assigned),false);
    assert.equal(itemRootOwnerId(replaced.canon,'cells'),'elias');
  }finally{repository.close();}
});

test('ultimate-owner pins protect nested contents when their container moves; container flags have effective false defaults',()=>{
  const story=inventoryStory(),quote='Elias handed the canvas pack and its contents to Mira.';
  story.factPins.fields=[{kind:'item',recordId:'cells',field:'rootOwnerId'}];
  assert.equal(resolvedFactPins(story).fields[0].value,'elias');
  const moved=applyStoryEffects(story.canon,[{type:'item.transfer',itemId:'pack',fromOwnerId:'elias',toOwnerId:'mira',evidence:quote}],quote).canon;
  assert.throws(()=>assertFactPinsUnchanged(story,moved),/ultimate owner/);
  assert.throws(()=>applyCorrectionOperations(story,[{type:'record',create:false,edit:{kind:'item',value:{...story.canon.items.find(item=>item.id==='pack')!,ownerId:'mira',equipped:false}}}]),/ultimate owner/);
  story.factPins.fields=[{kind:'item',recordId:'cells',field:'ownerId'}];assert.doesNotThrow(()=>assertFactPinsUnchanged(story,moved));
  story.factPins.fields=[{kind:'item',recordId:'cells',field:'isContainer'}];assert.equal(resolvedFactPins(story).fields[0].value,false);
  const converted=structuredClone(story.canon);Object.assign(converted.items.find(item=>item.id==='cells')!,{quantity:1,isContainer:true});assert.throws(()=>assertFactPinsUnchanged(story,converted),/Pinned container/);
});

test('story questions retrieve remotely stored items with their full ownership path',()=>{
  const story=inventoryStory();story.canon.items.find(item=>item.id==='pack')!.ownerId='glass';
  const report=buildStoryContext(story,'Who holds the power cells?',16384,1536,undefined,undefined,{purpose:'ask'});
  assert.equal(report.runnable,true);assert.equal(report.sources.find(source=>source.id==='cells')!.required,true);
  const text=report.messages.map(message=>message.content).join('\n');assert.ok(text.includes('The Glass Belt › Canvas pack › Drawstring pouch'));assert.ok(text.includes('"rootOwnerId":"glass"'));
});

test('AI item edits preserve existing container status when an optional field is omitted',()=>{
  const story=inventoryStory(),pack=story.canon.items.find(item=>item.id==='pack')!,{isContainer:_,...withoutFlag}=pack;
  const input={kind:'record' as const,recordKind:'item' as const,mode:'revise' as const,targetId:pack.id,expectedRevision:story.revision,requestId:randomUUID(),passageId:story.passages.at(-1)!.id,direction:'Record its faded insignia.'};
  const result=prepareCorrectionResult(story,input,{explanation:'Record the insignia.',edits:[{kind:'item',value:{...withoutFlag,description:'A faded insignia marks the canvas pack.'}}],world:null});
  const saved=applyCorrectionOperations(story,result.operations);assert.equal(saved.canon.items.find(item=>item.id==='pack')!.isContainer,true);assert.equal(itemRootOwnerId(saved.canon,'cells'),'elias');
});

test('AI ordinary-item name rerolls treat an explicit false container flag as the existing default',()=>{
  const story=inventoryStory(),cells=story.canon.items.find(item=>item.id==='cells')!,before=structuredClone(story);
  assert.equal(Object.hasOwn(cells,'isContainer'),false);
  const input={kind:'record' as const,recordKind:'item' as const,mode:'name' as const,targetId:cells.id,expectedRevision:story.revision,requestId:randomUUID(),passageId:story.passages.at(-1)!.id,direction:'Choose a more specific name.'};
  const raw={explanation:'Use the battery model name.',edits:[{kind:'item',value:{...cells,name:'Aster power cells',isContainer:false}}],world:null},originalRaw=structuredClone(raw);
  const result=prepareCorrectionResult(story,input,raw),operation=result.operations[0];
  assert.deepEqual(result.changes.map(change=>change.field),['name']);
  assert.equal(operation.type,'record');
  if(operation.type==='record')assert.equal(Object.hasOwn(operation.edit.value,'isContainer'),false);
  const saved=applyCorrectionOperations(story,result.operations);
  assert.deepEqual(saved.canon.items.find(item=>item.id===cells.id),{...cells,name:'Aster power cells'});
  assert.deepEqual(story,before);assert.deepEqual(raw,originalRaw);
});

test('an AI false-only default container flag does not offer a no-op correction',()=>{
  const story=inventoryStory(),cells=story.canon.items.find(item=>item.id==='cells')!,before=structuredClone(story);
  const input={kind:'record' as const,recordKind:'item' as const,mode:'revise' as const,targetId:cells.id,expectedRevision:story.revision,requestId:randomUUID(),passageId:story.passages.at(-1)!.id,direction:'Check the item details.'};
  const raw={explanation:'The item remains an ordinary possession.',edits:[{kind:'item',value:{...cells,isContainer:false}}],world:null},originalRaw=structuredClone(raw);
  assert.throws(()=>prepareCorrectionResult(story,input,raw),/proposed no record changes/);
  assert.deepEqual(story,before);assert.deepEqual(raw,originalRaw);
});

test('generated setup container refs survive setup portability and approved opening publication',()=>{
  const repository=new StoryRepository(':memory:');
  try{
    const draft=repository.createSetup({premise:'A courier takes a bag of supplies to a remote port.',castSize:1},randomUUID()),person=createSample().canon.characters[0];
    const plan=normalizeSetup({title:'The courier',chapterTitle:'Departure',worldNotes:'A quiet working port.',funds:10,cargoNotes:'',
      places:[{ref:'port',name:'Port',description:'A working port.',parentRef:null}],
      characters:[{ref:'courier',name:'Ari',role:'Courier',notes:'',visual:person.visual,persona:person.persona,wardrobe:person.wardrobe,injuries:'',appearanceNotes:'',outfitNotes:'',locationRef:'port'}],
      items:[{ref:'bag',name:'Courier bag',description:'A canvas bag.',quantity:1,ownerRef:'courier',equipped:true,isContainer:true},{ref:'pouch',name:'Inner pouch',description:'A supply pouch.',quantity:1,ownerRef:'bag',equipped:false,isContainer:true},{ref:'cells',name:'Power cells',description:'Standard power cells.',quantity:10,ownerRef:'pouch',equipped:false}],
      relationships:[],threads:[],opening:{viewpointRef:'courier',locationRef:'port',castRefs:['courier'],purpose:'Begin the delivery.',tension:'A distant deadline.',stopAt:'Leaving the port.'}},draft);
    const saved=repository.saveSetup(draft.id,{expectedRevision:0,requestId:randomUUID(),input:draft.input,plan}),imported=repository.importSetup(repository.exportSetup(saved.id));
    const canon=imported.plan!.canon,cells=canon.items.find(item=>item.name==='Power cells')!,courier=canon.characters[0];assert.equal(itemRootOwnerId(canon,cells.id),courier.id);
    const published=repository.commitOpening(imported.id,imported.revision,randomUUID(),'inventory-opening',{mode:'continue',direction:'',draft:{title:'At the dock',chapterTitle:plan.chapterTitle,startsChapter:true,endOfChapter:false,viewpointId:courier.id,paragraphs:['Ari shouldered the courier bag and walked toward the waiting launch.']},effects:[]});
    assert.deepEqual(published.canon,canon);assert.equal(itemRootOwnerId(published.canon,cells.id),courier.id);assert.equal(published.canon.characters[0].noNsfw,true);
  }finally{repository.close();}
});
