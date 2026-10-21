<script lang="ts">
  import { onMount, onDestroy, tick, untrack } from 'svelte';
  import type { Story } from './story';
  import type { SetupDraft } from './setup';
  import type { ScenePreparationProposal, ScenePreparationRequest } from './scene-preparation';
  import { reportUiError } from './ui-feedback';
  let { source, kind = 'story', busy = $bindable(false), canGenerate = false, disabled = false, onApplied, onDirty = () => {} }: {
    source: Story | SetupDraft; kind?: 'story' | 'setup'; busy?: boolean; canGenerate?: boolean; disabled?: boolean;
    onApplied: (source: Story | SetupDraft) => void; onDirty?: (dirty: boolean) => void;
  } = $props();
  let direction = $state(''), characterIds = $state<string[]>([]), placeIds = $state<string[]>([]), itemIds = $state<string[]>([]), recordSearch = $state('');
  let result = $state<ScenePreparationProposal | null>(null), history = $state<ScenePreparationProposal[]>([]);
  let problem = $state(''), note = $state(''), working = $state(false), previewKey = $state('');
  let controller: AbortController | null = null, mounted = false;
  let pending: { key: string; input: ScenePreparationRequest } | null = null;
  let applyRequest: { expectedRevision: number; requestId: string } | null = null;
  let previewHeading = $state<HTMLHeadingElement>();
  const canon = $derived('canon' in source ? source.canon : source.plan!.canon);
  const context = $derived('context' in source ? source.context : source.plan!.context);
  const endpoint = $derived(`/api/${kind === 'story' ? 'stories' : 'setups'}/${source.id}/preparation`);
  const inputKey = $derived(JSON.stringify([direction.trim(), characterIds, placeIds, itemIds]));
  const stale = $derived(Boolean(result && (result.storyId !== source.id || result.sourceRevision !== source.revision)));
  const changed = $derived(Boolean(result && !result.appliedAt && previewKey !== inputKey));
  const tooManyTargets = $derived([characterIds, placeIds, itemIds].some(ids => ids.length > 30));
  const selectedIds = $derived([...characterIds, ...placeIds, ...itemIds]);
  const dirty = $derived(Boolean(direction.trim() || characterIds.length || placeIds.length || itemIds.length || (result && !result.appliedAt)));
  const records = $derived([...canon.characters, ...canon.places, ...canon.items, ...canon.relationships, ...canon.threads, ...context.lore]);
  function recordName(id: string | null) {
    if (!id) return 'Automatic';
    const additions = result ? [...result.additions.places, ...result.additions.items, ...result.additions.threads, ...result.additions.lore] : [];
    const record = [...records, ...additions].find(record => record.id === id);
    if (!record) return id;
    if ('name' in record) return record.name;
    if ('title' in record) return record.title;
    return `${canon.characters.find(person => person.id === record.fromId)?.name || record.fromId} → ${canon.characters.find(person => person.id === record.toId)?.name || record.toId}`;
  }
  function matches(name: string) { return name.toLocaleLowerCase().includes(recordSearch.toLocaleLowerCase()); }
  async function removeTarget(id?: string) {
    const group = id && itemIds.includes(id) ? 'items' : id && placeIds.includes(id) ? 'places' : 'cast';
    characterIds = id ? characterIds.filter(current => current !== id) : [];
    placeIds = id ? placeIds.filter(current => current !== id) : [];
    itemIds = id ? itemIds.filter(current => current !== id) : [];
    await tick(); document.getElementById(`preparation-${source.id}-${group}`)?.focus();
  }
  async function read(response: Response) { const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Scene preparation failed.'); return body; }
  async function refresh() { const body = await read(await fetch(endpoint)); if (mounted) history = body.results; }
  $effect(() => onDirty(dirty));
  $effect(() => { if (problem) untrack(() => reportUiError(problem, 'Scene preparation')); });
  onMount(() => { mounted = true; refresh().catch(error => { if (mounted) problem = error.message; }); });
  onDestroy(() => { mounted = false; controller?.abort(); onDirty(false); });
  function example() { direction = 'Prepare a feeding scene. Reuse the existing animals, feed, containers and locations. Propose only missing resources and useful open tasks, and leave travel and feeding as future actions.'; }
  function clear() {
    if (busy) return;
    direction = ''; characterIds = []; placeIds = []; itemIds = []; result = null; pending = null; applyRequest = null; problem = ''; note = 'Draft cleared. Saved previews remain available below.';
  }
  async function selectPreview(id: string) {
    const saved = history.find(row => row.id === id); if (!saved || busy) return;
    if (dirty && result?.id !== saved.id && !confirm('Replace this preparation draft with the saved preview?')) return;
    result = saved; direction = saved.appliedAt ? '' : saved.direction; characterIds = []; placeIds = []; itemIds = [];
    previewKey = JSON.stringify([direction.trim(), [], [], []]); pending = null; applyRequest = null; problem = ''; note = '';
    await tick(); previewHeading?.focus();
  }
  async function generate() {
    if (busy || disabled || !canGenerate || !direction.trim() || tooManyTargets) return;
    if (result && !result.appliedAt && !confirm('Replace the displayed scene preparation preview? Saved records stay as they are.')) return;
    const input = { expectedRevision: source.revision, direction: direction.trim(), characterIds: $state.snapshot(characterIds), placeIds: $state.snapshot(placeIds), itemIds: $state.snapshot(itemIds) }, key = JSON.stringify(input);
    if (pending?.key !== key) pending = { key, input: { ...input, requestId: crypto.randomUUID() } };
    const active = new AbortController(); controller = active; busy = true; working = true; problem = ''; note = '';
    try {
      result = await read(await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pending.input), signal: active.signal }));
      previewKey = inputKey; pending = null; applyRequest = null;
      await tick(); previewHeading?.focus();
      try { await refresh(); } catch { problem = 'The preview was saved, but the saved-preview list could not refresh. Your displayed preview is available for review.'; }
    } catch (error) {
      if (mounted) {
        if (active.signal.aborted) { note = 'Preparation cancelled. Check saved previews if the request had already finished.'; refresh().catch(() => {}); }
        else problem = error instanceof Error ? error.message : 'Could not prepare the scene. Your direction was kept.';
      }
    } finally { busy = false; working = false; controller = null; }
  }
  async function cancel() {
    if (!controller || !pending) return;
    try { await read(await fetch('/api/generation/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storyId: source.id, requestId: pending.input.requestId }) })); pending = null; }
    catch (error) { problem = error instanceof Error ? error.message : 'Cancellation could not be confirmed. Inspect Dev → Jobs.'; }
    finally { controller?.abort(); }
  }
  async function apply() {
    if (busy || disabled || !result || result.appliedAt || stale || changed) return;
    if (!applyRequest) applyRequest = { expectedRevision: source.revision, requestId: crypto.randomUUID() };
    busy = true; problem = ''; note = '';
    try {
      const saved: Story | SetupDraft = await read(await fetch(`${endpoint}/${result.id}/apply`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(applyRequest) }));
      result = { ...result, appliedAt: saved.updatedAt, appliedRevision: saved.revision }; direction = ''; characterIds = []; placeIds = []; itemIds = []; pending = null; applyRequest = null;
      onApplied(saved); note = 'Scene preparation applied. Review the added records and next-scene direction, then generate when ready.';
      try { await refresh(); } catch { problem = 'The preparation was applied, but the saved-preview list could not refresh. Reload to inspect its saved history.'; }
    } catch (error) { problem = error instanceof Error ? error.message : 'Could not apply the preparation. Your preview was kept.'; }
    finally { busy = false; }
  }
</script>

<section class="scene-preparation" aria-label="Prepare a scene">
  <h2>Prepare a scene</h2>
  <p>Describe the scene you want to set up. Review the existing records to reuse, any missing places, possessions, open tasks and background, and a brief for the next passage.</p>
  <p class="muted">Applying adds reviewed world details as author edits. Existing records and written events are preserved. Tasks use open story threads; preparing does not complete them, move anyone or write prose.</p>
  <form onsubmit={event => { event.preventDefault(); generate(); }}><fieldset disabled={busy || disabled}>
    <label>Scene preparation request<textarea bind:value={direction} maxlength="4000" rows="4" placeholder="Prepare a feeding scene for Alex and the pony, using the stable and supplies already in the story…" required></textarea></label>
    <button type="button" onclick={example}>Feeding scene example</button>
    <details><summary>Choose existing records to include (optional)</summary>
      <label>Find existing records<input bind:value={recordSearch} /></label>
      <div class="form-grid">
        <label>Preparation cast<select aria-label="Preparation cast" id={`preparation-${source.id}-cast`} multiple size="4" bind:value={characterIds}>{#each canon.characters.filter(record => matches(record.name) || characterIds.includes(record.id)) as record}<option value={record.id}>{record.name}</option>{/each}</select></label>
        <label>Preparation places<select aria-label="Preparation places" id={`preparation-${source.id}-places`} multiple size="4" bind:value={placeIds}>{#each canon.places.filter(record => matches(record.name) || placeIds.includes(record.id)) as record}<option value={record.id}>{record.name}</option>{/each}</select></label>
        <label>Preparation possessions<select aria-label="Preparation possessions" id={`preparation-${source.id}-items`} multiple size="4" bind:value={itemIds}>{#each canon.items.filter(record => matches(record.name) || itemIds.includes(record.id)) as record}<option value={record.id}>{record.name}{record.unlimited ? ' · Always available' : ` × ${record.quantity}`}</option>{/each}</select></label>
      </div><p class="muted">These are context hints. Selecting a person or place does not move anyone. Use Ctrl (Command on Mac) to select several records, up to 30 of each type.</p>
      {#if selectedIds.length}<section class="selected-targets" aria-label="Selected preparation records"><p class="muted">{characterIds.length} cast · {placeIds.length} places · {itemIds.length} possessions selected</p><ul>{#each selectedIds as id}<li><span>{recordName(id)}</span><button type="button" aria-label={`Remove preparation hint ${recordName(id)}`} onclick={() => removeTarget(id)}>Remove hint</button></li>{/each}</ul><button type="button" onclick={() => removeTarget()}>Clear selected preparation records</button></section>{/if}
      {#if tooManyTargets}<p class="notice" role="status">Choose no more than 30 cast members, 30 places and 30 possessions before previewing.</p>{/if}
    </details>
    <div class="row"><button class="primary" disabled={!canGenerate || !direction.trim() || tooManyTargets}>{working ? 'Preparing…' : 'Preview scene preparation'}</button><button type="button" onclick={clear} disabled={!dirty}>Clear preparation draft</button></div>
  </fieldset></form>
  {#if working}<button onclick={cancel}>Cancel scene preparation</button>{/if}
  {#if !canGenerate}<p class="muted">Choose and save a text model in Settings to prepare scenes.</p>{/if}
  {#if disabled}<p class="notice">Save or reset the current editor’s changes before preparing a scene.</p>{/if}
  {#if problem}<p class="error" role="alert">{problem}</p>{/if}
  {#if note}<p class="notice" role="status">{note}</p>{/if}
  {#if history.length}<label>Saved scene preparations<select aria-label="Saved scene preparations" value={result?.id || ''} disabled={busy || disabled} onchange={event => selectPreview(event.currentTarget.value)}><option value="">Choose a saved preview</option>{#each history as saved}<option value={saved.id}>{saved.appliedAt ? 'Applied' : 'Preview'} · {saved.direction.slice(0, 90)}</option>{/each}</select></label>{/if}
  {#if result}<section class="preparation-preview" aria-label="Scene preparation preview">
    <h3 tabindex="-1" bind:this={previewHeading}>Review scene preparation</h3><p>{result.explanation}</p>
    <h4>Reuse existing records</h4>{#if result.reusedIds.length}<ul>{#each result.reusedIds as id}<li>{recordName(id)}</li>{/each}</ul>{:else}<p class="muted">No explicit reuse list was proposed.</p>{/if}
    <h4>Places to add · {result.additions.places.length}</h4>{#each result.additions.places as place}<article><strong>{place.name}</strong><p>{place.description}</p><small>Inside: {recordName(place.parentId)}</small></article>{:else}<p class="muted">No new places needed.</p>{/each}
    <h4>Possessions to add · {result.additions.items.length}</h4>{#each result.additions.items as item}<article><strong>{item.name} × {item.quantity}{item.isContainer ? ' · Container' : ''}</strong><p>{item.description}</p><small>Held or stored by: {recordName(item.ownerId)} · Counted stock</small></article>{:else}<p class="muted">No new possessions needed.</p>{/each}
    <h4>Open tasks / story threads to add · {result.additions.threads.length}</h4>{#each result.additions.threads as task}<article><strong>{task.title}</strong><p>{task.notes}</p><small>Open possibility; not a completed event.</small></article>{:else}<p class="muted">No new open tasks needed.</p>{/each}
    <h4>Background to add · {result.additions.lore.length}</h4>{#each result.additions.lore as lore}<article><strong>{lore.title}</strong><p>{lore.text}</p><small>When relevant · Keywords: {lore.keywords.join(', ') || 'None'} · Links: {lore.relatedIds.map(recordName).join(', ') || 'None'}</small></article>{:else}<p class="muted">No new background needed.</p>{/each}
    <h4>Next-scene direction</h4><p class="muted">Replaces the saved scene brief: {context.sceneBrief.purpose || 'No current purpose'}.</p>
    <p>{result.sceneBrief.purpose}</p><p>Viewpoint: {recordName(result.sceneBrief.viewpointId)} · Scene location: {recordName(result.sceneBrief.locationId)}</p><p>Cast: {result.sceneBrief.castIds.map(recordName).join(', ')}</p>
    {#if result.sceneBrief.resourceIds?.length}<p>Prepared resource hints: {result.sceneBrief.resourceIds.map(recordName).join(', ')}</p><p class="muted">These records will be available to the next-passage context selector. Resource hints do not move anyone into the scene or establish viewpoint knowledge. Review or remove them later in the scene brief editor.</p>{/if}
    <p>Tension: {result.sceneBrief.tension || 'None specified'}<br />Pause when: {result.sceneBrief.stopAt || 'A natural stopping point'}<br />Scope: next accepted passage.</p>
    {#if stale && !result.appliedAt}<p class="notice" role="status">The source changed after this preview. Generate a fresh preparation against the latest saved records.</p>{/if}
    {#if changed}<p class="notice" role="status">The preparation request or selected records changed. Generate a new preview before applying.</p>{/if}
    {#if result.appliedAt}<p class="notice">Applied at revision {result.appliedRevision}.</p>{:else}<button class="primary" onclick={apply} disabled={busy || disabled || stale || changed}>Apply scene preparation</button>{/if}
  </section>{/if}
</section>

<style>
  .scene-preparation{min-width:0}.scene-preparation fieldset{border:0;padding:0;min-width:0}.scene-preparation details{margin:18px 0}.scene-preparation summary{cursor:pointer}.scene-preparation .row{margin:16px 0;flex-wrap:wrap}
  .preparation-preview{margin-top:22px;border:1px solid var(--line);border-radius:8px;padding:20px;overflow-wrap:anywhere}.preparation-preview article{padding:12px 0;border-bottom:1px solid var(--line)}.preparation-preview article p{margin:6px 0}.preparation-preview h4{margin:24px 0 8px}.preparation-preview small{color:var(--muted)}select[multiple]{min-height:105px}
  .selected-targets ul{list-style:none;padding:0;margin:8px 0}.selected-targets li{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--line)}.selected-targets li span{min-width:0;overflow-wrap:anywhere}.selected-targets li button{flex-shrink:0}
  @media(max-width:600px){.preparation-preview{padding:12px}.scene-preparation .row button{width:100%}}
</style>
