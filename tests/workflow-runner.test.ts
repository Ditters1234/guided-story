import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { unzipSync, strFromU8 } from 'fflate';
import { runContinuationWorkflow, retryContinuationWorkflow, acceptContinuationWorkflow, recoverContinuationWorkflowDraft } from '../src/lib/server/story-workflow/continuation';
import { generatePassage } from '../src/lib/server/story-generation';
import { StoryRepository } from '../src/lib/server/repository';
import { defaultStoryWorkflow } from '../src/lib/story-workflow/default-graph';
import { getJobs } from '../src/lib/server/jobs';
import { generationInput,workflowFixture,workflowSettings,scriptedProvider,scene,effect } from './workflow-fixture';
const signal=()=>new AbortController().signal;
const action=(r:StoryRepository,id:string,draftId:string,notes='')=>({requestId:randomUUID(),expectedRevision:r.read(id).revision,expectedVersion:r.readRetained('story',id,draftId).version,notes});

for(const scenario of ['quiet','expanded','inventory','repair'] as const)test(`continuation graph matches the current engine's full wire requests/proposal for ${scenario}`,async()=>{
  const {repository:r,story}=workflowFixture();try{
    const options=scenario==='quiet'?{}:scenario==='expanded'?{short:true}:scenario==='inventory'?{inventory:true,effects:[effect]}:{inventory:true,short:true,effects:[],repairedEffects:[effect],reviews:[false,true]};
    const old=scriptedProvider(options),next=scriptedProvider(options),input=generationInput(story.revision),c=workflowSettings();
    const expected=await generatePassage({story,mode:'continue',direction:input.direction,chapterEnding:input.chapterEnding},c,signal(),()=>{},old.fetcher);
    const saved=await runContinuationWorkflow(r,story.id,input,c,signal(),{fetcher:next.fetcher});
    assert.deepEqual(next.requests,old.requests);assert.deepEqual(next.stages,old.stages);
    const run=r.workflows.find(story.id,input.requestId)!;
    const outputs=r.workflows.artifacts(run.id);
    assert.deepEqual(outputs.find(output=>output.metadata.nodeId==='acceptance')!.value,expected);
    assert.deepEqual(saved.passages.at(-1)!.paragraphs,expected.draft.paragraphs);
    assert.equal(saved.passages.length,story.passages.length+1);assert.equal(run.status,'completed');
    const attempts=r.workflows.attempts(run.id);assert.equal(attempts.length,20);
    assert.equal(attempts.find(node=>node.nodeId==='expand')!.status,scenario==='expanded'||scenario==='repair'?'completed':'skipped');
    assert.equal(run.repairAttempts,scenario==='repair'?1:0);
    const io=r.workflows.providerIO(run.id);assert.equal(io.length,next.requests.length);
    assert.deepEqual(io.map(row=>JSON.parse(row.request)),next.requests);
    assert.ok(io.every(row=>row.response&&JSON.parse(row.response).usage.prompt_tokens===100));
    assert.ok(!JSON.stringify({outputs,io,attempts}).includes(c.text.apiKey!));
    assert.ok(outputs.find(output=>output.metadata.nodeId==='preflight')!.value);
    const replay=await runContinuationWorkflow(r,story.id,input,c,signal(),{fetcher:async()=>{throw Error('unexpected resubmission');}});
    assert.deepEqual(replay,saved);assert.equal(r.read(story.id).passages.length,2);
  }finally{r.close();}
});

test('concurrent duplicate requests join one provider attempt and conflicting generation uses the existing source lock',async()=>{
  const {repository:r,story}=workflowFixture();try{
    let release!:()=>void,entered!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
    const provider=scriptedProvider({before:async stage=>{if(stage==='narrate'){entered();await gate;}}}),input=generationInput(story.revision);
    const first=runContinuationWorkflow(r,story.id,input,workflowSettings(),signal(),{fetcher:provider.fetcher});
    await started;
    const duplicate=runContinuationWorkflow(r,story.id,input,workflowSettings(),signal(),{fetcher:provider.fetcher});
    await assert.rejects(runContinuationWorkflow(r,story.id,generationInput(story.revision),workflowSettings(),signal(),{fetcher:provider.fetcher}),/already running/);
    release();assert.deepEqual(await duplicate,await first);assert.deepEqual(provider.stages,['narrate','extract']);
    await assert.rejects(runContinuationWorkflow(r,story.id,{...input,direction:'Other direction'},workflowSettings(),signal(),{fetcher:provider.fetcher}),/different generation inputs|different generation|different workflow|different.*inputs/);
  }finally{r.close();}
});

test('invalid graphs and impossible context fail before provider work',async()=>{
  const {repository:r,story}=workflowFixture();try{
    const provider=scriptedProvider(),graph=defaultStoryWorkflow('continue');graph.edges[0].from.port='missing';
    await assert.rejects(runContinuationWorkflow(r,story.id,generationInput(story.revision),workflowSettings(),signal(),{fetcher:provider.fetcher,graph}),/port/);
    const settings=workflowSettings();settings.text.contextTokens=2048;
    await assert.rejects(runContinuationWorkflow(r,story.id,generationInput(story.revision),settings,signal(),{fetcher:provider.fetcher}),/budget|fit/);
    assert.equal(provider.stages.length,0);assert.deepEqual(r.read(story.id),story);
  }finally{r.close();}
});

test('malformed extraction durably keeps full prose/raw response and cannot silently resubmit the same request',async()=>{
  const {repository:r,story}=workflowFixture();try{
    const provider=scriptedProvider({malformed:true}),input=generationInput(story.revision);
    await assert.rejects(runContinuationWorkflow(r,story.id,input,workflowSettings(),signal(),{fetcher:provider.fetcher}),/retained/);
    const run=r.workflows.find(story.id,input.requestId)!,retained=r.listRetained('story',story.id)[0];
    assert.equal(run.status,'blocked');assert.equal(retained.status,'blocked');assert.deepEqual(retained.content.draft.paragraphs,scene().paragraphs);
    assert.deepEqual(r.read(story.id),story);
    assert.match(r.workflows.providerIO(run.id).at(-1)!.response!,/broken effects/);
    await assert.rejects(runContinuationWorkflow(r,story.id,input,workflowSettings(),signal(),{fetcher:provider.fetcher}),/retained|already started/);
    assert.deepEqual(provider.stages,['narrate','extract']);
    const archive=unzipSync(r.export(story.id));assert.ok(!Object.values(archive).some(bytes=>/workflow_runs|workflow_provider_io|broken effects/.test(strFromU8(bytes))));
  }finally{r.close();}
});

test('the graph permits one repair, persists both check results and blocks a second semantic disagreement',async()=>{
  const {repository:r,story}=workflowFixture();try{
    const provider=scriptedProvider({inventory:true,short:true,reviews:[false,false]}),input=generationInput(story.revision);
    await assert.rejects(runContinuationWorkflow(r,story.id,input,workflowSettings(),signal(),{fetcher:provider.fetcher}),/after a repair attempt/);
    assert.deepEqual(provider.stages,['narrate','expand','extract','review','repair','review']);
    const run=r.workflows.find(story.id,input.requestId)!;assert.equal(run.status,'blocked');assert.equal(run.repairAttempts,1);
    assert.ok(r.workflows.artifacts(run.id).some(output=>output.metadata.nodeId==='rereview'&&output.metadata.port==='blocked'));
    assert.deepEqual(r.read(story.id),story);
  }finally{r.close();}
});

test('stale saved facts refuse atomic commit while retaining prose and independent author edits',async()=>{
  const {repository:r,story}=workflowFixture();try{
    const provider=scriptedProvider({before:stage=>{if(stage==='extract')r.mutate(story.id,{expectedRevision:story.revision,requestId:randomUUID(),action:{type:'story-title',title:'Author edit'}});}});
    await assert.rejects(runContinuationWorkflow(r,story.id,generationInput(story.revision),workflowSettings(),signal(),{fetcher:provider.fetcher}),/changed|retained/);
    assert.equal(r.read(story.id).title,'Author edit');assert.equal(r.read(story.id).passages.length,1);assert.equal(r.listRetained('story',story.id).length,1);
  }finally{r.close();}
});

test('cancellation during extraction retains prose, releases the source job and leaves canon unchanged',async()=>{
  const {repository:r,story}=workflowFixture();try{
    const controller=new AbortController(),input=generationInput(story.revision),provider=scriptedProvider({before:stage=>{if(stage==='extract')controller.abort();}});
    await assert.rejects(runContinuationWorkflow(r,story.id,input,workflowSettings(),controller.signal,{fetcher:provider.fetcher}),/retained|abort|cancel/i);
    assert.deepEqual(r.read(story.id),story);const run=r.workflows.find(story.id,input.requestId)!;assert.equal(run.status,'cancelled');
    assert.equal(r.listRetained('story',story.id)[0].status,'blocked');
    assert.equal(getJobs().find({storyId:story.id,requestId:input.requestId})!.state,'cancelled');
    assert.ok(r.workflows.providerIO(run.id).at(-1)!.response);
    await assert.rejects(runContinuationWorkflow(r,story.id,input,workflowSettings(),signal(),{fetcher:provider.fetcher}),/already started/);
    assert.equal(getJobs().find({storyId:story.id,requestId:input.requestId})!.state,'cancelled');
    assert.equal(getJobs().find({storyId:story.id,requestId:input.requestId})!.attempt,1);
    assert.deepEqual(provider.stages,['narrate','extract']);
  }finally{r.close();}
});

test('saved-fact correction retries only effects, releases the lock for review and accepts through the atomic receipt boundary',async()=>{
  const {repository:r,story}=workflowFixture(':memory:',1);try{
    const initial=scriptedProvider({inventory:true,effects:[effect],repairedEffects:[effect]}),input=generationInput(story.revision);
    await assert.rejects(runContinuationWorkflow(r,story.id,input,workflowSettings(),signal(),{fetcher:initial.fetcher}),/retained/);
    const kept=r.listRetained('story',story.id)[0];
    const item={...story.canon.items[0],quantity:3};
    r.mutate(story.id,{expectedRevision:story.revision,requestId:randomUUID(),action:{type:'record-save',edit:{kind:'item',value:item}}});
    const retryInput=action(r,story.id,kept.id,'Use the corrected counted stock.'),provider=scriptedProvider({inventory:true,effects:[effect]});
    const ready=await retryContinuationWorkflow(r,story.id,kept.id,retryInput,workflowSettings(),signal(),{fetcher:provider.fetcher});
    assert.equal(ready.status,'ready');assert.deepEqual(provider.stages,['extract','review']);assert.deepEqual(ready.content,kept.content);
    const run=r.workflows.find(story.id,retryInput.requestId)!;assert.equal(run.status,'awaiting-acceptance');
    assert.equal(getJobs().find({storyId:story.id,requestId:retryInput.requestId})!.state,'complete');
    assert.equal(r.read(story.id).passages.length,1);
    const apply=action(r,story.id,kept.id),saved=await acceptContinuationWorkflow(r,story.id,run.id,kept.id,apply,signal());
    assert.equal(saved.canon.items[0].quantity,1);assert.equal(saved.passages.length,2);assert.equal(r.workflows.read(run.id).status,'completed');
    assert.deepEqual(await acceptContinuationWorkflow(r,story.id,run.id,kept.id,apply,signal()),saved);
    assert.ok(r.workflows.artifacts(run.id).some(output=>output.metadata.nodeId==='commit'));
    assert.equal(r.workflows.attempts(run.id).filter(node=>node.nodeId==='commit').length,2);
  }finally{r.close();}
});

test('a newer retry/guidance supersedes older checks and unsubmitted notes cannot be accepted',async()=>{
  const {repository:r,story}=workflowFixture();try{
    await assert.rejects(runContinuationWorkflow(r,story.id,generationInput(story.revision),workflowSettings(),signal(),{fetcher:scriptedProvider({malformed:true}).fetcher}),/retained/);
    const draft=r.listRetained('story',story.id)[0];
    const first=action(r,story.id,draft.id),second=()=>action(r,story.id,draft.id,'New checking guidance');
    await retryContinuationWorkflow(r,story.id,draft.id,first,workflowSettings(),signal(),{fetcher:scriptedProvider().fetcher});
    const next=second();await retryContinuationWorkflow(r,story.id,draft.id,next,workflowSettings(),signal(),{fetcher:scriptedProvider().fetcher});
    const prior=r.workflows.find(story.id,first.requestId)!,current=r.workflows.find(story.id,next.requestId)!;
    await assert.rejects(acceptContinuationWorkflow(r,story.id,prior.id,draft.id,action(r,story.id,draft.id),signal()),/superseded/);
    await assert.rejects(acceptContinuationWorkflow(r,story.id,current.id,draft.id,action(r,story.id,draft.id,'Not yet checked'),signal()),/Submit rechecking guidance/);
    assert.equal(r.read(story.id).passages.length,1);
    await acceptContinuationWorkflow(r,story.id,current.id,draft.id,action(r,story.id,draft.id),signal());
    assert.equal(r.read(story.id).passages.length,2);
  }finally{r.close();}
});

test('workflow tables initialize lazily and complete artifacts survive reopening without changing canonical archive contracts',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'story-workflow-store-')),path=join(folder,'library.sqlite');let r:StoryRepository|undefined;
  try{
    const fixture=workflowFixture(path);r=fixture.repository;
    const db=new DatabaseSync(path);assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name='workflow_runs'").get(),undefined);db.close();
    const input=generationInput(fixture.story.revision);
    await runContinuationWorkflow(r,fixture.story.id,input,workflowSettings(),signal(),{fetcher:scriptedProvider().fetcher});
    const run=r.workflows.find(fixture.story.id,input.requestId)!,outputs=r.workflows.artifacts(run.id),io=r.workflows.providerIO(run.id);
    r.close();r=new StoryRepository(path);
    assert.deepEqual(r.workflows.artifacts(run.id),outputs);assert.deepEqual(r.workflows.providerIO(run.id),io);assert.equal(r.workflows.read(run.id).status,'completed');
    const db2=new DatabaseSync(path),artifact=outputs[0];db2.prepare('UPDATE workflow_artifacts SET value=? WHERE id=?').run('{"tampered":true}',artifact.metadata.id);db2.close();
    assert.throws(()=>r!.workflows.artifact(artifact.metadata.id),/integrity/);
  }finally{r?.close();assert.equal(resolve(folder).startsWith(resolve(tmpdir())+'\\'),true);rmSync(folder,{recursive:true,force:true});}
});

test('a commit-artifact write failure rolls back canon, operation receipts and workflow output together',async()=>{
  const {repository:r,story}=workflowFixture();try{
    const store=r.workflows,complete=store.complete.bind(store),input=generationInput(story.revision);
    store.complete=(attempt,values,origin)=>{if(attempt.nodeId==='commit')throw Error('Injected artifact write failure');return complete(attempt,values,origin);};
    await assert.rejects(runContinuationWorkflow(r,story.id,input,workflowSettings(),signal(),{fetcher:scriptedProvider().fetcher}),/retained/);
    assert.deepEqual(r.read(story.id),story);
    const run=store.find(story.id,input.requestId)!;assert.equal(run.status,'blocked');assert.ok(!store.artifacts(run.id).some(output=>output.metadata.nodeId==='commit'));
    assert.equal(r.listRetained('story',story.id)[0].status,'blocked');
  }finally{r.close();}
});

test('an acceptance-artifact write failure rolls back the recovered save and the same action can safely retry',async()=>{
  const {repository:r,story}=workflowFixture();try{
    await assert.rejects(runContinuationWorkflow(r,story.id,generationInput(story.revision),workflowSettings(),signal(),{fetcher:scriptedProvider({malformed:true}).fetcher}),/retained/);
    const draft=r.listRetained('story',story.id)[0],retry=action(r,story.id,draft.id);
    const ready=await retryContinuationWorkflow(r,story.id,draft.id,retry,workflowSettings(),signal(),{fetcher:scriptedProvider().fetcher});
    const store=r.workflows,run=store.find(story.id,retry.requestId)!,complete=store.complete.bind(store),apply=action(r,story.id,draft.id);
    store.complete=(attempt,values,origin)=>{if(attempt.nodeId==='commit')throw Error('Injected acceptance output failure');return complete(attempt,values,origin);};
    await assert.rejects(acceptContinuationWorkflow(r,story.id,run.id,draft.id,apply,signal()),/Injected/);
    assert.deepEqual(r.read(story.id),story);assert.deepEqual(r.readRetained('story',story.id,draft.id),ready);assert.equal(store.read(run.id).status,'awaiting-acceptance');
    store.complete=complete;
    const saved=await acceptContinuationWorkflow(r,story.id,run.id,draft.id,apply,signal());assert.equal(saved.passages.length,2);
    assert.deepEqual(await acceptContinuationWorkflow(r,story.id,run.id,draft.id,apply,signal()),saved);
  }finally{r.close();}
});

test('a failure updating run status after the atomic commit returns the saved result instead of reporting an unsaved passage',async()=>{
  const {repository:r,story}=workflowFixture();try{
    const store=r.workflows,finish=store.finish.bind(store);let failed=false;
    store.finish=(id,status)=>{if(status==='completed'&&!failed){failed=true;throw Error('Injected status failure');}return finish(id,status);};
    const input=generationInput(story.revision),provider=scriptedProvider();
    const saved=await runContinuationWorkflow(r,story.id,input,workflowSettings(),signal(),{fetcher:provider.fetcher});
    assert.equal(saved.passages.length,2);assert.equal(store.find(story.id,input.requestId)!.status,'completed');
    assert.deepEqual(await runContinuationWorkflow(r,story.id,input,workflowSettings(),signal(),{fetcher:provider.fetcher}),saved);
    assert.deepEqual(provider.stages,['narrate','extract']);
  }finally{r.close();}
});

test('final current pins still block a structurally valid, model-approved proposal atomically',async()=>{
  const {repository:r,story}=workflowFixture();try{
    const pinned=r.mutate(story.id,{expectedRevision:story.revision,requestId:randomUUID(),action:{type:'fact-pins',factPins:{fields:[{kind:'item',recordId:'sugar',field:'quantity'}],rules:[]}}});
    await assert.rejects(runContinuationWorkflow(r,story.id,generationInput(pinned.revision),workflowSettings(),signal(),{fetcher:scriptedProvider({inventory:true,effects:[effect]}).fetcher}),/pinned|pin|retained/);
    assert.deepEqual(r.read(story.id),pinned);assert.equal(r.listRetained('story',story.id).length,1);
  }finally{r.close();}
});

test('actual generated prose can fail extraction budget after narration while remaining fully retained',async()=>{
  const {repository:r,story}=workflowFixture();try{
    const settings=workflowSettings();settings.text.contextTokens=12000;let calls=0;
    const long={...scene(),paragraphs:[scene().paragraphs[0].repeat(24)]};
    await assert.rejects(runContinuationWorkflow(r,story.id,generationInput(story.revision),settings,signal(),{fetcher:async()=>{calls++;return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(long)},finish_reason:'stop'}]}));}}),/budget|fit/);
    assert.equal(calls,1);assert.deepEqual(r.listRetained('story',story.id)[0].content.draft.paragraphs,long.paragraphs);assert.deepEqual(r.read(story.id),story);
  }finally{r.close();}
});

test('an interrupted persisted request is not restarted on reopen and an explicit retry reuses prose without narration',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'workflow-interrupted-')),path=join(folder,'library.sqlite');let r:StoryRepository|undefined;
  try{
    const initial=workflowFixture(path);r=initial.repository;const {story}=initial,input=generationInput(story.revision);
    await assert.rejects(runContinuationWorkflow(r,story.id,input,workflowSettings(),signal(),{fetcher:scriptedProvider({malformed:true}).fetcher}),/retained/);
    const run=r.workflows.find(story.id,input.requestId)!,attempt=r.workflows.attempts(run.id).find(node=>node.nodeId==='extract')!;
    // Persist the state a killed process leaves; reopening alone must not execute anything.
    const db=new DatabaseSync(path);db.prepare('UPDATE workflow_runs SET payload=? WHERE id=?').run(JSON.stringify({...run,status:'running'}),run.id);
    db.prepare('UPDATE workflow_attempts SET payload=? WHERE id=?').run(JSON.stringify({...attempt,status:'running'}),attempt.id);
    db.prepare('UPDATE workflow_provider_io SET response=NULL,error=NULL,status=NULL WHERE attempt_id=?').run(attempt.id);db.close();
    r.close();r=new StoryRepository(path);assert.equal(r.workflows.read(run.id).status,'running');
    const kept=r.listRetained('story',story.id)[0],provider=scriptedProvider(),retry=action(r,story.id,kept.id);
    await retryContinuationWorkflow(r,story.id,kept.id,retry,workflowSettings(),signal(),{fetcher:provider.fetcher});
    assert.deepEqual(provider.stages,['extract']);assert.equal(r.workflows.read(run.id).status,'interrupted');
    assert.equal(r.workflows.attempts(run.id).find(node=>node.nodeId==='extract')!.status,'interrupted');
    assert.match(r.workflows.providerIO(run.id).find(row=>row.attempt_id===attempt.id)!.error!,/not resubmitted/);
  }finally{r?.close();assert.ok(resolve(folder).startsWith(resolve(tmpdir())+'\\'));rmSync(folder,{recursive:true,force:true});}
});

test('a completed content artifact can be recovered after failure before retention, with no model request on recovery',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'workflow-promote-')),path=join(folder,'library.sqlite');let r:StoryRepository|undefined;
  try{
    const initial=workflowFixture(path);r=initial.repository;const {story}=initial,input=generationInput(story.revision),provider=scriptedProvider();
    r.retainPassage=()=>{throw Error('Injected failure before prose retention');};
    await assert.rejects(runContinuationWorkflow(r,story.id,input,workflowSettings(),signal(),{fetcher:provider.fetcher}),/Injected/);
    assert.deepEqual(provider.stages,['narrate']);const run=r.workflows.find(story.id,input.requestId)!;
    assert.equal(r.listRetained('story',story.id).length,0);r.close();r=new StoryRepository(path);
    const recovered=await recoverContinuationWorkflowDraft(r,story.id,input.requestId,{requestId:randomUUID(),expectedRevision:story.revision},signal());
    assert.equal(recovered.status,'blocked');assert.deepEqual(recovered.content.draft.paragraphs,scene().paragraphs);
    const retry=action(r,story.id,recovered.id),updates=scriptedProvider();
    await retryContinuationWorkflow(r,story.id,recovered.id,retry,workflowSettings(),signal(),{fetcher:updates.fetcher});assert.deepEqual(updates.stages,['extract']);
    const child=r.workflows.find(story.id,retry.requestId)!,retained=r.workflows.artifacts(child.id).find(output=>output.metadata.nodeId==='retain')!;
    assert.ok(retained.metadata.inputArtifactIds.some(id=>r!.workflows.artifacts(run.id).some(output=>output.metadata.id===id&&output.metadata.nodeId==='content')));
  }finally{r?.close();assert.ok(resolve(folder).startsWith(resolve(tmpdir())+'\\'));rmSync(folder,{recursive:true,force:true});}
});

test('raw malformed narration is inspectable but cannot be promoted to a complete draft or silently retried',async()=>{
  const {repository:r,story}=workflowFixture();try{
    const input=generationInput(story.revision);let calls=0;
    const provider:typeof fetch=async()=>{calls++;return new Response(JSON.stringify({choices:[{message:{content:'{broken narration'},finish_reason:'stop'}]}));};
    await assert.rejects(runContinuationWorkflow(r,story.id,input,workflowSettings(),signal(),{fetcher:provider}),/invalid|JSON/i);
    await assert.rejects(runContinuationWorkflow(r,story.id,input,workflowSettings(),signal(),{fetcher:provider}),/already started/);
    await assert.rejects(recoverContinuationWorkflowDraft(r,story.id,input.requestId,{requestId:randomUUID(),expectedRevision:story.revision},signal()),/No complete passage/);
    assert.equal(calls,1);assert.equal(r.listRetained('story',story.id).length,0);assert.deepEqual(r.read(story.id),story);
  }finally{r.close();}
});

test('Brasswater continuation preserves full request parity and bounded narration/extraction scope at 32k',async()=>{
  const r=new StoryRepository(':memory:');try{
    const story=await r.import(new Uint8Array(readFileSync('exports/scoping-stress-test/brasswater-story.zip'))),c=workflowSettings(),input={...generationInput(story.revision),direction:'Continue examining the chart without changing possessions.'};
    const paragraphs=Array(25).fill('Iris studied the chart while Tamsin checked a pencil mark. Ren waited beside the table. The letter remained sealed, and nobody changed places or possessions.');
    const all:Record<string,any>[][]=[[],[]];
    const provider=(index:number):typeof fetch=>async(_url,init)=>{
      const body=JSON.parse(String(init!.body));all[index].push(body);
      const value=body.messages[0].content.startsWith('Review inventory consistency.')?{consistent:true,issues:[]}:body.messages[0].content.startsWith('Return {effects:')?{effects:[],memory:{summary:'The crew studied the chart.',facts:[],openQuestions:[],characterIds:['iris','tamsin','ren'],locationIds:['chartroom']}}:{title:'Chart',chapterTitle:story.passages[0].chapterTitle,viewpointId:'iris',endOfChapter:false,paragraphs};
      return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(value)},finish_reason:'stop'}]}));
    };
    const expected=await generatePassage({story,mode:'continue',direction:input.direction},c,signal(),()=>{},provider(0));
    await runContinuationWorkflow(r,story.id,input,c,signal(),{fetcher:provider(1)});assert.deepEqual(all[1],all[0]);
    const extraction=JSON.parse(all[1].find(body=>body.messages[0].content.startsWith('Return {effects:'))!.messages[1].content);
    assert.equal(extraction.directory.characters.length,24);assert.equal(extraction.directory.items.length,170);assert.ok(extraction.before.characters.length<24);assert.ok(extraction.before.items.length<170);
    const run=r.workflows.find(story.id,input.requestId)!;assert.deepEqual(r.workflows.artifacts(run.id).find(output=>output.metadata.nodeId==='acceptance')!.value,expected);
  }finally{r.close();}
});

test('effects retry needs no narration output allowance and refuses later history changes before provider work',async()=>{
  const {repository:r,story}=workflowFixture();try{
    await assert.rejects(runContinuationWorkflow(r,story.id,generationInput(story.revision),workflowSettings(),signal(),{fetcher:scriptedProvider({malformed:true}).fetcher}),/retained/);
    const kept=r.listRetained('story',story.id)[0],settings=workflowSettings(),provider=scriptedProvider();settings.text.maxTokens=256;
    const input=action(r,story.id,kept.id);
    await retryContinuationWorkflow(r,story.id,kept.id,input,settings,signal(),{fetcher:provider.fetcher});
    assert.deepEqual(provider.stages,['extract']);assert.equal(provider.requests[0].max_tokens,256);
    r.mutate(story.id,{expectedRevision:story.revision,requestId:randomUUID(),action:{type:'rename',passageId:story.passages[0].id,title:'Renamed history',chapterTitle:story.passages[0].chapterTitle}});
    const refused=scriptedProvider();await assert.rejects(retryContinuationWorkflow(r,story.id,kept.id,action(r,story.id,kept.id),settings,signal(),{fetcher:refused.fetcher}),/history changed/i);
    assert.equal(refused.requests.length,0);assert.equal(r.read(story.id).passages.length,1);
  }finally{r.close();}
});
