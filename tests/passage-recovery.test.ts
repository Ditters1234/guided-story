import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { StoryRepository } from '../src/lib/server/repository';
import { blankSetupPlan } from '../src/lib/setup';
import { connectionSchema } from '../src/lib/server/connections';
import { generateRetainedPassage, retryRetainedPassage } from '../src/lib/server/passage-recovery';
import { passageContentSchema, type PassageProposal } from '../src/lib/passage-proposal';
import { recoveryActionSchema } from '../src/lib/passage-recovery';
import { recoveryBaseline } from '../src/lib/server/passage-recovery-state';

const signal=()=>new AbortController().signal;
const settings=()=>connectionSchema.parse({...JSON.parse(readFileSync('config/connections.example.json','utf8')),text:{...JSON.parse(readFileSync('config/connections.example.json','utf8')).text,model:'retained-test',contextTokens:32000,maxTokens:4096}});
const paragraphs=['Alex gave two sugar cubes to the pony. He waited by the stable door while she finished the treats and listened to the quiet sound of rain on the roof. The morning was still young, and there was plenty of time to enjoy it. He folded the cloth over his arm and looked toward the yard. A pair of birds had settled on the fence beside the old gate. For a moment he watched them in silence, happy to let the rest of the work wait until the shower passed. The pony leaned toward his shoulder, then turned her attention to the open doorway.'];
const memory={summary:'Alex offered the pony two treats.',facts:['Alex gave two sugar cubes to the pony.'],openQuestions:[],characterIds:['alex'],locationIds:['stable']};
const bad={type:'item.split',ref:'new-treats',itemId:'sugar',expectedQuantity:1,quantity:2,ownerId:'alex',evidenceId:'source-0'};
const good=(quantity=3)=>({type:'item.quantity',itemId:'sugar',expectedQuantity:quantity,quantity:quantity-2,evidenceId:'source-0'});
const response=(content:unknown)=>new Response(JSON.stringify({choices:[{message:{content:typeof content==='string'?content:JSON.stringify(content)},finish_reason:'stop'}]}));
function setup(r:StoryRepository){const d=r.createSetup({premise:'A quiet morning at a stable.',castSize:1,preferences:{passageWords:100}},randomUUID()),plan=blankSetupPlan();plan.title='Retained test';plan.chapterTitle='Morning';plan.canon.places=[{id:'stable',name:'Stable',parentId:null,description:'A quiet stable.'}];Object.assign(plan.canon.characters[0],{id:'alex',name:'Alex',locationId:'stable'});plan.canon.items=[{id:'sugar',name:'Sugar Cubes',description:'Small sugar cubes as pony treats in tin.',quantity:1,ownerId:'alex',equipped:false}];plan.context.sceneBrief={...plan.context.sceneBrief,viewpointId:'alex',locationId:'stable',castIds:['alex'],purpose:'Offer the pony a treat.'};return r.saveSetup(d.id,{expectedRevision:0,requestId:randomUUID(),input:d.input,plan});}
const content=(startsChapter=true)=>passageContentSchema.parse({mode:'continue',direction:'Offer the pony a treat.',draft:{title:'A quiet morning',chapterTitle:'Morning',startsChapter,endOfChapter:false,viewpointId:'alex',paragraphs}});
const proposal=(startsChapter=true):PassageProposal=>({...content(startsChapter),effects:[],memory});
const action=(r:StoryRepository,kind:'setup'|'story',id:string,draftId:string)=>({requestId:randomUUID(),expectedVersion:r.readRetained(kind,id,draftId).version,expectedRevision:r.readPreparationSource(kind,id).revision,notes:''});
function provider(effect:unknown,counts:{narration:number;effects:number;review:number},inspect?:(body:any)=>void):typeof fetch{return async(_url,init)=>{const body=JSON.parse(String(init!.body)),system=body.messages[0].content;inspect?.(body);if(system.startsWith('Review inventory consistency.')){counts.review++;return response({consistent:true,issues:[]});}if(system.startsWith('Return {effects:')){counts.effects++;return response({effects:[effect],memory});}counts.narration++;return response({...content().draft,startsChapter:undefined});};}
const counts=()=>({narration:0,effects:0,review:0});

test('failed opening keeps authoritative prose before extraction, survives reopen and never renarrates the same request',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'story-retained-')),path=join(folder,'library.sqlite');let r=new StoryRepository(path);
  try{
    const draft=setup(r),scope={repository:r,kind:'setup' as const,id:draft.id,requestId:randomUUID(),fingerprint:'opening-fingerprint'},calls=counts();
    await assert.rejects(()=>generateRetainedPassage(scope,{setup:draft},settings(),signal(),()=>{},p=>r.commitOpening(draft.id,draft.revision,scope.requestId,scope.fingerprint,p),provider(bad,calls,body=>{if(body.messages[0].content.startsWith('Return {effects:')){assert.deepEqual(r.listRetained('setup',draft.id)[0].content.draft.paragraphs,paragraphs);assert.equal(r.list().length,0);}})),/prose is retained/);
    assert.deepEqual(calls,{narration:1,effects:2,review:0});assert.deepEqual(r.readSetup(draft.id),draft);
    let kept=r.listRetained('setup',draft.id)[0];assert.equal(kept.status,'blocked');assert.deepEqual(kept.rawEffects,[bad]);assert.match(kept.facts.find(row=>row.id==='sugar')!.detail,/quantity: 1/i);assert.ok(kept.issues.length);
    r.close();r=new StoryRepository(path);kept=r.readRetained('setup',draft.id,kept.id);assert.deepEqual(kept.content.draft.paragraphs,paragraphs);assert.equal(kept.status,'blocked');
    const repeat=counts();await assert.rejects(()=>generateRetainedPassage({...scope,repository:r},{setup:draft},settings(),signal(),()=>{},()=>{throw Error('Unexpected commit');},provider(good(),repeat)),/Retry world updates/);assert.equal(repeat.narration+repeat.effects,0);
    const archive=unzipSync(r.exportSetup(draft.id));assert.equal(Object.values(archive).some(bytes=>strFromU8(bytes).includes('retained_passages')),false);
  }finally{r.close();assert.equal(dirname(resolve(folder)),resolve(tmpdir()));rmSync(folder,{recursive:true,force:true});}
});

test('correcting saved counting units enables effects-only retry, explicit atomic opening save and durable request replays',async()=>{
  const r=new StoryRepository(':memory:');try{
    let draft=setup(r);const source=r.readPreparationSource('setup',draft.id),original=randomUUID(),kept=r.retainPassage('setup',draft.id,original,'opening',source,content());r.blockRetained('setup',draft.id,kept.id,original,[{category:'validation',message:'Only one cube is recorded.'}]);
    draft.plan!.canon.items[0].quantity=3;draft=r.saveSetup(draft.id,{expectedRevision:draft.revision,requestId:randomUUID(),input:draft.input,plan:draft.plan});
    const input=action(r,'setup',draft.id,kept.id),calls=counts();let sawCurrent=false;
    const ready=await retryRetainedPassage({repository:r,kind:'setup',id:draft.id},kept.id,input,settings(),signal(),()=>{},()=>{},provider(good(),calls,body=>{if(body.messages[0].content.startsWith('Return {effects:')){sawCurrent=/"quantity"\s*:\s*3/.test(body.messages.map((message:any)=>message.content).join('\n'));assert.match(JSON.stringify(body.messages),/Only one cube is recorded/);}}));
    assert.equal(sawCurrent,true);assert.deepEqual(calls,{narration:0,effects:1,review:1});assert.equal(ready.status,'ready');assert.deepEqual(ready.content,kept.content);assert.equal(r.list().length,0);assert.deepEqual(r.readSetup(draft.id),draft);
    const replay=await retryRetainedPassage({repository:r,kind:'setup',id:draft.id},kept.id,input,settings(),signal(),()=>{},()=>{},async()=>{throw Error('Repeated model call');});assert.equal(replay.status,'ready');
    const accept=action(r,'setup',draft.id,kept.id),saved=r.applyRetained('setup',draft.id,kept.id,accept);assert.equal(saved.passages.length,1);assert.deepEqual(saved.passages[0].paragraphs,paragraphs);assert.equal(saved.canon.items[0].quantity,1);assert.equal(saved.context.memories.length,1);assert.equal(r.readSetup(draft.id).storyId,saved.id);assert.equal(r.readRetained('setup',draft.id,kept.id).status,'saved');assert.deepEqual(r.applyRetained('setup',draft.id,kept.id,accept),saved);assert.deepEqual(r.openingResult(draft.id,original,'opening'),saved);
    assert.throws(()=>r.applyRetained('setup',draft.id,kept.id,{...accept,expectedVersion:accept.expectedVersion+1}),/different passage recovery/);
  }finally{r.close();}
});

test('continuation check cancellation and malformed extraction keep prose and canon; saving requires a successful complete check',async()=>{
  const r=new StoryRepository(':memory:');try{
    const draft=setup(r),story=r.commitOpening(draft.id,draft.revision,randomUUID(),'first',proposal()),original=randomUUID(),kept=r.retainPassage('story',story.id,original,'next',story,content(false));
    const controller=new AbortController(),input=action(r,'story',story.id,kept.id);
    await assert.rejects(()=>retryRetainedPassage({repository:r,kind:'story',id:story.id},kept.id,input,settings(),controller.signal,()=>{},()=>{},async()=>{controller.abort();throw new Error('cancelled');}),/cancelled/);
    assert.equal(r.readRetained('story',story.id,kept.id).status,'blocked');assert.match(r.readRetained('story',story.id,kept.id).issues[0].message,/cancelled/);assert.deepEqual(r.read(story.id),story);
    await assert.rejects(()=>retryRetainedPassage({repository:r,kind:'story',id:story.id},kept.id,action(r,'story',story.id,kept.id),settings(),signal(),()=>{},()=>{},async()=>response('{broken')),/malformed|JSON/i);
    assert.deepEqual(r.readRetained('story',story.id,kept.id).content.draft.paragraphs,paragraphs);assert.throws(()=>r.applyRetained('story',story.id,kept.id,action(r,'story',story.id,kept.id)),/Retry|Recheck/i);assert.deepEqual(r.read(story.id),story);
  }finally{r.close();}
});

test('continuation acceptance uses stored proposals only, refuses stale checks, preserves pins, and replays once',async()=>{
  const r=new StoryRepository(':memory:');try{
    const d=setup(r),story=r.commitOpening(d.id,d.revision,randomUUID(),'first',proposal()),original=randomUUID(),kept=r.retainPassage('story',story.id,original,'next',story,content(false));
    let begun=r.beginRetainedRetry('story',story.id,kept.id,action(r,'story',story.id,kept.id));
    assert.throws(()=>r.readyRetained('story',story.id,kept.id,begun.record.activeRequestId!,begun.source!,{...proposal(false),draft:{...proposal(false).draft,paragraphs:['Forged prose']}}),/cannot change/);
    let ready=r.readyRetained('story',story.id,kept.id,begun.record.activeRequestId!,begun.source!,proposal(false));
    const changed=r.mutate(story.id,{expectedRevision:story.revision,requestId:randomUUID(),action:{type:'world',funds:story.canon.funds+1,cargoNotes:story.canon.cargoNotes}});
    assert.throws(()=>r.applyRetained('story',story.id,kept.id,{...action(r,'story',story.id,kept.id),expectedVersion:ready.version}),/Saved facts changed/);assert.deepEqual(r.read(story.id),changed);
    begun=r.beginRetainedRetry('story',story.id,kept.id,action(r,'story',story.id,kept.id));ready=r.readyRetained('story',story.id,kept.id,begun.record.activeRequestId!,begun.source!,proposal(false));
    const apply=action(r,'story',story.id,kept.id),saved=r.applyRetained('story',story.id,kept.id,apply);assert.equal(saved.passages.length,2);assert.deepEqual(r.applyRetained('story',story.id,kept.id,apply),saved);assert.deepEqual(r.generatedPassageResult(story.id,original,'next'),saved);assert.equal(r.listRetained('story',story.id).length,0);assert.deepEqual(saved.factPins,story.factPins);
    assert.throws(()=>recoveryActionSchema.parse({...apply,proposal:proposal(false)}),/Unrecognized key/);
  }finally{r.close();}
});

test('history changes and invalidated replacement recovery refuse reuse without deleting the prose',()=>{
  const r=new StoryRepository(':memory:');try{
    const d=setup(r),story=r.commitOpening(d.id,d.revision,randomUUID(),'first',proposal()),replacement={...content(false),mode:'replace' as const,passageId:story.passages[0].id},kept=r.retainPassage('story',story.id,randomUUID(),'rewrite',story,replacement);
    const baseline=recoveryBaseline(story,replacement);assert.deepEqual(baseline.canon,story.recovery!.canon);assert.equal(baseline.passages.length,0);
    const changed=r.mutate(story.id,{expectedRevision:story.revision,requestId:randomUUID(),action:{type:'world',funds:4,cargoNotes:''}});assert.throws(()=>recoveryBaseline(changed,replacement),/recovery point changed/);assert.deepEqual(r.readRetained('story',story.id,kept.id).content,replacement);
    const next=r.commitGeneratedPassage(story.id,{expectedRevision:changed.revision,requestId:randomUUID(),proposal:proposal(false)});
    assert.throws(()=>r.beginRetainedRetry('story',story.id,kept.id,action(r,'story',story.id,kept.id)),/Written history changed/);assert.deepEqual(r.read(story.id),next);assert.deepEqual(r.readRetained('story',story.id,kept.id).content.draft.paragraphs,paragraphs);
  }finally{r.close();}
});

test('retained drafts are scoped, action IDs cannot collide, discard is replayable and library removal cleans recovery metadata',()=>{
  const r=new StoryRepository(':memory:');try{
    const d=setup(r),source=r.readPreparationSource('setup',d.id),original=randomUUID(),kept=r.retainPassage('setup',d.id,original,'opening',source,content());
    assert.throws(()=>r.readRetained('story',d.id,kept.id),/unavailable/);assert.throws(()=>r.beginRetainedRetry('setup',d.id,kept.id,{...action(r,'setup',d.id,kept.id),requestId:original}),/another story or setup operation/);
    const discard=action(r,'setup',d.id,kept.id),removed=r.discardRetained('setup',d.id,kept.id,discard);assert.equal(removed.status,'discarded');assert.deepEqual(r.discardRetained('setup',d.id,kept.id,discard),removed);assert.deepEqual(r.readSetup(d.id),d);assert.equal(r.listRetained('setup',d.id).length,0);
    assert.throws(()=>r.saveSetup(d.id,{expectedRevision:d.revision,requestId:discard.requestId,input:d.input,plan:d.plan}),/another operation/);
    r.removeFromLibrary('setup',d.id,d.revision,randomUUID());assert.throws(()=>r.readRetained('setup',d.id,kept.id),/unavailable/);
  }finally{r.close();}
});

test('successful initial generation consumes its reservation and hides its retained draft without changing normal publication',async()=>{
  const r=new StoryRepository(':memory:');try{
    let d=setup(r);d.plan!.canon.items[0].quantity=3;d=r.saveSetup(d.id,{expectedRevision:d.revision,requestId:randomUUID(),input:d.input,plan:d.plan});
    const scope={repository:r,kind:'setup' as const,id:d.id,requestId:randomUUID(),fingerprint:'ordinary-opening'},calls=counts();
    const saved=await generateRetainedPassage(scope,{setup:d},settings(),signal(),()=>{},p=>r.commitOpening(d.id,d.revision,scope.requestId,scope.fingerprint,p),provider(good(),calls));
    assert.equal(r.retainedGeneration('setup',d.id,scope.requestId,scope.fingerprint)!.status,'saved');assert.deepEqual(r.openingResult(d.id,scope.requestId,scope.fingerprint),saved);assert.equal(saved.canon.items[0].quantity,1);
    const nextScope={...scope,kind:'story' as const,requestId:randomUUID(),fingerprint:'ordinary-next'},before=r.read(saved.id);
    // A normal continuation with no inventory changes still autocommits once.
    const noChanges:typeof fetch=async(_url,init)=>{const body=JSON.parse(String(init!.body));if(body.messages[0].content.startsWith('Review inventory consistency.'))return response({consistent:true,issues:[]});if(body.messages[0].content.startsWith('Return {effects:'))return response({effects:[],memory});return response({...content(false).draft,startsChapter:undefined});};
    const next=await generateRetainedPassage(nextScope,{story:before,mode:'continue',direction:''},settings(),signal(),()=>{},p=>r.commitGeneratedPassage(saved.id,{expectedRevision:before.revision,requestId:nextScope.requestId,proposal:p},nextScope.fingerprint),noChanges);
    assert.equal(next.passages.length,2);assert.equal(r.listRetained('story',next.id).length,0);assert.deepEqual(r.generatedPassageResult(next.id,nextScope.requestId,nextScope.fingerprint),next);
  }finally{r.close();}
});

test('replacement retries restore the correct baseline and still enforce current author pins before becoming ready',async()=>{
  const r=new StoryRepository(':memory:');try{
    const d=setup(r);d.plan!.canon.items[0].quantity=3;const updated=r.saveSetup(d.id,{expectedRevision:d.revision,requestId:randomUUID(),input:d.input,plan:d.plan});
    const initial:PassageProposal={...proposal(),effects:[{type:'item.quantity',itemId:'sugar',expectedQuantity:3,quantity:1,evidence:paragraphs[0]}]};
    let story=r.commitOpening(d.id,updated.revision,randomUUID(),'first',initial);
    story=r.mutate(story.id,{expectedRevision:story.revision,requestId:randomUUID(),action:{type:'fact-pins',factPins:{fields:[{kind:'item',recordId:'sugar',field:'quantity'}],rules:[]}}});
    const rewrite={...content(false),mode:'replace' as const,passageId:story.passages[0].id},original=randomUUID(),kept=r.retainPassage('story',story.id,original,'rewrite',story,rewrite),calls=counts();
    const ready=await retryRetainedPassage({repository:r,kind:'story',id:story.id},kept.id,action(r,'story',story.id,kept.id),settings(),signal(),()=>{},()=>{},provider(good(),calls));assert.equal(ready.status,'ready');assert.equal(calls.narration,0);
    const saved=r.applyRetained('story',story.id,kept.id,action(r,'story',story.id,kept.id));assert.equal(saved.passages.length,1);assert.equal(saved.passages[0].id,story.passages[0].id);assert.equal(saved.canon.items[0].quantity,1);assert.deepEqual(saved.factPins,story.factPins);
    const second=r.retainPassage('story',story.id,randomUUID(),'bad-rewrite',saved,rewrite),begin=r.beginRetainedRetry('story',story.id,second.id,action(r,'story',story.id,second.id));
    assert.throws(()=>r.readyRetained('story',story.id,second.id,begin.record.activeRequestId!,saved,{...rewrite,effects:[]}),/pinned/i);assert.deepEqual(r.read(story.id),saved);
  }finally{r.close();}
});

test('a server stop during extraction leaves complete, untruncated prose available for an explicit retry',()=>{
  const folder=mkdtempSync(join(tmpdir(),'story-retained-interrupt-')),path=join(folder,'library.sqlite');let r=new StoryRepository(path);
  try{
    const d=setup(r),source=r.readPreparationSource('setup',d.id),text=content();text.draft.paragraphs=[paragraphs[0].repeat(12)+' Complete ending: café 🌧️.'];
    const record=r.retainPassage('setup',d.id,randomUUID(),'interrupted',source,text);r.close();r=new StoryRepository(path);
    const kept=r.listRetained('setup',d.id)[0];assert.equal(kept.status,'checking');assert.deepEqual(kept.content,text);assert.equal(kept.version,record.version);assert.equal(r.list().length,0);assert.deepEqual(r.readSetup(d.id),d);
    const retry=r.beginRetainedRetry('setup',d.id,record.id,action(r,'setup',d.id,record.id));assert.equal(retry.replay,false);assert.equal(retry.record.attempts,2);assert.deepEqual(retry.record.content,text);
  }finally{r.close();assert.equal(dirname(resolve(folder)),resolve(tmpdir()));rmSync(folder,{recursive:true,force:true});}
});

test('recovery polling reports a setup published elsewhere without treating it as a missing source',()=>{
  const r=new StoryRepository(':memory:');try{
    const d=setup(r),source=r.readPreparationSource('setup',d.id),record=r.retainPassage('setup',d.id,randomUUID(),'opening',source,content());
    assert.equal(r.recoveryState('setup',d.id).drafts[0].id,record.id);
    const begun=r.beginRetainedRetry('setup',d.id,record.id,action(r,'setup',d.id,record.id));r.readyRetained('setup',d.id,record.id,begun.record.activeRequestId!,source,proposal());
    const input=action(r,'setup',d.id,record.id),saved=r.applyRetained('setup',d.id,record.id,input),state=r.recoveryState('setup',d.id);
    assert.equal(state.publishedStoryId,saved.id);assert.equal(state.sourceRevision,r.readSetup(d.id).revision);assert.deepEqual(state.drafts,[]);assert.deepEqual(r.applyRetained('setup',d.id,record.id,input),saved);assert.equal(r.recoveryState('story',saved.id).publishedStoryId,null);assert.equal(r.list().length,1);
    assert.throws(()=>r.recoveryState('setup',randomUUID()),/not found/);
  }finally{r.close();}
});

test('accepting cannot silently ignore new guidance or consume the action ID when guidance was rejected',()=>{
  const r=new StoryRepository(':memory:');try{
    const d=setup(r),source=r.readPreparationSource('setup',d.id),record=r.retainPassage('setup',d.id,randomUUID(),'opening',source,content()),begun=r.beginRetainedRetry('setup',d.id,record.id,action(r,'setup',d.id,record.id));
    const ready=r.readyRetained('setup',d.id,record.id,begun.record.activeRequestId!,source,proposal()),input=action(r,'setup',d.id,record.id);
    assert.throws(()=>r.applyRetained('setup',d.id,record.id,{...input,notes:'The counting unit needs another check.'}),/Submit rechecking guidance/);assert.deepEqual(r.readRetained('setup',d.id,record.id),ready);assert.deepEqual(r.readSetup(d.id),d);assert.equal(r.list().length,0);
    const saved=r.applyRetained('setup',d.id,record.id,input);assert.equal(saved.passages.length,1);assert.deepEqual(r.applyRetained('setup',d.id,record.id,input),saved);
  }finally{r.close();}
});

test('a manual source correction during retry prevents readiness and preserves both the correction and retained text',async()=>{
  const r=new StoryRepository(':memory:');try{
    let d=setup(r);d.plan!.canon.items[0].quantity=3;d=r.saveSetup(d.id,{expectedRevision:d.revision,requestId:randomUUID(),input:d.input,plan:d.plan});
    const original=randomUUID(),source=r.readPreparationSource('setup',d.id),record=r.retainPassage('setup',d.id,original,'opening',source,content()),calls=counts();let edited=false;
    await assert.rejects(()=>retryRetainedPassage({repository:r,kind:'setup',id:d.id},record.id,action(r,'setup',d.id,record.id),settings(),signal(),()=>{},()=>{},provider(good(),calls,body=>{
      if(edited||!body.messages[0].content.startsWith('Return {effects:'))return;edited=true;
      d=r.saveSetup(d.id,{expectedRevision:d.revision,requestId:randomUUID(),input:{...d.input,narrationStyle:'A newly saved voice.'},plan:d.plan});
    })),/saved facts changed during checking/);
    const retained=r.readRetained('setup',d.id,record.id);assert.equal(retained.status,'blocked');assert.equal(retained.proposal,null);assert.deepEqual(retained.content.draft.paragraphs,paragraphs);assert.deepEqual(r.readSetup(d.id),d);assert.equal(r.list().length,0);assert.equal(calls.narration,0);
  }finally{r.close();}
});
