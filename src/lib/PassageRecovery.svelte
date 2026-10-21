<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
  import type { Story } from './story';
  import type { SetupDraft } from './setup';
  import type { RetainedPassage, RecoveryAction } from './passage-recovery';
  import { evidenceSources } from './passage-evidence';
  let { source, kind, refreshKey=0, busy=$bindable(false), disabled=false, canGenerate=false, onSaved, onChecked=()=>{}, onDiscard=()=>{}, onDirty=()=>{}, onCount=()=>{}, onReload, onEdit }: {
    source:Story|SetupDraft;kind:'story'|'setup';refreshKey?:number;busy?:boolean;disabled?:boolean;canGenerate?:boolean;
    onSaved:(story:Story,draft:RetainedPassage)=>void;onDiscard?:()=>void;onDirty?:(dirty:boolean)=>void;onCount?:(count:number)=>void;
    onChecked?:(draft:RetainedPassage)=>void;
    onReload?:()=>void;onEdit?:(kind:'item'|'character'|'place',id:string)=>void;
  }=$props();
  let drafts=$state<RetainedPassage[]>([]),problem=$state(''),note=$state(''),publishedStoryId=$state(''),loading=$state(false),working=$state(''),workingVerb=$state(''),notes=$state<Record<string,string>>({}),savedRevision=$state(-1),heading=$state<HTMLHeadingElement>();
  let controller:AbortController|undefined,listController:AbortController|undefined,activeRequest='',sequence=0;
  let listFailed=$state(false);
  let pending:{key:string;input:RecoveryAction}|null=null;
  const path=$derived(`/api/${kind==='setup'?'setups':'stories'}/${source.id}/recovery`);
  const stale=$derived(savedRevision>=0&&savedRevision!==source.revision);
  const unavailable=$derived(loading||listFailed);
  const closedGuidance=$derived(Object.entries(notes).filter(([id,text])=>text.trim()&&!drafts.some(draft=>draft.id===id)));
  const canon=$derived('canon'in source?source.canon:source.plan!.canon);
  $effect(()=>onCount(drafts.length));
  $effect(()=>onDirty(Object.values(notes).some(value=>value.trim().length>0)));
  $effect(()=>{const key=`${path}:${source.revision}:${refreshKey}`;untrack(()=>{void key;void load();});});
  onDestroy(()=>{listController?.abort();controller?.abort();onDirty(false);onCount(0);});
  async function json(response:Response){const body=await response.json();if(!response.ok)throw new Error(body.error||'The retained passage request failed.');return body;}
  async function load(){
    const serial=++sequence;listController?.abort();listController=new AbortController();loading=true;
    try{
      const body=await json(await fetch(path,{signal:listController.signal}));if(serial!==sequence)return;
      const newlyRetained=!drafts.length&&body.drafts.length>0;
      drafts=body.drafts;savedRevision=body.sourceRevision;publishedStoryId=body.publishedStoryId||'';problem='';listFailed=false;if(drafts.length)note='';
      if(newlyRetained&&refreshKey>0){await tick();heading?.focus({preventScroll:true});heading?.scrollIntoView({block:'start'});}
    }
    catch(error){if(serial===sequence&&!listController.signal.aborted){listFailed=true;problem=error instanceof Error?error.message:'Could not load retained passages.';}}
    finally{if(serial===sequence)loading=false;}
  }
  async function act(draft:RetainedPassage,verb:'retry'|'apply'|'discard'){
    if(busy||unavailable||disabled||stale||(verb==='apply'&&hasGuidance(draft)))return;
    if(verb==='discard'&&!confirm('Discard this unaccepted passage and its world-update preview? The saved story stays as it is. Copy the prose first if you want to keep it.'))return;
    const body={expectedVersion:draft.version,expectedRevision:source.revision,notes:verb==='retry'?(notes[draft.id]||''):''},key=JSON.stringify({path,id:draft.id,verb,body});
    if(pending?.key!==key)pending={key,input:{...body,requestId:crypto.randomUUID()}};
    const request=pending.input;activeRequest=request.requestId;controller=new AbortController();busy=true;working=draft.id;workingVerb=verb;problem='';note='';
    try{
      const result=await json(await fetch(`${path}/${draft.id}/${verb}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),signal:controller.signal}));
      pending=null;notes[draft.id]='';
      if(verb==='apply'){drafts=drafts.filter(row=>row.id!==draft.id);onSaved(result,draft);}
      else{if(verb==='discard'){drafts=drafts.filter(row=>row.id!==draft.id);onDiscard();note='Unaccepted draft discarded.';}else{drafts=drafts.map(row=>row.id===draft.id?result:row);note=result.status==='ready'?'World updates passed the checks. Review them, then save the recovered passage.':'The prose is kept. Review the reported issue before retrying.';}}
      await tick();heading?.focus({preventScroll:true});
    }catch(error){const message=controller.signal.aborted?'Update checking was cancelled. The retained prose is kept.':error instanceof Error?error.message:'The request failed. The retained prose is kept.';await load();problem=message;}
    finally{busy=false;working='';workingVerb='';controller=undefined;activeRequest='';if(verb==='retry')onChecked(drafts.find(row=>row.id===draft.id)??draft);}
  }
  async function cancel(){try{await json(await fetch('/api/generation/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storyId:source.id,requestId:activeRequest})}));}catch{problem='Cancellation could not be confirmed. Inspect Dev → Jobs.';}finally{controller?.abort();}}
  async function copy(draft:RetainedPassage){try{await navigator.clipboard.writeText(`${draft.content.draft.title}\n\n${draft.content.draft.paragraphs.join('\n\n')}`);note='Retained prose copied.';}catch{problem='Could not copy automatically. Open Retained prose and select the text to copy it.';}}
  async function clearGuidance(id:string){notes[id]='';await tick();(document.getElementById(`recovery-guidance-${id}`)||heading)?.focus({preventScroll:true});}
  function hasGuidance(draft:RetainedPassage){return Boolean(notes[draft.id]?.trim());}
  function editable(kind:'item'|'character'|'place',id:string){return (kind==='item'?canon.items:kind==='character'?canon.characters:canon.places).some(row=>row.id===id);}
  const labels:Record<string,string>={itemId:'Possession',characterId:'Character',locationId:'Location',ownerId:'Holder / storage',fromOwnerId:'Previous holder / storage',toOwnerId:'New holder / storage',expectedOwnerId:'Expected previous holder',expectedQuantity:'Expected previous quantity',quantity:'Resulting quantity / portion',ref:'New record reference',evidenceId:'Source anchor'};
  const operationNames:Record<string,string>={'character.create':'Add character','character.update':'Update character','character.move':'Move character','place.create':'Add place','place.update':'Update place','item.create':'Add possession','item.update':'Update possession','item.transfer':'Move possession','item.split':'Split a counted stack','item.draw':'Draw a finite portion from a supply','item.quantity':'Change recorded quantity','item.equip':'Change equipped state','relationship.create':'Add relationship','relationship.update':'Update relationship','thread.create':'Add story thread','thread.update':'Update story thread','funds.change':'Change funds'};
  function fields(effect:unknown){return effect&&typeof effect==='object'?Object.entries(effect).filter(([key])=>!['type','evidence','evidenceId'].includes(key)):[];}
  function valueText(value:unknown,draft:RetainedPassage):string{if(typeof value==='string')return draft.facts.find(row=>row.id===value)?.name||value;return JSON.stringify(value);}
  function typeName(effect:unknown){const type=effect&&typeof effect==='object'&&'type'in effect?String(effect.type):'Unrecognized update';return operationNames[type]||type;}
  function quote(effect:unknown,draft:RetainedPassage){if(!effect||typeof effect!=='object')return '';if('evidence'in effect&&typeof effect.evidence==='string')return effect.evidence;if('evidenceId'in effect)return evidenceSources(draft.content.draft.paragraphs).find(row=>row.id===effect.evidenceId)?.text||'Unknown source anchor';return '';}
</script>

{#if drafts.length||problem||note||publishedStoryId||closedGuidance.length}
  <section class="passage-recovery editor" aria-label="Retained passages">
    <h2 bind:this={heading} tabindex="-1">{drafts.length?'Recover a generated passage':'Retained passage updates'}</h2>
    {#if drafts.length}<p>The prose below is saved separately on this computer. It joins the story only after its complete world updates pass the checks and you accept them.</p>{/if}
    {#if problem}<p class="notice" role="alert">{problem}</p>{/if}
    {#if note}<p role="status">{note}</p>{/if}
    {#if disabled}<p class="notice">Save or reset your other edits before checking or saving a retained passage.</p>{/if}
    {#if publishedStoryId}<p class="notice">Chapter one has already been saved. {#if onReload}<button onclick={onReload} disabled={busy||loading||disabled}>Open saved story</button>{/if}</p>
    {:else if stale}<p class="notice">The saved source has changed. Load the latest saved {kind==='setup'?'setup':'story'} before checking this passage. {#if onReload}<button onclick={onReload} disabled={busy||loading||disabled}>Load latest saved {kind==='setup'?'setup':'story'}</button>{/if}</p>{/if}
    <button onclick={load} disabled={busy||loading}>{loading?'Loading retained drafts…':'Reload retained drafts'}</button>
    {#each drafts as draft(draft.id)}
      <section class="recovery-draft" aria-label={`Retained draft · ${draft.content.draft.title}`}>
        <h3>{draft.content.draft.title}</h3><p class="muted">{draft.content.mode==='replace'?'Latest-passage rewrite':kind==='setup'?'Chapter one opening':'Next passage'} · {draft.status==='ready'?'Ready for review':'Updates need checking'} · {new Date(draft.createdAt).toLocaleString()}</p>
        {#if draft.status==='checking'&&!working}<p class="muted">This check may still be running or may have been interrupted. Check the activity bar before retrying.</p>{/if}
        {#each draft.issues as issue}<div class="notice"><p>{issue.message}</p>{#if issue.detail}<details><summary>Technical details</summary><p class="technical">{issue.detail}</p></details>{/if}</div>{/each}
        <details open><summary>Retained prose</summary><article class="retained-prose">{#each draft.content.draft.paragraphs as paragraph}<p>{paragraph}</p>{/each}</article></details>
        <div class="row"><button onclick={()=>copy(draft)}>Copy retained prose</button></div>
        <details><summary>Related saved records at the last check · {draft.facts.length}</summary><p class="muted">Up to 60 records matched from names in the prose and IDs in attempted updates, before proposed changes. This is a diagnostic snapshot; it does not list the model's complete input. Edit the current records if they are wrong, save, then retry the same prose.</p>{#each draft.facts as fact}<div class="recovery-fact"><strong>{fact.name}</strong><p>{fact.detail}</p>{#if onEdit}{#if editable(fact.kind,fact.id)}<button onclick={()=>onEdit?.(fact.kind,fact.id)} disabled={busy||unavailable}>Edit {fact.name}</button>{:else}<p class="muted">This record is no longer in the current saved world.</p>{/if}{/if}</div>{/each}{#if !draft.facts.length}<p class="muted">No named records were identified in this attempt.</p>{/if}</details>
        <details open={draft.status==='ready'}><summary>{draft.status==='ready'?'Checked world updates':'Attempted world updates'} · {draft.rawEffects.length}</summary>{#each draft.rawEffects as effect,i}<div class="recovery-effect"><h4>{i+1}. {typeName(effect)}</h4><dl>{#each fields(effect) as [key,value]}<dt>{labels[key]||key}</dt><dd>{valueText(value,draft)}</dd>{/each}</dl>{#if quote(effect,draft)}<blockquote>{quote(effect,draft)}</blockquote>{/if}</div>{/each}{#if !draft.rawEffects.length}<p class="muted">No world updates were returned in this attempt.</p>{/if}</details>
        {#if draft.proposal?.memory}<details><summary>Proposed passage memory</summary><p>{draft.proposal.memory.summary}</p><h4>Facts</h4><ul>{#each draft.proposal.memory.facts as fact}<li>{fact}</li>{/each}</ul><h4>Open questions</h4>{#if draft.proposal.memory.openQuestions.length}<ul>{#each draft.proposal.memory.openQuestions as question}<li>{question}</li>{/each}</ul>{:else}<p class="muted">None proposed.</p>{/if}<p>Character references: {draft.proposal.memory.characterIds.map(id=>valueText(id,draft)).join(', ')||'None'}</p><p>Place references: {draft.proposal.memory.locationIds.map(id=>valueText(id,draft)).join(', ')||'None'}</p></details>{/if}
        {#if draft.status==='ready'&&draft.checkedRevision!==source.revision}<p class="notice">Saved facts changed since this check. Retry world updates before saving.</p>{/if}
        <label>Guidance for rechecking {draft.content.draft.title}<textarea id={`recovery-guidance-${draft.id}`} bind:value={notes[draft.id]} maxlength="4000" disabled={busy} placeholder="Explain a counting unit or a saved fact the model misunderstood. Save record corrections first."></textarea></label>
        {#if hasGuidance(draft)}<button onclick={()=>clearGuidance(draft.id)} disabled={busy}>Clear rechecking guidance</button>{#if draft.status==='ready'}<p class="notice" role="status">This guidance has not been used in the checked proposal. Retry world updates to use it, or clear it before saving.</p>{/if}{/if}
        <p class="muted">Retry checks world updates against the latest saved facts using this exact prose. It can still report a real contradiction; you can keep or copy the prose while deciding how to correct it.</p>
        <div class="row"><button onclick={()=>act(draft,'retry')} disabled={busy||unavailable||disabled||stale||!canGenerate}>Retry world updates</button>{#if draft.status==='ready'}<button class="primary" onclick={()=>act(draft,'apply')} disabled={busy||unavailable||disabled||stale||hasGuidance(draft)||draft.checkedRevision!==source.revision}>Save recovered passage</button>{/if}<button onclick={()=>act(draft,'discard')} disabled={busy||unavailable||disabled||stale}>Discard retained draft</button>{#if working===draft.id}<span role="status">Checking or saving…</span>{#if workingVerb==='retry'}<button onclick={cancel}>Cancel check</button>{/if}{/if}</div>
      </section>
    {/each}
    {#each closedGuidance as [id,text](id)}<div><p class="notice">A draft has been saved or discarded elsewhere. Your unsubmitted guidance is kept here until you clear it.</p><label>Unsubmitted guidance for a closed draft<textarea bind:value={notes[id]} disabled={busy} maxlength="4000"></textarea></label><button onclick={()=>clearGuidance(id)} disabled={busy}>Clear unsubmitted guidance</button></div>{/each}
  </section>
{/if}

<style>
  .passage-recovery{margin-block:2rem;min-width:0}.recovery-draft{border-top:1px solid var(--line,#ccc);padding-block:1.2rem}.retained-prose{font-family:Georgia,serif;line-height:1.7}.technical,dd,blockquote,.recovery-fact{overflow-wrap:anywhere;white-space:pre-wrap}.recovery-fact,.recovery-effect{padding-block:.7rem;border-bottom:1px solid var(--line,#ccc)}dl{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr);gap:.4rem}dd{margin:0}dt{font-weight:600}details{margin-block:1rem}blockquote{margin-inline:0;padding-inline-start:1rem;border-inline-start:3px solid var(--line,#ccc)}h2:focus{outline:none}
</style>
