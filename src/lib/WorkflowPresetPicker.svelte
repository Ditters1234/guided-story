<script lang="ts">
  import { onMount,onDestroy } from 'svelte';
  import { inspectExecutableWorkflow,type PresetReference } from './story-workflow/compile';
  import type { WorkflowMode } from './story-workflow/contracts';
  import type { WorkflowPreset } from './story-workflow/presets';
  import type { PresetContent } from './story-workflow/presets';
  import { defaultStoryWorkflow } from './story-workflow/default-graph';
  import { workflowModeName } from './story-workflow/presentation';
  let {sourceId,mode,label,value=$bindable(null),blocked=$bindable(false),disabled=false,onCustomize}:{sourceId:string;mode:WorkflowMode;label:string;value?:PresetReference|null;blocked?:boolean;disabled?:boolean;onCustomize?:(content:PresetContent)=>void}=$props();
  let presets=$state<WorkflowPreset[]>([]),loading=$state(false),failed=$state(false),problem=$state('');
  let controller:AbortController|undefined;
  const matching=$derived(presets.filter(preset=>preset.content.definition.mode===mode&&preset.content.definition.bindings.some(binding=>binding.kind==='source'&&binding.sourceId===sourceId)));
  const chosen=$derived(value?matching.find(preset=>preset.id===value!.id&&preset.revision===value!.revision):undefined);
  const eligible=$derived(chosen?inspectExecutableWorkflow(chosen.content.definition).eligible:false);
  $effect(()=>{blocked=Boolean(value&&(loading||failed||!chosen||!eligible));});
  async function refresh(){if(loading||disabled)return;controller?.abort();controller=new AbortController();loading=true;problem='';try{const response=await fetch('/api/story-workflow-presets',{signal:controller.signal});const result=await response.json();if(!response.ok)throw Error(result.error||'Could not load workflow presets.');presets=result.presets;failed=false;}catch(error){if(!controller.signal.aborted){failed=true;problem=error instanceof Error?error.message:'Could not load workflow presets.';}}finally{loading=false;}}
  function choose(key:string){const preset=matching.find(preset=>`${preset.id}:${preset.revision}`===key);value=preset?{id:preset.id,revision:preset.revision}:null;}
  function customize(){
    if(disabled||loading||(value&&(failed||!chosen)))return;
    const content:PresetContent=chosen?structuredClone($state.snapshot(chosen.content)):{name:`${workflowModeName(mode)} preset`,description:'',definition:defaultStoryWorkflow(mode)};
    if(chosen)content.name=`${content.name.slice(0,145)} (copy)`;
    for(const binding of content.definition.bindings)if(binding.kind==='source')binding.sourceId=sourceId;
    onCustomize?.(content);
  }
  onMount(()=>{void refresh();});onDestroy(()=>controller?.abort());
</script>

<section class="preset-picker" aria-label={label}>
  <label>{label}<select aria-label={label} value={value?`${value.id}:${value.revision}`:''} disabled={disabled||loading} onchange={event=>choose(event.currentTarget.value)}>
    <option value="">Default workflow</option>
    {#if value&&!chosen}<option value={`${value.id}:${value.revision}`}>Selected preset revision unavailable · refresh or choose again</option>{/if}
    {#each matching as preset (preset.id)}{@const eligibility=inspectExecutableWorkflow(preset.content.definition)}<option value={`${preset.id}:${preset.revision}`} disabled={!eligibility.eligible}>{preset.content.name} · revision {preset.revision}{eligibility.eligible?'':' · unsupported draft'}</option>{/each}
  </select></label>
  <div class="row"><button type="button" aria-label={`${label}: refresh presets`} onclick={refresh} disabled={disabled||loading}>{loading?'Loading workflows…':'Refresh workflow presets'}</button>
  {#if onCustomize}<button type="button" aria-label={`${label}: customize workflow`} onclick={customize} disabled={disabled||loading||Boolean(value&&(failed||!chosen))}>Customize workflow</button>{/if}</div>
  {#if problem}<p class="notice" role="alert">{problem} Default generation remains available when no preset is selected.</p>{/if}
  {#if blocked&&!loading}<p class="notice" role="alert">The selected workflow revision is unavailable, changed or unsupported. Refresh and choose its current saved revision, or choose Default workflow.</p>{/if}
  <p class="muted">{chosen?`${chosen.content.name} · revision ${chosen.revision}`:'Default checks and save policy'} · Customize opens an independent draft for this source. Save it, then explicitly select it here to use it.</p>
</section>

<style>.preset-picker{margin:18px 0;min-width:0}.preset-picker p{margin:8px 0}.preset-picker select{max-width:100%}</style>
