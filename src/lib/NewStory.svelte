<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { setupInputSchema, blankSetupPlan, type SetupDraft, type SetupInput, type SetupPlan, type CharacterRedesignMode } from './setup';
  import { pruneSceneBriefResources, type Story } from './story';
  import CharacterProfileEditor from './CharacterProfileEditor.svelte';
  import SetupAiControls from './SetupAiControls.svelte';
  import FactPinsEditor from './FactPinsEditor.svelte';
  import type { FactPinKind } from './fact-pins';
  import { worldFoundationEntry, type SetupDesignKind, type SetupDesignMode } from './setup-generation';
  import { normalizeCharacterProfile } from './character-profile';
  import { reportUiError } from './ui-feedback';
  import { inventoryHolders, inventoryPath } from './inventory';
  import { downloadSetup } from './setup-download';
  import ScenePreparation from './ScenePreparation.svelte';
  import { buildLoreAudit } from './lore-audit';
  import SceneResourceHints from './SceneResourceHints.svelte';
  import RecordSearch from './RecordSearch.svelte';
  import PassageRecovery from './PassageRecovery.svelte';
  import WorldMap from './WorldMap.svelte';
  import WorkflowPresetPicker from './WorkflowPresetPicker.svelte';
  import type { PresetReference } from './story-workflow/compile';
  import { buildWorldMap, sceneReferenceIds, type WorldNode } from './world-map';
  let { initial = null, canGenerate = false, busy = $bindable(false), onSaved, onCreated, onDirty = () => {} }: { initial?: SetupDraft | null; canGenerate: boolean; busy: boolean; onSaved: (draft: SetupDraft) => void; onCreated: (story: Story, setupId: string) => void; onDirty?: (dirty: boolean) => void } = $props();
  let saved = $state<SetupDraft | null>(untrack(() => initial ? structuredClone($state.snapshot(initial)) : null));
  let input = $state<SetupInput>(untrack(() => initial ? structuredClone($state.snapshot(initial.input)) : setupInputSchema.parse({ premise: 'A science-fiction story about a rogue space trader and their crew.' })));
  let plan = $state<SetupPlan | null>(untrack(() => initial?.plan ? structuredClone($state.snapshot(initial.plan)) : null));
  let tab = $state('cast'), error = $state(''), note = $state(''), phase = $state('');
  let recordSearch = $state(''), matchingRecordIds = $state<string[]>([]);
  let mapOpen=$state(false),mapId=$state(''),mapSelected=$state('');
  let openingPreset=$state<PresetReference|null>(null),openingPresetBlocked=$state(false);
  function selectMap(node:WorldNode){if(busy)return;tab=({place:'world',character:'cast',item:'items',lore:'background',thread:'threads',relationship:'relationships'})[node.kind];recordSearch='';mapId=node.id;mapSelected=node.key;}
  function referenceMap(node:WorldNode){if(!plan||busy)return;try{const draftNode=buildWorldMap(plan.canon,plan.context).nodes.get(node.key);if(!draftNode)throw new Error('This record was removed from your draft. Save or reload the setup first.');plan.context.sceneBrief.resourceIds=sceneReferenceIds(plan.context,draftNode);note='Scene reference added to your setup draft. Choose Save setup draft to apply it.';}catch(e){error=e instanceof Error?e.message:'Could not add scene reference.';}}
  function toggleMap(){if(tab==='prepare'&&!mayLeavePreparation())return;mapOpen=!mapOpen;mapId='';mapSelected='';}
  const searchableSections: Record<string,string> = { cast:'cast', world:'places', background:'background', items:'possessions', relationships:'relationships', threads:'story threads' };
  const sectionRecords = $derived(!plan ? [] : tab === 'cast' ? plan.canon.characters : tab === 'world' ? plan.canon.places : tab === 'background' ? plan.context.lore : tab === 'items' ? plan.canon.items : tab === 'relationships' ? plan.canon.relationships : tab === 'threads' ? plan.canon.threads : []);
  const matchingRecordCount = $derived(recordSearch.trim() ? sectionRecords.filter(record => matchingRecordIds.includes(record.id)).length : sectionRecords.length);
  function searchRecords(value: string) {
    recordSearch = value;
    const query = value.trim().toLocaleLowerCase();
    matchingRecordIds = sectionRecords.filter(record => {
      const links = 'ownerId' in record ? inventoryPath(plan!.canon,record.ownerId) : 'fromId' in record ? plan!.canon.characters.filter(person => person.id === record.fromId || person.id === record.toId).map(person => person.name).join(' ') : 'relatedIds' in record ? [...plan!.canon.characters,...plan!.canon.places,...plan!.canon.items].filter(link => record.relatedIds.includes(link.id)).map(link => link.name).join(' ') : '';
      return `${JSON.stringify(record)} ${links}`.toLocaleLowerCase().includes(query);
    }).map(record => record.id);
  }
  function recordVisible(id: string) { return mapOpen?id===mapId:!recordSearch.trim() || matchingRecordIds.includes(id); }
  function showAddedRecord() { recordSearch = ''; matchingRecordIds = []; mapOpen=false;mapId='';mapSelected=''; }
  let preparationDirty = $state(false),recoveryDirty=$state(false),recoveryRefresh=$state(0),retainedCount=$state(0);
  function mayLeavePreparation() { return !preparationDirty || confirm('Discard the scene preparation draft? Saved previews remain available.'); }
  function chooseTab(next: string) { if(next===tab&&!mapOpen)return; if (tab === 'prepare' && !mayLeavePreparation()) return; tab = next; showAddedRecord(); }
  $effect(() => { if (error) untrack(() => reportUiError(error, 'New story')); });
  let characterDirections = $state<Record<string,string>>({});
  let setupDirections = $state<Record<string,string>>({});
  const pendingAiInstructions = $derived(Object.values(characterDirections).some(value => value?.trim()) || Object.values(setupDirections).some(value => value?.trim()));
  function clearAiInstructions() { characterDirections = {}; setupDirections = {}; }
  let generatedRecordId = $state('');
  let allowAppearanceChanges = $state<Record<string,boolean>>({});
  let redesignChanges = $state<string[]>([]);
  const redesignLabels:Record<string,string>={name:'Name',role:'Role',notes:'Story notes',visual:'Visual identity',persona:'Personality, voice & history',currentState:'Current emotions & intentions',wardrobe:'Outfit & accessories',injuries:'Current condition',appearanceNotes:'Appearance notes',outfitNotes:'Outfit notes',locationId:'Starting location'};
  let controller = $state<AbortController>();
  let creation: { key: string; id: string } | null = null, saveRequest: { key: string; id: string } | null = null, generation: { key: string; id: string } | null = null;
  const dirty = $derived(!saved || JSON.stringify([input,plan]) !== JSON.stringify([saved.input,saved.plan]));
  const initialValues = untrack(() => JSON.stringify([input,plan]));
  const unsaved = $derived(saved ? dirty : JSON.stringify([input,plan]) !== initialValues);
  const hasFieldPins = $derived(Boolean(plan?.factPins.fields.length));
  const hasBlankRule = $derived(Boolean(plan?.factPins.rules.some(rule => !rule.text.trim())));
  const backgroundAudit = $derived(plan ? buildLoreAudit({ id: saved?.id || 'unsaved-setup', revision: saved?.revision || 0, canon: plan.canon, context: plan.context }) : null);
  $effect(() => onDirty(unsaved || preparationDirty || pendingAiInstructions || recoveryDirty));
  function accept(draft: SetupDraft) { saved = draft; input = structuredClone(draft.input); plan = draft.plan ? structuredClone(draft.plan) : null; onSaved(draft); }
  async function json(response: Response) { const body = await response.json(); if (!response.ok) throw new Error(body.error || 'The setup request failed.'); return body; }
  const send = (path: string, body: unknown, method = 'POST', signal?: AbortSignal) => fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal }).then(json);
  async function persist() {
    if (hasBlankRule) { tab = 'pins'; throw new Error('Write or remove each empty world rule before saving or generating.'); }
    const values = { input: $state.snapshot(input), plan: $state.snapshot(plan) };
    if (!saved) {
      const key = JSON.stringify(values.input); if (creation?.key !== key) creation = { key, id: crypto.randomUUID() };
      saved = await send('/api/setups', { input: values.input, requestId: creation.id }); onSaved(saved!);
    }
    if (JSON.stringify([values.input,values.plan]) === JSON.stringify([saved!.input,saved!.plan])) return saved!;
    const body = { expectedRevision: saved!.revision, ...values }, key = JSON.stringify(body);
    if (saveRequest?.key !== key) saveRequest = { key, id: crypto.randomUUID() };
    const next: SetupDraft = await send(`/api/setups/${saved!.id}`, { ...body, requestId: saveRequest.id }, 'PATCH'); saveRequest = null; accept(next); return next;
  }
  async function action(fn: () => Promise<void>) { if (busy) return; busy = true; error = ''; note = ''; redesignChanges=[];try { await fn(); } catch (e) { error = controller?.signal.aborted ? 'Cancellation requested. Your saved setup is available in Library; reload to check the latest result.' : e instanceof Error ? e.message : 'The request failed. Your saved draft is kept.'; } finally { busy = false; phase = ''; controller = undefined; recoveryRefresh++; } }
  async function cancel() { const current = controller; if (!current) return; try { if (saved && generation) await send('/api/generation/cancel', { storyId: saved.id, requestId: generation.id }); } catch { note = 'Cancellation could not be confirmed. Inspect Dev → Jobs.'; } finally { current.abort(); } }
  function save() { return action(async () => { phase = 'Saving setup…'; await persist(); note = 'Setup saved locally.'; }); }
  function saveAndExport() { return action(async () => { phase = 'Saving and exporting setup…'; const draft = await persist(); await downloadSetup(draft.id, draft.revision); note = 'Setup saved and ZIP downloaded. Import it from Library to create a separate editable draft.'; }); }
  function manual() { if (!plan) { plan = blankSetupPlan(); if (input.title.trim()) plan.title = input.title; } return save(); }
  async function generate(kind: 'generate'|'opening') {
    if(kind==='opening'&&openingPresetBlocked){error='Refresh and choose a current supported opening workflow, or choose Default workflow.';return;}
    if (busy) return;
    if (kind === 'generate' && hasFieldPins) { chooseTab('pins'); note = 'Remove individual field pins before replacing the whole cast and world. Targeted AI edits remain available and respect your pins.'; return; }
    if(kind==='opening'&&retainedCount){note='Recover or discard the retained opening below before writing another.';return;}
    if (kind === 'opening' && !mayLeavePreparation()) return;
    if (kind === 'opening' && pendingAiInstructions && !confirm('Begin chapter one and discard the unused AI instructions? Run their targeted AI action first to use them. These instructions are not part of the saved setup or opening brief.')) return;
    if (kind === 'generate' && plan && !confirm(`Regenerate the whole cast/world setup? This replaces the current draft records and edits.${pendingAiInstructions ? ' Unused targeted AI instructions will also be discarded.' : ''}${preparationDirty ? ' The unsaved scene preparation draft will also be discarded; saved previews remain available.' : ''}`)) return;
    await action(async () => {
      phase = 'Saving setup…'; const draft = await persist();
      if (draft.storyId) { onCreated(await json(await fetch(`/api/stories/${draft.storyId}`)), draft.id); return; }
      const preset=kind==='opening'?openingPreset:null;
      const key = JSON.stringify({id:draft.id,revision:draft.revision,kind,...(preset?{preset}:{})}); if (generation?.key !== key) generation = { key, id: crypto.randomUUID() };
      controller = new AbortController(); phase = kind === 'generate' ? 'Designing the cast & world…' : 'Writing the opening passage and checking its world changes…';
      const result = await send(`/api/setups/${draft.id}/${kind}`, { expectedRevision: draft.revision, requestId: generation.id,...(preset?{preset}:{}) }, 'POST', controller.signal);
      generation = null;
      if (kind === 'generate') { accept(result); clearAiInstructions(); tab = 'cast'; showAddedRecord(); note = 'Cast and world generated. Edit anything, save, then begin chapter one.'; }
      else onCreated(result, draft.id);
    });
  }
  async function redesign(characterId: string,mode:CharacterRedesignMode='revise') {
    if(busy || !plan)return;
    const allowChanges=Boolean((allowAppearanceChanges[characterId]??true)&&!plan.canon.characters.find(c=>c.id===characterId)?.pinnedAppearance);
    if(mode!=='name'&&!confirm(mode==='full'?`Create a fresh name and full character profile? ${allowChanges?'Appearance and outfit can change.':'Physical details and location stay protected.'} Their ID, content preferences and links to other records are kept.`:allowChanges?'Redesign this cast member, including their appearance and outfit? Their ID and content/pin preferences are kept.':'Redesign this cast member’s story details? Their appearance, outfit, current condition, location and content/pin preferences are kept.'))return;
    await action(async()=>{
      phase='Saving setup…';const draft=await persist(),before=draft.plan!.canon.characters.find(c=>c.id===characterId)!,direction=characterDirections[characterId] || '',key=`${draft.id}:${draft.revision}:character:${characterId}:${mode}:${direction}:${allowChanges}`;
      if(generation?.key!==key)generation={key,id:crypto.randomUUID()};controller=new AbortController();phase=mode==='name'?'Choosing a new name…':mode==='full'?'Rebuilding the full character profile…':'Redesigning one cast member…';
      const result=await send(`/api/setups/${draft.id}/character`,{expectedRevision:draft.revision,requestId:generation.id,characterId,mode,direction,allowAppearanceChanges:allowChanges},'POST',controller.signal);
      const after=result.plan.canon.characters.find((c:typeof before)=>c.id===characterId)!;
      redesignChanges=Object.keys(redesignLabels).filter(key=>JSON.stringify(before[key as keyof typeof before])!==JSON.stringify(after[key])).map(key=>redesignLabels[key]);
      generation=null;accept(result);characterDirections[characterId]='';note=mode==='name'?'Name rerolled. All other character details and links were kept.':mode==='full'?'Full character profile redesigned. Review the new name and every profile section before beginning.':allowChanges?'Character redesigned. Review their shared profile before beginning. Other setup records and character preferences were kept.':'Character story details redesigned. Their physical profile, outfit, current condition and location were kept.';
    });
  }
  async function design(kind: SetupDesignKind, mode: SetupDesignMode, targetId?: string) {
    if (busy || !plan) return;
    const labels = { place: 'place', item: 'possession', relationship: 'relationship', thread: 'story thread', lore: 'background entry', world: 'world foundations', opening: 'opening plan' };
    const label = labels[kind];
    if (mode === 'full' && !confirm(`Replace the ${label} details with a fresh design? Other setup records stay in place. Review the result before beginning.`)) return;
    await action(async () => {
      phase = 'Saving setup…';
      const draft = await persist(), direction = setupDirections[`${kind}:${targetId || 'new'}`] || '';
      const key = JSON.stringify([draft.id, draft.revision, kind, mode, targetId, direction]);
      if (generation?.key !== key) generation = { key, id: crypto.randomUUID() };
      controller = new AbortController();
      phase = mode === 'name' ? `Choosing a new ${kind === 'thread' ? 'title' : 'name'}…` : mode === 'create' ? `Designing a new ${label}…` : `Reworking the ${label}…`;
      const result: SetupDraft = await send(`/api/setups/${draft.id}/design`, { expectedRevision: draft.revision, requestId: generation.id, kind, mode, targetId, direction }, 'POST', controller.signal);
      if (kind === 'place' && mode === 'create') generatedRecordId = result.plan!.canon.places.find(p => !draft.plan!.canon.places.some(before => before.id === p.id))?.id || '';
      generation = null;
      accept(result);
      setupDirections[`${kind}:${targetId || 'new'}`] = '';
      if (mode === 'create') showAddedRecord();
      note = mode === 'name' ? `${kind === 'thread' || kind === 'lore' ? 'Title' : 'Name'} rerolled. Other details were kept.` : mode === 'create' ? `New ${label} generated and saved. Review and edit it before beginning.` : `${label.charAt(0).toUpperCase() + label.slice(1)} updated and saved. Review the result before beginning.`;
    });
  }
  async function reload() {
    if(!saved)return;
    await action(async()=>{
      const latest:SetupDraft=await json(await fetch(`/api/setups/${saved!.id}`));
      if((dirty||pendingAiInstructions||(latest.storyId&&recoveryDirty))&&!confirm(latest.storyId?'Discard unsaved setup edits, AI instructions and rechecking guidance, and open the saved story?':'Discard your unsaved setup edits and AI instructions, and reload the saved draft?'))return;
      if(latest.storyId){onCreated(await json(await fetch(`/api/stories/${latest.storyId}`)),latest.id);return;}
      accept(latest);clearAiInstructions();showAddedRecord();note='Loaded the saved setup.';
    });
  }
  function addCharacter() { if (!plan) return; showAddedRecord(); plan.canon.characters.push(normalizeCharacterProfile({ id: crypto.randomUUID(), name: `Cast member ${plan.canon.characters.length + 1}`, role: '', appearance: '', outfit: '', notes: '', locationId: plan.canon.places[0]?.id || '', noNsfw: true, pinnedAppearance: false })); }
  function characterUsed(id: string) { return !plan || plan.canon.characters.length === 1 || plan.canon.items.some(i => i.ownerId === id) || plan.canon.relationships.some(r => r.fromId === id || r.toId === id) || plan.context.sceneBrief.viewpointId === id || plan.context.sceneBrief.castIds.includes(id) || plan.context.lore.some(l => l.relatedIds.includes(id)) || plan.context.knowledge.some(k => k.knownBy.includes(id)); }
  function placeUsed(id: string) { return !plan || plan.canon.places.length === 1 || plan.canon.characters.some(c => c.locationId === id) || plan.canon.places.some(p => p.parentId === id) || plan.canon.items.some(i => i.ownerId === id) || plan.context.sceneBrief.locationId === id || plan.context.lore.some(l => l.relatedIds.includes(id)); }
  function recordPinned(kind: FactPinKind, id: string) { return Boolean(plan?.factPins.fields.some(pin => pin.kind === kind && pin.recordId === id)); }
  function removeRecord(collection: 'characters' | 'places' | 'items' | 'relationships' | 'threads' | 'lore', id: string) {
    if (!plan) return;
    const records = collection === 'lore' ? plan.context.lore : plan.canon[collection];
    const index = records.findIndex(record => record.id === id);
    if(index < 0)return;
    records.splice(index, 1);
    if(collection==='characters')delete characterDirections[id];
    else delete setupDirections[`${({places:'place',items:'item',relationships:'relationship',threads:'thread',lore:'lore'} as const)[collection]}:${id}`];
    pruneSceneBriefResources(plan);
  }
  function worldFoundation() { return plan ? worldFoundationEntry(plan) : undefined; }
  function worldNotes(text: string) { if (!plan) return; let entry = worldFoundation(); if (!entry) { entry = { id: crypto.randomUUID(), title: 'World foundations', text: '', keywords: [], relatedIds: [], visibility: 'always' }; plan.context.lore.push(entry); } entry.text = text; }
  onDestroy(() => { onDirty(false); controller?.abort(); });
</script>

<main class="full-view setup-view" class:map-open={mapOpen}>
  <div class="eyebrow">A novel begins with an idea</div><h1>{plan ? 'Shape your story' : 'New story'}</h1>
  <p class="muted">Suggest a premise, review the ensemble and world, then begin chapter one. Each continuation adds a passage to your growing chapter. Everything in the setup is editable.</p>
  {#if error}<p class="error" role="alert">{error}</p>{#if saved}<button onclick={reload} disabled={busy}>Reload saved setup (discards unsaved edits)</button>{/if}{/if}
  {#if note}<p class="notice" role="status">{note}</p>{/if}
  {#if note&&redesignChanges.length}<p class="muted">Updated: {redesignChanges.join(' · ')}.</p>{/if}
  {#if note.startsWith('Character')||note.startsWith('Full character')}<p class="muted">Possessions, relationship descriptions and opening notes are kept. Review these if they mention the previous name, outfit or history.</p>{/if}
  {#if busy}<p class="notice" role="status">{phase || 'Working…'}</p><button onclick={cancel} disabled={!controller}>Cancel generation</button>{/if}
  {#if pendingAiInstructions}<div class="notice" role="status"><p>Unused AI instructions stay on this page. Saving the setup does not save these instructions. Run their AI action to use them, or clear them before leaving.</p><button type="button" disabled={busy} onclick={clearAiInstructions}>Clear unused AI instructions</button></div>{/if}
  <fieldset class="setup-fields" disabled={busy}>
    <details open><summary>Story settings · premise &amp; storytelling preferences</summary>
      <label>Story idea<textarea bind:value={input.premise} maxlength="8000" rows="4" placeholder="A rogue space trader and their crew take a delivery that changes everything…"></textarea></label>
      <div class="form-grid"><label>Optional book title<input bind:value={input.title} maxlength="200" /></label><label>Generated cast size<input type="number" bind:value={input.castSize} min="1" max="8" /></label></div>
      <label>Narrator style<textarea bind:value={input.narrationStyle} maxlength="4000" placeholder="Atmospheric mystery, narrated like Poe…"></textarea></label><label>Art style<textarea bind:value={input.artStyle} maxlength="4000"></textarea></label>
      <label>Writing guide<textarea bind:value={input.preferences.writingGuide} maxlength="3000" placeholder="Steady pacing, concise description, dialogue with distinct voices. Avoid repeating gestures."></textarea><small>Optional guidance for pacing, dialogue, description and habits to avoid. Applies to future prose; keep content boundaries below.</small></label>
      <div class="form-grid"><label>Tense<select bind:value={input.preferences.tense}><option value="past">Past</option><option value="present">Present</option></select></label><label>Narration<select bind:value={input.preferences.person}><option value="third-limited">Third person · limited</option><option value="third-omniscient">Third person · omniscient</option><option value="first">First person</option></select></label><label>Words per passage<input type="number" bind:value={input.preferences.passageWords} min="100" max="3000" /></label><label>Target chapter words<input type="number" bind:value={input.preferences.chapterWords} min="500" max="15000" /></label></div>
      <p class="muted">A passage is one generated installment. A chapter usually spans several passages, with room for developed scenes before a natural chapter ending.</p>
      <label>Content notes &amp; boundaries<textarea bind:value={input.preferences.contentNotes} maxlength="6000"></textarea></label><label class="check"><input type="checkbox" bind:checked={input.adultContent} /><span>Allow adult content in this story<small>Generated characters still default to No NSFW. Change an individual profile only when wanted.</small></span></label>
    </details>
    <div class="row setup-actions"><button class="primary" onclick={() => generate('generate')} disabled={!canGenerate || !input.premise.trim() || hasFieldPins || hasBlankRule}>{plan ? 'Regenerate cast & world' : 'Generate cast & world'}</button>{#if !plan}<button onclick={manual}>Start with a manual setup</button>{/if}<button onclick={save} disabled={!dirty || hasBlankRule}>Save setup draft</button><button onclick={reload} disabled={!saved || (!dirty && !pendingAiInstructions)}>Reload saved setup</button><button onclick={saveAndExport} disabled={!input.premise.trim() || hasBlankRule}>Save &amp; export setup ZIP</button><span class="muted">{saved ? dirty ? 'Unsaved edits' : `Saved draft · revision ${saved.revision}` : 'Not saved yet'}</span></div>
    {#if hasFieldPins}<p class="muted">Whole cast/world regeneration replaces record IDs, so remove individual field pins first. Targeted AI edits and beginning chapter one respect your pins. <button type="button" onclick={() => chooseTab('pins')}>Manage setup pins</button></p>{/if}
    {#if hasBlankRule}<p class="notice">Write or remove each empty world rule before saving or generating. <button type="button" onclick={() => chooseTab('pins')}>Review world rules</button></p>{/if}
    {#if !canGenerate}<p class="muted">Choose and save a text model in Settings to generate. Manual setup and saving are available now.</p>{/if}
    {#if plan}
      <div class="form-grid"><label>Book title<input bind:value={plan.title} oninput={e => input.title = e.currentTarget.value} maxlength="200" /></label><label>Chapter one title<input bind:value={plan.chapterTitle} maxlength="200" /></label></div>
      <button type="button" aria-pressed={mapOpen} onclick={toggleMap} disabled={!saved?.plan}>{mapOpen?'Close setup map':'Explore setup map'}</button>
      <div class="tabs" role="group" aria-label="Setup sections">{#each [['cast','Cast'],['world','World'],['background','Background'],['items','Possessions'],['relationships','Relationships'],['threads','Story threads'],['opening','Opening'],['prepare','Prepare scene'],['pins','Pins & rules']] as [key,label]}<button class:active={tab === key} aria-pressed={tab === key} onclick={() => chooseTab(key)}>{label}</button>{/each}</div>
      <p class="muted">AI options save your edits first, then update only the chosen part of the setup. Every generated result stays editable.</p>
      <div class:setup-map-columns={mapOpen}>
      {#if mapOpen&&saved?.plan}<WorldMap canon={saved.plan.canon} context={saved.plan.context} layoutKey={`setup:${saved.id}`} selected={mapSelected} disabled={busy} onSelect={selectMap} onReference={referenceMap}/>{/if}
      <section class="setup-map-editor" aria-label={mapOpen?'Setup map editor':'Setup fields'}>
      {#if mapOpen}<p class="notice">Map: saved revision {saved?.revision}. Fields: your editable setup draft. All setup edits stay in this draft when you select another node. Choose Save setup draft to apply them.</p>{/if}
      {#if searchableSections[tab]&&!mapOpen}
        <RecordSearch label={`Search ${searchableSections[tab]}`} query={recordSearch} count={matchingRecordCount} total={sectionRecords.length} disabled={busy} onSearch={searchRecords} />
        {#if recordSearch.trim() && !matchingRecordCount}<p class="notice">No {searchableSections[tab]} match this search. Clear the search to see all records, or add a record below. All setup edits are kept.</p>{:else if !sectionRecords.length}<p class="muted">No {searchableSections[tab]} yet. Add one manually or use the AI options below.</p>{/if}
      {/if}
      {#if mapOpen&&!mapId}<h2>Choose a saved record</h2><p>Expand a location, focus the opening scene or search. The existing setup editor opens here.</p>
      {:else if tab === 'cast'}
        <h2>Your ensemble</h2><p class="muted">Viewpoint is a storytelling choice; no one has to be a player avatar. Reassign possessions, relationships, and opening references before removing a cast member.</p>
        {#each plan.canon.characters.filter(c => recordVisible(c.id)) as c, i (c.id)}
          <details class="setup-record" open={i === 0}>
            <summary>{c.name || 'Unnamed cast member'} · {c.role || 'Role undecided'}</summary>
            <div class="form-grid"><label>Name<input bind:value={c.name} maxlength="120" /></label><label>Role<input bind:value={c.role} maxlength="120" /></label></div>
            <CharacterProfileEditor value={c} prefix={c.name+' · '} onChange={v=>Object.assign(c,v)} />
            <label>Starting location<select bind:value={c.locationId}>{#each plan.canon.places as p}<option value={p.id}>{p.name}</option>{/each}</select></label>
            <div class="row"><label class="check"><input type="checkbox" bind:checked={c.noNsfw} />No NSFW</label><label class="check"><input type="checkbox" bind:checked={c.pinnedAppearance} />Pin appearance &amp; outfit</label></div>
            <label>Direction for a character redesign<input bind:value={characterDirections[c.id]} maxlength="2000" placeholder="Make them a woman and rework their look and outfit; keep their role and history…" /></label>
            <label class="check"><input type="checkbox" checked={!c.pinnedAppearance&&(allowAppearanceChanges[c.id]??true)} onchange={e=>allowAppearanceChanges[c.id]=e.currentTarget.checked} disabled={c.pinnedAppearance} /><span>Allow appearance / outfit changes<small>On by default. The redesign can update appearance, clothing and related descriptions to fit your direction. Turn off to keep physical details, condition and location. Pinned appearance and outfit stay protected.</small></span></label>
            <div class="row"><button onclick={() => redesign(c.id)} disabled={!canGenerate || hasBlankRule}>Redesign this cast member</button><button onclick={() => redesign(c.id,'full')} disabled={!canGenerate || hasBlankRule}>Full redesign</button><button onclick={() => redesign(c.id,'name')} disabled={!canGenerate || hasBlankRule}>Reroll name</button><button onclick={() => removeRecord('characters',c.id)} disabled={characterUsed(c.id) || recordPinned('character',c.id)}>Remove cast member</button></div>
            {#if recordPinned('character',c.id)}<p class="muted">This cast member has pinned fields. Remove their pins in Pins &amp; rules before removing the record.</p>{/if}
            <p class="muted">Redesign follows your direction and keeps unrelated details. Full redesign refreshes every profile section and name within your constraints. Reroll name changes only the name. Pins and the appearance option still apply.</p>
          </details>
        {/each}<button onclick={addCharacter}>Add cast member</button>
      {:else if tab === 'world'}
        <h2>World &amp; places</h2><label>World foundations<textarea value={worldFoundation()?.text || ''} oninput={e => worldNotes(e.currentTarget.value)} maxlength="10000"></textarea></label>
        <SetupAiControls label="World foundations" direction={setupDirections['world:new'] || ''} onDirection={v => setupDirections['world:new'] = v} placeholder="Make travel between stations dangerous, with old trade laws and a struggling frontier economy…" hint="Change the world's shared background without replacing your cast, places or possessions." actions={[{mode:'revise',label:'Revise world foundations'},{mode:'full',label:'Regenerate world foundations'}]} canGenerate={canGenerate && !hasBlankRule} onGenerate={mode => design('world', mode)} />
        {#each plan.canon.places.filter(p => recordVisible(p.id)) as p, i (p.id)}
          <details class="setup-record" open={i === 0 || generatedRecordId === p.id}>
            <summary>{p.name || 'Unnamed place'}</summary>
            <label>Place name<input bind:value={p.name} maxlength="200" /></label><label>Place description<textarea bind:value={p.description} maxlength="40000"></textarea></label>
            <label>Visual description for pictures<textarea bind:value={p.visualDescription} maxlength="4000" placeholder="Layout, materials, colors and recurring visible features"></textarea><small>Optional reusable image details. Pictures use the place description when this is blank.</small></label>
            <label>Inside<select aria-label="Inside" bind:value={p.parentId}><option value={null}>Independent place</option>{#each plan.canon.places.filter(q => q.id !== p.id) as q}<option value={q.id}>{q.name}</option>{/each}</select></label>
            <SetupAiControls label={`Place · ${p.name || 'Unnamed place'}`} direction={setupDirections[`place:${p.id}`] || ''} onDirection={v => setupDirections[`place:${p.id}`] = v} placeholder="Make this an abandoned mining port, with hints that someone still lives here…" hint="Revise follows your direction; full redesign creates fresh details. Name reroll changes only the name." actions={[{mode:'revise',label:'Revise place'},{mode:'full',label:'Full place redesign'},{mode:'name',label:'Reroll place name'}]} canGenerate={canGenerate && !hasBlankRule} onGenerate={mode => design('place', mode, p.id)} />
            <button onclick={() => removeRecord('places',p.id)} disabled={placeUsed(p.id) || recordPinned('place',p.id)}>Remove place</button>
            {#if recordPinned('place',p.id)}<p class="muted">This place has pinned fields. Remove its pins in Pins &amp; rules before removing the record.</p>{/if}
          </details>
        {/each}
        <SetupAiControls label="New place" direction={setupDirections['place:new'] || ''} onDirection={v => setupDirections['place:new'] = v} placeholder="A moon the crew could visit, or a cargo bay inside their ship…" hint="Generate one place that fits the existing world. You can choose its parent place in your direction." actions={[{mode:'create',label:'Generate a place'}]} canGenerate={canGenerate && !hasBlankRule} onGenerate={mode => design('place', mode)} />
        <button onclick={() => { showAddedRecord(); plan!.canon.places.push({ id: crypto.randomUUID(), name: `New place ${plan!.canon.places.length + 1}`, description: '', parentId: null }); }}>Add place / point of interest</button><p class="muted">A place in use must be reassigned before removal. Containment cycles are rejected on save.</p>
      {:else if tab === 'background'}
        <h2>Background &amp; lore</h2>
        <p>Review setting facts, customs and possible routines before beginning. Every saved background entry is shown here, including imported and hidden entries. World foundations is also editable in World.</p>
        <p class="muted">Relevant entries are considered when their keywords or linked records match the scene. Always entries are considered for every scene. Hidden entries stay out of narration. Background does not automatically give a viewpoint character knowledge. Keep notes concise, avoid duplicating profiles or inventory, and describe routines as possibilities rather than completed events.</p>
        {#if backgroundAudit}<details class="setup-record"><summary>Background diagnostics · {backgroundAudit.summary.entriesWithIssues} entries to review</summary>
          <p class="muted">Structural checks and wording heuristics for this setup draft. Wording flags do not prove a contradiction. Actual prompt selection is not measured here; written stories have Dev → Lore context previews.</p>
          {#each backgroundAudit.entries as entry (entry.id)}<section><h3>{entry.title}</h3><small>{entry.id} · {entry.visibility}</small>
            {#each entry.issues as issue}<p class="muted">{issue.heuristic ? 'Review wording' : 'Record check'}: {issue.message}</p>{/each}
            {#each entry.links as link}<p class="muted">{link.pathLabel}{link.kind === 'item' ? link.unlimited ? ' · Always available' : ` · Quantity ${link.quantity}` : ''}</p>{/each}
            {#if !entry.issues.length && !entry.links.length}<p class="muted">No explicit links or structural review flags.</p>{/if}
          </section>{/each}
        </details>{/if}
        {#each plan.context.lore.filter(entry => recordVisible(entry.id)) as entry (entry.id)}
          <section class="setup-record" aria-label={`Background · ${entry.title || 'Untitled entry'}`}>
            <label>Background title<input bind:value={entry.title} maxlength="200" /></label>
            <label>Background text<textarea bind:value={entry.text} maxlength="10000" rows="4"></textarea></label>
            <label>When to include<select bind:value={entry.visibility} onchange={event => { if (event.currentTarget.value === 'hidden' && plan!.context.sceneBrief.resourceIds) plan!.context.sceneBrief.resourceIds = plan!.context.sceneBrief.resourceIds.filter(id => id !== entry.id); }}><option value="relevant">When relevant</option><option value="always">Always</option><option value="hidden">Hidden from narration</option></select></label>
            <label>Keywords<input value={entry.keywords.join(', ')} onchange={event => entry.keywords = event.currentTarget.value.split(',').map(word => word.trim()).filter(Boolean)} /><small>Comma-separated words or phrases, up to 30 keywords of 100 characters each.</small></label>
            <label>Related records<select multiple size="6" bind:value={entry.relatedIds}>
              <optgroup label="Cast">{#each plan.canon.characters as c}<option value={c.id}>{c.name}</option>{/each}</optgroup>
              <optgroup label="Places">{#each plan.canon.places as p}<option value={p.id}>{p.name}</option>{/each}</optgroup>
              <optgroup label="Possessions">{#each plan.canon.items as item}<option value={item.id}>{item.name}</option>{/each}</optgroup>
            </select><small>Optional links to up to 30 records. Use Ctrl (Command on Mac) to select or clear individual records.</small></label>
            <SetupAiControls label={`Background · ${entry.title || 'Untitled entry'}`} direction={setupDirections[`lore:${entry.id}`] || ''} onDirection={v => setupDirections[`lore:${entry.id}`] = v} placeholder="Describe a local custom or an optional routine, keeping changing stock and locations in the records…" hint="Edit only this background entry. Visibility stays as you chose it; background does not automatically become viewpoint knowledge." actions={[{mode:'revise',label:'Revise background'},{mode:'full',label:'Redesign background'},{mode:'name',label:'Reroll background title'}]} canGenerate={canGenerate && !hasBlankRule} onGenerate={mode => design('lore', mode, entry.id)} />
            <button onclick={() => removeRecord('lore',entry.id)}>Remove background entry</button>
          </section>
        {/each}
        <SetupAiControls label="New background" direction={setupDirections['lore:new'] || ''} onDirection={v => setupDirections['lore:new'] = v} placeholder="A custom around welcoming guests, or a possible quiet-afternoon activity…" hint="Generate one concise relevant entry linked to existing records. It will be saved for your review." actions={[{mode:'create',label:'Generate background entry'}]} canGenerate={canGenerate && !hasBlankRule && plan.context.lore.length < 300} onGenerate={mode => design('lore', mode)} />
        <button onclick={() => { showAddedRecord(); plan!.context.lore.push({ id: crypto.randomUUID(), title: 'New background', text: '', keywords: [], relatedIds: [], visibility: 'relevant' }); }} disabled={plan.context.lore.length >= 300}>Add background entry</button>
      {:else if tab === 'items'}
        <h2>Starting possessions</h2><div class="form-grid"><label>Shared funds<input type="number" bind:value={plan.canon.funds} min="0" /></label><label>Shared cargo notes<textarea bind:value={plan.canon.cargoNotes} maxlength="40000"></textarea></label></div>
        {#each plan.canon.items.filter(item => recordVisible(item.id)) as item (item.id)}
          <section class="setup-record" aria-label={`Possession · ${item.name || 'Unnamed possession'}`}>
            <label>Item name<input bind:value={item.name} maxlength="200" /></label><label>Description<textarea bind:value={item.description} maxlength="40000"></textarea></label>
            <label>Visual description for pictures<textarea bind:value={item.visualDescription} maxlength="4000" placeholder="Shape, materials, colors and approximate size"></textarea><small>Optional reusable image details. Pictures use the item description when this is blank.</small></label>
            <label class="check"><input type="checkbox" checked={Boolean(item.isContainer)} disabled={Boolean(item.unlimited)||item.quantity!==1||plan.canon.items.some(child=>child.ownerId===item.id)} onchange={event=>item.isContainer=event.currentTarget.checked} />Container (bag, crate or other storage)</label>
            <label class="check"><input type="checkbox" checked={Boolean(item.unlimited)} disabled={Boolean(item.isContainer)} onchange={event=>{item.unlimited=event.currentTarget.checked;if(item.unlimited){item.quantity=1;item.equipped=false;}}} />Always available (unlimited supply)</label>
            <p class="muted">Use Always available for everyday supplies such as pony treats that should not run out. The saved holder still matters; this does not make the supply available everywhere. Portions taken away are ordinary counted items. For exact stock, leave it off and count the named unit; “Sugar Cubes” with quantity 1 means one cube.</p>
            <div class="form-grid"><label>Quantity<input type="number" bind:value={item.quantity} min="1" max={item.isContainer||item.unlimited?1:1000000} disabled={Boolean(item.isContainer||item.unlimited)} /></label><label>Owner or storage place<select aria-label="Owner or storage place" bind:value={item.ownerId} onchange={()=>item.equipped=false}>{#each inventoryHolders(plan.canon,item.id) as o}<option value={o.id}>{o.name}</option>{/each}</select></label></div>
            <p class="muted">Stored at {inventoryPath(plan.canon,item.ownerId)}. Containers move with their contents and always have quantity 1.</p>
            <label class="check"><input type="checkbox" bind:checked={item.equipped} disabled={Boolean(item.unlimited)||!plan.canon.characters.some(c=>c.id===item.ownerId)} />Equipped by its owner</label>
            <SetupAiControls label={`Possession · ${item.name || 'Unnamed possession'}`} direction={setupDirections[`item:${item.id}`] || ''} onDirection={v => setupDirections[`item:${item.id}`] = v} placeholder="Make this a worn family heirloom with a practical use aboard the ship…" hint="Revise or redesign its details, or reroll only its name. Ownership stays the same unless your direction asks to change it." actions={[{mode:'revise',label:'Revise possession'},{mode:'full',label:'Full possession redesign'},{mode:'name',label:'Reroll possession name'}]} canGenerate={canGenerate && !hasBlankRule} onGenerate={mode => design('item', mode, item.id)} />
            <button disabled={plan.canon.items.some(child=>child.ownerId===item.id) || plan.context.lore.some(entry=>entry.relatedIds.includes(item.id)) || recordPinned('item',item.id)} onclick={() => removeRecord('items',item.id)}>Remove item</button>{#if plan.canon.items.some(child=>child.ownerId===item.id)}<p class="muted">Move the container’s contents elsewhere before removing it.</p>{/if}
            {#if plan.context.lore.some(entry=>entry.relatedIds.includes(item.id))}<p class="muted">Remove this possession’s links in Background before removing the record.</p>{/if}
            {#if recordPinned('item',item.id)}<p class="muted">This possession has pinned fields. Remove its pins in Pins &amp; rules before removing the record.</p>{/if}
          </section>
        {/each}
        <SetupAiControls label="New possession" direction={setupDirections['item:new'] || ''} onDirection={v => setupDirections['item:new'] = v} placeholder="A tool for the engineer, cargo stored aboard the ship, or something the captain carries…" hint="Generate one possession held by an existing character, place or container." actions={[{mode:'create',label:'Generate a possession'}]} canGenerate={canGenerate && !hasBlankRule} onGenerate={mode => design('item', mode)} />
        <button onclick={() => { showAddedRecord(); plan!.canon.items.push({ id: crypto.randomUUID(), name: 'New possession', description: '', quantity: 1, ownerId: plan!.canon.characters[0].id, equipped: false }); }}>Add possession</button>
      {:else if tab === 'relationships'}
        <h2>Connections within the cast</h2>
        {#each plan.canon.relationships.filter(r => recordVisible(r.id)) as r (r.id)}
          {@const connection = `${plan.canon.characters.find(c => c.id === r.fromId)?.name || 'Cast member'} → ${plan.canon.characters.find(c => c.id === r.toId)?.name || 'Cast member'}`}
          <section class="setup-record" aria-label={`Relationship · ${connection}`}>
            <div class="form-grid"><label>From<select bind:value={r.fromId} onchange={event => { if(event.currentTarget.value === r.toId) r.toId = ''; }}>{#each plan.canon.characters as c}<option value={c.id}>{c.name}</option>{/each}</select></label><label>To<select bind:value={r.toId}><option value="">Choose another cast member</option>{#each plan.canon.characters.filter(c => c.id !== r.fromId) as c}<option value={c.id}>{c.name}</option>{/each}</select></label></div>
            <label>Relationship notes<textarea bind:value={r.notes} maxlength="40000"></textarea></label>
            <SetupAiControls label={`Relationship · ${connection}`} direction={setupDirections[`relationship:${r.id}`] || ''} onDirection={v => setupDirections[`relationship:${r.id}`] = v} placeholder="They trust each other at work but disagree over an old debt…" hint="Develop this connection while keeping the linked cast members, unless you ask to change them." actions={[{mode:'revise',label:'Revise relationship'},{mode:'full',label:'Full relationship redesign'}]} canGenerate={canGenerate && !hasBlankRule} onGenerate={mode => design('relationship', mode, r.id)} />
            <button onclick={() => removeRecord('relationships',r.id)} disabled={recordPinned('relationship',r.id)}>Remove relationship</button>
            {#if recordPinned('relationship',r.id)}<p class="muted">This relationship has pinned fields. Remove its pins in Pins &amp; rules before removing the record.</p>{/if}
          </section>
        {/each}
        <SetupAiControls label="New relationship" direction={setupDirections['relationship:new'] || ''} onDirection={v => setupDirections['relationship:new'] = v} placeholder="Explore a friendship, rivalry or unresolved debt between two cast members…" hint="Generate one connection between existing cast members. Mention their names to choose who is involved." actions={[{mode:'create',label:'Generate a relationship'}]} canGenerate={canGenerate && !hasBlankRule && plan.canon.characters.length >= 2} onGenerate={mode => design('relationship', mode)} />
        <button disabled={plan.canon.characters.length < 2} onclick={() => { showAddedRecord(); plan!.canon.relationships.push({ id: crypto.randomUUID(), fromId: plan!.canon.characters[0].id, toId: plan!.canon.characters[1].id, notes: '' }); }}>Add relationship</button>{#if plan.canon.characters.length < 2}<p class="muted">Add a second cast member before creating a relationship.</p>{/if}
      {:else if tab === 'threads'}
        <h2>Unresolved story threads</h2><p class="muted">These are possibilities to explore, not events that have already happened.</p>
        {#each plan.canon.threads.filter(t => recordVisible(t.id)) as t (t.id)}
          <section class="setup-record" aria-label={`Story thread · ${t.title || 'Untitled thread'}`}>
            <label>Thread title<input bind:value={t.title} maxlength="200" /></label><label>Thread notes<textarea bind:value={t.notes} maxlength="40000"></textarea></label>
            <SetupAiControls label={`Story thread · ${t.title || 'Untitled thread'}`} direction={setupDirections[`thread:${t.id}`] || ''} onDirection={v => setupDirections[`thread:${t.id}`] = v} placeholder="Tie this mystery to the captain's past, and leave several possible explanations…" hint="Develop its possibilities, create a fresh thread in its place, or reroll only the title." actions={[{mode:'revise',label:'Revise story thread'},{mode:'full',label:'Full story thread redesign'},{mode:'name',label:'Reroll thread title'}]} canGenerate={canGenerate && !hasBlankRule} onGenerate={mode => design('thread', mode, t.id)} />
            <button onclick={() => removeRecord('threads',t.id)} disabled={recordPinned('thread',t.id)}>Remove thread</button>
            {#if recordPinned('thread',t.id)}<p class="muted">This thread has pinned fields. Remove its pins in Pins &amp; rules before removing the record.</p>{/if}
          </section>
        {/each}
        <SetupAiControls label="New story thread" direction={setupDirections['thread:new'] || ''} onDirection={v => setupDirections['thread:new'] = v} placeholder="A mystery around the cargo, a looming faction conflict, or a personal question…" hint="Generate one unresolved possibility for the story to explore." actions={[{mode:'create',label:'Generate a story thread'}]} canGenerate={canGenerate && !hasBlankRule} onGenerate={mode => design('thread', mode)} />
        <button onclick={() => { showAddedRecord(); plan!.canon.threads.push({ id: crypto.randomUUID(), title: 'An unresolved question', notes: '', status: 'open' }); }}>Add story thread</button>
      {:else if tab === 'prepare'}
        <p class="muted">Save the setup fields first, then prepare a future scene below. Applying a reviewed preparation adds missing records and updates the opening brief.</p>
      {:else if tab === 'pins'}
        <section aria-label="Setup pins and world rules">
          <h2>Pins &amp; rules for this story</h2>
          <p>Protect selected setup facts from AI redesign and the opening's world changes. Manual edits update the value a pin protects. These pins and rules carry into the story when chapter one begins.</p>
          <p class="muted">Save with Save setup draft. Pins and rules are required context; generation stops if they cannot fit the model's context budget. Keep them concise. A pinned record must be unpinned before removal.</p>
          <FactPinsEditor canon={plan.canon} bind:value={plan.factPins} disabled={busy} idPrefix="setup-pins" appearanceHelp="Manage those in the Cast section." onChange={() => note = ''} />
        </section>
      {:else}
        <h2>Where chapter one begins</h2><div class="form-grid"><label>Opening viewpoint<select bind:value={plan.context.sceneBrief.viewpointId}>{#each plan.canon.characters as c}<option value={c.id}>{c.name}</option>{/each}</select></label><label>Opening location<select bind:value={plan.context.sceneBrief.locationId}>{#each plan.canon.places as p}<option value={p.id}>{p.name}</option>{/each}</select></label></div><fieldset><legend>Cast to introduce</legend>{#each plan.canon.characters as c}<label class="check"><input type="checkbox" value={c.id} bind:group={plan.context.sceneBrief.castIds} />{c.name}</label>{/each}</fieldset><label>Opening situation &amp; purpose<textarea bind:value={plan.context.sceneBrief.purpose} maxlength="3000"></textarea></label><label>Immediate tension<textarea bind:value={plan.context.sceneBrief.tension} maxlength="3000"></textarea></label><label>Pause when…<textarea bind:value={plan.context.sceneBrief.stopAt} maxlength="2000"></textarea></label>
        <SceneResourceHints canon={plan.canon} lore={plan.context.lore} bind:ids={plan.context.sceneBrief.resourceIds} saveLabel="Save setup draft" />
        <SetupAiControls label="Opening plan" direction={setupDirections['opening:new'] || ''} onDirection={v => setupDirections['opening:new'] = v} placeholder="Begin during an unexpected customs inspection, with the crew trying to hide their cargo…" hint="Plan the opening situation, tension and stopping point. Prose is written only when you begin chapter one." actions={[{mode:'revise',label:'Revise opening plan'},{mode:'full',label:'Regenerate opening plan'}]} canGenerate={canGenerate && !hasBlankRule} onGenerate={mode => design('opening', mode)} />
      {/if}
      </section></div>
      {#if saved?.plan}<WorkflowPresetPicker sourceId={saved.id} mode="opening" label="Opening workflow" bind:value={openingPreset} bind:blocked={openingPresetBlocked} disabled={busy}/>{/if}
      {#if retainedCount}<p class="notice">A generated opening is retained below. Retry its world updates or discard that draft before beginning another opening.</p>{/if}
      <div class="setup-finish"><h2>Ready to begin chapter one?</h2><p class="muted">Write an opening passage of about {input.preferences.passageWords} words toward a chapter of roughly {(input.preferences.chapterWords ?? 3000).toLocaleString()} words. Continue the story to develop the chapter. Your reviewed setup is saved first; prose and world changes are validated together.</p><button class="primary" onclick={() => generate('opening')} disabled={!canGenerate || openingPresetBlocked || hasBlankRule || retainedCount>0}>Begin chapter one</button><button onclick={save} disabled={!dirty || hasBlankRule}>Save setup draft</button></div>
    {/if}
  </fieldset>
  {#if saved?.plan}<PassageRecovery source={saved} kind="setup" refreshKey={recoveryRefresh} bind:busy {canGenerate} disabled={dirty||preparationDirty} onReload={reload} onCount={count=>retainedCount=count} onDirty={value=>recoveryDirty=value} onDiscard={()=>generation=null} onSaved={story=>{generation=null;onCreated(story,saved!.id);}} onEdit={(kind,id)=>{chooseTab(kind==='item'?'items':kind==='place'?'world':'cast');showAddedRecord();generatedRecordId=id;note='Edit the saved record above, save the setup, then retry the retained passage below.';}} />{/if}
  {#if !mapOpen && tab === 'prepare' && saved?.plan}<ScenePreparation source={saved} kind="setup" bind:busy {canGenerate} disabled={dirty} onDirty={value => preparationDirty = value} onApplied={value => accept(value as SetupDraft)} />{/if}
</main>

<style>
  .setup-view.map-open{max-width:1280px}
  .setup-map-editor{min-width:0}.setup-map-columns{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:28px;margin-top:20px}.setup-map-columns .setup-map-editor{border-left:1px solid var(--line);padding-left:24px}
  @media(max-width:1000px){.setup-map-columns{grid-template-columns:minmax(0,1fr)}.setup-map-columns .setup-map-editor{border-left:0;border-top:1px solid var(--line);padding:18px 0 0}}
</style>
