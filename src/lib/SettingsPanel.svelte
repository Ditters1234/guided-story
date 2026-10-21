<script lang="ts">
  import { onMount, onDestroy, tick, untrack } from 'svelte';
  import type { Story } from './story';
  import type { PublicConnections } from './settings';
  import { imageVariables, resolveImagePrompt, type ImageVariables } from './image-prompts';
  import { subjectFromCharacter } from './illustration';
  import { registerClientSecret } from './client-console';
  import { setClientDraftSecret } from './client-secrets';
  import { reportUiError } from './ui-feedback';
  let { story, connections = $bindable(null), busy = $bindable(false), instance, initialTab = '', textSize = $bindable('17'), readingWidth = $bindable('660'), appearance = $bindable('auto'), artwork = $bindable(true), readingFont = $bindable('serif'), lineSpacing = $bindable('1.85'), onReadingSave, onMutate, onOpenGallery, onDirty }: {
    story: Story | null; connections: PublicConnections | null; busy: boolean; instance: string; initialTab?: string;
    textSize: string; readingWidth: string; appearance: string; artwork: boolean; readingFont: string; lineSpacing: string; onReadingSave: () => void; onMutate: (action: unknown) => Promise<boolean>; onOpenGallery: () => void; onDirty?: (dirty: boolean) => void;
  } = $props();
  const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
  type ConnectionSection = keyof PublicConnections;
  let connectionDraft = $state<PublicConnections | null>(untrack(() => connections ? clone(connections) : null));
  let savedConnections = untrack(() => connections ? clone(connections) : null);
  const tabs = [['reading', 'Reading'], ['story', 'Story'], ['text', 'Text LLM'], ['comfy', 'ComfyUI'], ['prompts', 'Prompts'], ['context', 'Context'], ['storage', 'Storage & Dev']];
  let tab = $state(untrack(() => tabs.some(([key]) => key === initialTab) ? initialTab : 'reading')), note = $state(''), error = $state('');
  type StoryDraft = Pick<Story, 'title' | 'premise' | 'narrationStyle' | 'artStyle' | 'adultContent' | 'preferences'>;
  const storyDraft = (s: Story): StoryDraft => ({ title: s.title, premise: s.premise, narrationStyle: s.narrationStyle, artStyle: s.artStyle, adultContent: s.adultContent, preferences: { ...s.preferences } });
  let draft = $state<StoryDraft | null>(untrack(() => story ? storyDraft(story) : null));
  let savedStoryDraft = $state<StoryDraft | null>(untrack(() => story ? storyDraft(story) : null));
  let draftStoryId = untrack(() => story?.id || '');
  let revision = $state(untrack(() => story ? `${story.id}:${story.revision}` : ''));
  let apiKey = $state(''), removeKey = $state(false), manualModel = $state(false), models = $state<string[]>([]), modelsUrl = $state('');
  let textStatus = $state(''), comfyStatus = $state(''), testedTextAddress = $state(''), testedComfyAddress = $state('');
  let testPrompt = $state('Write a short opening paragraph about a rogue space trader arriving at a mysterious station.'), testSystem = $state('You are a fiction writer. Return only the requested prose, without analysis.');
  let textResult = $state(''), textDuration = $state(0), runningText = $state(false);
  let controller: AbortController | null = null;
  let workflows = $state<{ name: string; path: string }[]>([]), workflowInfo = $state<{ nodes: { id: string; type: string; inputs: string[] }[] } | null>(null);
  let importedName = $state('');
  let framing = $state<'portrait' | 'fullbody' | 'scene'>('portrait'), subjectId = $state('');
  let values = $state<ImageVariables>({ 'subject.age':'42', 'subject.apparent_age':'', 'subject.actual_age':'42', 'subject.gender':'man', 'subject.presentation':'', 'subject.gender_identity':'man', 'subject.injuries':'', 'subject.appearance_notes':'', 'subject.outfit_notes':'', 'subject.species':'human', 'subject.skin':'', 'subject.build':'', 'subject.distinctive':'', 'image.composition':'', 'image.lighting':'', 'art.style': untrack(() => story?.artStyle || 'Painterly science-fiction illustration'), 'subject.name': 'an adult space trader', 'subject.face': 'weathered face', 'subject.hair': 'dark hair threaded with grey', 'subject.eyes': 'thoughtful eyes', 'subject.upper_body': 'worn flight jacket over a charcoal shirt', 'subject.lower_body': 'practical trousers', 'subject.footwear': 'scuffed boots', 'subject.accessories': '', 'subject.position': '', 'subject.depth': '', 'subject.gaze': '', 'subject.pose': 'standing at ease', 'subject.expression': 'a slight, knowing smile', 'image.background': 'softly lit spaceship bridge', 'image.scene': 'a quiet moment before docking at an unfamiliar station' });
  let nonsexual = $state(true), imageJob = $state<{ id: string; status: string; error?: string; seed: number | null; durationMs: number; images: string[] } | null>(null), watchingImage = $state(false);
  let imageTimer: ReturnType<typeof setTimeout> | undefined, alive = true;
  let imageRequest: { requestId: string; input: string } | null = null;
  let storage = $state({ count: 0, bytes: 0, stagingCount: 0 });
  let storageLoading = $state(false), storageLoaded = $state(false), storageError = $state(''), activeAction = $state('');
  const changed = (left: unknown, right: unknown) => JSON.stringify(left) !== JSON.stringify(right);
  const dirtySections = $derived({
    story: changed(draft, savedStoryDraft),
    text: Boolean(connectionDraft && connections && (changed(connectionDraft.text, connections.text) || apiKey || removeKey)),
    comfy: Boolean(connectionDraft && connections && changed(connectionDraft.images, connections.images)),
    prompts: Boolean(connectionDraft && connections && changed(connectionDraft.prompts, connections.prompts)),
    context: Boolean(connectionDraft && connections && changed(connectionDraft.context, connections.context))
  });
  const settingsDirty = $derived(Object.values(dirtySections).some(Boolean));
  $effect(() => { onDirty?.(settingsDirty); });
  // External saves may refresh untouched sections, but must not discard another tab's edits.
  $effect(() => {
    const current = connections ? clone(connections) : null;
    untrack(() => {
      if (!current) { savedConnections = null; return; }
      if (!connectionDraft || !savedConnections) connectionDraft = clone(current);
      else for (const section of ['text', 'images', 'context', 'prompts'] as const) {
        if (!changed(connectionDraft[section], savedConnections[section])) {
          connectionDraft = { ...connectionDraft, [section]: clone(current[section]) };
        }
      }
      savedConnections = clone(current);
    });
  });
  function resetSection(section: 'story' | ConnectionSection) {
    error = ''; note = '';
    if (section === 'story') { draft = savedStoryDraft ? clone(savedStoryDraft) : null; return; }
    if (!connections || !connectionDraft) return;
    connectionDraft = { ...connectionDraft, [section]: clone(connections[section]) };
    if (section === 'text') { apiKey = ''; removeKey = false; textStatus = ''; }
    if (section === 'images') { comfyStatus = ''; workflowInfo = null; importedName = ''; }
  }
  const template = $derived(connectionDraft?.prompts[framing] || '');
  const mustNonsexual = $derived(nonsexual || !story?.adultContent || Boolean(story?.canon.characters.find(c => c.id === subjectId)?.noNsfw));
  const resolved = $derived.by(() => { try { return { ...resolveImagePrompt(template, values, framing, mustNonsexual), error: '' }; } catch (e) { return { text: '', omitted: [], error: e instanceof Error ? e.message : 'Invalid template' }; } });
  $effect(() => { setClientDraftSecret(apiKey); return () => setClientDraftSecret(''); });
  $effect(() => { if (error) untrack(() => reportUiError(error, 'Settings')); });
  $effect(() => { if (resolved.error) untrack(() => reportUiError(resolved.error, 'Settings · image prompt')); });
  $effect(() => { if (imageJob?.error) untrack(() => reportUiError(imageJob!.error!, 'Settings · image test')); });
  $effect(() => {
    const current = story ? `${story.id}:${story.revision}` : '';
    if (current !== revision) untrack(() => {
      const next = story ? storyDraft(story) : null;
      if (draftStoryId !== (story?.id || '') || !changed(draft, savedStoryDraft)) draft = next ? clone(next) : null;
      savedStoryDraft = next; draftStoryId = story?.id || ''; revision = current;
    });
  });
  async function json(response: Response) { const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Settings request failed.'); return result; }
  const post = (path: string, body: unknown, signal?: AbortSignal) => fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal }).then(json);
  async function chooseTab(key: string) { tab = key; error = ''; note = ''; try { localStorage.setItem('guided-story-settings-tab', key); } catch { /* Tab preferences are optional. */ } if (key === 'storage') await refreshStorage(); }
  async function tabKey(event: KeyboardEvent) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const current = tabs.findIndex(([key]) => key === tab);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    await chooseTab(tabs[index][0]); await tick(); document.getElementById('settings-tab-' + tabs[index][0])?.focus();
  }
  async function readingChanged() { await tick(); onReadingSave(); note = 'Reading preferences saved on this browser.'; }
  function textPayload() { if(apiKey)registerClientSecret(apiKey);return connectionDraft ? { ...connectionDraft.text, ...(removeKey ? { apiKey: '' } : apiKey ? { apiKey } : {}) } : null; }
  async function action(fn: () => Promise<void>, label = 'Applying settings…') { if (busy) return; busy = true; activeAction = label; error = ''; note = ''; try { await fn(); } catch (e) { error = e instanceof Error ? e.message : 'Settings request failed.'; } finally { busy = false; activeAction = ''; } }
  async function save(section: 'text' | 'images' | 'context' | 'prompts') {
    await action(async () => {
      if (!connectionDraft) return;
      const saved = await json(await fetch('/api/connections', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [section]: section === 'text' ? textPayload() : connectionDraft[section] }) }));
      connectionDraft = { ...connectionDraft, [section]: clone(saved[section]) };
      // Publish only the acknowledged section; other draft tabs remain private until saved.
      if (connections) connections = { ...connections, [section]: clone(saved[section]) };
      if (section === 'text') { apiKey = ''; removeKey = false; }
      note = `${section === 'images' ? 'ComfyUI' : section === 'text' ? 'Text LLM' : section === 'prompts' ? 'Prompt' : 'Context'} settings saved locally.`;
    }, `Saving ${section === 'images' ? 'ComfyUI' : section === 'text' ? 'Text LLM' : section === 'prompts' ? 'prompt' : 'context'} settings…`);
  }
  async function testConnection(target: 'text' | 'images') {
    await action(async () => {
      if (!connectionDraft) return;
      const result = await post('/api/connections/test', target === 'text' ? { target, text: textPayload() } : { target, images: connectionDraft.images });
      if (target === 'text') { models = result.models; modelsUrl = result.baseUrl; testedTextAddress = connectionDraft.text.baseUrl; textStatus = models.length ? `Connected · ${models.length} available models. Select a model, then save Text LLM settings.` : 'Connected, but the API returned no model IDs. Choose Enter model ID manually, then save Text LLM settings.'; }
      else { testedComfyAddress = connectionDraft.images.baseUrl; comfyStatus = `Connected to ComfyUI${result.version ? ` ${result.version}` : ''} · ${result.devices.length} device(s).`; }
    }, target === 'text' ? 'Testing Text LLM connection…' : 'Testing ComfyUI connection…');
  }
  async function runText() {
    await action(async () => {
      controller = new AbortController(); runningText = true; textResult = '';
      try { const result = await post('/api/connections/text-test', { text: textPayload(), prompt: testPrompt, system: testSystem }, controller.signal); textResult = result.content; textDuration = result.durationMs; }
      finally { runningText = false; controller = null; }
    }, 'Running text test…');
  }
  async function refreshWorkflows() { workflows = await json(await fetch('/api/workflows')); }
  async function inspectWorkflow() {
    await action(async () => { if (!connectionDraft) return; const result = await json(await fetch('/api/workflows?path=' + encodeURIComponent(connectionDraft.images.workflow))); workflowInfo = result; connectionDraft.images.bindings = result.suggested; note = 'Suggested bindings loaded into the form. Check them before saving or testing; complex workflows may need manual mapping.'; }, 'Inspecting workflow inputs…');
  }
  async function importWorkflow(event: Event) {
    const input = event.target as HTMLInputElement, file = input.files?.[0]; if (!file) return;
    await action(async () => { if (!connectionDraft) return; if (file.size > 900000) throw new Error('Import an API-format workflow smaller than 900 KB.'); const result = await post('/api/workflows', { name: file.name, workflow: JSON.parse(await file.text()) }); await refreshWorkflows(); connectionDraft.images.workflow = result.path; importedName = result.name; workflowInfo = null; note = 'Workflow imported. Inspect its bindings, then save ComfyUI settings.'; }, 'Importing workflow…'); input.value = '';
  }
  function changeTestFraming(next:'portrait'|'fullbody'|'scene'){
    const c=story?.canon.characters.find(c=>c.id===subjectId);
    if(c){const before=subjectFromCharacter(c,framing),after=subjectFromCharacter(c,next);
      for(const [variable,field] of [['distinctive','distinctive'],['injuries','injuries'],['upper_body','upper_body'],['lower_body','lower_body'],['footwear','footwear'],['accessories','accessories'],['appearance_notes','appearanceNotes'],['outfit_notes','outfitNotes']] as const){const key=('subject.'+variable) as keyof ImageVariables;if(values[key]===before[field])values[key]=after[field];}}
    framing=next;
  }
  function selectSubject() {
    const c = story?.canon.characters.find(c => c.id === subjectId);
    if (c) { const subject=subjectFromCharacter(c,framing);values['subject.name']=c.name;
      for(const field of ['species','skin','build','face','hair','eyes','distinctive','injuries','upper_body','lower_body','footwear','accessories','pose','expression'] as const)values[('subject.'+field) as keyof ImageVariables]=subject[field];
      values['subject.appearance_notes']=subject.appearanceNotes;values['subject.outfit_notes']=subject.outfitNotes;
      values['subject.age']=subject.apparentAge || subject.age;values['subject.apparent_age']=subject.apparentAge;values['subject.actual_age']=subject.age;
      values['subject.gender']=subject.presentation || subject.gender;values['subject.presentation']=subject.presentation;values['subject.gender_identity']=subject.gender;
      nonsexual = c.noNsfw || !story?.adultContent;
    }
    if (story) values['art.style'] = story.artStyle;
    // Granular wardrobe fields are supplied; the portrait resolver omits off-frame regions.
  }
  async function pollImage() {
    if (!imageJob || !watchingImage) return;
    try { const result = await json(await fetch('/api/image-tests/' + imageJob.id)); if (!alive) return; imageJob = result; if (result.status !== 'queued') { watchingImage = false; localStorage.removeItem('guided-story-image-test'); if (result.error) error = result.error; await refreshStorage(); return; } }
    catch (e) { if (!alive) return; error = e instanceof Error ? e.message : 'Could not read image test.'; watchingImage = false; return; }
    imageTimer = setTimeout(pollImage, 2000);
  }
  async function runImage() {
    await action(async () => {
      if (!connectionDraft) return; if (resolved.error) throw new Error(resolved.error);
      const input = { images: connectionDraft.images, prompt: resolved.text, negative: connectionDraft.prompts.negative, template, variables: $state.snapshot(values) }, fingerprint = JSON.stringify(input);
      if (!imageRequest || imageRequest.input !== fingerprint) imageRequest = { requestId: crypto.randomUUID(), input: fingerprint };
      imageJob = await post('/api/image-tests', { ...input, requestId: imageRequest.requestId }); imageRequest = null;
      watchingImage = true; localStorage.setItem('guided-story-image-test', imageJob!.id); pollImage();
    }, 'Submitting Settings test image…');
  }
  function stopWatching() { watchingImage = false; clearTimeout(imageTimer); note = 'Stopped watching. The ComfyUI job continues; Resume watching can retrieve its result. Other ComfyUI jobs are not interrupted.'; }
  async function refreshStorage() { if (storageLoading) return; storageLoading = true; if (storageError && error === storageError) error = ''; storageError = ''; try { const result = await json(await fetch('/api/image-tests')); if (!alive) return; storage = result; storageLoaded = true; if (!imageJob && result.latest) { imageJob = result.latest; if (imageJob?.status === 'queued') { watchingImage = true; pollImage(); } } } catch (e) { if (alive) { storageError = e instanceof Error ? e.message : 'Storage unavailable'; error = storageError; } } finally { if (alive) storageLoading = false; } }
  async function clearPreviews() { if (!confirm('Delete local Settings test-image previews? Story records and ComfyUI output files are kept.')) return; await action(async () => { storage = await json(await fetch('/api/image-tests', { method: 'DELETE' })); storageLoaded = true; imageJob = null; localStorage.removeItem('guided-story-image-test'); note = 'Local test previews cleared.'; }, 'Clearing Settings test previews…'); }
  async function exportSettings() { const safe = await json(await fetch('/api/connections')); const url = URL.createObjectURL(new Blob([JSON.stringify(safe, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'storyweaver-settings-no-keys.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  async function saveStory() { if (!draft || busy) return; error = ''; note = ''; activeAction = 'Saving story preferences…'; try { const ok = await onMutate({ type: 'preferences', title: draft.title, premise: draft.premise, narrationStyle: draft.narrationStyle, artStyle: draft.artStyle, adultContent: draft.adultContent, preferences: draft.preferences }); if (ok) { savedStoryDraft = story ? storyDraft(story) : clone(draft); draft = clone(savedStoryDraft); revision = story ? `${story.id}:${story.revision}` : ''; note = 'Story preferences saved.'; } } catch (e) { error = e instanceof Error ? e.message : 'Could not save story preferences.'; } finally { activeAction = ''; } }
  onMount(() => {
    try { const savedTab = localStorage.getItem('guided-story-settings-tab'); if (!tabs.some(([key]) => key === initialTab) && tabs.some(([key]) => key === savedTab)) tab = savedTab!;
      const job = localStorage.getItem('guided-story-image-test'); if (job) { imageJob = { id: job, status: 'queued', images: [], seed: 0, durationMs: 0 }; watchingImage = true; pollImage(); }
    } catch { /* Preferences are optional. */ }
    refreshWorkflows().catch(e => error = e.message); refreshStorage();
  });
  onDestroy(() => { onDirty?.(false); alive = false; clearTimeout(imageTimer); controller?.abort(); });
</script>

<main class="full-view settings-view">
  <div class="eyebrow">Your reading space · {instance} instance</div><h1>Settings</h1>
  <p class="muted">Reading preferences save automatically. Other tabs have their own Save button. Switching tabs within Settings keeps your draft edits. Unsaved sections are marked below; leaving Settings asks before discarding them. Connection tests use the form without saving it.</p>
  <div class="settings-tabs" role="tablist" tabindex="-1" aria-label="Settings sections" onkeydown={tabKey}>{#each tabs as [key, label]}<button role="tab" id={'settings-tab-' + key} tabindex={tab === key ? 0 : -1} aria-selected={tab === key} aria-controls={'settings-panel-' + key} class:active={tab === key} onclick={() => chooseTab(key)} title={dirtySections[key as keyof typeof dirtySections] ? label + ": unsaved changes" : undefined}>{label}{#if dirtySections[key as keyof typeof dirtySections]}<span class="settings-unsaved-dot" aria-hidden="true"> &#8226;</span>{/if}</button>{/each}</div>
  <div role="tabpanel" id={'settings-panel-' + tab} aria-labelledby={'settings-tab-' + tab}>
  {#if error}<p class="error" role="alert">{error}</p>{/if}{#if note}<p class="notice" role="status">{note}</p>{/if}
  {#if activeAction}<p class="settings-activity notice" role="status">{activeAction}</p>{/if}
  {#if runningText && tab !== 'text'}<button type="button" onclick={() => controller?.abort()}>Cancel text test</button>{/if}
  {#if tab === 'reading'}
    <section class="settings-section"><h2>Reading preferences</h2><p class="muted">Saved automatically on this browser.</p><div class="form-grid">
      <label>Text size<select bind:value={textSize} onchange={readingChanged}><option value="17">Comfortable</option><option value="19">Larger</option><option value="21">Largest</option></select></label>
      <label>Reading width<select bind:value={readingWidth} onchange={readingChanged}><option value="660">Comfortable</option><option value="540">Narrow</option></select></label>
      <label>Appearance<select bind:value={appearance} onchange={readingChanged}><option value="auto">Follow device</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
      <label>Reading font<select bind:value={readingFont} onchange={readingChanged}><option value="serif">Book serif</option><option value="sans">Sans serif</option></select></label><label>Line spacing<select bind:value={lineSpacing} onchange={readingChanged}><option value="1.6">Compact</option><option value="1.85">Comfortable</option><option value="2.1">Roomy</option></select></label>
      <label class="check"><input type="checkbox" bind:checked={artwork} onchange={readingChanged} />Show artwork in the story</label>
    </div></section>
  {:else if tab === 'story'}
    {#if draft}<form class="settings-section" aria-label="Story preferences" onsubmit={e => { e.preventDefault(); saveStory(); }}><fieldset class="settings-fields" disabled={busy}><h2>This story</h2><label>Title<input bind:value={draft.title} required maxlength="200" /></label><label>Premise<textarea bind:value={draft.premise} maxlength="40000"></textarea></label><label>Narrator style<textarea bind:value={draft.narrationStyle} maxlength="10000" placeholder="For example: gothic atmosphere inspired by Poe, restrained dialogue."></textarea></label>
    <label>Writing guide<textarea bind:value={draft.preferences.writingGuide} maxlength="3000" placeholder="Pacing, description density, dialogue balance, narrative distance, and habits to avoid."></textarea></label><p class="muted">A short craft guide for this story, alongside the narrator style. Keep scene plans in Scene direction and boundaries below. This guide is included with every continuation.</p>
    <div class="form-grid"><label>Tense<select bind:value={draft.preferences.tense}><option value="past">Past</option><option value="present">Present</option></select></label><label>Narrative perspective<select bind:value={draft.preferences.person}><option value="third-limited">Third person · limited</option><option value="third-omniscient">Third person · omniscient</option><option value="first">First person</option></select></label><label>Target passage words<input type="number" min="100" max="3000" bind:value={draft.preferences.passageWords} /></label><label>Target chapter words<input type="number" min="500" max="15000" bind:value={draft.preferences.chapterWords} /></label></div>
    <p class="muted">Each generation adds one passage. Chapters build across passages toward this approximate length and a natural ending. New stories default to 800 words per passage and 3,000 per chapter. Very short model responses get one expansion pass before any world changes are extracted. The reader can keep a chapter open or request an earlier ending.</p>
    <label>Art direction<textarea bind:value={draft.artStyle} maxlength="10000"></textarea></label><label>Content boundaries and preferences<textarea bind:value={draft.preferences.contentNotes} maxlength="6000" placeholder="Themes to avoid, consent expectations, fade-to-black preferences, and other boundaries."></textarea></label>
    <label class="check"><input type="checkbox" bind:checked={draft.adultContent} /><span>Allow adult content for this story<small>Off by default. Each character keeps their individual No NSFW setting.</small></span></label><div class="row"><button class="primary" disabled={busy}>Save story preferences</button><button type="button" onclick={() => resetSection('story')} disabled={busy || !dirtySections.story}>Reset to saved</button>{#if dirtySections.story}<span class="muted" role="status">Unsaved story changes</span>{/if}</div><p class="muted">These preferences guide live narration and image-test art direction. Changes apply to future generations.</p></fieldset></form>{:else}<p>Select a story from Library first.</p>{/if}
  {:else if tab === 'text' && connectionDraft}
    <form class="settings-section" aria-label="Text LLM settings" onsubmit={e => { e.preventDefault(); save('text'); }}><fieldset class="settings-fields" disabled={busy}><h2>Text LLM</h2><p class="muted">OpenAI-compatible API. Tests use this form without saving or changing a story.</p><div class="form-grid">
      <label>Text API address<input type="url" bind:value={connectionDraft.text.baseUrl} required /></label><label>Text model<select bind:value={connectionDraft.text.model} disabled={busy || modelsUrl !== connectionDraft.text.baseUrl || !models.length}><option value="">Test connection to load models</option>{#if connectionDraft.text.model && !models.includes(connectionDraft.text.model)}<option value={connectionDraft.text.model}>{connectionDraft.text.model} (saved ID)</option>{/if}{#each models as model}<option value={model}>{model}</option>{/each}</select></label>
      <label>Thinking mode (Unsloth)<select bind:value={connectionDraft.text.thinking}><option value="provider">Provider default / other APIs</option><option value="off">Off</option><option value="on">On</option></select><small>Explicit modes send Unsloth’s enable_thinking control. Use Provider default for APIs without it.</small></label><label>API key<input type="password" autocomplete="off" bind:value={apiKey} placeholder={connectionDraft.text.hasApiKey ? 'Key stored — leave blank to keep' : 'Not configured'} /></label><label>Structured output<select bind:value={connectionDraft.text.structuredOutput}><option value="auto">Auto · JSON for structured tasks</option><option value="schema">JSON schema</option><option value="json">JSON object</option><option value="prompt">Prompt only</option></select></label>
      <label>Temperature<input type="number" min="0" max="2" step="0.05" bind:value={connectionDraft.text.temperature} required /></label><label>Top P<input type="number" min="0.01" max="1" step="0.01" bind:value={connectionDraft.text.topP} required /></label><label>Output tokens<input type="number" min="128" max="32768" bind:value={connectionDraft.text.maxTokens} required /></label><label>Context budget<input type="number" min="1024" max="262144" bind:value={connectionDraft.text.contextTokens} required /></label><label>Request timeout (seconds)<input type="number" min="15" max="600" bind:value={connectionDraft.text.timeoutSeconds} required /></label>
    </div><label class="check"><input type="checkbox" bind:checked={manualModel} />Enter model ID manually</label>{#if manualModel}<label>Model ID<input bind:value={connectionDraft.text.model} maxlength="300" /></label>{/if}<label class="check"><input type="checkbox" bind:checked={removeKey} />Remove the saved API key</label><div class="row"><button type="button" onclick={() => testConnection('text')} disabled={busy}>Test Text LLM / refresh models</button><button class="primary" disabled={busy}>Save Text LLM settings</button><button type="button" onclick={() => resetSection('text')} disabled={busy || !dirtySections.text}>Reset to saved</button>{#if dirtySections.text}<span class="muted" role="status">Unsaved Text LLM changes</span>{/if}</div>{#if textStatus}<p role="status" class="muted">{textStatus}{#if testedTextAddress !== connectionDraft.text.baseUrl} The address changed after this test; test the new address before saving.{/if}</p>{/if}<p class="muted">Blank key retains the stored key. Recap and memory extraction use temperature 0.2 for consistency; the prompt test uses the temperature above. Auto requests JSON-object output for structured story/editor tasks; ordinary prose tests and recaps stay plain text. Choose Prompt only for providers without JSON mode. JSON schema adds provider-side schema guidance. Unsupported formats return an error rather than silently changing modes.</p></fieldset></form>
    <section class="settings-section"><h3>Run a test prompt</h3><label>Test system instructions<textarea disabled={busy} bind:value={testSystem} maxlength="10000"></textarea></label><label>Test prompt<textarea disabled={busy} bind:value={testPrompt} maxlength="10000"></textarea></label><div class="row"><button class="primary" onclick={runText} disabled={busy || !connectionDraft.text.model || !testPrompt.trim()}>Run text test</button>{#if runningText}<button onclick={() => controller?.abort()}>Cancel text test</button>{/if}</div>{#if textResult}<p class="muted">Completed in {(textDuration / 1000).toFixed(1)} seconds · request details in Dev</p><div class="test-prose" aria-label="Text test result">{textResult}</div>{/if}</section>
  {:else if tab === 'comfy' && connectionDraft}
    <form class="settings-section" aria-label="ComfyUI settings" onsubmit={e => { e.preventDefault(); save('images'); }}><fieldset class="settings-fields" disabled={busy}><h2>ComfyUI</h2><label>ComfyUI address<input type="url" bind:value={connectionDraft.images.baseUrl} required /></label><label>Workflow file<select bind:value={connectionDraft.images.workflow}>{#if !workflows.some(w => w.path === connectionDraft!.images.workflow)}<option value={connectionDraft.images.workflow}>{connectionDraft.images.workflow}</option>{/if}{#each workflows as w}<option value={w.path}>{w.name}</option>{/each}</select></label><div class="row"><button type="button" onclick={inspectWorkflow} disabled={busy}>Inspect workflow / suggest bindings</button><label class="import-label">Import API workflow<input type="file" accept=".json,application/json" onchange={importWorkflow} disabled={busy} /></label></div>{#if importedName}<p class="muted">Imported {importedName}</p>{/if}
      <details><summary>Workflow input bindings</summary><p class="muted">Use nodeID.inputName. Leave unsupported controls empty; their values stay as stored in the workflow. Output node must return images. Inspect replaces these form bindings with suggestions.</p><div class="form-grid">{#each Object.keys(connectionDraft.images.bindings) as key}<label>{key}<input bind:value={connectionDraft.images.bindings[key as keyof typeof connectionDraft.images.bindings]} /></label>{/each}</div>{#if workflowInfo}<pre class="dev-json">{JSON.stringify(workflowInfo.nodes, null, 2)}</pre>{/if}</details>
      <div class="form-grid"><label>Image width<input type="number" min="256" max="2048" step="8" bind:value={connectionDraft.images.width} /></label><label>Image height<input type="number" min="256" max="2048" step="8" bind:value={connectionDraft.images.height} /></label><label>Sampling steps<input type="number" min="1" max="100" bind:value={connectionDraft.images.steps} /></label><label>Guidance CFG<input type="number" min="0" max="30" step="0.1" bind:value={connectionDraft.images.cfg} /></label><label>Seed (-1 random)<input type="number" min="-1" max="2147483647" bind:value={connectionDraft.images.seed} /></label><label>Image timeout (seconds)<input type="number" min="30" max="900" bind:value={connectionDraft.images.timeoutSeconds} /></label></div><div class="row"><button type="button" onclick={() => testConnection('images')} disabled={busy}>Test ComfyUI connection</button><button class="primary" disabled={busy}>Save ComfyUI settings</button><button type="button" onclick={() => resetSection('images')} disabled={busy || !dirtySections.comfy}>Reset to saved</button>{#if dirtySections.comfy}<span class="muted" role="status">Unsaved ComfyUI changes</span>{/if}</div>{#if comfyStatus}<p class="muted" role="status">{comfyStatus}{#if testedComfyAddress !== connectionDraft.images.baseUrl} The address changed after this test; test the new address before saving.{/if}</p>{/if}
    </fieldset></form>
    <section class="settings-section"><h3>Run a test image</h3><p class="muted">Uses the current workflow, bindings, image settings, and resolved prompt below. A real job is queued in ComfyUI. Test previews do not change a story or enter its gallery.</p><button onclick={() => chooseTab('prompts')}>Edit image prompt &amp; subject details</button>{#if resolved.error}<p class="error" role="alert">{resolved.error}</p>{:else}<pre class="dev-json">{resolved.text}</pre>{/if}{#if connectionDraft.prompts.negative}<p class="muted">Negative prompt: {connectionDraft.prompts.negative}</p>{/if}<div class="row"><button class="primary" onclick={runImage} disabled={busy || watchingImage || Boolean(resolved.error)}>Generate test image</button>{#if watchingImage}<button onclick={stopWatching}>Stop watching image test</button>{:else if imageJob?.status === 'queued'}<button onclick={() => { watchingImage = true; pollImage(); }}>Resume watching image test</button>{/if}</div>
      {#if imageJob}<p role="status" class="muted">Image test {imageJob.status} · seed {imageJob.seed ?? 'workflow-defined'} · {(imageJob.durationMs / 1000).toFixed(1)} seconds</p>{#if imageJob.error}<p class="error" role="alert">{imageJob.error}</p>{/if}{#each imageJob.images as src}<a href={src} target="_blank" rel="noreferrer"><img class="test-image" {src} alt="ComfyUI test generation" /></a>{/each}{/if}<p class="muted">Stopping the watcher does not interrupt the shared ComfyUI server. Prompt IDs and preview metadata are saved locally. After a restart, status checks use the original ComfyUI endpoint and do not submit the image again.</p>
    </section>
      {#if imageJob?.status === 'complete' && story}<button onclick={onOpenGallery}>Keep a picture in the story gallery ↗</button><p class="muted">In Gallery, choose Add a picture, assign the depicted subjects and source passage, then Save preview to story.</p>{/if}
  {:else if tab === 'prompts' && connectionDraft}
    <form class="settings-section" aria-label="Prompt settings" onsubmit={e => { e.preventDefault(); save('prompts'); }}><fieldset class="settings-fields" disabled={busy}><h2>Editable prompts</h2><label>Narrator craft instructions<textarea bind:value={connectionDraft.prompts.narratorInstructions} maxlength="6000"></textarea></label><p class="muted">Added to the Dev context preview with the story's narrator style. Application contracts and canonical facts remain separate.</p>
      {#each [['portrait', 'Portrait template'], ['fullbody', 'Full-body template'], ['scene', 'Scene template'], ['group','Story scene / group template']] as [key, label]}<label>{label}<textarea bind:value={connectionDraft.prompts[key as 'portrait' | 'fullbody' | 'scene' | 'group']} maxlength="10000"></textarea></label>{/each}<p class="muted">Illustration studio defaults to natural-language prompts. Its Custom prompt template mode uses these saved portrait/full-body and group templates. Use {'{{subjects}}'} for separate named subject blocks. The studio previews the complete group prompt.</p><label>Negative prompt<textarea bind:value={connectionDraft.prompts.negative} maxlength="10000"></textarea></label><p class="muted">A negative prompt is sent only when a negative input is mapped. The supplied workflow uses zeroed conditioning; keep this empty unless you adapt the workflow.</p><div class="row"><button class="primary" disabled={busy}>Save prompt settings</button><button type="button" onclick={() => resetSection('prompts')} disabled={busy || !dirtySections.prompts}>Reset to saved</button>{#if dirtySections.prompts}<span class="muted" role="status">Unsaved prompt changes</span>{/if}</div>
    </fieldset></form>
    <section class="settings-section"><h3>Image prompt preview &amp; test subject</h3><p class="muted">Subject fields below are one-off test inputs, not canonical character edits. Selecting a cast member supplies their saved visual identity, name and content preference; enter only the physical and clothing details appropriate to the shot.</p><div class="form-grid"><label>Framing<select bind:value={framing} onchange={e=>changeTestFraming(e.currentTarget.value as 'portrait'|'fullbody'|'scene')}><option value="portrait">Portrait / bust</option><option value="fullbody">Full body</option><option value="scene">Scene</option></select></label><label>Test subject<select bind:value={subjectId} onchange={selectSubject}><option value="">Custom adult test subject</option>{#each story?.canon.characters || [] as c}<option value={c.id}>{c.name}</option>{/each}</select></label></div>
      <label class="check"><input type="checkbox" bind:checked={nonsexual} />Nonsexual, fully clothed test</label>{#if mustNonsexual}<p class="muted">Nonsexual treatment is active from this checkbox, the story preference, or the selected character's No NSFW preference.</p>{/if}<div class="form-grid">{#each imageVariables as key}<label>{key}<input bind:value={values[key]} disabled={framing === 'portrait' && ['subject.lower_body', 'subject.footwear'].includes(key)} maxlength="2000" /></label>{/each}</div><p class="muted">Use variables as {'{{subject.face}}'}. Portrait framing omits lower-body and footwear variables. No whole-biography variable is automatically appended.</p><h3>Resolved prompt</h3>{#if resolved.error}<p class="error" role="alert">{resolved.error}</p>{:else}<pre class="dev-json">{resolved.text}</pre>{/if}<button onclick={() => chooseTab('comfy')}>Use preview for test image</button>
    </section>
  {:else if tab === 'context' && connectionDraft}
    <form class="settings-section" aria-label="Context settings" onsubmit={e => { e.preventDefault(); save('context'); }}><fieldset class="settings-fields" disabled={busy}><h2>Context &amp; continuity</h2><p class="muted">These controls apply to live story continuation and Dev → Context. Recaps use a separate bounded summary pipeline.</p><div class="form-grid"><label>Recent passages<input type="number" min="1" max="10" bind:value={connectionDraft.context.recentPassages} /></label><label>Maximum recent prose bytes<input type="number" min="500" max="30000" bind:value={connectionDraft.context.recentProseBytes} /></label><label>Recent chapter summaries before book compaction<input type="number" min="1" max="6" bind:value={connectionDraft.context.recentChapters} /></label><label>Context overhead reserve<input type="number" min="256" max="8192" bind:value={connectionDraft.context.overheadTokens} /></label></div><label class="check"><input type="checkbox" bind:checked={connectionDraft.context.includeRelationships} />Include relevant relationships</label><label class="check"><input type="checkbox" bind:checked={connectionDraft.context.includeThreads} />Include unresolved threads</label><label class="check"><input type="checkbox" bind:checked={connectionDraft.context.autoCompact} />Automatically maintain chapter and book memories after saved passages</label><div class="row"><button class="primary" disabled={busy}>Save context settings</button><button type="button" onclick={() => resetSection('context')} disabled={busy || !dirtySections.context}>Reset to saved</button>{#if dirtySections.context}<span class="muted" role="status">Unsaved context changes</span>{/if}</div><p class="muted">Required facts, individual content preferences, hidden-lore exclusion, and stale-source checks remain active. Input budgeting uses conservative token estimates with an overhead reserve; recent prose also has a byte cap and a 30% token-share limit. Exact token counts depend on the model. Each generated passage saves a source-linked continuity memory automatically. Dev also offers manual extraction. Completed chapters get source-checked summaries; older chapters feed a book overview. Dev → Memory can rebuild pending summaries. Automatic maintenance handles one chapter after each saved passage; failures preserve the passage and leave memory pending.</p></fieldset></form>
  {:else if ['text','comfy','prompts','context'].includes(tab) && !connectionDraft}
    <div class="notice"><p>Connection settings could not be loaded. Your saved settings are kept on the server.</p><button onclick={() => action(async () => { connections = await json(await fetch('/api/connections')); connectionDraft = connections ? clone(connections) : null; await refreshWorkflows(); note = 'Connection settings reloaded.'; })} disabled={busy}>Reload connection settings</button></div>
  {:else if tab === 'storage'}
    <section class="settings-section" aria-busy={storageLoading}><h2>Storage &amp; developer tools</h2><p>Local instance: <strong>{instance}</strong></p><p class="muted">Story library: data/{instance}/library.sqlite<br />Diagnostics: data/{instance}/diagnostics.sqlite<br />Generation jobs: data/{instance}/jobs.sqlite<br />Settings: config/connections.{instance}.local.json<br />Test images: data/{instance}/test-images</p>{#if storageLoading}<p class="muted" role="status">Loading storage usage…</p>{/if}{#if storageLoaded}<p class="muted">{storageError ? 'Last loaded totals: ' : ''}{storage.count} test previews · {storage.stagingCount} interrupted staging files · {(storage.bytes / 1048576).toFixed(2)} MB. Test jobs and previews survive restarts; preview files can be cleared here after testing.</p>{:else if storageError}<p class="muted">Storage usage could not be loaded. Use Refresh storage usage to try again.</p>{/if}<div class="row"><button onclick={refreshStorage} disabled={storageLoading || busy}>Refresh storage usage</button><button onclick={clearPreviews} disabled={busy || watchingImage || storageLoading || !storageLoaded}>Clear test image previews</button><button onclick={() => action(exportSettings, 'Exporting saved settings…')} disabled={busy}>Export settings without keys</button></div><p class="muted">Settings export includes saved server values. Save changes from the other tabs first to include them.</p>
    <h3>Story backup</h3>{#if story}<a class="button" href={'/api/stories/' + story.id + '/export'}>Export current story ZIP</a>{/if}<p class="muted">Import stories from Library. ZIPs include story text and world records; test images and API keys are excluded. Saves are disposable during development; no version migrations are promised.</p><h3>Diagnostics</h3><a class="button" href="/api/dev/diagnostics?download=1" download>Export diagnostics</a><p class="muted">Dev provides console filters, full request inspection, context previews, memory editors, state snapshots, and separate log/trace clearing. Retains 2,000 log entries and 100 traces. Configured secrets are redacted; ordinary story text remains visible. Launcher startup output stays in the terminal.</p></section>
  {/if}
  </div>
</main>

<style>
  .settings-fields{border:0;padding:0;margin:0;min-width:0}.settings-fields:disabled{opacity:.75}.settings-unsaved-dot{color:var(--accent);font-weight:700}
</style>
