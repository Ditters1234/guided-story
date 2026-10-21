import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { unzipSync } from 'fflate';
import { defaultStoryWorkflow } from '../src/lib/story-workflow/default-graph';
import { addBuiltIn,removeBuiltIn,supportedNode,assessPreset,exportPreset,importPreset,presetSaveSchema } from '../src/lib/story-workflow/presets';
import { WorkflowPresetStore } from '../src/lib/server/story-workflow/presets';
import { StoryRepository } from '../src/lib/server/repository';
import { workflowNodeName } from '../src/lib/story-workflow/presentation';

const content=()=>({name:'Author draft',description:'An explicit experimental preset.',definition:defaultStoryWorkflow('continue')});
const command=(revision=0)=>({requestId:randomUUID(),expectedRevision:revision,content:content()});

test('default author drafts retain the exact default policy and report unresolved source bindings',()=>{
  for(const mode of ['opening','continue','replace'] as const){const graph=defaultStoryWorkflow(mode),before=structuredClone(graph),result=assessPreset(graph);assert.equal(result.structuralValid,true);assert.equal(result.executionEnabled,false);assert.equal(result.bindings.length,1);assert.equal(result.bindings[0].code,'unbound-source');assert.deepEqual(graph,before);}
});
test('portable presets detach source IDs and unavailable model references, without mutating the draft',()=>{
  const draft=content();draft.definition.bindings[0]={name:'current-source',kind:'source',sourceKind:'story',sourceId:'private-story'};draft.definition.bindings[1]={name:'text-profile',kind:'model',connectionRef:'unavailable-reference'};
  const before=structuredClone(draft),wire=exportPreset(draft);assert.equal(wire.content.definition.bindings[0].kind==='source'&&wire.content.definition.bindings[0].sourceId,undefined);assert.equal(wire.content.definition.bindings[1].kind==='model'&&wire.content.definition.bindings[1].connectionRef,'unbound');assert.deepEqual(draft,before);
  const input={...wire,content:draft};assert.deepEqual(importPreset(input),wire.content);assert.equal(assessPreset(importPreset(input).definition).bindings.length,2);
});
test('preset envelopes reject copied secrets, scripts, canon and layout fields',()=>{
  const valid=exportPreset(content());
  for(const extra of [{apiKey:'forbidden'},{canon:{}},{positions:[]},{script:'forbidden'}])assert.throws(()=>importPreset({...valid,...extra}));
  const secret=structuredClone(valid) as any;secret.content.definition.bindings[1].apiKey='forbidden';assert.throws(()=>importPreset(secret));
  assert.throws(()=>importPreset({...valid,version:2}));assert.equal(presetSaveSchema.safeParse({...command(),expectedRevision:-1}).success,false);
});
test('built-in authoring assigns stable unique IDs and removes only incident edges',()=>{
  const graph=defaultStoryWorkflow('continue'),before=structuredClone(graph),added=addBuiltIn(graph,'model');assert.equal(added.nodes.at(-1)!.id,'model-2');assert.equal(added.nodes.at(-1)!.binding,'text-profile');assert.deepEqual(graph,before);
  const third=addBuiltIn(added,'model');assert.equal(third.nodes.at(-1)!.id,'model-3');
  const removed=removeBuiltIn(graph,'narrate');assert.ok(!removed.nodes.some(n=>n.id==='narrate'));assert.ok(!removed.edges.some(e=>e.from.node==='narrate'||e.to.node==='narrate'));assert.deepEqual(graph,before);assert.equal(assessPreset(removed).structuralValid,false);
  assert.throws(()=>addBuiltIn(graph,'external-script'));assert.equal(supportedNode('constructor'),undefined);assert.equal(workflowNodeName('constructor'),'constructor');
});
test('draft diagnostics include disconnected required stages and mismatched ports before any execution',()=>{
  const graph=defaultStoryWorkflow('continue');graph.nodes=graph.nodes.filter(n=>n.type!=='commit');graph.edges=graph.edges.filter(e=>e.to.node!=='commit');
  assert.ok(assessPreset(graph).issues.some(issue=>issue.code==='required-stage'));
  const wrong=defaultStoryWorkflow('continue');wrong.edges[0].from={node:'model',port:'model'};assert.ok(assessPreset(wrong).issues.some(issue=>issue.code==='port-type'));
  const unknown=defaultStoryWorkflow('continue');unknown.nodes[0].type='constructor';assert.ok(assessPreset(unknown).issues.some(issue=>issue.code==='unknown-node'));
});
test('preset saves keep immutable versions, unique definition identities and exact request replay',()=>{
  const db=new DatabaseSync(':memory:'),store=new WorkflowPresetStore(db);try{
    const request=command(),first=store.save(null,request);assert.equal(first.revision,1);assert.equal(first.content.definition.id,`preset-${first.id}`);assert.equal(first.content.definition.version,1);assert.deepEqual(store.save(null,request),first);
    const next=command(1);next.content.name='A revised author draft';const second=store.save(first.id,next);assert.equal(second.revision,2);assert.equal(second.content.definition.version,2);assert.deepEqual(store.save(null,request),first);assert.deepEqual(store.read(first.id),second);
    const old=db.prepare('SELECT payload FROM workflow_preset_versions WHERE id=? AND revision=1').get(first.id) as {payload:string};assert.deepEqual(JSON.parse(old.payload),first);assert.equal(store.list().length,1);
    const reopened=new WorkflowPresetStore(db);assert.deepEqual(reopened.read(first.id),second);assert.deepEqual(reopened.save(first.id,next),second);
  }finally{db.close();}
});
test('stale edits, reused request IDs and bad schema roll back without replacing saved drafts',()=>{
  const db=new DatabaseSync(':memory:'),store=new WorkflowPresetStore(db);try{
    const request=command(),first=store.save(null,request),next=command(1);const second=store.save(first.id,next);
    assert.throws(()=>store.save(first.id,command(1)),/another window/);assert.throws(()=>store.save(null,{...request,content:{...request.content,name:'Different'}}),/already used/);
    assert.throws(()=>store.save(first.id,{...command(2),apiKey:'forbidden'}));assert.deepEqual(store.read(first.id),second);assert.equal((db.prepare('SELECT count(*) count FROM workflow_preset_versions').get() as {count:number}).count,2);
    assert.throws(()=>store.save(null,command(2)),/another window/);assert.equal(db.isTransaction,false);
  }finally{db.close();}
});
test('semantically incomplete drafts can be saved but never become a runner definition or canon mutation',()=>{
  const repo=new StoryRepository(':memory:');try{
    const story=repo.create(),before=unzipSync(repo.export(story.id)),request=command();request.content.definition=removeBuiltIn(request.content.definition,'commit');
    const saved=repo.workflowPresets.save(null,request);assert.equal(assessPreset(saved.content.definition).structuralValid,false);assert.equal(assessPreset(saved.content.definition).executionEnabled,false);assert.deepEqual(repo.read(story.id),story);const after=unzipSync(repo.export(story.id));assert.deepEqual(Object.keys(after),Object.keys(before));assert.deepEqual(after['story.json'],before['story.json']);
    assert.equal(defaultStoryWorkflow('continue').nodes.filter(node=>node.type==='commit').length,1);assert.equal(repo.workflows.list().length,0);
  }finally{repo.close();}
});
