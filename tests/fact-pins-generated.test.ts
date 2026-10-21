import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createSample, sampleContinuationProposal, sampleReplacementProposal } from '../src/lib/server/fixture';
import { preparePassageCommit } from '../src/lib/server/passage-commit';
import { applyCorrectionOperations } from '../src/lib/server/record-editing';
import { generateCorrectionResult } from '../src/lib/server/story-corrections';
import { connectionSchema } from '../src/lib/server/connections';
import { generatePassage } from '../src/lib/server/story-generation';
import { resolvedFactPins } from '../src/lib/fact-pins';
import type { Story } from '../src/lib/story';

const settings=()=>connectionSchema.parse({...JSON.parse(readFileSync('config/connections.example.json','utf8')),text:{baseUrl:'http://localhost:9999/v1',model:'test-model',maxTokens:4096,contextTokens:100000,temperature:0.8,structuredOutput:'prompt'}});
const pinOwner=(story:Story)=>story.factPins={fields:[{kind:'item',recordId:'fob',field:'ownerId'}],rules:[]};

test('passage commits reject pinned ownership changes atomically, while unrelated changes remain possible',()=>{
  const story=createSample();pinOwner(story);
  const before=structuredClone(story),proposal=sampleContinuationProposal('');
  assert.throws(()=>preparePassageCommit(story,proposal),/pinned/i);
  assert.deepEqual(story,before);
  proposal.effects=[];
  proposal.draft.paragraphs=['Ren waited beside the bridge console while Elias kept his access fob.'];
  const saved=preparePassageCommit(story,proposal).story;
  assert.equal(saved.canon.items.find(item=>item.id==='fob')!.ownerId,'elias');
  assert.deepEqual(saved.factPins,story.factPins);
});

test('latest replacement enforces current author pins rather than silently restoring before-passage values',()=>{
  const initial=createSample(),continued=preparePassageCommit(initial,sampleContinuationProposal('')).story;
  pinOwner(continued);
  assert.equal(continued.canon.items.find(item=>item.id==='fob')!.ownerId,'ren');
  assert.equal(continued.recovery!.canon.items.find(item=>item.id==='fob')!.ownerId,'elias');
  const replacement=sampleReplacementProposal(continued,continued.passages.at(-1)!.id);
  assert.throws(()=>preparePassageCommit(continued,replacement),/pinned/i);
  const sameOutcome=sampleContinuationProposal('');
  replacement.draft.paragraphs=sameOutcome.draft.paragraphs;
  replacement.effects=sameOutcome.effects;
  const saved=preparePassageCommit(continued,replacement).story;
  assert.equal(saved.canon.items.find(item=>item.id==='fob')!.ownerId,'ren');
  assert.deepEqual(saved.factPins,continued.factPins);
});

test('replacement narration receives current pinned values alongside the restored before-state',async()=>{
  const story=preparePassageCommit(createSample(),sampleContinuationProposal('')).story;
  pinOwner(story);
  let messages:{role:string;content:string}[]=[];
  await assert.rejects(()=>generatePassage({story,mode:'replace',direction:'Retell the handover.'},settings(),new AbortController().signal,()=>{},async(_url,init)=>{
    messages=JSON.parse(String(init!.body)).messages;
    return new Response(JSON.stringify({choices:[{message:{content:'{}'},finish_reason:'stop'}]}));
  }));
  assert.ok(messages.length>0);
  assert.ok(messages.some(message=>message.content.includes(JSON.stringify(resolvedFactPins(story)))),'Current pinned owner must reach narration before a replacement is written.');
  assert.ok(messages.some(message=>message.content.includes('"ownerId":"elias"')),'Restored ownership is still the fictional before-state.');
});

test('reviewed corrections cannot alter pinned fields through full-record or world operations',()=>{
  const story=createSample();
  story.factPins={fields:[{kind:'item',recordId:'fob',field:'ownerId'},{kind:'world',recordId:null,field:'funds'}],rules:[]};
  const item=story.canon.items.find(item=>item.id==='fob')!,before=structuredClone(story);
  assert.throws(()=>applyCorrectionOperations(story,[{type:'record',create:false,edit:{kind:'item',value:{...item,ownerId:'ren'}}}]),/pinned/i);
  assert.throws(()=>applyCorrectionOperations(story,[{type:'world',funds:story.canon.funds-1,cargoNotes:story.canon.cargoNotes}]),/pinned/i);
  assert.deepEqual(story,before);
  const saved=applyCorrectionOperations(story,[{type:'record',create:false,edit:{kind:'item',value:{...item,description:'The same access fob, with its serial number recorded.'}}}]);
  assert.equal(saved.canon.items.find(row=>row.id==='fob')!.ownerId,item.ownerId);
  assert.notEqual(saved.canon.items.find(row=>row.id==='fob')!.description,item.description);
});

test('correction model context retains exact author constraints and refuses oversized rules before calling the model',async()=>{
  const story=createSample();pinOwner(story);
  story.factPins.rules=[{id:'vacuum-rule',text:'Unprotected humans cannot breathe in vacuum.'}];
  const item=story.canon.items.find(row=>row.id==='fob')!,{id:_,...value}=item;
  const input={kind:'record' as const,recordKind:'item' as const,mode:'revise' as const,targetId:item.id,expectedRevision:story.revision,requestId:randomUUID(),passageId:story.passages.at(-1)!.id,direction:'Record the serial number without changing ownership.'};
  let calls=0;
  await generateCorrectionResult(story,input,settings(),new AbortController().signal,()=>{},async(_url,init)=>{
    calls++;
    const payload=JSON.parse(String(init!.body)),context=JSON.parse(payload.messages[1].content);
    assert.equal(context.factPins.fields[0].field,'ownerId');
    assert.equal(context.factPins.fields[0].value,'elias');
    assert.deepEqual(context.factPins.rules,story.factPins.rules);
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({explanation:'Record its serial number.',value:{...value,description:'Serial number SW-45 is engraved on the access fob.'}})},finish_reason:'stop'}]}));
  });
  assert.equal(calls,1);
  story.factPins.rules=Array.from({length:50},(_,i)=>({id:`rule-${i}`,text:'Required world fact. '.repeat(100).slice(0,2000)}));
  const small=settings();small.text.contextTokens=16384;
  await assert.rejects(()=>generateCorrectionResult(story,input,small,new AbortController().signal,()=>{},async()=>{calls++;throw new Error('Oversized required facts reached the model.');}),/context budget/i);
  assert.equal(calls,1);
});
