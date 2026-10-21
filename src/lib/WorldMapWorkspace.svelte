<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { Story } from './story';
  import WorldMap from './WorldMap.svelte';
  import RecordEditor from './RecordEditor.svelte';
  import LoreDevPanel from './LoreDevPanel.svelte';
  import { buildWorldMap, sceneReferenceIds, worldKey, type WorldNode } from './world-map';
  let {story,busy=$bindable(false),canGenerate=false,onMutate,onReload,onSaved,onDirty}: {
    story:Story;busy?:boolean;canGenerate?:boolean;onMutate:(action:unknown)=>Promise<boolean>;onReload:()=>Promise<boolean>;onSaved:(story:Story)=>void;onDirty:(value:boolean)=>void;
  }=$props();
  let selected=$state(''),selectedNode=$state<WorldNode|null>(null),dirty=$state(false),note=$state('');
  const model=$derived(buildWorldMap(story.canon,story.context)),node=$derived(model.nodes.get(selected)??(dirty?selectedNode:null));
  $effect(()=>onDirty(dirty));onDestroy(()=>onDirty(false));
  function select(next:WorldNode){if(busy||next.key===selected)return;if(dirty&&!confirm('Discard the unsaved record fields, background edits or AI instructions? Save them first to keep them.'))return;dirty=false;selected=next.key;selectedNode=next;note='';}
  async function reference(next:WorldNode){if(busy||dirty)return;try{const resourceIds=sceneReferenceIds(story.context,next);if(await onMutate({type:'scene-brief',brief:{...story.context.sceneBrief,resourceIds}}))note='Scene reference saved. Review or remove it in the scene brief.';}catch(error){note=error instanceof Error?error.message:'Could not add this reference.';}}
</script>

<main class="full-view world-workspace">
  <div class="eyebrow">{story.title}</div><h1>World map</h1>
  <div class="row"><button disabled={busy} onclick={onReload}>Load latest saved world</button><span class="muted">Saved revision {story.revision}</span></div>
  <p class="muted">Select a saved node to edit it beside the map. Save or reload that editor explicitly. Load latest saved world keeps unsaved fields visible and blocks stale saves.</p>
  {#if note}<p class="notice" role="status">{note}</p>{/if}
  <div class="world-columns">
    <WorldMap canon={story.canon} context={story.context} viewpointId={story.passages.at(-1)?.viewpointId} layoutKey={`story:${story.id}`} {selected} disabled={busy} referenceDisabled={dirty} onSelect={select} onReference={reference}/>
    <section class="world-editor" aria-label="World map editor">
      {#if node}
        {#key selected}
          {#if node.kind==='lore'}<LoreDevPanel {story} mode="author" selectedEntryId={node.id} {busy} {onMutate} onDirty={value=>dirty=value}/>
          {:else}<RecordEditor {story} embedded initialKind={node.kind} initialId={node.id} bind:busy {canGenerate} {onSaved} {onMutate} {onReload} onSelection={(kind,id)=>{dirty=false;selected=worldKey(kind,id);selectedNode=model.nodes.get(selected)??null;}} onDirty={value=>dirty=value}/>{/if}
        {/key}
      {:else}<h2>Choose a record</h2><p>Expand a location, focus the current scene or search saved records. Selecting a record opens its existing editor here.</p>{/if}
    </section>
  </div>
</main>

<style>
  .world-workspace{max-width:1280px}
  .world-columns{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:28px;margin-top:24px}.world-editor{min-width:0;border-left:1px solid var(--line);padding-left:24px}
  @media(max-width:1000px){.world-columns{grid-template-columns:minmax(0,1fr)}.world-editor{border-left:0;border-top:1px solid var(--line);padding:20px 0 0}}
</style>
