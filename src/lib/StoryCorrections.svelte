<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import type { Story } from './story';
  import type { RecordKind } from './record-editing';
  import type { CorrectionRequest, CorrectionResult } from './story-corrections';
  import { reportUiError } from './ui-feedback';

  let { story, passageId, mode = 'reader', recordKind = 'item', targetId = '', canGenerate, disabled = false, blockedReason = '', busy = $bindable(false), onSaved, onDirty = () => {}, onClose }: {
    story: Story; passageId: string; mode?: 'reader' | 'record'; recordKind?: RecordKind; targetId?: string;
    canGenerate: boolean; disabled?: boolean; blockedReason?: string; busy?: boolean;
    onSaved: (story: Story) => void; onDirty?: (dirty: boolean) => void; onClose?: () => void;
  } = $props();
  let direction = $state(''), operation = $state<'revise' | 'full' | 'name' | 'create'>(untrack(() => targetId ? 'revise' : 'create'));
  let result = $state<CorrectionResult | null>(null), history = $state<CorrectionResult[]>([]);
  let previewInput = $state<{ direction: string; operation: string } | null>(null);
  let working = $state(false), problem = $state(''), note = $state('');
  let section: HTMLElement, instructionField: HTMLTextAreaElement;
  let controller: AbortController | null = null, pending: { key: string; input: CorrectionRequest } | null = null;
  let mounted = false;
  let applyRequest: { expectedRevision: number; requestId: string } | null = null;
  const passage = $derived(story.passages.find(p => p.id === passageId));
  const stale = $derived(Boolean(result && result.sourceRevision !== story.revision && !result.appliedAt));
  const requestOperation = $derived(mode === 'reader' ? 'repair' : targetId ? operation : 'create');
  const instructionsChanged = $derived(Boolean(result && !result.appliedAt && previewInput && (direction.trim() !== previewInput.direction || requestOperation !== previewInput.operation)));
  const dirty = $derived(Boolean(direction.trim() || (result && !result.appliedAt)));
  const needsDirection = $derived(mode === 'reader' || operation === 'create');
  const title = $derived(mode === 'reader' ? 'Correct story records' : `AI options · ${targetId ? `Edit ${recordKind}` : `New ${recordKind}`}`);
  const inputId = $derived(`correction-direction-${mode}-${recordKind}-${targetId || passageId}`);
  const savedResults = $derived(history.filter(entry => mode === 'reader' ? entry.kind === 'repair' && entry.passageId === passageId
    : entry.kind === 'record' && entry.operations.some(op => op.type === 'record' && op.edit.kind === recordKind && (!targetId || op.edit.value.id === targetId))));
  const includedChapterPassages = $derived.by(() => {
    const chapter = story.passages.find(p => p.id === result?.passageId)?.chapter, included = new Set(result?.coverage?.includedPassageIds || []);
    return story.passages.filter(p => p.chapter === chapter && included.has(p.id)).length;
  });

  $effect(() => { onDirty(dirty); });
  $effect(() => { if (problem) untrack(() => reportUiError(problem, mode === 'reader' ? 'Story correction' : 'AI record editor')); });
  onDestroy(() => { mounted = false; controller?.abort(); onDirty(false); });
  onMount(() => {
    mounted = true;
    if (mode === 'reader') tick().then(() => { if (mounted) { section?.scrollIntoView({ block: 'start', behavior: 'auto' }); instructionField?.focus({ preventScroll: true }); } });
    refresh().catch(e => { if (mounted) problem = errorText(e, 'Could not load saved correction previews.'); });
    return () => { mounted = false; };
  });
  function errorText(error: unknown, fallback: string) { return error instanceof Error ? error.message : fallback; }
  async function read(response: Response) { const body = await response.json(); if (!response.ok) throw new Error(body.error || 'The correction request failed.'); return body; }
  async function refresh() { const body = await read(await fetch(`/api/stories/${story.id}/corrections`)); if (mounted) history = body.results; }
  function discard() {
    if (busy) return;
    result = null; previewInput = null; applyRequest = null; pending = null; note = 'Preview discarded. Saved story records were kept.';
  }
  function clear() {
    if (busy || (dirty && !confirm('Discard the correction direction and unapplied preview? Saved story records will be kept.'))) return;
    direction = ''; result = null; previewInput = null; pending = null; applyRequest = null; problem = ''; note = 'Correction draft cleared.';
  }
  function close() { if (!busy && (!dirty || confirm('Discard this correction draft? Saved story records will be kept.'))) onClose?.(); }
  function chooseResult(id: string) {
    if (busy) return;
    const selected = savedResults.find(entry => entry.id === id);
    if (!selected) return;
    if (dirty && selected.id !== result?.id && !confirm('Replace the current correction direction and preview with this saved result?')) return;
    result = selected; direction = selected.appliedAt ? '' : selected.direction; previewInput = { direction: selected.direction, operation: requestOperation }; applyRequest = null; pending = null; note = ''; problem = '';
  }
  async function generate() {
    if (busy || disabled || !canGenerate || (needsDirection && !direction.trim())) return;
    if (result && !result.appliedAt && !confirm('Replace the unapplied correction preview? Saved story records will be kept.')) return;
    const body = { expectedRevision: story.revision, passageId, kind: mode === 'reader' ? 'repair' as const : 'record' as const, direction: direction.trim(),
      ...(mode === 'record' ? { recordKind, mode: targetId ? operation : 'create' as const, ...(targetId ? { targetId } : {}) } : {}) };
    const key = JSON.stringify(body);
    if (!pending || pending.key !== key) pending = { key, input: { ...body, requestId: crypto.randomUUID() } };
    const active = new AbortController(); controller = active;
    busy = true; working = true; problem = ''; note = '';
    try {
      result = await read(await fetch(`/api/stories/${story.id}/corrections`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pending.input), signal: active.signal }));
      previewInput = { direction: body.direction, operation: body.mode || 'repair' };
      pending = null; applyRequest = null;
      await refresh();
      await tick(); section?.querySelector<HTMLElement>('.correction-preview h3')?.focus();
    } catch (error) {
      if (mounted && active.signal.aborted) { note = 'Request cancelled. Your saved records and direction were kept.'; refresh().catch(() => {}); }
      else if (mounted) problem = errorText(error, 'Could not draft the correction. Your direction was kept.');
    } finally { busy = false; working = false; controller = null; }
  }
  async function cancel() {
    const active = controller, request = pending;
    if (!active || !request) return;
    try {
      await read(await fetch('/api/generation/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storyId: story.id, requestId: request.input.requestId }) }));
      pending = null;
    } catch (error) { problem = errorText(error, 'Cancellation could not be confirmed. Inspect Dev → Jobs.'); }
    finally { active.abort(); }
  }
  async function apply() {
    if (busy || disabled || !result || stale || instructionsChanged || result.appliedAt) return;
    busy = true; problem = ''; note = '';
    if (!applyRequest) applyRequest = { expectedRevision: story.revision, requestId: crypto.randomUUID() };
    try {
      const saved: Story = await read(await fetch(`/api/stories/${story.id}/corrections/${result.id}/apply`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(applyRequest) }));
      result = { ...result, appliedAt: saved.updatedAt, appliedRevision: saved.revision }; direction = ''; pending = null; applyRequest = null;
      onSaved(saved); note = 'Corrections applied to current story records. Written passages were kept.';
      refresh().catch(error => { if (mounted) problem = errorText(error, 'The correction was saved, but recent previews could not refresh.'); });
    } catch (error) { problem = errorText(error, 'Could not apply the correction. Your preview was kept.'); }
    finally { busy = false; }
  }
  const fieldLabels: Record<string, string> = { name:'Name', role:'Role', notes:'Notes', description:'Description', title:'Title', quantity:'Quantity', ownerId:'Owner / storage', equipped:'Equipped / worn', locationId:'Location', parentId:'Inside / located at', fromId:'From character', toId:'To character', status:'Status', funds:'Funds', cargoNotes:'Cargo notes', appearance:'Appearance', outfit:'Outfit', injuries:'Current injuries / condition', appearanceNotes:'Additional appearance details', outfitNotes:'Additional outfit details', upper_body:'Upper-body clothing', lower_body:'Lower-body clothing', footwear:'Footwear', accessories:'Worn accessories', age:'Age (actual age)', apparentAge:'Apparent age', gender:'Gender', presentation:'Presentation', species:'Species / form', skin:'Skin / complexion', build:'Build / silhouette', face:'Face', hair:'Hair', eyes:'Eyes', distinctive:'Distinctive features', personality:'Personality', voice:'Voice / manner of speaking', motives:'Motives / goals', history:'History', noNsfw:'No NSFW', pinnedAppearance:'Pinned appearance and outfit' };
  function fieldLabel(field: string) { return field.split('.').filter(part => !['visual','wardrobe','persona'].includes(part)).map(part => fieldLabels[part] || part.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_',' ')).join(' · '); }
</script>

<section class="story-corrections story-editor" bind:this={section} aria-label={mode === 'reader' ? 'Correct story records' : `${recordKind} AI options`}>
  <div class="heading-row"><h2>{title}</h2>{#if onClose}<button type="button" disabled={busy} onclick={close}>Close corrections</button>{/if}</div>
  {#if passage && mode === 'reader'}<p class="correction-context muted">Chapter {passage.chapter} · {passage.chapterTitle}<strong>{passage.title}</strong></p>{/if}
  <p class="muted">{mode === 'reader' ? 'Describe a missed item, ownership change, outfit detail or other fact. Review the proposed changes before applying them to current story records. This does not rewrite the chapter or create a story branch.' : 'Describe what you want, then preview the AI’s proposed record changes. Nothing is saved until you choose Apply corrections.'}</p>
  {#if mode === 'reader' && passage && story.passages.at(-1)?.id !== passageId}<p class="notice muted">You are reading an earlier passage. Corrections are checked against the current story records, including events that happened later.</p>{/if}
  {#if mode === 'record' && recordKind === 'character'}<p class="muted">Pinned appearance and outfit, No NSFW preferences, and the character’s identity are preserved. Use the manual editor to change protected preferences.</p>{/if}
  <form class="correction-request" onsubmit={event => { event.preventDefault(); generate(); }}>
    <fieldset disabled={busy || disabled}>
      {#if mode === 'record' && targetId}<label>AI edit type<select bind:value={operation}><option value="revise">Revise selected {recordKind}</option><option value="full">Full redesign of selected {recordKind}</option>{#if recordKind !== 'relationship'}<option value="name">{recordKind === 'thread' ? 'Reroll title only' : 'Reroll name only'}</option>{/if}</select></label>{/if}
      <label for={inputId}>{mode === 'reader' ? 'What needs correction?' : targetId ? 'Record edit direction' : `Describe the new ${recordKind}`}</label>
      <textarea id={inputId} bind:this={instructionField} bind:value={direction} rows="4" maxlength="3000" required={needsDirection} aria-describedby={`${inputId}-help`} placeholder={mode === 'reader' ? 'For example: Mira traded her jacket to Ren for the access fob, but the jacket is missing from Ren’s inventory. Add it and correct both outfits and ownership as needed.' : targetId ? 'What should change, and what should stay the same?' : `Describe the ${recordKind} to add and how it fits the current story.`}></textarea>
      <p id={`${inputId}-help`} class="muted">{mode === 'reader' ? 'Use the characters’ names and describe the expected result. The AI can propose related record fixes together.' : operation === 'name' ? 'Only the name or title changes. Add optional naming guidance above.' : targetId ? 'Optional for a general refinement or redesign. Only the selected record is edited; use Correct story records below a passage for changes involving several records.' : 'A new record needs a description. Its links and owner must refer to existing story records.'}</p>
      <div class="row"><button class="primary" disabled={!canGenerate || (needsDirection && !direction.trim())}>{working ? 'Drafting corrections…' : mode === 'reader' ? 'Preview corrections' : 'Preview AI changes'}</button><button type="button" disabled={!dirty} onclick={clear}>Clear correction draft</button></div>
    </fieldset>
    {#if working}<button type="button" onclick={cancel}>Cancel correction request</button>{/if}
    {#if disabled}<p class="notice muted">{blockedReason || 'Save or reset unsaved record fields before requesting AI changes.'}</p>{/if}
    {#if !canGenerate}<p class="muted">Choose and save a text model in Settings to use AI corrections.</p>{/if}
  </form>
  {#if problem}<p class="notice" role="alert">{problem}</p>{/if}
  {#if note}<p class="muted" role="status">{note}</p>{/if}
  {#if savedResults.length}<label>Recent correction previews<select value={result?.id || ''} disabled={busy || disabled} onchange={event => chooseResult(event.currentTarget.value)}><option value="">Choose a saved preview</option>{#each savedResults as entry}<option value={entry.id}>{new Date(entry.createdAt).toLocaleString()} · {entry.appliedAt ? 'Applied' : 'Preview'} · {entry.direction.slice(0,80) || 'Record edit'}</option>{/each}</select></label>{/if}
  {#if result}<section class="correction-preview" aria-label="Correction preview">
    <h3 tabindex="-1">Review proposed corrections</h3><p class="muted">Original request</p><p class="original-request">{result.direction || 'General record refinement or redesign.'}</p><p class="explanation">{result.explanation}</p>
    <p class="muted">{result.appliedAt ? `Applied at revision ${result.appliedRevision}.` : stale ? 'The story changed after this preview. Generate a fresh preview before applying.' : `Based on saved revision ${result.sourceRevision}. Review every change before applying.`}</p>
    {#if instructionsChanged}<p class="notice muted" role="status">Request changed. The preview below is from previous instructions. Restore the original direction and edit type, or generate a fresh preview before applying.</p>{/if}
    {#if result.coverage}<div aria-label="Correction context coverage"><p class="muted">Context: {includedChapterPassages} / {result.coverage.totalChapterPassages} passages from the selected chapter. The latest passage is also included when it is in another chapter.</p>{#each result.coverage.warnings as warning}<p class="notice muted" role="status">{warning}</p>{/each}</div>{/if}
    <div class="correction-changes">{#each result.changes as change}<article class="correction-change"><h4>{change.label} · {fieldLabel(change.field)}</h4><div class="change-values"><div><span>Before</span><p>{change.before || 'Not set'}</p></div><div><span>After</span><p>{change.after || 'Not set'}</p></div></div></article>{/each}</div>
    <div class="row"><button type="button" class="primary" onclick={apply} disabled={busy || disabled || stale || instructionsChanged || Boolean(result.appliedAt)}>{result.appliedAt ? 'Corrections applied' : 'Apply corrections'}</button><button type="button" onclick={discard} disabled={busy}>Discard preview</button></div>
  </section>{/if}
</section>

<style>
  .story-corrections{scroll-margin-top:20px;min-width:0}.story-corrections h2{font-size:23px}.correction-context{margin-top:16px}.correction-context strong{display:block;color:var(--text);font-weight:500}.correction-request{margin-top:18px}.story-corrections .correction-request fieldset{border:0;padding:0;margin:0;min-width:0}.correction-request label{font-size:14px;font-weight:500}.correction-request textarea{font-size:16px;line-height:1.6;min-height:125px}.correction-request .row{margin:16px 0}.correction-request select{max-width:100%}.correction-preview{border-top:1px solid var(--line);padding-top:20px;margin-top:24px}.correction-preview h3{font-size:18px;margin:0 0 15px}.explanation,.original-request{white-space:pre-wrap;font-size:14px}.original-request{padding:12px;border-left:2px solid var(--line);background:var(--page)}.correction-changes{margin:20px 0}.correction-change{border:1px solid var(--line);border-radius:7px;padding:15px;margin:12px 0;background:var(--page);min-width:0}.correction-change h4{font-size:13px;margin:0 0 13px;overflow-wrap:anywhere}.change-values{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px}.change-values>div{min-width:0}.change-values span{font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--muted)}.change-values p{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;margin:6px 0 0}.change-values>div+div{border-left:2px solid var(--accent);padding-left:14px}.story-corrections .notice{margin:16px 0}.story-corrections .row{flex-wrap:wrap}@media(max-width:600px){.change-values{grid-template-columns:minmax(0,1fr);gap:14px}.change-values>div+div{border-left:0;border-top:2px solid var(--accent);padding:12px 0 0}.story-corrections .row>button{flex:1 1 150px}.correction-change{padding:12px}.story-corrections h2{font-size:21px}}
</style>
