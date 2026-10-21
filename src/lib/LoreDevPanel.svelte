<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
  import type { Story } from './story';
  import type { ContextData, ContextReport } from './context-types';
  import { buildLoreAudit, captureLoreEditBaseline, prepareLoreContextMutation, type LoreAuditSelection } from './lore-audit';

  let { story, report = null, busy = false, mode = 'developer', selectedEntryId = '', onMutate, onDirty = () => {} }: {
    story: Story; report?: ContextReport | null; busy?: boolean;
    mode?: 'author' | 'developer'; selectedEntryId?:string;
    onMutate: (action: unknown) => Promise<boolean>; onDirty?: (dirty: boolean) => void;
  } = $props();
  let baseline = $state(untrack(() => captureLoreEditBaseline(story)));
  let baselineLore = $state(untrack(() => JSON.stringify(story.context.lore)));
  let draft = $state<ContextData['lore']>(untrack(() => JSON.parse(baselineLore)));
  let search = $state(''), visibility = $state('all'), review = $state('all'), selection = $state('all');
  let saving = $state(false), problem = $state(''), note = $state(''), openedId = $state(untrack(()=>selectedEntryId));
  let addButton = $state<HTMLButtonElement>();
  const dirty = $derived(JSON.stringify(draft) !== baselineLore);
  const stale = $derived(story.id !== baseline.storyId || story.revision !== baseline.revision || JSON.stringify(story.context) !== baseline.contextJson);
  const audit = $derived(buildLoreAudit({ ...story, context: { ...story.context, lore: draft } }, dirty ? null : report));
  const knownIds = $derived(new Set([...story.canon.characters, ...story.canon.places, ...story.canon.items].map(record => record.id)));
  const savedLore = $derived(JSON.parse(baselineLore) as ContextData['lore']);
  function recordName(id: string) { return [...story.canon.characters, ...story.canon.places, ...story.canon.items].find(record => record.id === id)?.name || `Missing: ${id}`; }
  const matching = $derived(draft.filter(entry => {
    const inspected = audit.entries.find(record => record.id === entry.id)!;
    return (!selectedEntryId || entry.id===selectedEntryId) && (visibility === 'all' || entry.visibility === visibility) &&
      (review === 'all' || review === 'issues' && inspected.issues.length > 0 || review === 'missing' && inspected.links.some(link => !link.exists) || review === 'heuristic' && inspected.issues.some(issue => issue.heuristic)) &&
      (selection === 'all' || inspected.selection.status === selection) &&
      [entry.id, entry.title, entry.text, ...entry.keywords, ...inspected.links.map(link => `${link.id} ${link.name} ${link.pathLabel}`)].join('\n').toLocaleLowerCase().includes(search.toLocaleLowerCase());
  }));
  const editedOpenEntry = $derived(draft.find(entry => entry.id === openedId && JSON.stringify(entry) !== JSON.stringify(savedLore.find(saved => saved.id === entry.id))));
  const keptOpen = $derived(Boolean(editedOpenEntry && !matching.some(entry => entry.id === openedId)));
  const filtered = $derived(draft.filter(entry => matching.some(match => match.id === entry.id) || (keptOpen && entry.id === openedId)));
  $effect(() => onDirty(dirty));
  // Edited lore has no measured selection. Keep the active editor visible when
  // its saved Included/Excluded filter stops matching on the first keystroke.
  $effect(() => { if (dirty && selection !== 'all' && selection !== 'no-preview') selection = 'all'; });
  onDestroy(() => onDirty(false));
  $effect(() => { if (stale && !dirty && !saving) loadSaved(); });

  function loadSaved() {
    baseline = captureLoreEditBaseline(story);
    baselineLore = JSON.stringify(story.context.lore);
    draft = JSON.parse(baselineLore);
    problem = ''; note = ''; openedId = selectedEntryId;
  }
  async function add() {
    if (busy || saving || stale || draft.length >= 300) return;
    const id = crypto.randomUUID();
    draft.push({ id, title: 'New background entry', text: '', visibility: 'relevant', keywords: [], relatedIds: [] });
    search = ''; visibility = 'all'; review = 'all'; selection = 'all'; openedId = id;
    note = 'Background entry added to your draft.';
    await tick(); document.getElementById(`lore-title-${id}`)?.focus();
  }
  async function remove(id: string) {
    draft = draft.filter(entry => entry.id !== id); if (openedId === id) openedId = '';
    note = 'Background entry removed from your draft. Save background edits to apply the removal.';
    await tick(); addButton?.focus();
  }
  async function removeLink(entry: ContextData['lore'][number], id?: string) {
    entry.relatedIds = id ? entry.relatedIds.filter(current => current !== id) : [];
    await tick(); document.getElementById(`lore-related-${entry.id}`)?.focus();
  }
  function selectionLabel(value: LoreAuditSelection) {
    return ({ included: 'Included in preview', excluded: 'Excluded from preview', unreported: 'Not reported by preview', 'no-preview': 'No measured selection', 'stale-preview': 'Preview is stale' })[value.status];
  }
  async function save() {
    if (busy || saving || !dirty) return;
    problem = ''; note = '';
    try {
      const action = prepareLoreContextMutation($state.snapshot(story), $state.snapshot(baseline), $state.snapshot(draft));
      const submittedStoryId = story.id, submittedLore = JSON.stringify(action.context.lore);
      saving = true;
      if (await onMutate(action)) {
        await tick();
        if (story.id === submittedStoryId && JSON.stringify(story.context.lore) === submittedLore) {
          loadSaved(); note = mode === 'author' ? 'Story background saved.' : 'Background saved. Build a new Context preview to inspect its selection.';
        } else note = 'The save completed and the saved story changed again. Your draft is kept; reset to inspect the latest saved background.';
      } else note = 'The save did not complete. Your unsaved background draft is kept.';
    } catch (error) { problem = error instanceof Error ? error.message : 'Background could not be saved. Your draft is kept.'; }
    finally { saving = false; }
  }
</script>

<section class="lore-panel" class:author-mode={mode === 'author'} aria-label={mode === 'author' ? 'Story background editor' : 'Lore developer tools'}>
  {#if mode === 'author'}
  <h2>Story background</h2>
  <p>Keep setting details, routines and useful background here. Link entries to the people, places or items they concern so relevant details can reach the narrator.</p>
  <p class="muted">Always entries accompany every story request. When relevant entries are selected for the scene. Hidden entries stay out of narration. Background does not establish that a viewpoint character knows a fact; update current possessions, locations and tasks in Records.</p>
  <p class="muted">{audit.summary.total} entries · {audit.summary.always} always · {audit.summary.relevant} relevant · {audit.summary.hidden} hidden</p>
  {:else}
  <h2>Background &amp; lore diagnostics</h2>
  <p>Inspect and edit every background entry, including hidden entries. This is an author view: seeing a fact here does not establish that a viewpoint character knows it.</p>
  <p class="muted">Current records determine physical placement, counted stock and saved supply mode. Wording flags below are simple heuristics for review, never proof of stale facts or a semantic contradiction.</p>
  <p class="muted">{audit.summary.total} entries · {audit.summary.always} always · {audit.summary.relevant} relevant · {audit.summary.hidden} hidden · {audit.summary.entriesWithIssues} with review flags · {audit.summary.missingReferences} missing links</p>
  {#if dirty}<p class="notice">Unsaved background draft. Context-preview selection is unavailable for edited entries until you save and rebuild the preview.</p>
  {:else}<p class="muted">{audit.preview.reason}{#if audit.preview.status === 'current'} {audit.summary.included} included · {audit.summary.excluded} excluded.{/if}</p>{/if}
  {#if !report && !dirty}<p class="muted">Build a context preview in Dev → Context to inspect actual included/excluded reasons. This panel makes no model calls.</p>{/if}
  {/if}
  {#if stale}<p class="notice" role="alert">The saved story changed. Your unsaved draft is still here. Saving is blocked; copy any edits you want to keep, then use Reset to latest saved lore.</p>{/if}
  {#if problem}<p class="error" role="alert">{problem}</p>{/if}
  {#if note}<p class="notice" role="status">{note}</p>{/if}
  <div class="row lore-actions">
    <button class="primary" onclick={save} disabled={busy || saving || stale || !dirty}>{saving ? 'Saving background…' : 'Save background edits'}</button>
    <button onclick={loadSaved} disabled={busy || saving || (!dirty && !stale)}>Reset to latest saved lore</button>
    {#if !selectedEntryId}<button bind:this={addButton} onclick={add} disabled={busy || saving || stale || draft.length >= 300}>Add background entry</button>{/if}
    <span class="muted">{dirty ? 'Unsaved edits' : `Saved revision ${baseline.revision}`}</span>
  </div>
  <div class="lore-filters">
    <label>{mode === 'author' ? 'Search background' : 'Search lore'}<input bind:value={search} placeholder={mode === 'author' ? 'Title, text, keyword or linked record' : 'Title, text, keyword, ID or linked record'} /></label>
    <label>Visibility<select aria-label="Visibility" bind:value={visibility}><option value="all">All visibility</option><option value="always">Always</option><option value="relevant">When relevant</option><option value="hidden">Hidden</option></select></label>
    {#if mode === 'developer'}<label>Review flags<select aria-label="Review flags" bind:value={review}><option value="all">All entries</option><option value="issues">Any review flag</option><option value="missing">Missing links</option><option value="heuristic">Wording heuristics</option></select></label>
    <label>Preview selection<select aria-label="Preview selection" bind:value={selection}><option value="all">All selection states</option><option value="included">Included</option><option value="excluded">Excluded</option><option value="unreported">Not reported</option><option value="no-preview">No preview</option><option value="stale-preview">Stale preview</option></select></label>
    {/if}
  </div>
  <p class="muted">Showing {filtered.length} / {draft.length} entries. Removing an entry or link changes this draft until you explicitly save.</p>
  {#if keptOpen}<p class="notice" role="status">Your edited entry is kept open even though it no longer matches the filters. Close it when you are ready to hide it.</p>{/if}
  <fieldset disabled={busy || saving || stale}>
    {#each filtered as entry (entry.id)}
      {@const inspected = audit.entries.find(record => record.id === entry.id)!}
      <details class="lore-entry" open={entry.id === openedId} ontoggle={event => { if (event.currentTarget.open) openedId = entry.id; else if (openedId === entry.id) openedId = ''; }}>
        <summary><strong>{entry.title || 'Untitled background'}</strong><span>{entry.visibility === 'always' ? 'Always' : entry.visibility === 'hidden' ? 'Hidden from narration' : 'When relevant'}{#if mode === 'developer'} · {selectionLabel(inspected.selection)}{inspected.issues.length ? ` · ${inspected.issues.length} review flag(s)` : ''}{/if}</span></summary>
        {#if entry.id === openedId}
        {#if mode === 'developer'}<p class="lore-id">ID: {entry.id}</p>{/if}
        <div class="form-grid"><label>Background title<input id={`lore-title-${entry.id}`} bind:value={entry.title} maxlength="200" /></label><label>When to include<select aria-label="When to include" bind:value={entry.visibility}><option value="relevant">When relevant</option><option value="always">Always</option><option value="hidden">Hidden from narration</option></select></label></div>
        <label>Background text<textarea bind:value={entry.text} rows="5" maxlength="10000"></textarea></label>
        <label>Keywords<input aria-label="Keywords" value={entry.keywords.join(', ')} onchange={event => entry.keywords = event.currentTarget.value.split(',').map(value => value.trim()).filter(Boolean)} /><small>Comma-separated, up to 30 keywords of 100 characters each.</small></label>
        <label>Related records<select aria-label="Related records" id={`lore-related-${entry.id}`} multiple size="6" bind:value={entry.relatedIds}>
          <optgroup label="Cast">{#each story.canon.characters as record}<option value={record.id}>{record.name}</option>{/each}</optgroup>
          <optgroup label="Places">{#each story.canon.places as record}<option value={record.id}>{record.name}</option>{/each}</optgroup>
          <optgroup label="Items">{#each story.canon.items as record}<option value={record.id}>{record.name}</option>{/each}</optgroup>
          {#if entry.relatedIds.some(id => !knownIds.has(id))}<optgroup label="Missing links · clear or replace">{#each entry.relatedIds.filter(id => !knownIds.has(id)) as id}<option value={id}>Missing: {id}</option>{/each}</optgroup>{/if}
        </select><small>Use Ctrl (Command on Mac) to select or clear individual links. Up to 30 links.</small></label>
        {#if entry.relatedIds.length}<section class="selected-links" aria-label={`Selected links for ${entry.title}`}><p class="muted">{entry.relatedIds.length} / 30 linked records</p><ul>{#each entry.relatedIds as id}<li><span>{recordName(id)}</span><button type="button" aria-label={`Remove link to ${recordName(id)}`} onclick={() => removeLink(entry, id)}>Remove link</button></li>{/each}</ul><button type="button" onclick={() => removeLink(entry)}>Clear related records</button></section>{/if}
        {#if mode === 'developer'}<section class="lore-selection" aria-label={`Selection for ${entry.title}`}><h3>{selectionLabel(inspected.selection)}</h3><p>{inspected.selection.reason}</p>{#if inspected.selection.tokens !== undefined}<p class="muted">{inspected.selection.tokens} estimated tokens · {inspected.selection.bytes} bytes{inspected.selection.required ? ' · Required context' : ''}</p>{/if}</section>
        {#if inspected.issues.length}<ul class="lore-issues">{#each inspected.issues as issue}<li><strong>{issue.heuristic ? 'Review wording' : 'Record check'}:</strong> {issue.message}{#if issue.relatedIds.length}<small>Related IDs: {issue.relatedIds.join(', ')}</small>{/if}</li>{/each}</ul>{/if}
        <section class="lore-links" aria-label={`Current links for ${entry.title}`}><h3>Linked current records</h3>{#each inspected.links as link}<article><strong>{link.name}</strong> · {link.kind}<span class="lore-id">{link.id}</span><p>{link.pathLabel}</p>{#if link.kind === 'item'}<p class="muted">{link.unlimited ? 'Always available supply · source quantity 1' : `Counted quantity: ${link.quantity}`}{link.isContainer ? ' · Container' : ''} · Immediate holder/storage: {link.holderName} ({link.holderId})</p>{/if}{#if !link.pathValid}<p class="error">The current physical path is missing or cyclic.</p>{/if}</article>{:else}<p class="muted">No explicit linked records. Text mentions are not automatically added as links.</p>{/each}</section>
        {/if}
        <button onclick={() => remove(entry.id)}>Remove background entry from draft</button>
        {/if}
      </details>
    {:else}<p class="muted">No matching background entries. Change the filters or add an entry.</p>{/each}
  </fieldset>
</section>

<style>
  .lore-panel, fieldset { min-width: 0; }
  fieldset { border: 0; padding: 0; margin: 0; }
  .lore-actions { margin: 20px 0; }
  .lore-filters { display: grid; grid-template-columns: minmax(180px,2fr) repeat(3,minmax(120px,1fr)); gap: 14px; }
  .lore-filters label { min-width: 0; }
  .selected-links { margin: 12px 0 20px; }.selected-links ul { list-style: none; padding: 0; margin: 8px 0; }.selected-links li { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--line); }.selected-links li span { min-width: 0; overflow-wrap: anywhere; }.selected-links li button { flex-shrink: 0; }
  .author-mode .lore-filters { grid-template-columns: minmax(0,2fr) minmax(180px,1fr); }
  .lore-entry { border: 1px solid var(--line); border-radius: 7px; padding: 16px; margin: 14px 0; background: var(--panel); }
  summary { cursor: pointer; overflow-wrap: anywhere; }
  summary span { display: block; font-size: 12px; color: var(--muted); margin: 6px 0 0; }
  .lore-id { display: block; font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }
  .lore-selection, .lore-links { border-top: 1px solid var(--line); padding-top: 12px; margin-top: 18px; }
  h3 { font-size: 14px; margin: 0 0 8px; }
  .lore-selection p, .lore-links p { margin: 7px 0; overflow-wrap: anywhere; }
  .lore-links article { padding: 10px 0; border-bottom: 1px solid var(--line); margin-bottom: 8px; }
  .lore-issues { padding-left: 22px; }
  .lore-issues li { margin: 12px 0; overflow-wrap: anywhere; }
  .lore-issues small { display: block; margin-top: 5px; color: var(--muted); }
  @media(max-width:850px) { .lore-filters { grid-template-columns: repeat(2,minmax(0,1fr)); } }
  @media(max-width:550px) { .lore-filters, .author-mode .lore-filters { grid-template-columns: minmax(0,1fr); gap: 0; } .lore-entry { padding: 12px; } .lore-actions button { width: 100%; } }
</style>
