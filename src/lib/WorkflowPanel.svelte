<script lang="ts">
  import { onMount, onDestroy, tick, untrack } from 'svelte';
  import type { Story } from './story';
  import type { SetupDraft } from './setup';
  import type { WorkflowInspection, WorkflowNodeInspection, WorkflowRunList } from './server/story-workflow/inspection';
  import { workflowNodeName, workflowModeName } from './story-workflow/presentation';
  import WorkflowGraph from './WorkflowGraph.svelte';
  import PassageRecovery from './PassageRecovery.svelte';
  let {busy=$bindable(false),canGenerate=false,onDirty=()=>{},onEditPresets=()=>{},currentStory,onRead,onOpenSource,onSaved}:{busy?:boolean;canGenerate?:boolean;onDirty?:(value:boolean)=>void;onEditPresets?:()=>void;currentStory?:{id:string;title:string};onRead?:()=>void;onOpenSource:(kind:'setup'|'story',id:string,record?:{kind:'item'|'character'|'place';id:string})=>void;onSaved:(story:Story)=>void}=$props();
  let scope=$state('all');
  let runs=$state<WorkflowRunList['runs']>([]),next=$state<number|null>(null),query=$state(''),listLoading=$state(false),listFailed=$state(false);
  let selected=$state(''),detail=$state<WorkflowInspection|null>(null),node=$state<WorkflowNodeInspection|null>(null),nodeId=$state(''),source=$state<Story|SetupDraft|null>(null);
  let loading=$state(false),nodeLoading=$state(false),detailFailed=$state(false),problem=$state(''),nodeProblem=$state(''),note=$state(''),dirty=$state(false),showGraph=$state(false),refreshKey=$state(0);
  let listController:AbortController|undefined,detailController:AbortController|undefined,nodeController:AbortController|undefined,serial=0,nodeSerial=0;
  let inspectorHeading=$state<HTMLHeadingElement>(),recoveryHeading=$state<HTMLHeadingElement>(),needsRefresh=$state(false);
  let actionRequest:{key:string;requestId:string}|null=null;
  const visible=$derived(runs.filter(row=>(scope!=='current'||!currentStory||(row.run.source.kind==='story'&&row.run.source.id===currentStory.id))&&`${row.title} ${row.run.mode} ${row.run.status} ${row.run.source.kind} ${row.run.source.id} ${row.run.id}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())));
  const unavailable=$derived(loading||listLoading||listFailed||detailFailed);
  const sourceStale=$derived(Boolean(source&&detail&&detail.sourceRevision!==null&&source.revision!==detail.sourceRevision));
  const chosen=$derived(detail?.nodes.find(n=>n.id===nodeId));
  const links=$derived(detail?.definition.edges.filter(edge=>edge.from.node===nodeId||edge.to.node===nodeId)??[]);
  const prose=$derived.by(()=>{for(const output of node?.outputs??[]){const value=output.value as any;const paragraphs=value?.content?.draft?.paragraphs??value?.draft?.paragraphs??(output.metadata.type==='narration'?value?.paragraphs:null);if(Array.isArray(paragraphs)&&paragraphs.every(p=>typeof p==='string'))return paragraphs as string[];}return [];});
  const pretty=(value:unknown)=>JSON.stringify(value,null,2);
  async function read(response:Response){const body=await response.json();if(!response.ok)throw new Error(body.error||'Workflow history is unavailable.');return body;}
  function mayLeave(){return !dirty||confirm('Discard the unsubmitted rechecking guidance? Submit it with Retry world updates first to keep it.');}
  async function loadRuns(older=false){
    if(listLoading||busy)return;listController?.abort();listController=new AbortController();listLoading=true;
    try{const result:WorkflowRunList=await read(await fetch('/api/story-workflows'+(older&&next?`?before=${next}`:''),{signal:listController.signal}));runs=older?[...runs,...result.runs]:result.runs;next=result.next;listFailed=false;problem='';}
    catch(error){if(!listController.signal.aborted){listFailed=true;problem=error instanceof Error?error.message:'Could not load workflow history.';}}
    finally{listLoading=false;}
  }
  async function selectRun(id:string,refresh=false){
    if(busy||(!refresh&&selected!==id&&!mayLeave()))return;
    const count=++serial;detailController?.abort();nodeController?.abort();detailController=new AbortController();loading=true;detailFailed=false;problem='';note='';node=null;nodeProblem='';
    if(selected!==id){try{localStorage.setItem('guided-story-workflow-run',id);}catch{/* Inspection remains usable without browser storage. */}selected=id;detail=null;source=null;dirty=false;onDirty(false);}
    try{
      const result:WorkflowInspection=await read(await fetch(`/api/story-workflows/${id}`,{signal:detailController.signal}));if(count!==serial)return;
      let current:Story|SetupDraft|null=null;
      const response=await fetch(`/api/${result.run.source.kind==='setup'?'setups':'stories'}/${result.run.source.id}`,{signal:detailController.signal});
      if(response.ok)current=await response.json();else if(response.status!==404)throw new Error('Could not load current saved facts. Reload the run before using recovery.');
      if(count!==serial)return;detail=result;source=current;refreshKey++;
      const preferred=refresh&&result.nodes.some(n=>n.id===nodeId)?nodeId:result.nodes.find(n=>['failed','blocked','cancelled','interrupted'].includes(n.status))?.id??result.nodes.find(n=>n.status==='running')?.id??'source';
      await selectNode(preferred,false);
    }catch(error){if(count===serial&&!detailController.signal.aborted){detailFailed=true;problem=error instanceof Error?error.message:'Could not load this run.';}}
    finally{if(count===serial)loading=false;}
  }
  async function selectNode(id:string,focus=true,attemptId?:string){
    if(!selected)return;nodeId=id;const count=++nodeSerial;nodeController?.abort();nodeController=new AbortController();nodeLoading=true;node=null;nodeProblem='';
    try{const result=await read(await fetch(`/api/story-workflows/${selected}/nodes/${encodeURIComponent(id)}${attemptId?`?attempt=${attemptId}`:''}`,{signal:nodeController.signal}));if(count!==nodeSerial)return;node=result;if(focus){await tick();inspectorHeading?.focus({preventScroll:true});}}
    catch(error){if(count===nodeSerial&&!nodeController.signal.aborted)nodeProblem=error instanceof Error?error.message:'Could not load this stage.';}
    finally{if(count===nodeSerial)nodeLoading=false;}
  }
  async function refresh(){await loadRuns();if(selected)await selectRun(selected,true);}
  async function recover(){
    if(!detail||!source||!detail.recovery.canRecover||busy||unavailable||sourceStale||dirty)return;
    let failure='';
    const current=detail,key=`${current.run.id}:${current.version}:${source.revision}`;
    if(actionRequest?.key!==key)actionRequest={key,requestId:crypto.randomUUID()};busy=true;problem='';
    try{await read(await fetch(`/api/story-workflows/${current.run.id}/recover`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedVersion:current.version,expectedRevision:source.revision,requestId:actionRequest.requestId})}));actionRequest=null;}
    catch(error){failure=error instanceof Error?error.message:'Could not recover this prose.';}
    finally{busy=false;await selectRun(current.run.id,true);if(failure)problem=failure;else{note='Complete prose recovered. Retry its world updates, then review before saving.';await tick();recoveryHeading?.focus({preventScroll:true});}}
  }
  async function removeDetails(){
    if(!detail||busy||unavailable||dirty||!detail.removal.allowed)return;
    if(!confirm('Remove this run’s stored snapshots, stage outputs and provider bodies from workflow history? The saved story and request receipt are kept. This cannot be undone.'))return;
    const current=detail;let failure='';busy=true;problem='';
    try{await read(await fetch(`/api/story-workflows/${current.run.id}`,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedVersion:current.version})}));note='Stored workflow details removed. The saved story and request receipt are kept.';}
    catch(error){failure=error instanceof Error?error.message:'Could not remove these details.';}
    finally{busy=false;await loadRuns();await selectRun(current.run.id,true);if(failure)problem=failure;else note='Stored workflow details removed. The saved story and request receipt are kept.';}
  }
  async function copyProse(){try{await navigator.clipboard.writeText(prose.join('\n\n'));note='Stored prose copied.';}catch{nodeProblem='Select the stored prose below to copy it.';}}
  function guidance(value:boolean){dirty=value;onDirty(value);}
  async function recoverySaved(saved:Story){onSaved(saved);source=detail?.run.source.kind==='story'?saved:source;dirty=false;onDirty(false);needsRefresh=true;}
  $effect(()=>{if(needsRefresh&&!busy){needsRefresh=false;untrack(()=>{void refresh();});}});
  onMount(()=>{void loadRuns().then(()=>{let id='';try{id=localStorage.getItem('guided-story-workflow-run')||'';}catch{/* Optional remembered selection. */}if(/^[0-9a-f-]{36}$/i.test(id))void selectRun(id);});});
  onDestroy(()=>{serial++;nodeSerial++;listController?.abort();detailController?.abort();nodeController?.abort();onDirty(false);});
</script>

<main class="workflow-view">
  <div class="eyebrow">Story workflows</div><h1>Workflow history</h1>
  <p>Inspect passage runs and recover retained prose, or customize a graph in the preset editor.</p>
  <div class="workflow-entry"><div><h2>Build your workflow</h2><p class="muted">Start from a built-in graph, choose a saved source and configure its nodes. Select the saved preset when writing a passage.</p></div><div class="row"><button class="primary" onclick={onEditPresets} disabled={busy}>Edit workflow presets</button>{#if currentStory&&onRead}<button onclick={onRead} disabled={busy}>Return to story</button>{/if}</div></div>
  {#if problem}<p class="notice" role="alert">{problem}</p>{/if}{#if note}<p role="status">{note}</p>{/if}
  <div class="controls"><label>Find a run<input type="search" bind:value={query} placeholder="Story, opening, failed…" /></label>{#if currentStory}<label>Workflow source filter<select aria-label="Workflow source filter" bind:value={scope}><option value="all">All saved sources</option><option value="current">Current story · {currentStory.title}</option></select></label>{/if}<button type="button" onclick={refresh} disabled={busy||loading||listLoading}>{listLoading?'Loading history…':'Refresh workflow history'}</button></div>
  <p class="muted" role="status">{visible.length} of {runs.length} loaded runs{next?' · Older runs available':''}. Filters change the list; the selected run stays open.</p>
  <div class="run-list" aria-label="Workflow runs">{#each visible as row}<button type="button" class:chosen={selected===row.run.id} aria-pressed={selected===row.run.id} onclick={()=>selectRun(row.run.id)} disabled={busy||loading}><strong>{row.title} · {workflowModeName(row.run.mode)}</strong><span>{row.run.status.replaceAll('-',' ')} · {row.removedAt?'Detailed calls removed':`${row.calls} provider calls`} · {new Date(row.run.createdAt).toLocaleString()}{row.removedAt?' · Details removed':''}</span><small>{row.run.id}</small></button>{:else}<p class="muted">{listLoading?'Loading runs…':query||scope==='current'?'No matching runs in this page of history.':'No story workflow runs yet. New generated passages will appear here.'}</p>{#if query||scope==='current'}<button onclick={()=>{query='';scope='all';}}>Show all loaded runs</button>{/if}{/each}</div>
  {#if next}<button type="button" onclick={()=>loadRuns(true)} disabled={busy||listLoading}>Load older runs</button>{/if}
  {#if loading}<p role="status">Loading run and current saved facts…</p>{/if}
  {#if detail}
    <section class="run-detail" aria-label="Selected workflow run">
      <h2>{detail.title} · {workflowModeName(detail.run.mode)}</h2><p><strong>{detail.displayStatus.replaceAll('-',' ')}</strong> · Source revision {detail.run.source.revision} · Workflow v{detail.run.workflowVersion}</p><p class="muted">Definition: {detail.run.workflowId} · version {detail.run.workflowVersion}</p>
      {#if detail.active}<p role="status">Generation or checking is active for this source. Refresh to see its progress. Recovery and history removal wait until it finishes.</p>{/if}
      {#if detail.changes.length}<aside class="notice" aria-label="Changes since this run"><h3>Changes since this run</h3><ul>{#each detail.changes as change}<li>{change}</li>{/each}</ul></aside>{:else if !detail.removedAt}<p class="muted">The saved source still matches this run’s source. A completed model result remains the result of its recorded attempt.</p>{/if}
      {#if sourceStale}<p class="notice">The source changed while this inspector loaded. Refresh workflow history before using recovery.</p>{/if}
      {#if source}<button type="button" onclick={()=>onOpenSource(detail!.run.source.kind,detail!.run.source.id)} disabled={busy}>Open current {detail.run.source.kind==='setup'?'setup':'story'} and editors</button>{/if}
      {#if detail.removedAt}<p>Stored details were removed on {new Date(detail.removedAt).toLocaleString()}. The definition and request receipt remain to prevent accidental resubmission.</p>
      {:else}
        <div class="controls"><button type="button" aria-expanded={showGraph} onclick={()=>showGraph=!showGraph}>{showGraph?'Hide workflow diagram':'Show workflow diagram'}</button><span class="muted">Stage list and inspector work without the diagram.</span></div>
        {#if showGraph}<WorkflowGraph inspection={detail} selected={nodeId} onSelect={id=>selectNode(id)} />{/if}
        <div class="inspection-grid"><nav class="stages" aria-label="Workflow stages">{#each detail.nodes as stage,i}<button type="button" class:chosen={nodeId===stage.id} aria-pressed={nodeId===stage.id} onclick={()=>selectNode(stage.id)}><strong>{i+1}. {workflowNodeName(stage.id)}</strong><span>{stage.status.replaceAll('-',' ')} · {stage.attempts.length} attempt{stage.attempts.length===1?'':'s'}</span></button>{/each}</nav>
          <section class="node-inspector" aria-label="Stage inspector"><h3 tabindex="-1" bind:this={inspectorHeading}>{workflowNodeName(nodeId)}</h3>
            <button type="button" onclick={()=>{recoveryHeading?.focus({preventScroll:true});recoveryHeading?.scrollIntoView({block:'start'});}}>Go to supported recovery</button>
            {#if chosen}<p class="muted">Implementation v{chosen.version} · {chosen.providerCeiling?`At most ${chosen.providerCeiling} provider call per attempt`:'Deterministic stage; no provider call'}</p>
              <label>Recorded attempt<select value={node?.attempt?.id??''} disabled={nodeLoading||!chosen.attempts.length} onchange={event=>selectNode(nodeId,false,event.currentTarget.value)}>{#if !chosen.attempts.length}<option value="">No attempt reached</option>{/if}{#each chosen.attempts as attempt}<option value={attempt.id}>Attempt {attempt.attempt} · {attempt.status}</option>{/each}</select></label>
              <details><summary>Typed connections · {links.length}</summary><ul class="connections">{#each links as link}<li><button type="button" onclick={()=>selectNode(link.from.node===nodeId?link.to.node:link.from.node)}>{workflowNodeName(link.from.node)}.{link.from.port} → {workflowNodeName(link.to.node)}.{link.to.port}</button><code>{detail.nodes.find(n=>n.id===link.from.node)?.outputs[link.from.port]?.type}</code></li>{/each}</ul></details>
            {/if}
            {#if nodeLoading}<p role="status">Loading resolved stage data…</p>{/if}{#if nodeProblem}<p class="notice" role="alert">{nodeProblem}</p><button type="button" onclick={()=>selectNode(nodeId,false)}>Reload stage</button>{/if}
            {#if node}
              {#if node.attempt?.error}<p class="notice">{node.attempt.error}</p>{/if}
              {#each node.checks as check}<div class="check-result"><strong>{check.kind==='model'?'Model consistency check':'Deterministic validation'} · {check.status}</strong>{#each check.issues as issue}<p>{issue.message}</p>{/each}</div>{/each}
              {#each node.issues as issue}<p class="notice">{typeof issue==='string'?issue:pretty(issue)}</p>{/each}
              {#if prose.length}<details open><summary>Stored prose</summary><article class="stored-prose">{#each prose as paragraph}<p>{paragraph}</p>{/each}</article><button type="button" onclick={copyProse}>Copy stored prose</button></details>{/if}
              {#if node.selection.length}<details><summary>Selected references and context report</summary><pre>{pretty(node.selection)}</pre></details>{/if}
              {#if node.references.length}<details><summary>Records included in this request · {node.references.length}</summary><p class="muted">Scoped records, compact references and reference-only people are labeled separately. Being included does not establish presence, access or viewpoint knowledge.</p><pre>{pretty(node.references)}</pre></details>{/if}
              {#each node.provider as call}<section class="provider"><h4>Recorded provider call · {call.status??'completion unknown'}</h4><p>Estimated input: {call.estimatedInputTokens??'unavailable'} tokens · Output ceiling: {call.outputTokenCeiling??'unavailable'} tokens</p><p class="muted">Estimates exclude connection overhead. Actual usage is supplied by the provider, when available.</p><pre>{pretty(call.usage??'Provider usage unavailable')}</pre>{#if call.error}<p class="notice">{call.error}</p>{/if}<details><summary>Sent request</summary><pre>{pretty(call.request)}</pre></details><details><summary>{call.complete?'Returned response':'Incomplete / unknown response'}</summary><pre>{pretty(call.response)}</pre></details></section>{/each}
              <details><summary>Resolved inputs · {node.inputs.length}</summary>{#each node.inputs as input}<h4>{workflowNodeName(input.metadata.nodeId)}.{input.metadata.port} · {input.metadata.type}</h4><p>{input.metadata.origin==='model'?'Retained model result':'Deterministic output'} · Source revision {input.metadata.source.revision}</p><details><summary>Source provenance and versions</summary><pre>{pretty(input.metadata)}</pre>{#if input.metadata.runId!==selected}<button type="button" onclick={()=>selectRun(input.metadata.runId)}>Inspect parent run</button>{/if}</details><pre>{pretty(input.value)}</pre>{/each}</details>
              <details><summary>Stored outputs · {node.outputs.length}</summary>{#each node.outputs as output}<h4>{output.metadata.port} · {output.metadata.type}</h4><p>{output.metadata.origin==='model'?'Retained model result; a new call requires an explicit action':'Deterministic output'}</p><details><summary>Output provenance and versions</summary><pre>{pretty(output.metadata)}</pre></details><pre>{pretty(output.value)}</pre>{/each}</details>
              {#if !node.attempt}<p class="muted">This stage was not reached. Inspect the preceding failure or conditional branch.</p>{/if}
            {/if}
          </section>
        </div>
      {/if}
      <section class="recovery-controls" aria-label="Workflow recovery"><h3 tabindex="-1" bind:this={recoveryHeading}>Supported recovery</h3>
        <p>Reuse complete prose to re-extract world updates, validate them and run at most one repair. Narration and short-prose expansion are not repeated. Changed history or an invalid rewrite baseline cannot be rebased here.</p>
        {#if detail.recovery.canRecover}<button type="button" onclick={recover} disabled={busy||unavailable||sourceStale||dirty}>Recover complete stored prose</button><p class="muted">No model call. This creates a retained draft that must be explicitly checked and reviewed.</p>{/if}
        {#if detail.recovery.retained?.latestReviewId&&detail.recovery.retained.latestReviewId!==selected}<button type="button" onclick={()=>selectRun(detail!.recovery.retained!.latestReviewId!)} disabled={busy}>Inspect latest successful check</button>{/if}
        {#if source&&detail.recovery.retained}
          {#key `${selected}:${detail.run.source.kind}:${detail.run.source.id}`}<PassageRecovery {source} kind={detail.run.source.kind} bind:busy {canGenerate} disabled={unavailable||sourceStale||detail.active} {refreshKey} onDirty={guidance} onReload={()=>{if(detail?.publishedStoryId)onOpenSource('setup',detail.run.source.id);else void selectRun(selected,true);}} onSaved={recoverySaved} onChecked={()=>{needsRefresh=true;}} onDiscard={()=>{needsRefresh=true;}} onEdit={(kind,id)=>onOpenSource(detail!.run.source.kind,detail!.run.source.id,{kind,id})} />{/key}
        {:else if detail.recovery.closedStatus}<p>This retained draft was {detail.recovery.closedStatus}. Its historical outputs remain readable until you remove stored details.</p>
        {:else if !detail.recovery.canRecover}<p class="muted">{detail.removedAt?'Detailed outputs were removed.':detail.active?'Wait for the active operation, or cancel it through the activity controls.':detail.run.status==='completed'?'This run already saved its result.':'No recoverable complete prose is available for the current source. Inspect stored outputs for reading or copying.'}</p>{/if}
      </section>
      <section class="lifecycle"><h3>Stored history</h3><p>Detailed snapshots and provider bodies stay on this computer and are excluded from story ZIPs. Removing them keeps the saved story and request receipt.</p><button type="button" onclick={removeDetails} disabled={busy||unavailable||dirty||!detail.removal.allowed}>Remove stored details</button>{#if detail.removal.reason}<p class="muted">{detail.removal.reason}</p>{/if}</section>
    </section>
  {/if}
</main>
<style>
  .workflow-entry{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;padding:18px;border:1px solid var(--line);border-radius:8px;background:var(--panel);margin:22px 0}.workflow-entry>div:first-child{flex:1 1 280px}.workflow-entry h2{font-size:21px}.workflow-entry p{margin:0}
  .workflow-view{max-width:1300px;margin:auto;padding:24px;min-width:0}.controls{display:flex;gap:14px;align-items:end;flex-wrap:wrap;margin:16px 0}.controls label{flex:1;min-width:190px}.run-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:8px;max-height:350px;overflow:auto;margin:16px 0}.run-list button,.stages button{text-align:left;display:grid;gap:5px;overflow-wrap:anywhere;min-width:0}.run-list small{font-size:.7rem}.chosen{border:2px solid #385f57!important}.run-list span,.stages span{font-size:.8rem;text-transform:capitalize}.run-detail{margin-top:28px;border-top:1px solid #bbb;padding-top:18px;min-width:0}.inspection-grid{display:grid;grid-template-columns:minmax(200px,270px) minmax(0,1fr);gap:22px;margin:20px 0}.stages{display:grid;gap:6px;align-content:start;max-height:720px;overflow:auto;padding:2px}.node-inspector{min-width:0;border:1px solid #ccc;border-radius:10px;padding:18px}.node-inspector h3{scroll-margin-top:100px}.node-inspector details{margin:12px 0;min-width:0}.node-inspector summary{cursor:pointer;overflow-wrap:anywhere}.node-inspector pre{max-height:420px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f3ef;color:#26332e;padding:12px;font-size:.76rem;border-radius:6px;max-width:100%}.node-inspector label{display:grid;gap:5px}.connections{padding-left:20px}.connections li{margin:8px 0}.connections button{font-size:.78rem;white-space:normal;overflow-wrap:anywhere}.connections code{display:block;font-size:.75rem}.provider,.check-result{padding:10px;border:1px solid #ccc;margin:10px 0;border-radius:8px}.stored-prose{max-height:450px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.65}.recovery-controls,.lifecycle{margin:24px 0;padding-top:15px;border-top:1px solid #bbb}.notice{padding:12px;border:1px solid #b09a70;border-radius:8px;overflow-wrap:anywhere}.node-inspector select{max-width:100%}button:focus-visible,[tabindex]:focus-visible{outline:3px solid #385f57;outline-offset:3px}@media(max-width:700px){.workflow-view{padding:14px}.inspection-grid{grid-template-columns:1fr}.stages{max-height:240px}.node-inspector{padding:12px}.run-list{max-height:280px}.controls{align-items:stretch}.controls>*{width:100%}}
</style>
