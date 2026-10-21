import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {DiagnosticStore,registerSecrets} from '../src/lib/server/diagnostics';
import {JobStore} from '../src/lib/server/jobs';

test('activity retains older live calls beyond recent history and polls redacted metadata without request/result bodies',()=>{
  const store=new DiagnosticStore(':memory:');registerSecrets('activity-private-key');
  try{
    const active=store.start({kind:'story-question',storyId:'earlier',request:{endpoint:'http://localhost:8888/v1/chat/completions',model:'activity-private-key',messages:[{content:'PROMPT_BODY_MARKER'}]}});
    for(let i=0;i<120;i++){const id=store.start({kind:'text-test',request:{endpoint:'http://localhost/v1/chat/completions',model:'qa'}});store.finish(id,{content:'RESULT_BODY_MARKER'});}
    const dry=store.start({kind:'context-preview',request:{messages:['DRY_RUN_MARKER']}});store.finish(dry,{});
    const rows=store.activity(),text=JSON.stringify(rows);assert.equal(rows.length,21);assert.equal(rows[0].id,active);assert.equal(rows[0].status,'pending');assert.equal(rows[0].finishedAt,undefined);
    for(const hidden of ['activity-private-key','PROMPT_BODY_MARKER','RESULT_BODY_MARKER','DRY_RUN_MARKER'])assert.ok(!text.includes(hidden));
    assert.equal(store.traces().length,101);assert.ok(store.trace(active));assert.equal(store.trace(active)!.request instanceof Object,true);
    store.clearTraces();assert.equal(store.activity().length,1);assert.equal(store.trace(dry),null);
    store.finish(active,{content:'The answer is ready.'});assert.equal(store.activity()[0].status,'complete');assert.ok(store.trace(active)!.response);
  }finally{store.close();}
});

test('activity retains every active job ahead of its bounded completed tail and omits saved graphs/drafts/history',()=>{
  const store=new JobStore(':memory:');registerSecrets('activity-job-secret');
  const input=()=>({kind:'text-test',requestId:randomUUID(),lockKey:randomUUID(),input:{}});
  try{
    const active=store.start(input()).job;store.transition(active.id,'generating',{details:{stage:'preparing-context',graph:{prompt:'GRAPH_MARKER'},draft:'DRAFT_MARKER'}});
    for(let i=0;i<105;i++){const j=store.start(input()).job;store.transition(j.id,'failed',{error:'activity-job-secret failure'});}
    const image=store.start({...input(),kind:'image-test'}).job;store.transition(image.id,'generating',{recoverable:true});
    const rows=store.activity(),text=JSON.stringify(rows);assert.equal(rows.length,7);assert.equal(rows.filter(j=>j.state==='generating').length,2);assert.equal(rows.find(j=>j.id===image.id)!.recoverable,true);assert.equal(rows.find(j=>j.id===active.id)!.stage,'preparing-context');
    for(const hidden of ['activity-job-secret','GRAPH_MARKER','DRAFT_MARKER','fingerprint','history'])assert.ok(!text.includes(hidden));
  }finally{store.close();}
});
