import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { defaultStoryWorkflow } from '../src/lib/story-workflow/default-graph';
import { inspectExecutableWorkflow } from '../src/lib/story-workflow/compile';
import type { WorkflowMode } from '../src/lib/story-workflow/contracts';
import { runPassageWorkflow,retryPassageWorkflow,acceptPassageWorkflow } from '../src/lib/server/story-workflow/passage';
import { generatePassageEntry } from '../src/lib/server/passage-entry';
import { inspectWorkflowRun } from '../src/lib/server/story-workflow/inspection';
import { workflowFixture,workflowSetupFixture,workflowSettings,scriptedProvider,generationInput,effect } from './workflow-fixture';
import { getJobs } from '../src/lib/server/jobs';

const signal=()=>new AbortController().signal;
function routed(mode:WorkflowMode,id:string){const graph=defaultStoryWorkflow(mode);graph.bindings[0]={name:'current-source',kind:'source',sourceKind:mode==='opening'?'setup':'story',sourceId:id};graph.bindings.push({name:'updates-profile',kind:'model',connectionRef:'configured-text'});graph.nodes.push({id:'updates-model',type:'model',version:1,binding:'updates-profile'});for(const edge of graph.edges)if(edge.from.node==='model'&&['extraction-preflight','extract','review','repair','rereview'].includes(edge.to.node))edge.from.node='updates-model';return graph;}
function save(r:ReturnType<typeof workflowFixture>['repository'],mode:WorkflowMode,id:string){return r.workflowPresets.save(null,{requestId:randomUUID(),expectedRevision:0,content:{name:'Routed text stages',description:'',definition:routed(mode,id)}});}
const ref=(preset:{id:string;revision:number})=>({id:preset.id,revision:preset.revision});

test('compiler admits only complete built-in paths with connected configured model routing',()=>{
  const graph=routed('continue','story');assert.equal(inspectExecutableWorkflow(graph).eligible,true);assert.equal(inspectExecutableWorkflow({...graph,nodes:graph.nodes.slice().reverse(),edges:graph.edges.slice().reverse()}).eligible,true);
  const extra=structuredClone(graph);extra.nodes.push({id:'write-extra',type:'narrate',version:1});assert.equal(inspectExecutableWorkflow(extra).eligible,false);
  const rename=structuredClone(graph);rename.nodes.find(n=>n.id==='commit')!.id='save';for(const edge of rename.edges)if(edge.to.node==='commit')edge.to.node='save';assert.ok(inspectExecutableWorkflow(rename).issues.some(issue=>issue.code==='stage-shape'));
  const bypass=structuredClone(graph);bypass.edges=bypass.edges.filter(e=>e.to.node!=='acceptance'||e.to.port!=='candidates');bypass.edges.push({from:{node:'rereview',port:'checked'},to:{node:'acceptance',port:'candidates'}});assert.ok(inspectExecutableWorkflow(bypass).issues.some(issue=>issue.code==='check-path'));
  const unused=structuredClone(graph);unused.nodes.push({id:'unused-model',type:'model',version:1,binding:'text-profile'});assert.ok(inspectExecutableWorkflow(unused).issues.some(issue=>issue.code==='unused-model'));
});

for(const mode of ['opening','continue','replace'] as const)for(const scenario of ['quiet','expanded','inventory','repair'] as const)test(`saved preset ${mode}/${scenario} preserves exact default provider requests and proposals`,async()=>{
  const a=mode==='opening'?workflowSetupFixture():workflowFixture(),b=mode==='opening'?workflowSetupFixture():workflowFixture();
  const r=a.repository,next=b.repository,source='setup'in a?a.setup:a.story,target='setup'in b?b.setup:b.story;
  try{
    // Align saved facts and historical prose through portable imports for full wire comparison.
    const aligned=mode==='opening'?next.importSetup(r.exportSetup(source.id)):await next.import(r.export(source.id));
    const kind=mode==='opening'?'setup':'story',targetId=aligned.id,revision=aligned.revision;
    const options=scenario==='quiet'?{}:scenario==='expanded'?{short:true}:scenario==='inventory'?{inventory:true,effects:[effect]}:{inventory:true,short:true,effects:[],repairedEffects:[effect],reviews:[false,true]};
    const normal=scriptedProvider(options),custom=scriptedProvider(options),configuration=workflowSettings();
    const expected=await runPassageWorkflow(r,mode,source.id,generationInput(source.revision),configuration,signal(),{fetcher:normal.fetcher});
    const preset=save(next,mode,targetId),input={...generationInput(revision),preset:ref(preset)};
    const saved=await runPassageWorkflow(next,mode,targetId,input,configuration,signal(),{fetcher:custom.fetcher});
    assert.deepEqual(custom.requests,normal.requests);assert.deepEqual(custom.stages,normal.stages);assert.deepEqual(saved.canon,expected.canon);
    const run=next.workflows.find(targetId,input.requestId)!;assert.equal(run.workflowId,preset.content.definition.id);assert.equal(run.workflowVersion,preset.revision);assert.equal(run.status,'completed');assert.deepEqual(next.workflows.definition(run.id),preset.content.definition);
    const artifacts=next.workflows.artifacts(run.id),model=artifacts.find(a=>a.metadata.nodeId==='updates-model')!;assert.ok(model);assert.ok(!JSON.stringify(model.value).includes(configuration.text.apiKey!));assert.ok(!JSON.stringify(model.value).includes(configuration.text.baseUrl));
    assert.ok(next.workflows.attempts(run.id).find(a=>a.nodeId==='extract')!.inputArtifactIds.includes(model.metadata.id));assert.equal(inspectWorkflowRun(next,run.id,configuration).implementationChanged,false);
    if(kind==='story')assert.equal(next.listRetained(kind,targetId).length,0);else assert.equal(next.readSetup(targetId).storyId,saved.id);
  }finally{r.close();next.close();}
});

test('invalid, stale, missing and cross-source presets fail without jobs, runs or provider requests',async()=>{
  const {repository:r,story}=workflowFixture();try{
    let calls=0;const fetcher:typeof fetch=async()=>{calls++;throw Error('Provider must not be called');},c=workflowSettings();
    const invalids=[(g:ReturnType<typeof routed>)=>{g.nodes=g.nodes.filter(n=>n.id!=='commit');g.edges=g.edges.filter(e=>e.to.node!=='commit');},(g:ReturnType<typeof routed>)=>{g.bindings[0]={name:'current-source',kind:'source',sourceKind:'story',sourceId:'another-story'};},(g:ReturnType<typeof routed>)=>{g.bindings[1]={name:'text-profile',kind:'model',connectionRef:'missing'};},(g:ReturnType<typeof routed>)=>{g.bindings[0]={name:'current-source',kind:'source',sourceKind:'story'};}];
    for(const change of invalids){const graph=routed('continue',story.id);change(graph);const preset=r.workflowPresets.save(null,{requestId:randomUUID(),expectedRevision:0,content:{name:'Invalid',description:'',definition:graph}}),input={...generationInput(story.revision),preset:ref(preset)};await assert.rejects(runPassageWorkflow(r,'continue',story.id,input,c,signal(),{fetcher}));assert.equal(getJobs().find({storyId:story.id,requestId:input.requestId}),null);}
    await assert.rejects(runPassageWorkflow(r,'continue',story.id,{...generationInput(story.revision),preset:{id:randomUUID(),revision:1}},c,signal(),{fetcher}),{status:404});
    const missingId=randomUUID(),missing=save(r,'continue',missingId);await assert.rejects(runPassageWorkflow(r,'continue',missingId,{...generationInput(1),preset:ref(missing)},c,signal(),{fetcher}),{status:404});
    const preset=save(r,'continue',story.id),input={...generationInput(story.revision),preset:ref(preset)};r.workflowPresets.save(preset.id,{requestId:randomUUID(),expectedRevision:1,content:preset.content});await assert.rejects(runPassageWorkflow(r,'continue',story.id,input,c,signal(),{fetcher}),/preset changed/);
    const current=r.workflowPresets.read(preset.id);await assert.rejects(runPassageWorkflow(r,'continue',story.id,{...generationInput(story.revision+1),preset:ref(current)},c,signal(),{fetcher}),/changed/);
    c.text.model='';await assert.rejects(runPassageWorkflow(r,'continue',story.id,{...generationInput(story.revision),preset:ref(current)},c,signal(),{fetcher}),/configured text model/);
    assert.equal(calls,0);assert.equal(r.workflows.list().length,0);assert.deepEqual(r.read(story.id),story);
  }finally{r.close();}
});

test('completed preset replay uses its immutable revision after preset edits and a changed source',async()=>{
  const {repository:r,story}=workflowFixture();try{const preset=save(r,'continue',story.id),input={...generationInput(story.revision),preset:ref(preset)},c=workflowSettings();c.context.autoCompact=false;const provider=scriptedProvider();
    const saved=await generatePassageEntry(r,'continue',story.id,input,c,signal(),{fetcher:provider.fetcher,engine:'legacy'});assert.equal(r.workflows.find(story.id,input.requestId)!.status,'completed');
    r.workflowPresets.save(preset.id,{requestId:randomUUID(),expectedRevision:1,content:{...preset.content,name:'Later version'}});
    assert.deepEqual(await generatePassageEntry(r,'continue',story.id,input,c,signal(),{fetcher:async()=>{throw Error('Unexpected replay call');}}),saved);assert.deepEqual(provider.stages,['narrate','extract']);
  }finally{r.close();}
});

test('effects-only preset retries pin the original graph across later draft edits and accept once',async()=>{
  const {repository:r,story}=workflowFixture();try{
    const preset=save(r,'continue',story.id),input={...generationInput(story.revision),preset:ref(preset)};
    await assert.rejects(runPassageWorkflow(r,'continue',story.id,input,workflowSettings(),signal(),{fetcher:scriptedProvider({malformed:true}).fetcher}),/retained/);
    const draft=r.listRetained('story',story.id)[0];const broken=structuredClone(preset.content);broken.definition.nodes=broken.definition.nodes.filter(node=>node.id!=='commit');broken.definition.edges=broken.definition.edges.filter(edge=>edge.to.node!=='commit');r.workflowPresets.save(preset.id,{requestId:randomUUID(),expectedRevision:1,content:broken});
    const action={requestId:randomUUID(),expectedRevision:story.revision,expectedVersion:draft.version,notes:''},provider=scriptedProvider();const checked=await retryPassageWorkflow(r,'story',story.id,draft.id,action,workflowSettings(),signal(),{fetcher:provider.fetcher});assert.deepEqual(provider.stages,['extract']);
    const run=r.workflows.find(story.id,action.requestId)!;assert.deepEqual(r.workflows.definition(run.id),preset.content.definition);assert.equal(run.status,'awaiting-acceptance');const accept={requestId:randomUUID(),expectedRevision:story.revision,expectedVersion:checked.version,notes:''};const saved=await acceptPassageWorkflow(r,'story',story.id,run.id,draft.id,accept,signal());assert.equal(saved.passages.length,2);assert.deepEqual(await acceptPassageWorkflow(r,'story',story.id,run.id,draft.id,accept,signal()),saved);
  }finally{r.close();}
});
