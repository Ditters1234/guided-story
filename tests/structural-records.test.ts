import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { characterSchema, canonSchema, type Story } from '../src/lib/story';
import { createSample } from '../src/lib/server/fixture';
import { applyStoryEffects } from '../src/lib/story-effects';
import { splitItemStack } from '../src/lib/inventory';
import { StoryRepository, type Mutation } from '../src/lib/server/repository';
import { prepareCorrectionResult } from '../src/lib/server/story-corrections';
import { applyCorrectionOperations } from '../src/lib/server/record-editing';
import { assertFactPinsUnchanged, validateFactPins } from '../src/lib/fact-pins';

const command=(story:Story,action:Mutation['action']):Mutation=>({expectedRevision:story.revision,requestId:randomUUID(),action});

test('current feelings and intentions stay separate from identity and support legacy profiles',()=>{
  const person=createSample().canon.characters[0];
  const {currentState:_state,...legacy}=person;
  assert.equal(characterSchema.parse(legacy).currentState,'');
  const saved=characterSchema.parse({...person,currentState:'Worried about the delay; intends to speak to the crew.'});
  assert.deepEqual(saved.persona,person.persona);
  assert.equal(saved.appearance,person.appearance);
  assert.equal(saved.outfit,person.outfit);
  assert.deepEqual(characterSchema.parse(saved),saved);
  assert.throws(()=>characterSchema.parse({...saved,currentState:'x'.repeat(4001)}));
});

test('evidenced sparse updates preserve lasting persona and independent visual descriptions',()=>{
  const story=createSample(),person=story.canon.characters[0],place=story.canon.places[0],item=story.canon.items[0];
  person.currentState='Concerned about the journey.';
  place.visualDescription='A circular platform with copper rails.';
  item.visualDescription='A small steel case with a blue stripe.';
  const evidence='The captain relaxed and decided to wait.';
  const result=applyStoryEffects(story.canon,[
    {type:'character.update',characterId:person.id,currentState:'Relaxed; intends to wait.',evidence},
    {type:'place.update',placeId:place.id,description:'A meeting point for crews.',evidence},
    {type:'item.update',itemId:item.id,description:'The crew’s shared equipment.',evidence}
  ],evidence);
  assert.equal(result.canon.characters[0].currentState,'Relaxed; intends to wait.');
  assert.deepEqual(result.canon.characters[0].persona,person.persona);
  assert.equal(result.canon.places[0].visualDescription,place.visualDescription);
  assert.equal(result.canon.items[0].visualDescription,item.visualDescription);
  assert.equal(person.currentState,'Concerned about the journey.');
  assert.throws(()=>applyStoryEffects(story.canon,[{type:'character.update',characterId:person.id,currentState:'Calm',evidence:'This sentence never appeared.'}],evidence),/evidence/);
  const cleared=applyStoryEffects(result.canon,[{type:'character.update',characterId:person.id,currentState:'',evidence},{type:'item.update',itemId:item.id,visualDescription:'',evidence}],evidence).canon;
  assert.equal(cleared.characters[0].currentState,'');assert.equal(cleared.items[0].visualDescription,'');
});

test('manual and narrated splits retain the same reusable object design',()=>{
  const manual=createSample().canon,source=manual.items[0];
  source.quantity=5;source.visualDescription='Opaque green glass with a silver seal.';
  const id=splitItemStack(manual,source.id,2,manual.characters[0].id,()=>'split-manual');
  assert.equal(manual.items.find(item=>item.id===id)!.visualDescription,source.visualDescription);
  const evidence='Two supplies were passed to the captain.';
  const narrated=applyStoryEffects(manual,[{type:'item.split',ref:'new-stack',itemId:source.id,expectedQuantity:3,quantity:1,ownerId:manual.characters[0].id,evidence}],evidence,()=>'split-narrated').canon;
  assert.equal(narrated.items.find(item=>item.id==='split-narrated')!.visualDescription,source.visualDescription);
});

test('record edits and portable archives preserve current state and reusable place/object visuals',async()=>{
  const repository=new StoryRepository(':memory:');
  try{
    let story=repository.create();
    story=repository.mutate(story.id,command(story,{type:'record-save',edit:{kind:'character',value:{...story.canon.characters[0],currentState:'Alert; wants to find the missing key.'}}}));
    story=repository.mutate(story.id,command(story,{type:'record-save',edit:{kind:'place',value:{...story.canon.places[0],visualDescription:'White stone archways around a green tiled floor.'}}}));
    story=repository.mutate(story.id,command(story,{type:'record-save',edit:{kind:'item',value:{...story.canon.items[0],visualDescription:'A brass cylinder with an ivory dial.'}}}));
    assert.deepEqual(repository.read(story.id).canon,story.canon);
    assert.deepEqual((await repository.import(repository.export(story.id))).canon,story.canon);
    assert.equal(story.recovery?.valid,false);
  }finally{repository.close();}
});

test('AI corrections preserve omitted optional state/design fields while allowing explicit clearing',()=>{
  const story=createSample();
  story.canon.characters[0].currentState='Suspicious; intends to question the pilot.';
  story.canon.places[0].visualDescription='Narrow balconies and blue painted doors.';
  story.canon.items[0].visualDescription='A dented metal trunk with a red handle.';
  const person={...story.canon.characters[0]} as Record<string,unknown>;
  for(const key of ['appearance','outfit','noNsfw','pinnedAppearance','currentState'])delete person[key];
  const {visualDescription:_placeVisual,...place}=story.canon.places[0];
  const {visualDescription:_itemVisual,...item}=story.canon.items[0];
  const request={kind:'repair' as const,expectedRevision:story.revision,requestId:randomUUID(),passageId:story.passages[0].id,direction:'Correct these notes.'};
  const result=prepareCorrectionResult(story,request,{explanation:'Correct the notes while retaining saved state and design.',world:null,edits:[
    {kind:'character',value:{...person,notes:'Updated character note.'}},
    {kind:'place',value:{...place,description:'Updated place note.'}},
    {kind:'item',value:{...item,description:'Updated item note.'}}
  ]});
  const next=applyCorrectionOperations(story,result.operations);
  assert.equal(next.canon.characters[0].currentState,story.canon.characters[0].currentState);
  assert.equal(next.canon.places[0].visualDescription,story.canon.places[0].visualDescription);
  assert.equal(next.canon.items[0].visualDescription,story.canon.items[0].visualDescription);
  assert.ok(!result.changes.some(change=>['currentState','visualDescription'].includes(change.field)));
  const cleared=prepareCorrectionResult(next,{...request,expectedRevision:next.revision},{explanation:'Clear the current feelings and visual note.',world:null,edits:[{kind:'character',value:{...person,currentState:''}},{kind:'item',value:{...item,visualDescription:''}}]});
  const after=applyCorrectionOperations(next,cleared.operations);
  assert.equal(after.canon.characters[0].currentState,'');assert.equal(after.canon.items[0].visualDescription,'');
});

test('optional state and design fields can be pinned even when empty on older records',()=>{
  const story=createSample();
  story.factPins.fields=[{kind:'character',recordId:story.canon.characters[0].id,field:'currentState'},{kind:'place',recordId:story.canon.places[0].id,field:'visualDescription'}];
  validateFactPins(story);
  const after=canonSchema.parse(story.canon);after.places[0].visualDescription='A newly imagined red tower.';
  assert.throws(()=>assertFactPinsUnchanged(story,after),/Pinned visual description/);
});
