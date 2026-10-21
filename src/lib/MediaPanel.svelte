<script lang="ts">
  import { onDestroy, onMount, untrack, tick } from 'svelte';
  import type { Story } from './story';
  import { reportUiError } from './ui-feedback';
  import { mediaUrl, type MediaAsset } from './media';
  import type PhotoSwipe from 'photoswipe';
  import 'photoswipe/style.css';
  import MediaSubjectPicker from './MediaSubjectPicker.svelte';
  let { story, characterId = '', compact = false, initialAssetId = '', busy = false, onMutate, onSaved, onJump, onOpen, onGenerate, onDirty = () => {} }: {
    story: Story; characterId?: string; compact?: boolean; initialAssetId?: string; busy?: boolean;
    onMutate: (action: unknown) => Promise<boolean>; onSaved: (story: Story) => void;
    onJump: (id: string) => void; onOpen: (assetId: string, characterId: string) => void;
    onGenerate?: (characterId: string,parentId: string) => void;
    onDirty?: (dirty: boolean) => void;
  } = $props();
  let person = $state(untrack(() => characterId)), category = $state('all'), status = $state('all'), newest = $state(false), search = $state('');
  let selectedId = $state(untrack(() => initialAssetId)), caption = $state(''), subjects = $state<string[]>([]), selectedCategory = $state<MediaAsset['category']>('scene'), selectedStatus = $state<'canonical'|'experimental'>('canonical');
  let sourceId = $state(''), parentId = $state(''), files = $state<FileList>(), adding = $state(false), working = $state(false), error = $state(''), note = $state('');
  let baseline = $state(''), assetBaseline = $state('');
  $effect(() => { if (error) untrack(() => reportUiError(error, 'Gallery & photobooks')); });
  let editorElement=$state<HTMLElement>();
  let galleryElement=$state<HTMLDivElement>();
  async function revealEditor(focus=false) { await tick(); if (alive) { editorElement?.scrollIntoView({block:'start',behavior:'auto'}); if(focus)editorElement?.querySelector<HTMLInputElement>('input')?.focus({preventScroll:true}); } }
  let preview = $state<{ id: string; images: string[]; status: string } | null>(null), previewIndex = $state('0');
  let previews = $state<{ id: string; images: string[]; status: string }[]>([]), previewId = $state('');
  let previewLoading = $state(false), previewError = $state('');
  let viewer: PhotoSwipe | undefined, alive = true;
  let pending: { key: string; requestId: string } | null = null;
  const selected = $derived(story.media.assets.find(a => a.id === selectedId));
  function subjectSet(ids: string[]) { return [...new Set(ids)].sort(); }
  function assetDetails(a: MediaAsset) { return JSON.stringify({caption: a.caption, category: a.category, status: a.status === 'experimental' ? 'experimental' : 'canonical', subjects: subjectSet(a.subjectIds)}); }
  function draftDetails() { return JSON.stringify({caption, category: selectedCategory, status: selectedStatus, subjects: subjectSet(subjects), ...(adding ? {sourceId, parentId, files: Array.from(files || []).map(f => [f.name, f.size, f.lastModified]), previewId, previewIndex} : {})}); }
  const metadataDirty = $derived((adding || !!selectedId) && !!baseline && draftDetails() !== baseline);
  const stale = $derived(!adding && !!selected && !!assetBaseline && assetDetails(selected) !== assetBaseline);
  $effect(() => { onDirty(metadataDirty); if (metadataDirty) note = ''; });
  $effect(() => { if (selected && stale && !metadataDirty && !working) loadPicture(selected); });
  function canDiscard() { return !busy && !working && (!metadataDirty || confirm('Discard the unsaved picture details?')); }
  async function closeEditor() { if (!canDiscard()) return; selectedId='';adding=false;baseline='';assetBaseline='';files=undefined;await tick();galleryElement?.scrollIntoView({block:'start'});galleryElement?.focus({preventScroll:true}); }
  const entities = $derived([...story.canon.characters.map(entity => ({...entity,kind:'Cast'})), ...story.canon.places.map(entity => ({...entity,kind:'Place'})), ...story.canon.items.map(entity => ({...entity,kind:'Item'}))]);
  const subjectOptions = $derived([...entities, ...(selected?.snapshots.filter(snapshot => !entities.some(entity => entity.id === snapshot.id)).map(snapshot => ({id:snapshot.id,name:snapshot.name,kind:'Historical'})) || [])]);
  const filtered = $derived(Boolean(person || category !== 'all' || status !== 'all' || search.trim()));
  function clearFilters() { person = ''; category = 'all'; status = 'all'; search = ''; }
  const pictures = $derived.by(() => {
    const query = search.trim().toLocaleLowerCase();
    const rows = story.media.assets.filter(a => (!person || a.subjectIds.includes(person)) && (category === 'all' || a.category === category) && (status === 'all' || a.status === status) && (!query || [a.caption,a.category,a.source?.title || '',...a.subjectIds.map(id => entities.find(entity => entity.id === id)?.name || a.snapshots.find(snapshot => snapshot.id === id)?.name || '')].join(' ').toLocaleLowerCase().includes(query)));
    const position = (a: MediaAsset) => a.source ? story.passages.findIndex(p => p.id === a.source!.passageId) : story.passages.length;
    return rows.sort((a, b) => (position(a) - position(b) || a.createdAt.localeCompare(b.createdAt)) * (newest ? -1 : 1));
  });
  function loadPicture(a: MediaAsset) { selectedId = a.id; caption = a.caption; subjects = [...a.subjectIds]; selectedCategory = a.category; selectedStatus = a.status === 'experimental' ? 'experimental' : 'canonical'; adding = false; files = undefined; sourceId = ''; parentId = ''; assetBaseline = assetDetails(a); baseline = draftDetails(); error = ''; note = ''; }
  function choose(a: MediaAsset | undefined) { if (!a) return; if (!adding && selectedId === a.id) { revealEditor(); return; } if (!canDiscard()) return; loadPicture(a); revealEditor(); }
  function resetAdd(variantId = '') { selectedId = ''; caption = ''; subjects = person ? [person] : []; sourceId = ''; parentId = variantId; files = undefined; selectedCategory = person ? 'portrait' : 'scene'; selectedStatus = 'canonical'; adding = true; assetBaseline = ''; baseline = draftDetails(); error = ''; note = ''; }
  function beginAdd(variantId = '') { if (!canDiscard()) return; resetAdd(variantId); revealEditor(true); }
  function resetDraft() { if (busy || working) return; const wasAdding = adding; if (adding) resetAdd(); else if (selected) loadPicture(selected); note = wasAdding ? 'New picture details reset.' : 'Saved picture details loaded.'; }
  async function json(response: Response) { const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Image request failed.'); return data; }
  async function refreshPreview() {
    if (previewLoading) return;
    previewLoading = true; if (previewError && error === previewError) error = ''; previewError = '';
    try {
      const data = await json(await fetch('/api/image-tests'));
      if (alive) {
        const wasDirty = metadataDirty, previousId = previewId, previousIndex = previewIndex;
        previews = data.completed || []; preview = previews.find(p => p.id === previousId) || (wasDirty && previousId ? null : previews[0]) || null;
        previewId = preview?.id || ''; previewIndex = preview?.id === previousId && Number(previousIndex) < preview.images.length ? previousIndex : '0';
        if (adding && !wasDirty) baseline = draftDetails();
      }
    }
    catch (e) { if (alive) { previewError = e instanceof Error ? e.message : 'Could not load previews.'; error = previewError; } }
    finally { if (alive) previewLoading = false; }
  }
  async function add(fromPreview: boolean) {
    if (working || busy) return;
    const file = files?.[0];
    if (!fromPreview && !file) { error = 'Choose a PNG, JPEG, or WebP image.'; return; }
    if (!fromPreview && file!.size > 20_000_000) { error = 'Images must be no larger than 20 MB.'; return; }
    if (fromPreview && !preview) return;
    working = true; error = ''; note = '';
    const metadata = { expectedRevision: story.revision, caption, category: selectedCategory, subjectIds: subjects, passageId: sourceId || null, parentId: parentId || null, status: selectedStatus };
    const key = JSON.stringify({ storyId: story.id, metadata, file: fromPreview ? [preview!.id, previewIndex] : [file!.name, file!.size, file!.lastModified] });
    if (pending?.key !== key) pending = { key, requestId: crypto.randomUUID() };
    try {
      let request: RequestInit;
      if (fromPreview) request = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ metadata: { ...metadata, requestId: pending.requestId }, jobId: preview!.id, index: Number(previewIndex) }) };
      else { const form = new FormData(); form.set('image', file!); form.set('metadata', JSON.stringify({ ...metadata, requestId: pending.requestId })); request = { method: 'POST', body: form }; }
      const saved: Story = await json(await fetch(`/api/stories/${encodeURIComponent(story.id)}/media`, request));
      if (!alive) return;
      pending = null; onSaved(saved); loadPicture(saved.media.assets.at(-1)!); revealEditor(); note = 'Picture saved to the story library.';
    } catch (e) { if (alive) error = e instanceof Error ? e.message : 'Could not save this picture.'; }
    finally { if (alive) working = false; }
  }
  async function saveDetails() {
    if (!selected || busy || working || !metadataDirty || stale) return;
    const id = selected.id;
    working = true; error = ''; note = '';
    try {
      if (await onMutate({ type: 'media-edit', assetId: id, edit: { caption, category: selectedCategory, subjectIds: [...subjects], status: selectedStatus } })) {
        await tick(); const saved = story.media.assets.find(a => a.id === id); if (saved) loadPicture(saved); note = 'Picture details saved.';
      }
    } catch (e) { if (alive) error = e instanceof Error ? e.message : 'Could not save picture details.'; }
    finally { if (alive) working = false; }
  }
  async function removePicture() {
    if (!selected || !confirm('Remove this picture from this story and its photobooks? Other imported story copies keep their pictures. The original file remains in local storage.')) return;
    if (await onMutate({ type: 'media-remove', assetId: selected.id })) { selectedId = ''; baseline = ''; assetBaseline = ''; note = 'Picture removed from this story.'; }
  }
  async function openViewer(a: MediaAsset) {
    try {
      const module = await import('photoswipe'); if (!alive) return;
      viewer?.destroy();
      viewer = new module.default({ dataSource: pictures.map(p => ({ src: mediaUrl(story.id, p.id), width: p.width, height: p.height, alt: p.caption || 'Story illustration' })), index: Math.max(0, pictures.findIndex(p => p.id === a.id)), showHideAnimationType: 'none' });
      viewer.init();
    } catch { error = 'The image viewer could not open. Use Download original to view the picture.'; }
  }
  onMount(() => { if (initialAssetId) { const a = story.media.assets.find(a => a.id === initialAssetId); if (a) loadPicture(a); } if (!compact) refreshPreview(); });
  onDestroy(() => { alive = false; viewer?.destroy(); onDirty(false); });
</script>

{#if compact}
  <h3>{story.canon.characters.find(c => c.id === characterId)?.name.split(' ')[0]}’s photobook</h3>
  <div class="photobook-mini">{#each pictures as a}<button class="photo-tile" onclick={() => onOpen(a.id, characterId)} title={a.caption || 'Open picture'}><img src={mediaUrl(story.id, a.id, true)} alt={a.caption || 'Story illustration'} loading="lazy" /><small>{a.status === 'superseded' ? 'Earlier version' : a.source ? `Chapter ${a.source.chapter}` : 'Reference'}</small></button>{:else}<p class="muted">No pictures yet. Add portraits, reference art, or illustrations from the story.</p>{/each}</div>
  <button onclick={() => onOpen('', characterId)}>Open photobook &amp; add pictures ↗</button>
  {#if onGenerate}<button onclick={()=>onGenerate?.(characterId,'')} disabled={busy}>Create portrait</button>{/if}
{:else}
  <div class="media-toolbar"><label>Depicted subject<select bind:value={person}><option value="">Everyone &amp; everything</option>{#each entities as e}<option value={e.id}>{e.name}</option>{/each}</select></label><label>Kind<select bind:value={category}><option value="all">All pictures</option>{#each ['portrait','scene','place','item','other'] as c}<option value={c}>{c}</option>{/each}</select></label><label>History<select bind:value={status}><option value="all">All versions</option><option value="canonical">Canonical</option><option value="experimental">Experimental</option><option value="superseded">Earlier versions</option></select></label><label>Order<select bind:value={newest}><option value={false}>Story order</option><option value={true}>Reverse story order</option></select></label></div>
  <div class="media-search"><label>Find a picture<input type="search" bind:value={search} placeholder="Caption, depicted subject or source passage" /></label>{#if filtered}<button type="button" onclick={clearFilters}>Clear picture filters</button>{/if}</div>
  <div class="row"><button class="primary" onclick={() => beginAdd()} disabled={busy || working}>Add a picture</button>{#if onGenerate}<button onclick={()=>onGenerate?.(person,'')} disabled={busy||working}>Generate a picture</button>{/if}<span class="muted" role="status">{pictures.length} of {story.media.assets.length} pictures · originals preserved</span></div>
  {#if error}<p class="error" role="alert">{error}</p>{/if}{#if note}<p role="status">{note}</p>{/if}
  <div bind:this={galleryElement} class="media-grid" tabindex="-1">{#each pictures as a, i}
    {#if i === 0 || pictures[i-1].source?.chapter !== a.source?.chapter}<h2 class="media-chapter">{a.source ? `Chapter ${a.source.chapter} · ${story.passages.find(p => p.id === a.source!.passageId)?.chapterTitle || ''}` : 'Reference pictures'}</h2>{/if}
    <figure class="media-card"><button class="photo-tile" disabled={busy || working} onclick={() => choose(a)} aria-label={`Picture details: ${a.caption || a.category}`}><img src={mediaUrl(story.id, a.id, true)} alt={a.caption || 'Story illustration'} loading="lazy" /></button><figcaption>{a.caption || 'Untitled picture'}<small>{a.category}{a.status === 'superseded' ? ' · Earlier version' : a.status === 'experimental' ? ' · Experimental' : ''}</small></figcaption></figure>
  {:else}<div class="media-empty"><h2>{story.media.assets.length ? 'No pictures match this view' : 'Your photobook starts here'}</h2><p class="muted">{story.media.assets.length ? 'Clear the picture filters or try another caption, subject or source passage.' : 'Add a portrait, upload reference art, or generate an illustration. Pictures can be linked to cast, places, items and story passages.'}</p>{#if filtered}<button type="button" onclick={clearFilters}>Show all pictures</button>{/if}</div>{/each}</div>
  {#if adding || selected}
    <section bind:this={editorElement} class="media-editor editor" aria-label={adding ? 'Add picture' : 'Picture details'}>
      <div class="heading-row"><h2>{adding ? 'Add to the photobook' : 'Picture details'}</h2><button onclick={closeEditor} disabled={busy || working}>Back to pictures</button></div>
      <div class="row"><span class="muted" role="status">{metadataDirty ? 'Unsaved picture details.' : adding ? 'Choose a picture or completed preview to save.' : 'Saved picture details loaded.'}</span><button onclick={resetDraft} disabled={busy || working || (!metadataDirty && !stale)}>{adding ? 'Reset picture draft' : 'Reset to saved'}</button></div>
      {#if stale && metadataDirty}<p class="notice" role="status">This picture’s saved details changed while you were editing. Reset to saved before editing further so an older draft cannot overwrite them.</p>{/if}
      {#if selected}<img class="media-preview" src={mediaUrl(story.id, selected.id)} alt={selected.caption || 'Selected story illustration'} /><div class="row"><button onclick={() => openViewer(selected!)}>View &amp; zoom</button><a class="button" href={mediaUrl(story.id, selected.id) + '?download=1'}>Download original</a>{#if selected.source}<button disabled={busy || working || !story.passages.some(p=>p.id===selected?.source?.passageId)} title={story.passages.some(p=>p.id===selected?.source?.passageId) ? "Read the saved source passage" : "This source belongs to an earlier version and is no longer in the current story"} onclick={() => onJump(selected!.source!.passageId)}>Read source passage ↗</button>{/if}<button disabled={busy || working} onclick={() => beginAdd(selected!.id)}>Add a variant</button></div>{#if selected.status === 'superseded'}<p class="notice">This picture belongs to an earlier version of its source passage. It is preserved as history.</p>{/if}{/if}
      <form onsubmit={e => { e.preventDefault(); if (adding) add(false); else saveDetails(); }}><fieldset class="media-edit-fields" disabled={busy || working}>
        <label>Caption<input bind:value={caption} maxlength="4000" /></label>
        <div class="form-grid"><label>Picture kind<select bind:value={selectedCategory}>{#each ['portrait','scene','place','item','other'] as c}<option value={c}>{c}</option>{/each}</select></label><label>Story status<select bind:value={selectedStatus} disabled={selected?.status === 'superseded'}><option value="canonical">{selected?.status === 'superseded' ? 'Earlier version' : 'Canonical'}</option><option value="experimental">Experimental</option></select></label></div>
        <MediaSubjectPicker entities={subjectOptions} bind:value={subjects} legend="Who or what is actually pictured?" />
        {#if adding}
          <label>Source passage<select bind:value={sourceId}><option value="">Reference art · no story event</option>{#each story.passages as p}<option value={p.id}>Chapter {p.chapter} · {p.title}</option>{/each}</select></label><p class="muted">Associations capture current appearance and outfit facts. For an illustration of an older event, check those details before treating it as a reference.</p>
          <label>Variant of<select bind:value={parentId}><option value="">Independent picture</option>{#each story.media.assets as a}<option value={a.id}>{a.caption || a.id}</option>{/each}</select></label>
          <label>Upload PNG, JPEG, or WebP · up to 20 MB<input type="file" accept="image/png,image/jpeg,image/webp" bind:files /></label><button class="primary" disabled={busy || working || !files?.length}>{working ? 'Saving…' : 'Save uploaded picture'}</button>
        {:else}<button class="primary" disabled={busy || working || !metadataDirty || stale}>{working ? 'Saving…' : 'Save picture details'}</button>{/if}
      </fieldset></form>
      {#if adding}<div class="media-import" aria-busy={previewLoading}><h3>Or keep a ComfyUI preview</h3><p class="muted">Generate in Settings → ComfyUI, then save the result here. The story keeps its own file when test previews are cleared.</p><button onclick={refreshPreview} disabled={working || previewLoading}>{previewLoading ? 'Loading completed previews…' : 'Refresh completed preview'}</button>{#if previewLoading}<p class="muted" role="status">Checking saved Settings test previews…</p>{/if}{#if previewError}<p class="error" role="alert">{previewError} Use Refresh completed preview to try again.</p>{/if}{#if preview}<label>Completed generation<select bind:value={previewId} onchange={() => { preview = previews.find(p => p.id === previewId) || null; previewIndex = '0'; }}>{#each previews as p}<option value={p.id}>{p.id.slice(0, 8)} · {p.images.length} pictures</option>{/each}</select></label><img class="media-preview" src={preview.images[Number(previewIndex)]} alt="Completed ComfyUI preview" /><label>Output<select bind:value={previewIndex}>{#each preview.images as _, i}<option value={String(i)}>Picture {i + 1}</option>{/each}</select></label><button onclick={() => add(true)} disabled={busy || working || previewLoading}>Save preview to story</button>{:else if !previewLoading && !previewError}<p class="muted">No completed preview is available yet.</p>{/if}</div>{/if}
      {#if selected}
        <h3>Portrait &amp; identity reference</h3><p class="muted">These selections are independent. Choosing another picture keeps the photobook intact.</p>
        {#each story.canon.characters.filter(c => selected!.subjectIds.includes(c.id)) as c}<div class="media-selection"><strong>{c.name}</strong><button disabled={busy} onclick={() => onMutate({ type: 'media-select', characterId: c.id, assetId: story.media.portraits[c.id] === selected!.id ? null : selected!.id, selection: 'portrait' })}>{story.media.portraits[c.id] === selected.id ? 'Clear current portrait' : 'Set as portrait'}</button><button disabled={busy} onclick={() => onMutate({ type: 'media-select', characterId: c.id, assetId: story.media.references[c.id] === selected!.id ? null : selected!.id, selection: 'reference' })}>{story.media.references[c.id] === selected.id ? 'Clear identity reference' : 'Use as identity reference'}</button></div>{/each}
        {#if onGenerate}<button onclick={()=>onGenerate?.(selected.category==='portrait'?selected.subjectIds.find(id=>story.canon.characters.some(c=>c.id===id)) || '':'',selected.id)} disabled={busy||working}>Generate a variation</button>{/if}
        <p class="muted">Identity references are saved for future reference-image workflows. Current text-to-image generation does not consume them.</p>
        <details><summary>Appearance &amp; outfit at association time</summary>{#each selected.snapshots as s}<h3>{s.name}</h3><p>{s.appearance || 'No appearance recorded.'}</p><p>{s.outfit || 'No outfit recorded.'}</p>{/each}</details>
        <button class="danger" onclick={removePicture} disabled={busy || working}>Remove picture from story</button>
        <details><summary>Generation details &amp; provenance</summary><p>{selected.width} × {selected.height} · {(selected.bytes / 1000000).toFixed(2)} MB · {selected.provenance.kind} · {new Date(selected.createdAt).toLocaleString()}</p>{#if selected.parentId}<p>Variant of <button onclick={() => choose(story.media.assets.find(a => a.id === selected!.parentId)!)}>parent picture</button></p>{/if}{#if selected.source}<p>Source: {selected.source.title} · story revision {selected.source.revision}</p>{/if}<pre class="dev-json">{JSON.stringify(selected.provenance, null, 2)}</pre></details>
      {/if}
    </section>
  {/if}
{/if}

<style>
  .media-editor .media-edit-fields{border:0;padding:0;margin:0;min-width:0}.media-edit-fields:disabled{opacity:.75}
  .media-search{display:flex;align-items:end;gap:12px;flex-wrap:wrap;margin:16px 0}.media-search label{flex:1;min-width:0}.media-search input{width:100%}.media-empty{grid-column:1/-1;padding:24px;border:1px dashed var(--line);border-radius:8px}.media-empty h2{font-size:1.15rem;margin-top:0}
</style>
