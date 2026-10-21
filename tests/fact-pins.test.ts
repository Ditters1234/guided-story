import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { factPinsSchema, resolvedFactPins, validateFactPins, assertFactPinsUnchanged, factPinFields, type FactPins } from '../src/lib/fact-pins';
import { validateStory } from '../src/lib/story';
import { createSample } from '../src/lib/server/fixture';
import { StoryRepository, type Mutation } from '../src/lib/server/repository';
import { buildStoryContext } from '../src/lib/server/context-builder';

const request=(expectedRevision:number,action:Mutation['action']):Mutation=>({expectedRevision,requestId:randomUUID(),action});
const example=():FactPins=>({fields:[{kind:'character',recordId:'elias',field:'visual.eyes'},{kind:'relationship',recordId:'crew-trust',field:'notes'}],rules:[{id:randomUUID(),text:'Travel between star systems takes at least a week.'}]});

test('fact pins validate allowlisted paths, matching target kinds, uniqueness and nonblank rules',()=>{
  const story=createSample();story.factPins=example();assert.doesNotThrow(()=>validateStory(story));
  for(const field of ['__proto__','visual','appearance','noNsfw','visual.unlisted'])assert.equal(factPinsSchema.safeParse({fields:[{kind:'character',recordId:'elias',field}],rules:[]}).success,false);
  assert.equal(factPinsSchema.safeParse({fields:[{kind:'world',recordId:'elias',field:'funds'}],rules:[]}).success,false);
  assert.equal(factPinsSchema.safeParse({fields:[{kind:'item',recordId:null,field:'quantity'}],rules:[]}).success,false);
  assert.equal(factPinsSchema.safeParse({...example(),fields:[example().fields[0],example().fields[0]]}).success,false);
  const rule={id:'one',text:'A rule'};
  assert.equal(factPinsSchema.safeParse({fields:[],rules:[rule,rule]}).success,false);
  assert.equal(factPinsSchema.safeParse({fields:[],rules:[{...rule,text:'  '}]}).success,false);
  story.factPins.fields[0].recordId='missing';assert.throws(()=>validateStory(story),/missing record or field/);
});

test('all selectable fields resolve; leaf pins allow other changes and reject deleting their target',()=>{
  const story=createSample();
  const targets={character:'elias',place:'bridge',item:'tool',relationship:'crew-trust',thread:'container',world:null};
  for(const [kind,choices] of Object.entries(factPinFields))for(const {field} of choices){
    story.factPins.fields=[{kind:kind as keyof typeof targets,recordId:targets[kind as keyof typeof targets],field}];
    assert.doesNotThrow(()=>validateFactPins(story));assert.notEqual(resolvedFactPins(story).fields[0].value,undefined);
  }
  story.factPins=example();const after=structuredClone(story.canon);
  after.characters[0].visual!.hair='Silver hair';assert.doesNotThrow(()=>assertFactPinsUnchanged(story,after));
  after.characters[0].visual!.eyes='Newly invented eyes';assert.throws(()=>assertFactPinsUnchanged(story,after),/Pinned eyes for Elias/);
  after.characters.shift();assert.throws(()=>assertFactPinsUnchanged(story,after),/Pinned eyes/);
});

test('pin saves are transactional and idempotent; manual values remain editable and deleted records detach pins',()=>{
  const repository=new StoryRepository(':memory:');
  try{
    const original=repository.create(),input=request(0,{type:'fact-pins',factPins:example()});
    const saved=repository.mutate(original.id,input);assert.equal(saved.recovery?.valid,original.recovery?.valid);
    assert.deepEqual(repository.mutate(original.id,input),saved);
    assert.throws(()=>repository.mutate(saved.id,request(0,{type:'fact-pins',factPins:{fields:[],rules:[]}})),/changed in another tab/);
    assert.throws(()=>repository.mutate(saved.id,request(saved.revision,{type:'fact-pins',factPins:{fields:[{kind:'item',recordId:'absent',field:'name'}],rules:[]}})),/missing record or field/);
    assert.equal(repository.read(saved.id).revision,saved.revision);
    const character={...saved.canon.characters[0],visual:{...saved.canon.characters[0].visual!,eyes:'Amber'}};
    const edited=repository.mutate(saved.id,request(saved.revision,{type:'character',character}));
    assert.equal(resolvedFactPins(edited).fields[0].value,'Amber');assert.equal(edited.recovery!.valid,false);
    const pinnedItem=repository.mutate(edited.id,request(edited.revision,{type:'fact-pins',factPins:{...edited.factPins,fields:[...edited.factPins.fields,{kind:'item',recordId:'fob',field:'quantity'}]}}));
    const removed=repository.mutate(edited.id,request(pinnedItem.revision,{type:'record-remove',kind:'item',id:'fob'}));
    assert.equal(removed.factPins.fields.some(pin=>pin.recordId==='fob'),false);assert.equal(removed.factPins.rules.length,1);
  }finally{repository.close();}
});

test('pin configuration and world rules survive portable story archives',async()=>{
  const repository=new StoryRepository(':memory:');
  try{
    const story=repository.create(),saved=repository.mutate(story.id,request(0,{type:'fact-pins',factPins:example()}));
    const imported=await repository.import(repository.export(saved.id));
    assert.notEqual(imported.id,saved.id);assert.deepEqual(imported.factPins,saved.factPins);
    assert.equal(resolvedFactPins(imported).fields[0].recordLabel,'Elias Voss');
  }finally{repository.close();}
});

test('all pins are mandatory narrator/Ask context, including off-scene facts; excessive pins block generation',()=>{
  const story=createSample();
  story.canon.characters.push({...structuredClone(story.canon.characters[0]),id:'distant',name:'A distant archivist',locationId:'glass',notes:'Only the archivist holds the key.'});
  story.factPins={fields:[{kind:'character',recordId:'distant',field:'notes'}],rules:example().rules};
  for(const task of [{},{purpose:'ask' as const}]){
    const report=buildStoryContext(story,'Continue at the ship.',16384,1536,undefined,undefined,task);
    assert.equal(report.runnable,true);assert.equal(report.sources.find(s=>s.id==='fact-pins')?.required,true);
    assert.equal(report.sources.find(s=>s.id==='fact-pins')?.included,true);
    assert.ok(report.messages.some(m=>m.content.includes('Only the archivist holds the key.')));
    assert.ok(report.messages.some(m=>m.content.includes('at least a week')));
  }
  story.canon.characters.at(-1)!.notes='A'.repeat(30000);
  const report=buildStoryContext(story,'',8192,1536);
  assert.equal(report.runnable,false);assert.equal(report.sources.find(s=>s.id==='fact-pins')?.included,false);
  assert.ok(report.warnings.some(w=>w.includes('pinned details do not fit')));
});
