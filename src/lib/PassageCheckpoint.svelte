<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { Story } from './story';
  import { continuationPresetFromCheckpoint, type PassageCheckpointInfo } from './passage-checkpoints';
  import { exportPreset, type PresetContent } from './story-workflow/presets';
  let {story,passageId,busy=false,onFork,onDirty,onReuse}:{story:Story;passageId:string;busy?:boolean;onFork:(body:unknown)=>Promise<boolean>;onDirty:(dirty:boolean)=>void;onReuse:(content:PresetContent)=>void}=$props();
  let open=$state(false),loading=$state(false),loaded=$state(false),problem=$state(''),info=$state<PassageCheckpointInfo|null>(null);
  let title=$state(''),baseline=$state('');
  let controller:AbortController|undefined,request:{key:string;id:string}|null=null;
  const recordedModel=$derived(info?.workflow?.generation?.model??info?.workflow?.acceptance.model);
  $effect(()=>onDirty(title!==baseline));
  onDestroy(()=>{controller?.abort();onDirty(false);});
  async function load(){
    if(loading||busy)return;controller?.abort();const current=controller=new AbortController();loading=true;loaded=false;info=null;problem='';
    try{const response=await fetch(`/api/stories/${encodeURIComponent(story.id)}/passages/${encodeURIComponent(passageId)}/checkpoint`,{signal:current.signal});const value=await response.json();if(!response.ok)throw new Error(value.error||'Could not load this checkpoint.');if(current.signal.aborted)return;info=value.checkpoint;loaded=true;if(!title){title=`${story.title.slice(0,160)} (fork)`;baseline=title;}}
    catch(error){if(!current.signal.aborted)problem=error instanceof Error?error.message:'Could not load this checkpoint.';}
    finally{if(controller===current)loading=false;}
  }
  function toggle(){open=!open;if(open&&!loaded)void load();}
  async function fork(){
    if(!info||busy||loading||problem||!title.trim())return;
    const body={expectedRevision:story.revision,checkpoint:info.checkpoint,title:title.trim()},key=JSON.stringify(body);
    if(request?.key!==key)request={key,id:crypto.randomUUID()};
    if(await onFork({...body,requestId:request.id})){baseline=title;request=null;}
  }
  function download(){
    if(!info?.workflow)return;
    const value=exportPreset({name:`${info.title.slice(0,130)} workflow`,description:'Recorded passage workflow. Choose a saved source and passage mode before reuse. New runs use current configured model settings.',definition:info.workflow.acceptance.definition});
    const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='passage-workflow-preset.json';link.click();URL.revokeObjectURL(url);
  }
</script>

<section class="passage-checkpoint" aria-label="Passage checkpoint">
  <button type="button" onclick={toggle} aria-expanded={open} disabled={busy}>Passage checkpoint &amp; fork</button>
  {#if open}
    <div class="checkpoint-body">
      {#if loading}<p role="status">Loading saved checkpoint…</p>{/if}
      {#if problem}<p role="alert">{problem}</p><button type="button" onclick={load} disabled={busy||loading}>Retry checkpoint load</button>{/if}
      {#if loaded&&info}
        <button type="button" onclick={load} disabled={busy||loading}>Refresh checkpoint</button>
        <p>Saved at “{info.title}” · {info.passageCount} {info.passageCount===1?'passage':'passages'} · {new Date(info.capturedAt).toLocaleString()}</p>
        <p class="muted">Open a separate story with the prose, world, knowledge, memories, rules and preferences saved at this point. Continue from here using your current model settings. Later events and edits stay in the original story.</p>
        {#if info.differsFromCurrent}<p class="notice">Earlier prose or titles have since been edited. This fork uses the original saved checkpoint.</p>{/if}
        {#if info.workflow}
          <p>Workflow: {info.workflow.acceptance.definition.id} · version {info.workflow.acceptance.definition.version}</p>
          {#if recordedModel}<p class="muted">Recorded narration model: {recordedModel.model} · temperature {recordedModel.temperature} · context limit {recordedModel.contextTokens.toLocaleString()}</p>{/if}
          {#if info.workflow.generation?.runId!==info.workflow.acceptance.runId}<p class="muted">The prose and its accepted world updates came from separate checks. Both workflow records are preserved.</p>{/if}
          <button type="button" onclick={download} disabled={busy}>Download workflow preset</button>
          <button type="button" onclick={()=>onReuse(continuationPresetFromCheckpoint($state.snapshot(info!),story.id))} disabled={busy}>Edit workflow for this story</button>
          <details><summary>Recorded workflow metadata</summary><pre>{JSON.stringify(info.workflow,null,2)}</pre></details>
        {:else}<p class="muted">The world checkpoint is available. No node-workflow metadata was recorded for this passage.</p>{/if}
        <form onsubmit={event=>{event.preventDefault();void fork();}}>
          <label>New story title<input bind:value={title} maxlength="200" required disabled={busy||loading}/></label>
          <button class="primary" disabled={busy||loading||!title.trim()}>Start new story from this passage</button>
        </form>
        <p class="muted">Story ZIP exports include these checkpoints and workflow definitions.</p>
      {:else if loaded}<p class="notice">No saved world checkpoint is available for this older passage. New accepted passages save one automatically; earlier world state cannot be reconstructed safely.</p>{/if}
    </div>
  {/if}
</section>

<style>
  .passage-checkpoint{margin:1rem 0}.checkpoint-body{padding:1rem;border:1px solid var(--border,#8886);border-radius:.6rem;margin-top:.6rem;overflow-wrap:anywhere}form{display:grid;gap:.7rem;margin-top:1rem}input{width:100%;box-sizing:border-box}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:22rem;overflow:auto;font-size:.8rem}details{margin-top:.8rem}button{max-width:100%;white-space:normal}
</style>
