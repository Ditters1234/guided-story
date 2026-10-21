// Saved local LLM; all generated setup, diagnostic and database files are isolated.
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,basename} from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const folder=mkdtempSync(join(tmpdir(),'storyweaver-setup-design-live-'));
process.env.STORY_DATA_DIR=folder;process.env.STORY_INSTANCE='play';
let r,diagnostics;
try{
  const {getRepository}=await import('../src/lib/server/repository.ts');
  const {getDiagnostics,scrub}=await import('../src/lib/server/diagnostics.ts');
  const {readPrivateConnections}=await import('../src/lib/server/connections.ts');
  const {createSample}=await import('../src/lib/server/fixture.ts');
  const {emptyContext}=await import('../src/lib/context-types.ts');
  const {generateSetupRecord}=await import('../src/lib/server/setup-generation.ts');
  const {worldFoundationEntry}=await import('../src/lib/setup-generation.ts');
  r=getRepository();diagnostics=getDiagnostics();const settings=readPrivateConnections(),sample=createSample(),context=emptyContext();
  context.sceneBrief={...context.sceneBrief,viewpointId:sample.canon.characters[0].id,locationId:sample.canon.characters[0].locationId,castIds:sample.canon.characters.map(c=>c.id),purpose:'The crew checks a delivery manifest.',tension:'One page is missing.',stopAt:'A question about the missing page.'};
  context.lore.push({id:randomUUID(),title:'World foundations',text:'Independent freighter crews trade between orbital ports.',keywords:[],relatedIds:[],visibility:'always'});
  let draft=r.createSetup({premise:'A hopeful science-fiction mystery about an adult freighter captain, engineer and pilot investigating a missing delivery manifest. Grounded spaceships and orbital ports, fully clothed, no sexual content.',castSize:3},randomUUID());
  draft=r.saveSetup(draft.id,{expectedRevision:draft.revision,requestId:randomUUID(),input:draft.input,plan:{title:'Setup design acceptance',chapterTitle:'A missing page',canon:sample.canon,context}});
  const results=[];
  const cases=[
    {kind:'place',mode:'create',direction:'Add exactly one new independent orbital repair stop named Lantern Dock. Describe its practical repair function. Do not change existing places.'},
    {kind:'item',mode:'revise',targetId:sample.canon.items[0].id,direction:'Make this possession a cobalt-blue access fob with a cracked corner. Keep its owner, quantity and equipped state.'},
    {kind:'relationship',mode:'revise',targetId:sample.canon.relationships[0].id,direction:'Make their relationship an uneasy mentor and protege bond: loyal in a crisis but argumentative about routine decisions. Keep the same two cast members.'},
    {kind:'thread',mode:'create',direction:'Add one unresolved mystery about a sealed star chart whose destination was removed. This is an open possibility, not an event that already happened.'},
    {kind:'world',mode:'revise',direction:'Expand the world foundations with a rule that every orbital port erases its public electronic records at dawn. Keep the independent freighter setting. No hidden plans or completed plot events.'},
    {kind:'opening',mode:'full',direction:'Plan an opening aboard the ship bridge with the captain, engineer and pilot checking the delivery manifest and debating the missing page. Stop before they decide whether to investigate Lantern Dock. Only a planning brief, not narrative prose.'}
  ];
  for(const input of cases){
    console.log(`Generating ${input.kind} with the saved local text model.`);const before=structuredClone(draft.plan),started=Date.now();
    const next=await generateSetupRecord(draft,input,settings,AbortSignal.timeout(360000));
    assert.equal(next.title,before.title);assert.equal(next.chapterTitle,before.chapterTitle);assert.deepEqual(next.canon.characters,before.canon.characters);
    const group={place:'places',item:'items',relationship:'relationships',thread:'threads'}[input.kind];
    if(group){for(const key of Object.keys(before.canon))if(key!==group)assert.deepEqual(next.canon[key],before.canon[key]);assert.deepEqual(next.context,before.context);
      if(input.mode==='create'){assert.equal(next.canon[group].length,before.canon[group].length+1);assert.deepEqual(next.canon[group].slice(0,-1),before.canon[group]);}
      else {assert.deepEqual(next.canon[group].filter(v=>v.id!==input.targetId),before.canon[group].filter(v=>v.id!==input.targetId));assert.notDeepEqual(next.canon[group].find(v=>v.id===input.targetId),before.canon[group].find(v=>v.id===input.targetId));}
    }else{assert.deepEqual(next.canon,before.canon);const masked=structuredClone(next.context),original=structuredClone(before.context);if(input.kind==='world'){delete masked.lore;delete original.lore;assert.notEqual(worldFoundationEntry(next)?.text,worldFoundationEntry(before)?.text);}else{delete masked.sceneBrief;delete original.sceneBrief;assert.ok(next.context.sceneBrief.purpose.trim());assert.ok(next.context.sceneBrief.stopAt.trim());}assert.deepEqual(masked,original);}
    if(input.kind==='place')assert.equal(next.canon.places.at(-1).name,'Lantern Dock');
    if(input.kind==='item'){const old=before.canon.items.find(i=>i.id===input.targetId),item=next.canon.items.find(i=>i.id===input.targetId);assert.equal(item.ownerId,old.ownerId);assert.equal(item.quantity,old.quantity);assert.equal(item.equipped,old.equipped);assert.match(item.description,/cobalt/i);}
    draft=r.commitGeneratedSetup(draft.id,draft.revision,randomUUID(),`live-${input.kind}`,next);assert.equal(draft.storyId,null);
    results.push({input,durationMs:Date.now()-started,plan:next});
  }
  mkdirSync('test-results',{recursive:true});writeFileSync('test-results/setup-design-live.json',JSON.stringify(scrub({results}),null,2));
  console.log('PASS: real place, possession, relationship, thread, world-foundations and opening-brief generation; scoped edits, stable links and editable saved setup. Normal libraries/settings untouched.');
}catch(e){mkdirSync('test-results',{recursive:true});writeFileSync('test-results/setup-design-live-failure.json',JSON.stringify({error:e.message,traces:diagnostics?.traces()},null,2));throw e;}
finally{r?.close();diagnostics?.close();const target=resolve(folder);assert.ok((target.startsWith(resolve(tmpdir())+'\\')||target.startsWith(resolve(tmpdir())+'/'))&&basename(target).startsWith('storyweaver-setup-design-live-'));rmSync(target,{recursive:true,force:true});}
