import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { StoryRepository, type PreparationSourceKind } from '../src/lib/server/repository';
import { generatePassage, type PassageSource } from '../src/lib/server/story-generation';
import { recoverySourceHash } from '../src/lib/server/passage-recovery-state';
import { resolvedFactPins } from '../src/lib/fact-pins';
import { runPassageWorkflow, retryPassageWorkflow, acceptPassageWorkflow, recoverPassageWorkflowDraft } from '../src/lib/server/story-workflow/passage';
import { workflowFixture, workflowSetupFixture, workflowSettings, scriptedProvider, generationInput, effect, memory, scene } from './workflow-fixture';

const signal=()=>new AbortController().signal;
function fixture(mode:'opening'|'replace',path=':memory:') {
  if(mode==='opening') {
    const {repository:r,setup}=workflowSetupFixture(path);
    return {r,id:setup.id,revision:setup.revision,kind:'setup' as const,source:{setup} satisfies PassageSource};
  }
  const {repository:r,story}=workflowFixture(path);
  // The latest saved passage changed stock. A rewrite must extract/review
  // against three cubes before that passage, rather than the current one cube.
  const changed=r.commitGeneratedPassage(story.id,{expectedRevision:story.revision,requestId:randomUUID(),proposal:{mode:'continue',direction:'Feed the pony.',draft:{...scene(true),startsChapter:false},effects:[{type:'item.quantity',itemId:'sugar',expectedQuantity:3,quantity:1,evidence:'Alex gave two Sugar Cubes to the pony.'}],memory}});
  return {r,id:changed.id,revision:changed.revision,kind:'story' as const,source:{story:changed,mode:'replace',direction:'Listen to the rain.',chapterEnding:'auto'} satisfies PassageSource};
}
const action=(r:StoryRepository,kind:PreparationSourceKind,id:string,draftId:string)=>({requestId:randomUUID(),expectedRevision:r.readPreparationSource(kind,id).revision,expectedVersion:r.readRetained(kind,id,draftId).version,notes:''});

for(const mode of ['opening','replace'] as const) {
  for(const scenario of ['quiet','expanded','inventory','repair'] as const) test(`${mode} graph preserves full provider requests and proposal for ${scenario}`,async()=>{
    const {r,id,revision,kind,source}=fixture(mode);
    try {
      const options=scenario==='quiet'?{}:scenario==='expanded'?{short:true}:scenario==='inventory'?{inventory:true,effects:[effect]}:{inventory:true,short:true,effects:[],repairedEffects:[effect],reviews:[false,true]};
      const old=scriptedProvider(options),next=scriptedProvider(options),input=generationInput(revision),c=workflowSettings();
      const expected=await generatePassage(source,c,signal(),()=>{},old.fetcher);
      const saved=await runPassageWorkflow(r,mode,id,input,c,signal(),{fetcher:next.fetcher});
      assert.deepEqual(next.requests,old.requests);assert.deepEqual(next.stages,old.stages);
      const run=r.workflows.find(id,input.requestId)!;
      assert.equal(run.mode,mode);assert.equal(run.source.kind,kind);assert.equal(run.status,'completed');
      assert.deepEqual(r.workflows.artifacts(run.id).find(a=>a.metadata.nodeId==='acceptance')!.value,expected);
      assert.equal(saved.passages.length,mode==='opening'?1:2);
      assert.equal(saved.canon.items[0].quantity,scenario==='inventory'||scenario==='repair'?1:3);
      assert.equal(next.requests.length,scenario==='quiet'?2:scenario==='repair'?6:3);
      if(mode==='opening')assert.equal(r.readSetup(id).storyId,saved.id);
      else assert.ok(run.source.replacementBaselineHash);
      assert.deepEqual(await runPassageWorkflow(r,mode,id,input,c,signal(),{fetcher:async()=>{throw Error('resubmitted');}}),saved);
      if(kind==='story')assert.equal(r.listRetained(kind,id).length,0);
    } finally {r.close();}
  });

  test(`${mode} malformed updates retain prose, retry only effects and accept exactly once`,async()=>{
    const {r,id,revision,kind}=fixture(mode);
    try {
      const before=r.readPreparationSource(kind,id),input=generationInput(revision);
      await assert.rejects(runPassageWorkflow(r,mode,id,input,workflowSettings(),signal(),{fetcher:scriptedProvider({malformed:true}).fetcher}),/retained/);
      assert.equal(recoverySourceHash(r.readPreparationSource(kind,id)),recoverySourceHash(before));
      const kept=r.listRetained(kind,id)[0],retry=action(r,kind,id,kept.id),provider=scriptedProvider({inventory:true,effects:[]});
      const settings=workflowSettings();settings.text.maxTokens=256;
      const ready=await retryPassageWorkflow(r,kind,id,kept.id,retry,settings,signal(),{fetcher:provider.fetcher});
      assert.equal(ready.status,'ready');assert.deepEqual(provider.stages,['extract']);assert.deepEqual(ready.content,kept.content);
      const run=r.workflows.find(id,retry.requestId)!;assert.equal(run.status,'awaiting-acceptance');
      const apply=action(r,kind,id,kept.id),saved=await acceptPassageWorkflow(r,kind,id,run.id,kept.id,apply,signal());
      assert.equal(saved.passages.length,mode==='opening'?1:2);
      assert.deepEqual(await acceptPassageWorkflow(r,kind,id,run.id,kept.id,apply,signal()),saved);
      assert.equal(r.workflows.artifacts(run.id).filter(a=>a.metadata.nodeId==='commit').length,1);
    } finally {r.close();}
  });

  test(`${mode} final-artifact failure rolls back canon and publication receipts`,async()=>{
    const {r,id,revision,kind}=fixture(mode);
    try {
      const before=r.readPreparationSource(kind,id),store=r.workflows,complete=store.complete.bind(store),input=generationInput(revision);
      store.complete=(attempt,outputs,origin)=>{if(attempt.nodeId==='commit')throw Error('Injected commit artifact failure');return complete(attempt,outputs,origin);};
      await assert.rejects(runPassageWorkflow(r,mode,id,input,workflowSettings(),signal(),{fetcher:scriptedProvider().fetcher}),/Injected/);
      assert.equal(recoverySourceHash(r.readPreparationSource(kind,id)),recoverySourceHash(before));
      const run=store.find(id,input.requestId)!;assert.ok(!store.artifacts(run.id).some(a=>a.metadata.nodeId==='commit'));
      assert.equal(kind==='setup'?r.openingResult(id,input.requestId,run.requestFingerprint):r.generatedPassageResult(id,input.requestId,run.requestFingerprint),null);
      assert.equal(r.listRetained(kind,id)[0].status,'blocked');
      if(kind==='setup')assert.equal(r.readSetup(id).storyId,null);
    } finally {r.close();}
  });

  test(`${mode} complete content survives reopen and explicit recovery without narration`,async()=>{
    const folder=mkdtempSync(join(tmpdir(),'workflow-modes-')),path=join(folder,'library.sqlite');
    let r:StoryRepository|undefined;
    try {
      const f=fixture(mode,path);r=f.r;const {id,kind,revision}=f,input=generationInput(revision),provider=scriptedProvider();
      r.retainPassage=()=>{throw Error('Injected retention failure');};
      await assert.rejects(runPassageWorkflow(r,mode,id,input,workflowSettings(),signal(),{fetcher:provider.fetcher}),/Injected/);
      assert.deepEqual(provider.stages,['narrate']);r.close();r=new StoryRepository(path);
      const kept=await recoverPassageWorkflowDraft(r,kind,id,input.requestId,{requestId:randomUUID(),expectedRevision:revision},signal());
      assert.equal(kept.status,'blocked');assert.deepEqual(kept.content.draft.paragraphs,scene().paragraphs);
      const retry=action(r,kind,id,kept.id),updates=scriptedProvider();
      await retryPassageWorkflow(r,kind,id,kept.id,retry,workflowSettings(),signal(),{fetcher:updates.fetcher});
      assert.deepEqual(updates.stages,['extract']);
      const run=r.workflows.find(id,retry.requestId)!;
      const saved=await acceptPassageWorkflow(r,kind,id,run.id,kept.id,action(r,kind,id,kept.id),signal());
      assert.equal(saved.passages.length,mode==='opening'?1:2);
    } finally {r?.close();assert.ok(resolve(folder).startsWith(resolve(tmpdir())+'\\'));rmSync(folder,{recursive:true,force:true});}
  });

  test(`${mode} cancellation preserves complete prose outside canon`,async()=>{
    const {r,id,revision,kind}=fixture(mode);
    try {
      const before=r.readPreparationSource(kind,id),controller=new AbortController(),provider=scriptedProvider({before:stage=>{if(stage==='extract')controller.abort();}}),input=generationInput(revision);
      await assert.rejects(runPassageWorkflow(r,mode,id,input,workflowSettings(),controller.signal,{fetcher:provider.fetcher}),/retained|abort|cancel/i);
      assert.equal(recoverySourceHash(r.readPreparationSource(kind,id)),recoverySourceHash(before));assert.equal(r.workflows.find(id,input.requestId)!.status,'cancelled');
      assert.equal(r.listRetained(kind,id)[0].status,'blocked');
    } finally {r.close();}
  });

  test(`${mode} review-artifact failure cannot leave an acceptable proposal without its artifact`,async()=>{
    const {r,id,revision,kind}=fixture(mode);
    try {
      await assert.rejects(runPassageWorkflow(r,mode,id,generationInput(revision),workflowSettings(),signal(),{fetcher:scriptedProvider({malformed:true}).fetcher}),/retained/);
      const kept=r.listRetained(kind,id)[0],store=r.workflows,complete=store.complete.bind(store),retry=action(r,kind,id,kept.id);
      store.complete=(attempt,outputs,origin)=>{if(attempt.nodeId==='acceptance')throw Error('Injected review artifact failure');return complete(attempt,outputs,origin);};
      await assert.rejects(retryPassageWorkflow(r,kind,id,kept.id,retry,workflowSettings(),signal(),{fetcher:scriptedProvider().fetcher}),/Injected/);
      assert.equal(r.readRetained(kind,id,kept.id).status,'blocked');assert.equal(store.reviewRun(kind,id,kept.id),null);
      assert.equal(r.readRetained(kind,id,kept.id).proposal,null);
      await assert.rejects(Promise.resolve().then(()=>r.applyRetained(kind,id,kept.id,action(r,kind,id,kept.id))),/Recheck|changed/);
    } finally {r.close();}
  });

  test(`${mode} reviewed commit-artifact failure rolls back acceptance and can retry the same action`,async()=>{
    const {r,id,revision,kind}=fixture(mode);
    try {
      const before=r.readPreparationSource(kind,id);
      await assert.rejects(runPassageWorkflow(r,mode,id,generationInput(revision),workflowSettings(),signal(),{fetcher:scriptedProvider({malformed:true}).fetcher}),/retained/);
      const kept=r.listRetained(kind,id)[0],retry=action(r,kind,id,kept.id);
      await retryPassageWorkflow(r,kind,id,kept.id,retry,workflowSettings(),signal(),{fetcher:scriptedProvider().fetcher});
      const store=r.workflows,run=store.reviewRun(kind,id,kept.id)!,complete=store.complete.bind(store),apply=action(r,kind,id,kept.id);
      store.complete=(attempt,outputs,origin)=>{if(attempt.nodeId==='commit')throw Error('Injected accepted artifact failure');return complete(attempt,outputs,origin);};
      await assert.rejects(acceptPassageWorkflow(r,kind,id,run.id,kept.id,apply,signal()),/Injected/);
      assert.equal(recoverySourceHash(r.readPreparationSource(kind,id)),recoverySourceHash(before));
      assert.equal(r.readRetained(kind,id,kept.id).status,'ready');assert.equal(store.read(run.id).status,'awaiting-acceptance');
      store.complete=complete;
      const saved=await acceptPassageWorkflow(r,kind,id,run.id,kept.id,apply,signal());
      assert.equal(saved.passages.length,mode==='opening'?1:2);
      assert.deepEqual(await acceptPassageWorkflow(r,kind,id,run.id,kept.id,apply,signal()),saved);
    } finally {r.close();}
  });
}

test('replacement retains current pinned values over restored pre-event canon',async()=>{
  const {r,id,revision}=fixture('replace');
  try {
    const pinned=r.mutate(id,{expectedRevision:revision,requestId:randomUUID(),action:{type:'fact-pins',factPins:{fields:[{kind:'item',recordId:'sugar',field:'quantity'}],rules:[]}}});
    assert.equal(pinned.canon.items[0].quantity,1);assert.equal(pinned.recovery!.canon.items[0].quantity,3);
    const provider=scriptedProvider();
    await assert.rejects(runPassageWorkflow(r,'replace',id,generationInput(pinned.revision),workflowSettings(),signal(),{fetcher:provider.fetcher}),/pinned|pin|retained/);
    assert.deepEqual(r.read(id),pinned);
    const prepared=r.workflows.artifacts(r.workflows.find(id,r.listRetained('story',id)[0].requestId)!.id).find(a=>a.metadata.nodeId==='prepare')!.value as {factPins:unknown;story:unknown};
    assert.deepEqual(prepared.factPins,resolvedFactPins(pinned));
    const kept=r.listRetained('story',id)[0],retry=action(r,'story',id,kept.id),updates=scriptedProvider();
    await assert.rejects(retryPassageWorkflow(r,'story',id,kept.id,retry,workflowSettings(),signal(),{fetcher:updates.fetcher}),/pin/);
    assert.deepEqual(r.read(id),pinned);
  } finally {r.close();}
});

test('a changed replacement recovery point refuses an effects retry before provider work',async()=>{
  const {r,id,revision}=fixture('replace');
  try {
    await assert.rejects(runPassageWorkflow(r,'replace',id,generationInput(revision),workflowSettings(),signal(),{fetcher:scriptedProvider({malformed:true}).fetcher}),/retained/);
    const kept=r.listRetained('story',id)[0],story=r.read(id);
    r.mutate(id,{expectedRevision:story.revision,requestId:randomUUID(),action:{type:'record-save',edit:{kind:'item',value:{...story.canon.items[0],quantity:5}}}});
    const provider=scriptedProvider();
    await assert.rejects(retryPassageWorkflow(r,'story',id,kept.id,action(r,'story',id,kept.id),workflowSettings(),signal(),{fetcher:provider.fetcher}),/recovery point|baseline/);
    assert.equal(provider.requests.length,0);
  } finally {r.close();}
});

test('a replacement of the first passage can retry with empty prior history',async()=>{
  const {repository:r,story}=workflowFixture();
  try {
    await assert.rejects(runPassageWorkflow(r,'replace',story.id,generationInput(story.revision),workflowSettings(),signal(),{fetcher:scriptedProvider({malformed:true}).fetcher}),/retained/);
    const kept=r.listRetained('story',story.id)[0],retry=action(r,'story',story.id,kept.id),provider=scriptedProvider();
    await retryPassageWorkflow(r,'story',story.id,kept.id,retry,workflowSettings(),signal(),{fetcher:provider.fetcher});
    const run=r.workflows.reviewRun('story',story.id,kept.id)!;
    const saved=await acceptPassageWorkflow(r,'story',story.id,run.id,kept.id,action(r,'story',story.id,kept.id),signal());
    assert.equal(saved.passages.length,1);assert.deepEqual(provider.stages,['extract']);
  } finally {r.close();}
});

test('another connection publishing the setup while the graph checks updates cannot be overwritten',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'workflow-publication-')),path=join(folder,'library.sqlite');
  const {r,id,revision}=fixture('opening',path),other=new StoryRepository(path);
  try {
    let publishedId='';
    const provider=scriptedProvider({before:stage=>{
      if(stage==='extract')publishedId=other.commitOpening(id,revision,randomUUID(),'other-window',{mode:'continue',direction:'',draft:{...scene(),title:'Other window',startsChapter:true},effects:[],memory}).id;
    }});
    await assert.rejects(runPassageWorkflow(r,'opening',id,generationInput(revision),workflowSettings(),signal(),{fetcher:provider.fetcher}),/already|written|retained/);
    assert.equal(r.readSetup(id).storyId,publishedId);assert.equal(r.read(publishedId).passages[0].title,'Other window');
    assert.equal(r.list().length,1);
  } finally {other.close();r.close();assert.ok(resolve(folder).startsWith(resolve(tmpdir())+'\\'));rmSync(folder,{recursive:true,force:true});}
});
