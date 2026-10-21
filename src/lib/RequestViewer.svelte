<script lang="ts">
  import {onMount,untrack,tick} from 'svelte';
  import {activeJobStates,activityElapsed,activityName,type ActivitySnapshot,type ActivityRequest} from './activity';
  import type {TraceEntry} from './diagnostic-types';
  import {uiErrors,reportUiError} from './ui-feedback';
  let {busy=false,status=''}:{busy?:boolean;status?:string}=$props();
  let expanded=$state(false),snapshot=$state<ActivitySnapshot|null>(null),problem=$state(''),working=$state(false),now=$state(Date.now());
  let tab=$state<'requests'|'errors'>('requests'),copyNote=$state('');
  const unread=$derived($uiErrors.filter(e=>!e.read).length);
  let selected=$state<TraceEntry|null>(null),selectedId=$state(''),detailProblem=$state(''),loadingDetail=$state(false);
  let toggleButton:HTMLButtonElement,viewerElement:HTMLElement,alive=false,inFlight=false,timer:ReturnType<typeof setTimeout>,controller:AbortController,detailController:AbortController|null=null;
  const reconciling=new Set<string>();let imageCursor=0,lastImageCheck=0;
  const running=$derived(snapshot?.requests.filter(r=>r.status==='pending')||[]);
  const activeJobs=$derived(snapshot?.jobs.filter(j=>activeJobStates.includes(j.state))||[]);
  const summary=$derived(problem?'Status unavailable':snapshot?`${snapshot.activeRequests} running · ${snapshot.activeJobs} ${snapshot.activeJobs===1?'job':'jobs'}`:'Connecting…');
  const pretty=(value:unknown)=>JSON.stringify(value,null,2);
  async function read(response:Response){const body=await response.json();if(!response.ok)throw new Error(body.error||'Request activity is unavailable.');return body;}
  async function inspect(request:ActivityRequest){
    selectedId=request.id;selected=null;detailProblem='';detailController?.abort();const current=new AbortController();detailController=current;loadingDetail=true;
    try{
      const result=await read(await fetch('/api/dev/diagnostics?trace='+encodeURIComponent(request.id),{signal:AbortSignal.any([current.signal,AbortSignal.timeout(10000)])}));
      if(alive&&!current.signal.aborted&&selectedId===request.id){selected=result;if(!result)detailProblem='This request is no longer retained in diagnostics.';}
    }catch(e){if(alive&&!current.signal.aborted&&selectedId===request.id)detailProblem=e instanceof Error?e.message:'Could not load this request.';}
    finally{if(alive&&selectedId===request.id&&!current.signal.aborted)loadingDetail=false;}
  }
  function reconcileImages(data:ActivitySnapshot){
    if(Date.now()-lastImageCheck<5000)return;
    const images=data.jobs.filter(j=>activeJobStates.includes(j.state)&&j.recoverable&&['image-test','story-illustration'].includes(j.kind));
    if(!images.length)return;lastImageCheck=Date.now();const job=images[imageCursor++%images.length];if(reconciling.has(job.id))return;reconciling.add(job.id);
    // Read the existing prompt on its original server. This never queues, interrupts or accepts a picture.
    const path=job.storyId?`/api/stories/${encodeURIComponent(job.storyId)}/illustrations/${job.id}`:`/api/image-tests/${job.id}`;
    void fetch(path,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(50000)])}).then(read).catch(()=>{}).finally(()=>reconciling.delete(job.id));
  }
  async function refresh(){
    if(!alive||inFlight||document.hidden)return;inFlight=true;working=true;clearTimeout(timer);
    try{
      const data:ActivitySnapshot=await read(await fetch('/api/dev/activity',{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)])}));
      if(!alive)return;snapshot=data;problem='';now=Date.now();uiErrors.ingest(data);reconcileImages(data);
      const updated=data.requests.find(r=>r.id===selectedId);
      if(expanded&&updated&&selected&&(updated.status!==selected.status||updated.finishedAt!==selected.finishedAt))void inspect(updated);
    }catch(e){if(alive&&!controller.signal.aborted)problem=e instanceof Error?e.message:'Could not refresh API activity.';}
    finally{inFlight=false;if(alive){working=false;timer=setTimeout(refresh,expanded||busy||running.length||activeJobs.length?2000:5000);}}
  }
  function toggle(){expanded=!expanded;if(expanded){tab='requests';void refresh();}}
  function showErrors(){expanded=true;tab='errors';copyNote='';uiErrors.markRead();void refresh();}
  async function copyErrors(){try{await navigator.clipboard.writeText($uiErrors.map(e=>`${e.lastAt} · ${e.source}${e.count>1?` · ${e.count} reports`:''}\n${e.message}`).join('\n\n'));copyNote='Errors copied.';}catch{reportUiError('Clipboard access is unavailable. Select the error text to copy it.','Error viewer');}}
  function tabKeys(event:KeyboardEvent){if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();tab=event.key==='Home'?'requests':event.key==='End'?'errors':tab==='requests'?'errors':'requests';viewerElement?.querySelector<HTMLButtonElement>(`#activity-tab-${tab}`)?.focus();}
  function inspectError(requestId:string){tab='requests';const request=snapshot?.requests.find(r=>r.id===requestId);if(request)void inspect(request);}
  async function collapse(){expanded=false;await tick();toggleButton?.focus();}
  $effect(()=>{if(busy)untrack(()=>void refresh());});
  $effect(()=>{if(expanded&&tab==='errors'&&unread)untrack(()=>uiErrors.markRead());});
  $effect(()=>{if(problem)untrack(()=>reportUiError(problem,'Activity connection'));});
  $effect(()=>{if(detailProblem)untrack(()=>reportUiError(detailProblem,'Request details'));});
  onMount(()=>{
    alive=true;controller=new AbortController();void refresh();
    const clock=setInterval(()=>{if(!document.hidden&&(expanded||running.length||activeJobs.length))now=Date.now();},1000);
    const visible=()=>{if(!document.hidden)void refresh();};document.addEventListener('visibilitychange',visible);
    return()=>{alive=false;clearTimeout(timer);clearInterval(clock);controller.abort();detailController?.abort();document.removeEventListener('visibilitychange',visible);};
  });
</script>

<svelte:window onkeydown={e=>{if(e.key==='Escape'&&expanded&&e.target instanceof Node&&viewerElement?.contains(e.target)){e.stopPropagation();void collapse();}}} />
<section class="request-viewer" aria-label="API request viewer" bind:this={viewerElement}>
  <div class="request-viewer-bar">
  <button class="request-viewer-toggle" bind:this={toggleButton} aria-label="Toggle API request viewer" aria-expanded={expanded} aria-controls="request-viewer-body" onclick={toggle}>
    <span class="request-dot" class:running={running.length>0||activeJobs.length>0} class:unavailable={Boolean(problem)} aria-hidden="true"></span>
    <strong>API requests</strong><span class="request-viewer-summary">{summary}{#if !problem&&running[0]} · {activityName(running[0].kind)} · {activityElapsed(running[0].at,now)}{:else if !problem&&activeJobs[0]} · {activityName(activeJobs[0].kind)} · {activeJobs[0].state}{:else if status} · {status}{/if}</span><span aria-hidden="true">{expanded?'⌄':'⌃'}</span>
  </button>
  <button class="error-count" class:has-errors={$uiErrors.length>0} class:unread={unread>0} aria-label="Show errors" title={$uiErrors[0]?.message||'No errors recorded in this session'} onclick={showErrors}>{$uiErrors.length?`${$uiErrors.length} ${$uiErrors.length===1?'error':'errors'}`:'No errors'}{#if unread}<span class="unread-dot" aria-hidden="true"></span>{/if}</button>
  </div>
  <span class="error-announcement" role="status" aria-live="polite" aria-atomic="true">{unread?`${unread} new ${unread===1?'error':'errors'}. ${$uiErrors[0]?.message.slice(0,240)} Open Errors in the bottom panel for details.`:''}</span>
    <div id="request-viewer-body" hidden={!expanded}>
  {#if expanded}
      <div class="request-viewer-heading"><div><h2>Activity &amp; errors</h2><p>Live status for this instance. Credentials are redacted.</p></div><div class="row"><button onclick={refresh} disabled={working}>Refresh activity</button><button onclick={collapse}>Collapse request viewer</button></div></div>
      <div class="activity-tabs" role="tablist" aria-label="Activity views" tabindex="-1" onkeydown={tabKeys}>
        <button id="activity-tab-requests" role="tab" aria-selected={tab==='requests'} aria-controls="activity-requests" tabindex={tab==='requests'?0:-1} class:active={tab==='requests'} onclick={()=>tab='requests'}>Requests</button>
        <button id="activity-tab-errors" role="tab" aria-selected={tab==='errors'} aria-controls="activity-errors" tabindex={tab==='errors'?0:-1} class:active={tab==='errors'} onclick={()=>tab='errors'}>Errors<span aria-hidden="true"> · {$uiErrors.length}</span></button>
      </div>
      {#if problem}<p class="request-viewer-problem" role="status">{problem}{snapshot?` Last update: ${new Date(snapshot.at).toLocaleTimeString()}.`:''}</p>{/if}
      <div id="activity-requests" role="tabpanel" aria-labelledby="activity-tab-requests" hidden={tab!=='requests'} class="request-viewer-grid">
        <div class="request-viewer-list">
          {#if snapshot?.jobs.length}<details class="request-viewer-jobs"><summary>Generation jobs · {snapshot.activeJobs} active</summary>{#each snapshot.jobs as job (job.id)}<div class="request-job" data-state={job.state}><strong>{activityName(job.kind)}</strong><small>{job.state}{job.stage?` · ${job.stage.replace(/-/g,' ')}`:''} · {activityElapsed(job.createdAt,now,activeJobStates.includes(job.state)?undefined:job.updatedAt)}{job.attempt>1?` · attempt ${job.attempt}`:''}</small>{#if job.error}<p>{job.error}</p>{/if}</div>{/each}</details>{/if}
          <h3>API calls</h3>
          {#each snapshot?.requests||[] as request (request.id)}
            <button class="request-call" class:selected={selectedId===request.id} data-status={request.status} aria-pressed={selectedId===request.id} onclick={()=>inspect(request)}><span><strong>{activityName(request.kind)}</strong><small>{request.model||(['image-test','story-illustration','connection-comfy'].includes(request.kind)?'ComfyUI':'Text API')}{request.storyId?` · story ${request.storyId.slice(0,8)}`:' · application'}</small></span><span><b>{request.status==='pending'?'Running':request.status==='error'?'Failed':'Complete'}</b><small>{activityElapsed(request.at,now,request.finishedAt)}</small></span></button>
          {:else}<p class="muted">{snapshot?'No API calls recorded yet. Start generation or run a connection test.':'Loading request activity…'}</p>{/each}
          <p class="muted">Active calls and the 20 most recent completed calls. Dry runs and local saves are excluded.</p>
        </div>
        <div class="request-viewer-detail" aria-label="Selected API request">
          {#if loadingDetail}<p role="status">Loading request…</p>{:else if detailProblem}<p role="status">{detailProblem}</p>{:else if selected}
            <h3>{activityName(selected.kind)}</h3><p class="muted">{selected.status==='pending'?'Waiting for the provider':selected.status==='error'?'Request failed':'Request complete'} · {activityElapsed(selected.at,now,selected.finishedAt)} · {new Date(selected.at).toLocaleTimeString()}</p>
            {#if selected.error}<p class="request-viewer-problem">{selected.error}</p>{/if}
            <details open><summary>Request payload</summary><pre>{pretty(selected.request)}</pre></details>
            <details open><summary>Response</summary>{#if selected.response!==undefined&&selected.response!==null}<pre>{pretty(selected.response)}</pre>{:else}<p class="muted">{selected.status==='pending'?'Waiting for the completed response.':'No response body was captured.'}</p>{/if}</details>
          {:else}<p class="muted">Select an API call to inspect its sent prompt or workflow, returned result and errors. The viewer stays available while the story or Settings is busy.</p>{/if}
        </div>
      </div>
      <div id="activity-errors" role="tabpanel" aria-labelledby="activity-tab-errors" hidden={tab!=='errors'} class="error-inbox">
        <div class="heading-row"><p class="muted">Save, form, browser and generation errors. Clearing this list keeps your story and Dev logs.</p><div class="row"><button onclick={copyErrors} disabled={!$uiErrors.length}>Copy errors</button><button onclick={()=>{uiErrors.clear();copyNote='Errors cleared.';}} disabled={!$uiErrors.length}>Clear errors</button></div></div>
        {#if copyNote}<p class="muted" role="status">{copyNote}</p>{/if}
        {#each $uiErrors as entry (entry.id)}<article class="error-entry"><div class="heading-row"><small>{entry.source} · <time datetime={entry.lastAt}>{new Date(entry.lastAt).toLocaleTimeString()}</time>{#if entry.count>1} · {entry.count} reports{/if}</small><button aria-label="Dismiss error" title="Dismiss this error" onclick={()=>uiErrors.dismiss(entry.id)}>Dismiss</button></div><p>{entry.message}</p>{#if entry.requestId&&snapshot?.requests.some(r=>r.id===entry.requestId)}<button onclick={()=>inspectError(entry.requestId!)}>View API request</button>{/if}</article>
        {:else}<div class="empty-errors"><strong>No errors to show</strong><p>New errors appear here without interrupting your work. The bottom badge stays visible while you read or edit.</p></div>{/each}
        <p class="muted">Up to 100 recent errors in this browser session. Server history remains in Dev → Console.</p>
      </div>
  {/if}
    </div>
</section>

<style>
  .request-viewer{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:min(100%,1280px);z-index:30;background:var(--page);border:1px solid var(--line);border-bottom:0;box-shadow:0 -8px 25px #00000012;padding-bottom:env(safe-area-inset-bottom)}
  .error-announcement{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
  .request-viewer-bar{display:flex;background:var(--panel);align-items:center}.request-viewer-bar .request-viewer-toggle{min-width:0;flex:1}.error-count{flex-shrink:0;margin-right:16px;font-size:12px;display:flex;align-items:center;gap:7px}.error-count.has-errors{color:light-dark(#963b30,#e6aaa0)}.error-count.unread{border-color:currentColor}.unread-dot{width:6px;height:6px;border-radius:50%;background:currentColor}#request-viewer-body{max-height:min(74dvh,720px);overflow:auto;overscroll-behavior:contain}.activity-tabs{display:flex;gap:6px;padding:8px 24px;border-bottom:1px solid var(--line)}.activity-tabs button{font-size:12px}.request-viewer [hidden]{display:none}.error-inbox{padding:16px 24px;max-height:min(48dvh,470px);overflow:auto;overscroll-behavior:contain}.error-inbox>.heading-row{align-items:start;margin-bottom:16px}.error-inbox .muted{margin:0 0 12px}.error-inbox>.heading-row>p{max-width:480px}.error-inbox button{font-size:12px}.error-entry{padding:15px;border:1px solid var(--line);border-left:3px solid light-dark(#963b30,#e6aaa0);border-radius:6px;margin-bottom:12px;background:var(--panel);overflow-wrap:anywhere}.error-entry small{font-size:11px;color:var(--muted)}.error-entry p{white-space:pre-wrap;font-size:13px;margin:12px 0}.error-entry .heading-row button{padding:4px 8px}.empty-errors{padding:20px 0}.empty-errors p{font-size:13px;color:var(--muted);margin:8px 0 20px}
  .request-viewer-toggle{display:flex;align-items:center;gap:10px;width:100%;min-height:52px;text-align:left;border:0;border-radius:0;padding:12px 24px;background:var(--panel)}
  .request-viewer-toggle strong{white-space:nowrap;font-size:13px}.request-viewer-summary{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:var(--muted);font-size:12px}
  .request-dot{height:8px;width:8px;border-radius:50%;background:var(--muted);flex-shrink:0}.request-dot.running{background:var(--accent);box-shadow:0 0 0 3px var(--line)}.request-dot.unavailable{background:light-dark(#a25c30,#d5a476)}
  .request-viewer-heading{padding:14px 24px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}.request-viewer-heading h2{font:21px Georgia,serif;margin:0 0 6px}.request-viewer-heading p{font-size:12px;color:var(--muted);margin:0}.request-viewer-heading button{font-size:12px}
  .request-viewer-grid{display:grid;grid-template-columns:minmax(240px,36%) minmax(0,1fr);max-height:min(55dvh,530px);min-height:160px}.request-viewer-list,.request-viewer-detail{padding:18px 24px;overflow:auto;min-width:0}.request-viewer-list{border-right:1px solid var(--line)}.request-viewer-list h3{margin-top:16px}.request-call{display:flex;justify-content:space-between;align-items:start;gap:12px;width:100%;text-align:left;margin:8px 0;font-size:12px;padding:10px}.request-call>span{min-width:0}.request-call>span:last-child{flex-shrink:0;text-align:right}.request-call strong,.request-call small{display:block;overflow-wrap:anywhere}.request-call small{font-size:11px;color:var(--muted);margin-top:4px}.request-call b{font-weight:500}.request-call.selected{border-color:var(--accent);background:var(--panel)}.request-call[data-status=error] b{color:light-dark(#963b30,#e6aaa0)}.request-call[data-status=pending] b{color:var(--accent)}
  .request-viewer details>summary{cursor:pointer;font-size:12px}.request-viewer-jobs{margin-bottom:20px}.request-job{padding:10px 0;border-bottom:1px solid var(--line);overflow-wrap:anywhere}.request-job strong{font-size:12px}.request-job small{display:block;color:var(--muted);font-size:11px}.request-job p{font-size:12px;margin:5px 0}.request-viewer-detail h3{font-size:15px}.request-viewer-detail details{margin:16px 0}.request-viewer-detail pre{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;font:12px/1.6 ui-monospace,monospace;background:var(--panel);padding:14px;border:1px solid var(--line);border-radius:6px;max-height:360px;overflow:auto}.request-viewer-detail details>p{margin:12px 0}.request-viewer-problem{font-size:12px;padding:10px 24px;margin:0;background:var(--panel);color:light-dark(#963b30,#e6aaa0);overflow-wrap:anywhere}.request-viewer-detail .request-viewer-problem{padding:12px}
  @media(max-width:650px){.request-viewer-toggle{padding:12px 16px;gap:8px}.request-viewer-toggle strong{font-size:12px}.request-viewer-summary{font-size:11px}.request-viewer-heading{padding:12px 16px}.request-viewer-grid{grid-template-columns:minmax(0,1fr);max-height:60dvh;overflow:auto}.request-viewer-list,.request-viewer-detail{padding:14px 16px;overflow:visible}.request-viewer-list{border-right:0;border-bottom:1px solid var(--line)}.request-viewer-detail pre{max-height:240px}}
  @media(max-width:650px){.error-count{margin-right:10px;padding:7px 9px;font-size:11px}.activity-tabs,.error-inbox{padding-left:16px;padding-right:16px}.request-viewer-bar .request-viewer-toggle{padding-right:8px}.request-viewer-toggle strong{font-size:11px}.request-viewer-heading .row{gap:6px}.request-viewer-heading button{padding:6px 8px}}
  @media(prefers-reduced-motion:reduce){.request-viewer *{scroll-behavior:auto}}
</style>
