<script lang="ts">
  import { tick, untrack, onDestroy } from 'svelte';
  import { reportUiError } from './ui-feedback';
  import type { Story } from './story';
  import { downloadSetup } from './setup-download';
  let {id,title,revision,kind,busy=$bindable(false),onRemoved,onRenamed,onRefresh,onDirty=()=>{}}: {
    id:string;title:string;revision:number;kind:'story'|'setup';busy?:boolean;
    onRemoved:(id:string,kind:'story'|'setup')=>void;onRenamed:(story:Story)=>void;onRefresh:()=>Promise<void>;
    onDirty?:(dirty:boolean)=>void;
  }=$props();
  let editing=$state(false),name=$state(untrack(()=>title)),problem=$state('');
  let titleInput=$state<HTMLInputElement>();
  let activity=$state('');
  let renameTitle=$state(untrack(()=>title)),renameRevision=$state(untrack(()=>revision));
  const stale=$derived(editing&&(renameRevision!==revision||renameTitle!==title));
  const dirty=$derived(editing&&(name.trim()!==renameTitle||stale));
  $effect(()=>onDirty(dirty));
  onDestroy(()=>onDirty(false));
  $effect(()=>{if(problem)untrack(()=>reportUiError(problem,'Library'));});
  function loadTitle(){name=title;renameTitle=title;renameRevision=revision;pending=null;problem='';}
  async function toggleRename(){if(editing&&dirty&&!confirm('Discard the unsaved story title?'))return;loadTitle();editing=!editing;if(editing){await tick();titleInput?.focus();titleInput?.select();}}
  async function reload(){if(busy)return;busy=true;activity='Reloading library…';try{await onRefresh();problem='';pending=null;}catch(e){problem=e instanceof Error?e.message:'Could not reload the library.';}finally{busy=false;activity='';}}
  async function exportSetup(){if(busy)return;busy=true;activity='Preparing setup ZIP…';problem='';try{await downloadSetup(id);}catch(e){problem=e instanceof Error?e.message:'Could not export setup.';}finally{busy=false;activity='';}}
  let pending:{key:string;requestId:string}|null=null;
  async function send(action:'rename'|'remove'){
    if(busy)return;
    if(action==='rename'&&stale){problem='This story changed while its title was being edited. Load the saved title before renaming.';return;}
    if(action==='remove'&&!confirm(kind==='story'?`Delete “${title}” from this library? Export a ZIP first if you want a copy. This removes its saved story, editor history and stored workflow details. Shared picture files are retained. This cannot be undone.`:`Discard the unfinished setup “${title}” and its stored workflow details? This cannot be undone.`))return;
    const expectedRevision=action==='rename'?renameRevision:revision;
    const key=JSON.stringify({id,revision:expectedRevision,action,title:name.trim()});if(pending?.key!==key)pending={key,requestId:crypto.randomUUID()};
    busy=true;activity=action==='rename'?'Saving story title…':kind==='story'?'Deleting story…':'Discarding setup…';problem='';
    try{
      const response=await fetch(`/api/${kind==='story'?'stories':'setups'}/${id}`,{method:action==='remove'?'DELETE':'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision,requestId:pending.requestId,...(action==='rename'?{action:{type:'story-title',title:name.trim()}}:{})})});
      const body=await response.json();if(!response.ok)throw new Error(body.error||'Library change failed.');
      pending=null;if(action==='remove')onRemoved(id,kind);else{onRenamed(body);editing=false;}
    }catch(e){problem=e instanceof Error?e.message:'Could not confirm the library change.';}
    finally{busy=false;activity='';}
  }
</script>

<div class="library-controls" aria-busy={Boolean(activity)}>
  <div class="row">{#if kind==='story'}<button disabled={busy} onclick={toggleRename} aria-expanded={editing} aria-controls={'rename-'+id}>Rename story</button>{:else}<button disabled={busy} onclick={exportSetup}>Export setup ZIP</button>{/if}<button class="danger" disabled={busy} onclick={()=>send('remove')}>{kind==='story'?'Delete story':'Discard setup'}</button></div>
  {#if editing}<form id={'rename-'+id} aria-label={'Rename '+title} onsubmit={e=>{e.preventDefault();send('rename');}}><label>Story title<input bind:this={titleInput} bind:value={name} required maxlength="200" disabled={busy} /></label><div class="row"><button class="primary" disabled={busy||!name.trim()||name.trim()===title||stale}>Save title</button><button type="button" disabled={busy} onclick={()=>editing=false}>Cancel rename</button>{#if dirty}<span class="muted" role="status">Unsaved title</span>{/if}</div>{#if stale}<p class="notice" role="status">This story changed while its title was being edited. Your draft is kept; load the saved title before renaming.</p><button type="button" disabled={busy} onclick={loadTitle}>Load saved title</button>{/if}</form>{/if}
  {#if activity}<p class="muted" role="status">{activity}</p>{/if}
  {#if problem}<p class="error" role="alert">{problem}</p><button disabled={busy} onclick={reload}>Reload library</button>{/if}
</div>
