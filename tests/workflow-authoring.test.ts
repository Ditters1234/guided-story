import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {defaultStoryWorkflow,builtInStoryNodes} from '../src/lib/story-workflow/default-graph';
import {workflowDefinitionSchema,type WorkflowDefinition, type WorkflowMode} from '../src/lib/story-workflow/contracts';
import {inspectExecutableWorkflow} from '../src/lib/story-workflow/compile';
import {validateWorkflow} from '../src/lib/story-workflow/validate';
import {setRepairMode,exportPreset,importPreset} from '../src/lib/story-workflow/presets';
import {authorPositions,authorNodeHeight,emptyAuthorLayout,readAuthorLayout,nodeGroup} from '../src/lib/story-workflow/authoring';
import {runPassageWorkflow,retryPassageWorkflow,acceptPassageWorkflow} from '../src/lib/server/story-workflow/passage';
import {getJobs} from '../src/lib/server/jobs';
import {workflowSourceOptions} from '../src/lib/story-workflow/sources';
import {workflowFixture,workflowSetupFixture,workflowSettings,scriptedProvider,generationInput,effect} from './workflow-fixture';
const signal=()=>new AbortController().signal;
function configured(mode:WorkflowMode,id:string){
  const graph=defaultStoryWorkflow(mode);graph.bindings[0]={name:'current-source',kind:'source',sourceKind:mode==='opening'?'setup':'story',sourceId:id};
  graph.nodes.find(n=>n.id==='model')!.config={kind:'model',model:'creative-node',temperature:0.45,maxTokens:2048};
  for(const [name,targets,maxTokens] of [['effects-node',['extraction-preflight','extract','repair'],1536],['review-node',['review','rereview'],1024]] as const){
    graph.nodes.push({id:name,type:'model',version:1,binding:'text-profile',config:{kind:'model',model:name,maxTokens}});
    for(const edge of graph.edges)if(targets.includes(edge.to.node as never)&&edge.to.port==='model')edge.from.node=name;
  }return graph;
}
function save(r:ReturnType<typeof workflowFixture>['repository'],graph:WorkflowDefinition){return r.workflowPresets.save(null,{requestId:randomUUID(),expectedRevision:0,content:{name:'Configured alternative',description:'',definition:graph}});}
const reference=(preset:{id:string;revision:number})=>({id:preset.id,revision:preset.revision});

test('supported node configuration is strict, typed, bounded and cannot inject connection credentials or bypass checks',()=>{
  const graph=configured('continue','story');assert.equal(inspectExecutableWorkflow(graph).eligible,true);
  for(const config of [{kind:'model',baseUrl:'http://localhost:1'},{kind:'model',apiKey:'forbidden'},{kind:'model',contextTokens:64000},{kind:'model',model:' '},{kind:'model',temperature:3},{kind:'model',maxTokens:99999},{kind:'script',code:'arbitrary'}]){
    const copy=structuredClone(graph);copy.nodes.find(n=>n.type==='model')!.config=config as any;assert.equal(workflowDefinitionSchema.safeParse(copy).success,false);
  }
  const bad=structuredClone(graph);bad.nodes.find(n=>n.id==='commit')!.config={kind:'repair',mode:'retain'};assert.equal(validateWorkflow(bad,builtInStoryNodes).valid,false);
  const duplicate=structuredClone(graph);duplicate.nodes[0].config={kind:'source',resourceIds:['same','same']};assert.equal(validateWorkflow(duplicate,builtInStoryNodes).valid,false);
  const mixed=structuredClone(graph);mixed.edges.find(e=>e.to.node==='narrate'&&e.to.port==='model')!.from.node='effects-node';assert.ok(inspectExecutableWorkflow(mixed).issues.some(i=>i.code==='request-model'));
  const retain=setRepairMode(graph,'retain');assert.equal(inspectExecutableWorkflow(retain).eligible,true);assert.equal(inspectExecutableWorkflow(setRepairMode(retain,'once')).eligible,true);retain.edges=retain.edges.filter(e=>e.from.port!=='blocked'||e.from.node!=='repair-input');assert.equal(inspectExecutableWorkflow(retain).eligible,false);
});

for(const mode of ['opening','continue','replace'] as const)test(`configured ${mode} routes actual model requests without extra default stages and preserves checkpoint provenance`,async()=>{
  const fixture=mode==='opening'?workflowSetupFixture():workflowFixture(),r=fixture.repository,source='setup'in fixture?fixture.setup:fixture.story;
  try{const preset=save(r,configured(mode,source.id)),provider=scriptedProvider({inventory:true,effects:[],repairedEffects:[effect],reviews:[false,true]}),settings=workflowSettings();
    const saved=await runPassageWorkflow(r,mode,source.id,{...generationInput(source.revision),preset:reference(preset)},settings,signal(),{fetcher:provider.fetcher});
    assert.deepEqual(provider.stages,['narrate','extract','review','repair','review']);assert.deepEqual(provider.requests.map(body=>body.model),['creative-node','effects-node','review-node','effects-node','review-node']);assert.equal(provider.requests[0].temperature,0.45);assert.equal(provider.requests[1].temperature,0.1);assert.equal(provider.requests[0].max_tokens??provider.requests[0].max_completion_tokens,2048);
    assert.equal(saved.canon.items[0].quantity,1);const info=r.passageCheckpoints.info(saved,saved.passages.at(-1)!.id)!;assert.equal(info.workflow!.acceptance.model!.model,'creative-node');assert.equal(info.workflow!.acceptance.models!['effects-node'].model,'effects-node');assert.equal(info.workflow!.acceptance.models!['review-node'].model,'review-node');assert.ok(!JSON.stringify(info).includes(settings.text.apiKey!));assert.equal(workflowSettings().text.model,settings.text.model);
  }finally{r.close();}
});

test('source hints affect scoped preparation only and portable presets detach source-specific selections',async()=>{
  const {repository:r,setup}=workflowSetupFixture();try{
    const plan=structuredClone(setup.plan!);plan.context.lore.push({id:'workflow-hint',title:'Distant silo',text:'An intentional unique detail: the silo has seven blue doors.',keywords:['unrelated'],relatedIds:[],visibility:'relevant'},{id:'hidden-hint',title:'Secret',text:'Hidden sentinel text.',keywords:[],relatedIds:[],visibility:'hidden'});
    const current=r.saveSetup(setup.id,{requestId:randomUUID(),expectedRevision:setup.revision,input:setup.input,plan}),graph=configured('opening',setup.id);graph.nodes[0].config={kind:'source',resourceIds:['workflow-hint']};const preset=save(r,graph),provider=scriptedProvider();
    const saved=await runPassageWorkflow(r,'opening',setup.id,{...generationInput(current.revision),preset:reference(preset)},workflowSettings(),signal(),{fetcher:provider.fetcher});
    assert.ok(JSON.stringify(provider.requests[0]).includes('seven blue doors'));assert.ok(!JSON.stringify(provider.requests).includes('Hidden sentinel text.'));assert.deepEqual(r.readSetup(setup.id).plan!.context.sceneBrief,plan.context.sceneBrief);assert.equal(saved.context.sceneBrief.resourceIds?.includes('workflow-hint')??false,false);
    const portable=exportPreset(preset.content),imported=importPreset(portable);assert.deepEqual(imported.definition.nodes[0].config,{kind:'source',resourceIds:[]});assert.equal(imported.definition.bindings.some(b=>b.kind==='source'&&b.sourceId),false);assert.deepEqual(imported.definition.nodes.find(n=>n.id==='model')!.config,graph.nodes.find(n=>n.id==='model')!.config);
  }finally{r.close();}
});

test('missing/hidden references and above-profile token overrides fail before a provider, job or run starts',async()=>{
  const {repository:r,story}=workflowFixture();try{let calls=0;const fetcher:typeof fetch=async()=>{calls++;throw Error('Unexpected provider');};
    for(const invalid of ['missing','budget'] as const){const graph=configured('continue',story.id);if(invalid==='missing')graph.nodes[0].config={kind:'source',resourceIds:['unavailable']};else for(const node of graph.nodes)if(node.config?.kind==='model')node.config.maxTokens=8192;
      const preset=save(r,graph),input={...generationInput(story.revision),preset:reference(preset)};await assert.rejects(runPassageWorkflow(r,'continue',story.id,input,workflowSettings(),signal(),{fetcher}),/missing or hidden|exceed/);assert.equal(getJobs().find({storyId:story.id,requestId:input.requestId}),null);
    }assert.equal(calls,0);assert.equal(r.workflows.list().length,0);assert.deepEqual(r.read(story.id),story);
  }finally{r.close();}
});

for(const failure of ['deterministic','review'] as const)test(`retain branch stops after ${failure} issues, then recovers without narration`,async()=>{
  const {repository:r,story}=workflowFixture();try{
    const graph=setRepairMode(configured('continue',story.id),'retain'),preset=save(r,graph),input={...generationInput(story.revision),preset:reference(preset)},provider=scriptedProvider(failure==='review'?{inventory:true,effects:[],reviews:[false]}:{inventory:true,effects:[{...effect,expectedQuantity:99}]});
    await assert.rejects(runPassageWorkflow(r,'continue',story.id,input,workflowSettings(),signal(),{fetcher:provider.fetcher}),/retained/);assert.deepEqual(provider.stages,failure==='review'?['narrate','extract','review']:['narrate','extract']);assert.deepEqual(r.read(story.id),story);assert.equal(r.workflows.find(story.id,input.requestId)!.repairAttempts,0);
    r.workflowPresets.lifecycle(preset.id,{requestId:randomUUID(),expectedRevision:1,action:'archive'});
    const kept=r.listRetained('story',story.id)[0],retry={requestId:randomUUID(),expectedRevision:story.revision,expectedVersion:kept.version,notes:''},next=scriptedProvider({inventory:true,effects:[effect]});const checked=await retryPassageWorkflow(r,'story',story.id,kept.id,retry,workflowSettings(),signal(),{fetcher:next.fetcher});assert.deepEqual(next.stages,['extract','review']);assert.equal(next.requests[0].model,'effects-node');
    const run=r.workflows.find(story.id,retry.requestId)!,saved=await acceptPassageWorkflow(r,'story',story.id,run.id,kept.id,{requestId:randomUUID(),expectedRevision:story.revision,expectedVersion:checked.version,notes:''},signal());assert.equal(saved.canon.items[0].quantity,1);assert.equal(saved.passages.length,2);
  }finally{r.close();}
});

test('archive/restore is guarded and idempotent while versions, replay and checkpoints remain immutable',async()=>{
  const {repository:r,story}=workflowFixture();try{
    const preset=save(r,configured('continue',story.id)),input={...generationInput(story.revision),preset:reference(preset)},provider=scriptedProvider(),saved=await runPassageWorkflow(r,'continue',story.id,input,workflowSettings(),signal(),{fetcher:provider.fetcher});
    const archive={requestId:randomUUID(),expectedRevision:1,action:'archive'},archived=r.workflowPresets.lifecycle(preset.id,archive);assert.equal(archived.archived,true);assert.deepEqual(r.workflowPresets.lifecycle(preset.id,archive),archived);assert.equal(r.workflowPresets.list().length,0);assert.equal(r.workflowPresets.list(true).length,1);assert.deepEqual(r.workflowPresets.readVersion(preset.id,1),preset);
    assert.throws(()=>r.workflowPresets.save(preset.id,{requestId:randomUUID(),expectedRevision:1,content:preset.content}),/Restore/);assert.throws(()=>r.workflowPresets.lifecycle(preset.id,{...archive,requestId:randomUUID()}),/status changed/);
    await assert.rejects(runPassageWorkflow(r,'continue',story.id,{...generationInput(saved.revision),preset:reference(preset)},workflowSettings(),signal(),{fetcher:async()=>{throw Error('Unexpected provider');}}),/archived/);
    assert.deepEqual(await runPassageWorkflow(r,'continue',story.id,input,workflowSettings(),signal(),{fetcher:async()=>{throw Error('Unexpected replay provider');}}),saved);assert.ok(r.passageCheckpoints.info(saved,saved.passages.at(-1)!.id));
    r.workflowPresets.lifecycle(preset.id,{requestId:randomUUID(),expectedRevision:1,action:'restore'});const second=r.workflowPresets.save(preset.id,{requestId:randomUUID(),expectedRevision:1,content:{...preset.content,name:'Version two'}});assert.deepEqual(r.workflowPresets.revisions(preset.id).map(row=>row.revision),[2,1]);assert.equal(second.revision,2);assert.throws(()=>r.workflowPresets.lifecycle(preset.id,{requestId:randomUUID(),expectedRevision:1,action:'archive'}),/changed/);
  }finally{r.close();}
});

test('presentation groups and canvas layout are bounded browser state with no executable graph changes',()=>{
  const graph=configured('continue','story'),before=structuredClone(graph),points=authorPositions(graph,emptyAuthorLayout());assert.equal(nodeGroup('model'),'sources');assert.equal(nodeGroup('repair-input'),'checks');
  for(const node of graph.nodes){const a=points.get(node.id)!;for(const other of graph.nodes.filter(n=>n.id!==node.id)){const b=points.get(other.id)!;assert.ok(a.x+290<=b.x||b.x+290<=a.x||a.y+authorNodeHeight(node.type)<=b.y||b.y+authorNodeHeight(other.type)<=a.y,'Initial cards never overlap');}}
  const layout=readAuthorLayout({version:1,positions:[{id:'model',x:80,y:120},{id:'gone',x:0,y:50}],collapsed:['checks']},graph);assert.equal(layout.positions.length,1);assert.equal(authorPositions(graph,layout).get('model')!.x,80);assert.deepEqual(graph,before);
  assert.deepEqual(readAuthorLayout({...layout,positions:[{id:'model',x:Infinity,y:50}]},graph),emptyAuthorLayout());assert.deepEqual(readAuthorLayout({...layout,collapsed:['checks','checks']},graph),emptyAuthorLayout());
});

test('source picker metadata excludes hidden text, prose and copied canonical record fields',()=>{
  const {repository:r,story}=workflowFixture();try{
    story.context.lore.push({id:'visible',title:'Visible heading',text:'A private detail stays out of the picker payload.',keywords:[],relatedIds:[],visibility:'relevant'},{id:'hidden',title:'Hidden heading',text:'Hidden sentinel.',keywords:[],relatedIds:[],visibility:'hidden'});
    const before=structuredClone(story),rows=workflowSourceOptions(story),payload=JSON.stringify(rows);assert.ok(rows.some(row=>row.id==='visible'));assert.ok(!rows.some(row=>row.id==='hidden'));assert.ok(!payload.includes('private detail'));assert.ok(!payload.includes('paragraphs'));assert.ok(!payload.includes('quantity'));assert.deepEqual(story,before);
  }finally{r.close();}
});

test('effects-only recovery keeps provenance after a narration hint is removed and its unused token allowance changes',async()=>{
  const {repository:r,story}=workflowFixture();try{
    const context=structuredClone(story.context);context.lore.push({id:'old-hint',title:'Earlier author background',text:'A detail relevant only to the original narration.',keywords:[],relatedIds:[],visibility:'relevant'});
    let current=r.mutate(story.id,{requestId:randomUUID(),expectedRevision:story.revision,action:{type:'context',context}});
    const graph=setRepairMode(configured('continue',story.id),'retain');graph.nodes[0].config={kind:'source',resourceIds:['old-hint']};const preset=save(r,graph),input={...generationInput(current.revision),preset:reference(preset)};
    await assert.rejects(runPassageWorkflow(r,'continue',story.id,input,workflowSettings(),signal(),{fetcher:scriptedProvider({inventory:true,effects:[{...effect,expectedQuantity:99}]}).fetcher}),/retained/);
    const nextContext=structuredClone(current.context);nextContext.lore=[];current=r.mutate(current.id,{requestId:randomUUID(),expectedRevision:current.revision,action:{type:'context',context:nextContext}});
    const draft=r.listRetained('story',story.id)[0],retry={requestId:randomUUID(),expectedRevision:current.revision,expectedVersion:draft.version,notes:''},provider=scriptedProvider({inventory:true,effects:[effect]});
    const retrySettings=workflowSettings();retrySettings.text.maxTokens=1536;
    const checked=await retryPassageWorkflow(r,'story',story.id,draft.id,retry,retrySettings,signal(),{fetcher:provider.fetcher});assert.deepEqual(provider.stages,['extract','review']);
    const run=r.workflows.find(story.id,retry.requestId)!,saved=await acceptPassageWorkflow(r,'story',story.id,run.id,draft.id,{requestId:randomUUID(),expectedRevision:current.revision,expectedVersion:checked.version,notes:''},signal());assert.equal(saved.canon.items[0].quantity,1);assert.deepEqual(saved.context.lore,[]);assert.deepEqual(r.passageCheckpoints.info(saved,saved.passages.at(-1)!.id)!.workflow!.generation!.definition.nodes[0].config,{kind:'source',resourceIds:['old-hint']});
  }finally{r.close();}
});
