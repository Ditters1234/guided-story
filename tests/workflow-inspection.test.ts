import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { StoryRepository } from '../src/lib/server/repository';
import { inspectWorkflowRun, inspectWorkflowNode, listWorkflowRuns, removeWorkflowDetails } from '../src/lib/server/story-workflow/inspection';
import { runPassageWorkflow, retryPassageWorkflow, acceptPassageWorkflow, recoverPassageWorkflowDraft } from '../src/lib/server/story-workflow/passage';
import { getJobs, cancelJob } from '../src/lib/server/jobs';
import { registerSecrets } from '../src/lib/server/diagnostics';
import { generationInput,workflowFixture,workflowSettings,scriptedProvider,effect } from './workflow-fixture';
const signal=()=>new AbortController().signal;

test('workflow listing is paged metadata; inspecting a stage exposes exact typed provenance without provider work',async()=>{
  const {repository:r,story}=workflowFixture();
  try {
    const input=generationInput(story.revision),provider=scriptedProvider();
    await runPassageWorkflow(r,'continue',story.id,input,workflowSettings(),signal(),{fetcher:provider.fetcher});
    const list=listWorkflowRuns(r,{limit:1}),id=list.runs[0].run.id;
    assert.equal(list.runs[0].calls,2);assert.equal(list.runs[0].attempts,20);assert.equal(list.runs[0].title,story.title);
    assert.ok(!JSON.stringify(list).includes('paragraphs'));assert.equal(listWorkflowRuns(r,{before:list.next!,limit:1}).runs.length,0);
    const detail=inspectWorkflowRun(r,id,workflowSettings());
    assert.equal(detail.displayStatus,'completed');assert.ok(detail.changes.some(message=>message.includes('history changed')));
    const stage=inspectWorkflowNode(r,id,'extract');
    assert.equal(stage.provider.length,1);assert.equal(stage.provider[0].usage.prompt_tokens,100);
    assert.ok(stage.provider[0].estimatedInputTokens!>0);assert.equal(stage.provider[0].outputTokenCeiling,4096);
    assert.deepEqual(stage.provider[0].request,provider.requests[1]);
    assert.ok(stage.references.some(reference=>reference.id==='sugar'&&reference.kind==='item'&&reference.scope==='compact reference'));
    assert.equal(inspectWorkflowNode(r,id,'source').references.length,0);
    assert.equal(stage.outputs[0].metadata.origin,'model');assert.equal(stage.inputs[0].metadata.runId,id);
    assert.equal(provider.requests.length,2);
    const skipped=inspectWorkflowNode(r,id,'expand');assert.equal(skipped.attempt?.status,'skipped');assert.equal(skipped.provider.length,0);
    const notRequired=inspectWorkflowNode(r,id,'review');assert.equal(notRequired.checks.find(c=>c.kind==='model').status,'not-required');
    assert.equal(notRequired.outputs[0].metadata.origin,'deterministic');
  } finally {r.close();}
});

test('display redaction preserves complete bounded structures and never mutates execution artifacts',async()=>{
  const {repository:r,story}=workflowFixture();
  try {
    const key='private-inspection-marker-credential',c=workflowSettings();c.text.apiKey=key;registerSecrets(key);
    const input={...generationInput(story.revision),direction:`Listen to the rain. Private note: ${key}`},provider=scriptedProvider();
    const fetcher:typeof fetch=async(url,init)=>{const response=await provider.fetcher(url,init),body=await response.json();body.extra={api_key:'unregistered-provider-key'};body.rows=Array.from({length:250},(_,id)=>({id}));return new Response(JSON.stringify(body));};
    await runPassageWorkflow(r,'continue',story.id,input,c,signal(),{fetcher});
    const id=r.workflows.find(story.id,input.requestId)!.id,raw=r.workflows.providerIO(id)[0].request,stage=inspectWorkflowNode(r,id,'narrate');
    assert.ok(raw.includes(key));assert.ok(!JSON.stringify(stage).includes(key));assert.ok(!JSON.stringify(stage).includes('unregistered-provider-key'));
    assert.equal(stage.provider[0].response.rows.length,250);assert.equal(stage.provider[0].response.rows[249].id,249);
    assert.equal(r.workflows.providerIO(id)[0].request,raw);assert.ok(raw.length>0);
  } finally {r.close();}
});

test('sugar-cube failure exposes deterministic issues, current-fact staleness and the latest successful explicit check',async()=>{
  const {repository:r,story}=workflowFixture(':memory:',1);
  try {
    const input=generationInput(story.revision),provider=scriptedProvider({inventory:true,effects:[effect]});
    await assert.rejects(runPassageWorkflow(r,'continue',story.id,input,workflowSettings(),signal(),{fetcher:provider.fetcher}),/retained/);
    const run=r.workflows.find(story.id,input.requestId)!,draft=r.listRetained('story',story.id)[0];
    const validation=inspectWorkflowNode(r,run.id,'validate');assert.equal(validation.checks[0].kind,'deterministic');assert.equal(validation.checks[0].status,'issues');
    assert.equal(inspectWorkflowNode(r,run.id,'extract').references.find(reference=>reference.id==='sugar'&&reference.scope==='scoped record')!.quantity,1);
    assert.ok(validation.issues.join(' ').match(/quantity|3|1/i));
    const before=inspectWorkflowRun(r,run.id,workflowSettings());assert.equal(before.recovery.retained!.id,draft.id);assert.equal(before.removal.allowed,false);
    const saved=r.mutate(story.id,{expectedRevision:story.revision,requestId:randomUUID(),action:{type:'record-save',edit:{kind:'item',value:{...story.canon.items[0],quantity:3}}}});
    const stale=inspectWorkflowRun(r,run.id,workflowSettings());assert.equal(stale.sourceCurrent,false);assert.ok(stale.changes.some(message=>message.includes('world facts changed')));
    const action={expectedRevision:saved.revision,expectedVersion:draft.version,notes:'Use the corrected saved count.',requestId:randomUUID()},updates=scriptedProvider({inventory:true,effects:[effect]});
    const ready=await retryPassageWorkflow(r,'story',story.id,draft.id,action,workflowSettings(),signal(),{fetcher:updates.fetcher});
    const retryRun=r.workflows.find(story.id,action.requestId)!;
    assert.equal(inspectWorkflowRun(r,run.id,workflowSettings()).recovery.retained!.latestReviewId,retryRun.id);
    assert.equal(inspectWorkflowRun(r,retryRun.id,workflowSettings()).sourceCurrent,true);
    assert.deepEqual(updates.stages,['extract','review']);assert.equal(r.read(story.id).passages.length,1);assert.equal(ready.status,'ready');
  } finally {r.close();}
});

test('node inspection rejects another node’s attempt and unknown node/run identifiers',async()=>{
  const {repository:r,story}=workflowFixture();
  try {
    const input=generationInput(story.revision);await runPassageWorkflow(r,'continue',story.id,input,workflowSettings(),signal(),{fetcher:scriptedProvider().fetcher});
    const id=r.workflows.find(story.id,input.requestId)!.id,attempt=r.workflows.attempts(id).find(a=>a.nodeId==='extract')!;
    assert.throws(()=>inspectWorkflowNode(r,id,'narrate',attempt.id),/does not belong/);
    assert.throws(()=>inspectWorkflowNode(r,id,'unknown'),/not found/);
    assert.throws(()=>inspectWorkflowRun(r,'not-a-uuid',null));
    assert.throws(()=>listWorkflowRuns(r,{limit:1000}));
  } finally {r.close();}
});

test('history removal deletes detailed bodies while preserving canon, receipts and exact-once committed replay',async()=>{
  const {repository:r,story}=workflowFixture();
  try {
    const input=generationInput(story.revision),provider=scriptedProvider(),saved=await runPassageWorkflow(r,'continue',story.id,input,workflowSettings(),signal(),{fetcher:provider.fetcher});
    const id=r.workflows.find(story.id,input.requestId)!.id,detail=inspectWorkflowRun(r,id,workflowSettings());
    assert.equal(detail.removal.allowed,true);
    assert.throws(()=>removeWorkflowDetails(r,id,{expectedVersion:'0'.repeat(64)}),/changed/);
    removeWorkflowDetails(r,id,{expectedVersion:detail.version});
    assert.ok(r.workflows.removedAt(id));assert.deepEqual(r.workflows.artifacts(id),[]);assert.deepEqual(r.workflows.providerIO(id),[]);assert.deepEqual(r.workflows.attempts(id),[]);
    assert.equal(inspectWorkflowRun(r,id,null).removal.allowed,false);assert.throws(()=>inspectWorkflowNode(r,id,'narrate'),/removed/);
    assert.deepEqual(r.read(story.id),saved);
    assert.deepEqual(await runPassageWorkflow(r,'continue',story.id,input,workflowSettings(),signal(),{fetcher:async()=>{throw Error('resubmitted');}}),saved);
    assert.equal(listWorkflowRuns(r,{}).runs[0].removedAt,r.workflows.removedAt(id));
  } finally {r.close();}
});

test('removing failed history keeps its request tombstone and cannot authorize narration replay',async()=>{
  const {repository:r,story}=workflowFixture();
  try {
    const input=generationInput(story.revision);let calls=0;
    await assert.rejects(runPassageWorkflow(r,'continue',story.id,input,workflowSettings(),signal(),{fetcher:async()=>{calls++;return new Response(JSON.stringify({choices:[{message:{content:'{broken'},finish_reason:'stop'}]}));}}));
    const run=r.workflows.find(story.id,input.requestId)!,detail=inspectWorkflowRun(r,run.id,null);assert.equal(detail.recovery.canRecover,false);
    removeWorkflowDetails(r,run.id,{expectedVersion:detail.version});
    await assert.rejects(runPassageWorkflow(r,'continue',story.id,input,workflowSettings(),signal(),{fetcher:async()=>{calls++;throw Error('resubmitted');}}),/already started/);
    assert.equal(calls,1);assert.deepEqual(r.read(story.id),story);assert.equal(getJobs().find({storyId:story.id,requestId:input.requestId})!.attempt,1);
  } finally {r.close();}
});

test('retained drafts and cross-run dependencies protect history until recovery and dependent cleanup complete',async()=>{
  const {repository:r,story}=workflowFixture();
  try {
    const input=generationInput(story.revision);
    await assert.rejects(runPassageWorkflow(r,'continue',story.id,input,workflowSettings(),signal(),{fetcher:scriptedProvider({malformed:true}).fetcher}),/retained/);
    const original=r.workflows.find(story.id,input.requestId)!,draft=r.listRetained('story',story.id)[0];
    assert.throws(()=>removeWorkflowDetails(r,original.id,{expectedVersion:inspectWorkflowRun(r,original.id,null).version}),/Recover or discard/);
    const retry={requestId:randomUUID(),expectedRevision:story.revision,expectedVersion:draft.version,notes:''};
    const ready=await retryPassageWorkflow(r,'story',story.id,draft.id,retry,workflowSettings(),signal(),{fetcher:scriptedProvider().fetcher}),child=r.workflows.find(story.id,retry.requestId)!;
    const saved=await acceptPassageWorkflow(r,'story',story.id,child.id,draft.id,{...retry,requestId:randomUUID(),expectedVersion:ready.version},signal());
    assert.equal(inspectWorkflowRun(r,original.id,null).removal.dependentRunId,child.id);
    assert.throws(()=>removeWorkflowDetails(r,original.id,{expectedVersion:inspectWorkflowRun(r,original.id,null).version}),/later run/);
    removeWorkflowDetails(r,child.id,{expectedVersion:inspectWorkflowRun(r,child.id,null).version});
    removeWorkflowDetails(r,original.id,{expectedVersion:inspectWorkflowRun(r,original.id,null).version});
    assert.deepEqual(r.read(story.id),saved);assert.equal(r.workflows.find(story.id,input.requestId)!.requestFingerprint,original.requestFingerprint);
  } finally {r.close();}
});

test('an active provider job blocks removal even before any prose is retained',async()=>{
  const {repository:r,story}=workflowFixture();
  try {
    let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(resolve=>release=resolve),started=new Promise<void>(resolve=>entered=resolve);
    const input=generationInput(story.revision),provider=scriptedProvider({before:async stage=>{if(stage==='narrate'){entered();await gate;}}});
    const pending=runPassageWorkflow(r,'continue',story.id,input,workflowSettings(),signal(),{fetcher:provider.fetcher});
    await started;const id=r.workflows.find(story.id,input.requestId)!.id,detail=inspectWorkflowRun(r,id,null);
    try {assert.equal(detail.active,true);assert.equal(detail.removal.allowed,false);assert.throws(()=>removeWorkflowDetails(r,id,{expectedVersion:detail.version}),/active/);}finally{release();}
    await pending;assert.deepEqual(provider.stages,['narrate','extract']);
  } finally {r.close();}
});

test('cancelled provider promises remain protected until the operation actually releases the source',async()=>{
  const {repository:r,story}=workflowFixture();
  try {
    let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(resolve=>release=resolve),started=new Promise<void>(resolve=>entered=resolve);
    const input=generationInput(story.revision),provider=scriptedProvider({before:async stage=>{if(stage==='narrate'){entered();await gate;}}});
    const pending=runPassageWorkflow(r,'continue',story.id,input,workflowSettings(),signal(),{fetcher:provider.fetcher});
    await started;const id=r.workflows.find(story.id,input.requestId)!.id;
    cancelJob(getJobs().find({storyId:story.id,requestId:input.requestId})!.id);
    const detail=inspectWorkflowRun(r,id,null);assert.equal(detail.active,true);
    try {assert.throws(()=>removeWorkflowDetails(r,id,{expectedVersion:detail.version}),/still stopping/);}finally{release();}
    await assert.rejects(pending,/cancel|abort/i);assert.equal(inspectWorkflowRun(r,id,null).active,false);assert.deepEqual(r.read(story.id),story);
  } finally {r.close();}
});

test('inspection offers explicit no-provider recovery only for complete content, and does not itself promote it',async()=>{
  const {repository:r,story}=workflowFixture();
  try {
    const original=r.retainPassage.bind(r),input=generationInput(story.revision),provider=scriptedProvider();r.retainPassage=()=>{throw Error('Injected retain failure');};
    await assert.rejects(runPassageWorkflow(r,'continue',story.id,input,workflowSettings(),signal(),{fetcher:provider.fetcher}),/Injected/);r.retainPassage=original;
    const id=r.workflows.find(story.id,input.requestId)!.id,inspection=inspectWorkflowRun(r,id,workflowSettings());
    assert.equal(inspection.recovery.canRecover,true);assert.equal(r.listRetained('story',story.id).length,0);
    const record=await recoverPassageWorkflowDraft(r,'story',story.id,input.requestId,{requestId:randomUUID(),expectedRevision:story.revision},signal());
    assert.equal(record.status,'blocked');assert.equal(inspectWorkflowRun(r,id,null).recovery.canRecover,false);assert.deepEqual(provider.stages,['narrate']);
  } finally {r.close();}
});

test('model-setting changes are explained without treating a stored response as a fresh request',async()=>{
  const {repository:r,story}=workflowFixture();
  try {
    const input=generationInput(story.revision);await runPassageWorkflow(r,'continue',story.id,input,workflowSettings(),signal(),{fetcher:scriptedProvider().fetcher});
    const c=workflowSettings();c.text.model='changed-model';const id=r.workflows.find(story.id,input.requestId)!.id,detail=inspectWorkflowRun(r,id,c);
    assert.equal(detail.configurationChanged,true);assert.ok(detail.changes.some(change=>change.includes('settings changed')));
    assert.equal(inspectWorkflowNode(r,id,'narrate').provider.length,1);
  } finally {r.close();}
});

test('a superseded recovery check is explained even when saved source facts still match',async()=>{
  const {repository:r,story}=workflowFixture();
  try {
    await assert.rejects(runPassageWorkflow(r,'continue',story.id,generationInput(story.revision),workflowSettings(),signal(),{fetcher:scriptedProvider({malformed:true}).fetcher}),/retained/);
    const draft=r.listRetained('story',story.id)[0],action={expectedRevision:story.revision,expectedVersion:draft.version,requestId:randomUUID(),notes:''};
    const ready=await retryPassageWorkflow(r,'story',story.id,draft.id,action,workflowSettings(),signal(),{fetcher:scriptedProvider().fetcher}),run=r.workflows.find(story.id,action.requestId)!;
    assert.equal(inspectWorkflowRun(r,run.id,null).reviewState,'current');
    await assert.rejects(retryPassageWorkflow(r,'story',story.id,draft.id,{...action,expectedVersion:ready.version,requestId:randomUUID()},workflowSettings(),signal(),{fetcher:scriptedProvider({malformed:true}).fetcher}),/retained/);
    const detail=inspectWorkflowRun(r,run.id,null);
    assert.equal(detail.sourceCurrent,true);assert.equal(detail.reviewState,'superseded');assert.ok(detail.changes.some(change=>change.includes('superseded')));
    assert.equal(r.read(story.id).passages.length,1);
  } finally {r.close();}
});

test('library deletion also removes stored workflow snapshots and provider bodies atomically',async()=>{
  const {repository:r,story}=workflowFixture();
  try {
    const input=generationInput(story.revision),saved=await runPassageWorkflow(r,'continue',story.id,input,workflowSettings(),signal(),{fetcher:scriptedProvider().fetcher});
    const id=r.workflows.find(story.id,input.requestId)!.id;
    r.removeFromLibrary('story',story.id,saved.revision,randomUUID());
    const detail=inspectWorkflowRun(r,id,null);assert.equal(detail.title,'Removed source');assert.equal(detail.recovery.canRecover,false);
    assert.ok(detail.changes.some(change=>change.includes('no longer available')));
    assert.throws(()=>inspectWorkflowNode(r,id,'content'),/removed/);
    assert.ok(r.workflows.removedAt(id));assert.deepEqual(r.workflows.providerIO(id),[]);assert.throws(()=>r.read(story.id),/could not be found/);
  } finally {r.close();}
});

test('superseded awaiting-review history can be removed after the latest proposal is saved',async()=>{
  const {repository:r,story}=workflowFixture();
  try {
    await assert.rejects(runPassageWorkflow(r,'continue',story.id,generationInput(story.revision),workflowSettings(),signal(),{fetcher:scriptedProvider({malformed:true}).fetcher}),/retained/);
    const draft=r.listRetained('story',story.id)[0],first={expectedRevision:story.revision,expectedVersion:draft.version,requestId:randomUUID(),notes:''};
    const ready=await retryPassageWorkflow(r,'story',story.id,draft.id,first,workflowSettings(),signal(),{fetcher:scriptedProvider().fetcher}),old=r.workflows.find(story.id,first.requestId)!;
    const second={...first,expectedVersion:ready.version,requestId:randomUUID()};
    const checked=await retryPassageWorkflow(r,'story',story.id,draft.id,second,workflowSettings(),signal(),{fetcher:scriptedProvider().fetcher}),latest=r.workflows.find(story.id,second.requestId)!;
    const saved=await acceptPassageWorkflow(r,'story',story.id,latest.id,draft.id,{...second,requestId:randomUUID(),expectedVersion:checked.version},signal());
    assert.equal(r.workflows.read(old.id).status,'awaiting-acceptance');const detail=inspectWorkflowRun(r,old.id,null);assert.equal(detail.removal.allowed,true);
    removeWorkflowDetails(r,old.id,{expectedVersion:detail.version});assert.ok(r.workflows.removedAt(old.id));assert.deepEqual(r.read(story.id),saved);
  } finally {r.close();}
});

test('reopened interrupted attempts are labeled without mutation or provider resubmission on inspection',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'workflow-inspector-reopen-')),path=join(folder,'library.sqlite');let r:StoryRepository|undefined;
  try {
    const fixture=workflowFixture(path);r=fixture.repository;const {story}=fixture,input=generationInput(story.revision);
    await assert.rejects(runPassageWorkflow(r,'continue',story.id,input,workflowSettings(),signal(),{fetcher:async()=>new Response(JSON.stringify({choices:[{message:{content:'{broken'},finish_reason:'stop'}]}))}));
    const run=r.workflows.find(story.id,input.requestId)!,attempt=r.workflows.attempts(run.id).find(a=>a.nodeId==='narrate')!;
    const db=new DatabaseSync(path);db.prepare('UPDATE workflow_runs SET payload=? WHERE id=?').run(JSON.stringify({...run,status:'running'}),run.id);
    db.prepare('UPDATE workflow_attempts SET payload=? WHERE id=?').run(JSON.stringify({...attempt,status:'running'}),attempt.id);db.prepare('UPDATE workflow_provider_io SET response=NULL,error=NULL,status=NULL WHERE attempt_id=?').run(attempt.id);db.close();
    r.close();r=new StoryRepository(path);const detail=inspectWorkflowRun(r,run.id,null);
    assert.equal(detail.displayStatus,'interrupted');assert.equal(detail.nodes.find(n=>n.id==='narrate')!.status,'interrupted');
    assert.equal(inspectWorkflowNode(r,run.id,'narrate').provider[0].complete,false);
    assert.equal(r.workflows.read(run.id).status,'running');assert.equal(r.workflows.attempts(run.id).find(a=>a.id===attempt.id)!.status,'running');
    removeWorkflowDetails(r,run.id,{expectedVersion:detail.version});assert.equal(r.workflows.read(run.id).status,'interrupted');assert.deepEqual(r.read(story.id),story);
  } finally {r?.close();assert.ok(resolve(folder).startsWith(resolve(tmpdir())+'\\'));rmSync(folder,{recursive:true,force:true});}
});

test('library deletion rolls back its source and workflow cleanup together on a history write failure',async()=>{
  const {repository:r,story}=workflowFixture();
  try {
    const input=generationInput(story.revision),saved=await runPassageWorkflow(r,'continue',story.id,input,workflowSettings(),signal(),{fetcher:scriptedProvider().fetcher});
    const id=r.workflows.find(story.id,input.requestId)!.id,remove=r.workflows.removeSourceDetails.bind(r.workflows);
    r.workflows.removeSourceDetails=sourceId=>{remove(sourceId);throw Error('Injected cleanup failure');};
    assert.throws(()=>r.removeFromLibrary('story',story.id,saved.revision,randomUUID()),/Injected/);
    assert.deepEqual(r.read(story.id),saved);assert.equal(r.workflows.removedAt(id),null);assert.equal(r.workflows.providerIO(id).length,2);
  } finally {r.close();}
});
