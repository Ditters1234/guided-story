<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
  import type { Story } from './story';
  import { emptyContext, sceneBriefScopeLabels } from './context-types';
  import SceneResourceHints from './SceneResourceHints.svelte';
  let { story, busy, onMutate, onDirty = () => {}, onPrepare }: { story: Story; busy: boolean; onMutate: (action: unknown) => Promise<boolean>; onDirty?: (dirty: boolean) => void; onPrepare?: () => void } = $props();
  let draft = $state(untrack(() => JSON.parse(JSON.stringify(story.context.sceneBrief)) as Story['context']['sceneBrief']));
  let baseline = $state(untrack(() => JSON.stringify(story.context.sceneBrief)));
  let note = $state(''), saving = $state(false);
  const dirty = $derived(JSON.stringify(draft) !== baseline);
  const stale = $derived(JSON.stringify(story.context.sceneBrief) !== baseline);
  const hasBrief = $derived(!!story.context.sceneBrief.purpose || !!story.context.sceneBrief.tension || !!story.context.sceneBrief.stopAt || !!story.context.sceneBrief.viewpointId || !!story.context.sceneBrief.locationId || !!story.context.sceneBrief.castIds.length || !!story.context.sceneBrief.resourceIds?.length);
  function reload() { draft = JSON.parse(JSON.stringify(story.context.sceneBrief)); baseline = JSON.stringify(draft); note = ''; }
  $effect(() => { if (stale && !dirty && !saving) reload(); });
  $effect(() => { onDirty(dirty); if (dirty) note = ''; });
  onDestroy(() => onDirty(false));
  async function save() {
    if (busy || saving || !dirty || stale) return;
    saving = true;
    try {
      if (await onMutate({ type: 'scene-brief', brief: $state.snapshot(draft) })) {
        await tick(); reload(); note = 'Scene direction saved.';
      }
    } finally { saving = false; }
  }
  async function clearBrief() {
    if (busy || saving || dirty || stale) return;
    saving = true;
    const endingScene = story.context.sceneBrief.scope === 'current-scene';
    try {
      if (await onMutate({ type: 'scene-brief', brief: emptyContext().sceneBrief })) {
        await tick(); reload(); note = endingScene ? 'Scene ended. Its saved direction was cleared.' : 'Saved scene direction cleared.';
      }
    } finally { saving = false; }
  }
  function cast(id: string, checked: boolean) { draft.castIds = checked ? [...new Set([...draft.castIds,id])] : draft.castIds.filter(v => v !== id); }
</script>

<details class="scene-direction"><summary>Scene direction{hasBrief ? ' · ' + sceneBriefScopeLabels[story.context.sceneBrief.scope] + ' active' : ' · Optional'}</summary>
  <p class="muted">Shape upcoming events without recording plans as history. Choose how long this direction stays active. A current scene ends when you choose End scene below; chapter endings do not clear it.</p>
  {#if onPrepare}<button type="button" onclick={onPrepare} disabled={busy}>Prepare missing scene details</button><p class="muted">Preview reusable records and missing places, items, open tasks and background before applying a next-scene plan.</p>{/if}
  {#if stale && dirty}<p class="notice" role="status">The saved scene direction changed while you were editing. Reset to the saved brief before making further changes so an older draft cannot overwrite it.</p>{/if}
  <form onsubmit={e => { e.preventDefault(); save(); }}><fieldset disabled={busy || saving}>
    <label>Scene purpose<textarea bind:value={draft.purpose} maxlength="3000" placeholder="What should this scene explore?"></textarea></label>
    <label>Scene tension<textarea bind:value={draft.tension} maxlength="3000"></textarea></label>
    <div class="form-grid"><label>Scene viewpoint<select aria-label="Scene viewpoint" bind:value={draft.viewpointId}><option value={null}>Automatic</option>{#each story.canon.characters as person}<option value={person.id}>{person.name}</option>{/each}</select></label><label>Scene location<select aria-label="Scene location" bind:value={draft.locationId}><option value={null}>Automatic</option>{#each story.canon.places as place}<option value={place.id}>{place.name}</option>{/each}</select></label></div>
    <div class="row">{#each story.canon.characters as person}<label class="check"><input type="checkbox" checked={draft.castIds.includes(person.id)} onchange={e => cast(person.id,e.currentTarget.checked)} />Focus on {person.name}</label>{/each}</div>
    <SceneResourceHints canon={story.canon} lore={story.context.lore} bind:ids={draft.resourceIds} />
    <label>Scene stopping point<input bind:value={draft.stopAt} maxlength="2000" /></label>
    <label>Direction scope<select aria-label="Direction scope" bind:value={draft.scope} onchange={() => draft.clearAfterPassage = draft.scope === 'next-passage'}><option value="next-passage">Next passage</option><option value="current-scene">Current scene</option><option value="ongoing">Ongoing</option></select></label>
    <p class="muted">{draft.scope === 'next-passage' ? 'Clears after the next accepted continuation. Failed requests, rewrites, Ask and wording polish keep it.' : draft.scope === 'current-scene' ? 'Stays active across passages until you choose End scene. This clears the direction without changing written events.' : 'Stays active until you change or clear it.'}</p>
    <div class="row"><button class="primary" disabled={!dirty || stale}>{saving ? 'Saving…' : 'Save scene direction'}</button><button type="button" onclick={reload} disabled={!dirty && !stale}>Reload saved brief</button><button type="button" onclick={clearBrief} disabled={!hasBrief || dirty || stale}>{story.context.sceneBrief.scope === 'current-scene' ? 'End scene' : 'Clear saved direction'}</button></div>
    <p class="muted">{dirty ? 'Unsaved scene direction.' : 'Saved scene direction loaded.'}</p>
  </fieldset></form>{#if note}<p class="muted" role="status">{note}</p>{/if}
</details>
