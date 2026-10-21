<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import { reportUiError } from './ui-feedback';
  import type { Story } from './story';
  import { inventoryPath } from './inventory';
  import { emptyContext, type ContextData, type ContextReport } from './context-types';
  import type { LogEntry, TraceEntry } from './diagnostic-types';
  import type { JobRecord } from './job-types';
  import MemoryCompactionPanel from './MemoryCompactionPanel.svelte';
  import LoreDevPanel from './LoreDevPanel.svelte';
  import SceneResourceHints from './SceneResourceHints.svelte';
  let { story, busy = false, canGenerate = false, direction = $bindable(''), onMutate, onStorySaved, onDirty = () => {}, onReload }: {
    story: Story | null; busy?: boolean; canGenerate?: boolean; direction?: string;
    onMutate: (action: unknown) => Promise<boolean>; onStorySaved: (story: Story) => void; onDirty?: (dirty: boolean) => void; onReload?: () => Promise<boolean>;
  } = $props();
  let tab = $state('console'), logs = $state<LogEntry[]>([]), traces = $state<TraceEntry[]>([]);
  let mediaAudit = $state<unknown>(null);
  async function auditMedia() { problem = ''; try { mediaAudit = await read(await fetch('/api/dev/media')); } catch (e) { problem = e instanceof Error ? e.message : 'Media audit failed.'; } }
  let autoRefresh = $state(true), search = $state(''), level = $state('all'), source = $state('all'), traceKind = $state('all');
  let logLimit = $state(250);
  let problem = $state(''), note = $state(''), working = $state(false), selectedTrace = $state<TraceEntry | null>(null);
  $effect(() => { if (problem) untrack(() => reportUiError(problem, 'Developer tools')); });
  let report = $state<ContextReport | null>(null);
  let loreDirty = $state(false), loreDirection = $state(''), reportDirection = $state('');
  function chooseTab(key: string) { if (tab === 'lore' && key !== tab && loreDirty && !confirm('Discard the unsaved lore edits? Use Save lore first to keep them.')) return; tab = key; problem = ''; }
  let jobs = $state<JobRecord[]>([]), selectedJob = $state<JobRecord | null>(null), proposalText = $state(''), proposalPreview = $state<unknown>(null);
  let draft = $state<ContextData>(untrack(() => story ? JSON.parse(JSON.stringify(story.context)) : emptyContext()));
  let memoryPassageId = $state(untrack(() => story?.passages.at(-1)?.id || ''));
  let activeController: AbortController | null = null, refreshInFlight = false;
  let memoryRequest: { requestId: string; expectedRevision: number; passageId: string } | null = null;
  let sourceRevision = $state(untrack(() => story ? `${story.id}:${story.revision}` : ''));
  const dirty = $derived(story ? JSON.stringify(draft) !== JSON.stringify(story.context) : false);
  $effect(() => onDirty(dirty || loreDirty));
  onDestroy(() => onDirty(false));
  const filteredLogs = $derived(logs.filter(l => (level === 'all' || l.level === level) && (source === 'all' || l.source === source) && `${l.message} ${JSON.stringify(l.data)}`.toLowerCase().includes(search.toLowerCase())));
  const filteredTraces = $derived(traces.filter(t => traceKind === 'all' || t.kind === traceKind));
  const logSources = $derived([...new Set(logs.map(l => l.source))]);
  const traceKinds = $derived([...new Set(traces.map(t => t.kind))]);
  $effect(() => {
    const revision = story ? `${story.id}:${story.revision}` : '';
    if (revision !== sourceRevision) {
      draft = story ? JSON.parse(JSON.stringify(story.context)) : emptyContext(); sourceRevision = revision; report = null;
      if (story && !story.passages.some(p => p.id === memoryPassageId)) memoryPassageId = story.passages.at(-1)!.id;
    }
  });
  const pretty = (value: unknown) => JSON.stringify(value, null, 2);
  async function read(response: Response) { const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Developer request failed.'); return body; }
  async function refresh() {
    if (refreshInFlight) return; refreshInFlight = true;
    try { const [data, jobData] = await Promise.all([fetch('/api/dev/diagnostics?limit=' + logLimit).then(read), fetch('/api/dev/jobs').then(read)]); logs = data.logs; traces = data.traces; jobs = jobData.jobs; }
    catch (e) { problem = e instanceof Error ? e.message : 'Diagnostics are unavailable.'; }
    finally { refreshInFlight = false; }
  }
  async function inspect(trace: TraceEntry) {
    try { selectedTrace = await read(await fetch('/api/dev/diagnostics?trace=' + encodeURIComponent(trace.id))); }
    catch (e) { problem = e instanceof Error ? e.message : 'Could not load trace.'; }
  }
  async function inspectJob(id: string) { try { selectedJob = await read(await fetch('/api/dev/jobs/' + id)); } catch (e) { problem = e instanceof Error ? e.message : 'Could not read job.'; } }
  async function stopJob(id: string) { try { await read(await fetch('/api/dev/jobs/' + id, { method: 'DELETE' })); await refresh(); await inspectJob(id); } catch (e) { problem = e instanceof Error ? e.message : 'Could not cancel job.'; } }
  async function reconcileImage(id: string) { try { await read(await fetch('/api/image-tests/' + id)); await refresh(); await inspectJob(id); } catch (e) { problem = e instanceof Error ? e.message : 'Could not read image status.'; } }
  function exampleProposal() {
    if (!story) return; const last = story.passages.at(-1)!, people = story.canon.characters, item = story.canon.items.find(i => people.some(c => c.id === i.ownerId)), owner = people.find(c => c.id === item?.ownerId), recipient = people.find(c => c.id !== owner?.id);
    const prose = owner && recipient && item ? `${owner.name} handed ${item.name} to ${recipient.name}.` : 'The crew waited for the lights to return.';
    proposalText = JSON.stringify({ mode: 'continue', direction: 'A short continuity demonstration.', draft: { title: 'A small exchange', chapterTitle: last.endOfChapter ? 'The next step' : last.chapterTitle, startsChapter: last.endOfChapter, endOfChapter: false, viewpointId: owner?.id || people[0]?.id, paragraphs: [prose] }, effects: owner && recipient && item ? [{ type: 'item.transfer', itemId: item.id, fromOwnerId: owner.id, toOwnerId: recipient.id, evidence: prose }] : [] }, null, 2); proposalPreview = null;
  }
  async function validateProposal() {
    if (!story || working) return; working = true; problem = ''; proposalPreview = null;
    try { proposalPreview = await read(await fetch('/api/dev/passage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storyId: story.id, expectedRevision: story.revision, proposal: JSON.parse(proposalText) }) })); await refresh(); }
    catch (e) { problem = e instanceof Error ? e.message : 'Proposal validation failed.'; } finally { working = false; }
  }
  async function clear(target: 'logs' | 'traces') {
    try { await read(await fetch('/api/dev/diagnostics?target=' + target, { method: 'DELETE' })); if (target === 'traces') selectedTrace = null; await refresh(); }
    catch (e) { problem = e instanceof Error ? e.message : 'Could not clear diagnostics.'; }
  }
  async function previewContext(previewDirection = direction) {
    if (!story) return; working = true; problem = ''; note = '';
    try { report = await read(await fetch('/api/dev/context', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storyId: story.id, direction: previewDirection }) })); reportDirection = previewDirection; await refresh(); }
    catch (e) { problem = e instanceof Error ? e.message : 'Could not build context.'; }
    finally { working = false; }
  }
  async function saveContext() { problem = ''; if (await onMutate({ type: 'context', context: $state.snapshot(draft) })) { note = 'Context records saved. Rebuild the preview to inspect the new selection.'; report = null; } }
  function addLore() { draft.lore.push({ id: crypto.randomUUID(), title: 'New lore entry', text: '', keywords: [], relatedIds: [], visibility: 'relevant' }); }
  function addKnowledge() { draft.knowledge.push({ id: crypto.randomUUID(), fact: 'New fact or belief', truth: 'established', knownBy: [], readerRevealed: false, sourcePassageId: null, sourceHash: null }); }
  function addMemory() {
    if (!story || !memoryPassageId) return;
    draft.memories.push({ id: crypto.randomUUID(), passageIds: [memoryPassageId], summary: 'New continuity note', facts: [], openQuestions: [], characterIds: [], locationIds: [], sourceHash: '0'.repeat(64), source: 'manual', createdAt: new Date().toISOString() });
  }
  function toggle(list: string[], id: string, checked: boolean) { return checked ? [...new Set([...list, id])] : list.filter(v => v !== id); }
  const lines = (text: string) => text.split('\n').map(s => s.trim()).filter(Boolean);
  async function generateMemory() {
    if (!story || working || busy || dirty) return;
    working = true; problem = ''; note = 'Generating continuity memory…'; activeController = new AbortController();
    if (!memoryRequest || memoryRequest.expectedRevision !== story.revision || memoryRequest.passageId !== memoryPassageId) memoryRequest = { expectedRevision: story.revision, requestId: crypto.randomUUID(), passageId: memoryPassageId };
    try {
      const saved: Story = await read(await fetch(`/api/stories/${story.id}/memory`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(memoryRequest), signal: activeController.signal }));
      onStorySaved(saved); memoryRequest = null; note = 'Continuity memory saved. World facts and passage text were not changed.';
      await refresh();
    } catch (e) { problem = activeController.signal.aborted ? 'Request cancelled. Reload to check for a result if it had already finished.' : e instanceof Error ? e.message : 'Could not generate continuity memory.'; note = ''; }
    finally { working = false; activeController = null; }
  }
  onMount(() => { refresh(); const timer = setInterval(() => { if (autoRefresh && !document.hidden) refresh(); }, 2000); return () => { clearInterval(timer); activeController?.abort(); }; });
</script>

<main class="dev-view">
  <div class="eyebrow">Developer tools · This instance only</div><div class="heading-row"><h1>Dev menu</h1><a class="button" href="/api/dev/diagnostics?download=1" download>Export diagnostics</a></div>
  <p class="muted">Local application diagnostics with credentials redacted. Retains 2,000 console entries and 100 completed traces plus active calls across restarts. Browser capture starts when the page mounts; launcher/startup-only output remains in the terminal.</p>
  <div class="tabs" role="group" aria-label="Developer sections">{#each [['console', 'Console'], ['requests', 'Requests'], ['jobs', 'Jobs'], ['passage', 'Passage lab'], ['context', 'Context'], ['lore', 'Lore'], ['memory', 'Memory'], ['media', 'Media'], ['state', 'State']] as [key, label]}<button class:active={tab === key} aria-pressed={tab === key} onclick={() => chooseTab(key)}>{label}</button>{/each}</div>
  {#if problem}<div class="dev-warning" role="alert">{problem}</div>{/if}{#if note}<p class="muted" role="status">{note}</p>{/if}
  {#if tab === 'console'}
    <div class="dev-controls"><label>Search logs<input bind:value={search} placeholder="Message or logged data" /></label><label>Level<select bind:value={level}>{#each ['all', 'debug', 'info', 'warn', 'error'] as v}<option value={v}>{v}</option>{/each}</select></label><label>Source<select bind:value={source}><option value="all">All sources</option>{#each logSources as s}<option value={s}>{s}</option>{/each}</select></label></div>
    <div class="row"><label>Recent entries<select bind:value={logLimit} onchange={refresh}><option value={250}>250</option><option value={1000}>1,000</option><option value={2000}>2,000</option></select></label><label class="check"><input type="checkbox" bind:checked={autoRefresh} />Auto-refresh every 2 seconds</label><button onclick={refresh}>Refresh logs</button><button onclick={() => clear('logs')}>Clear console</button></div>
    <p class="muted">Showing the latest {logs.length} entries · {filteredLogs.length} match. Polling these tools is excluded from request logging.</p>
    <div class="console-list" aria-label="Captured console entries">{#each filteredLogs as entry}<details class="log-entry" data-level={entry.level}><summary><time>{new Date(entry.at).toLocaleTimeString()}</time><span class="log-level">{entry.level}</span><span class="log-source">{entry.source}</span><span>{entry.message}</span></summary><pre>{pretty(entry)}</pre></details>{:else}<p class="muted">No matching entries. Use the reader or Settings to generate activity, or inspect a model request here after generation.</p>{/each}</div>
  {:else if tab === 'requests'}
    <div class="dev-controls"><label>Trace kind<select bind:value={traceKind}><option value="all">All traces</option>{#each traceKinds as k}<option value={k}>{k}</option>{/each}</select></label></div><div class="row"><button onclick={refresh}>Refresh traces</button><button onclick={() => clear('traces')}>Clear completed traces</button></div>
    <p class="muted">Actual model calls include the sent messages and returned text. Context previews are labeled dry runs. State changes include field-level before/after values.</p>
    {#each filteredTraces as trace}<button class="trace-row" onclick={() => inspect(trace)}><span>{trace.kind}</span><small>{new Date(trace.at).toLocaleTimeString()} · {trace.status}{trace.durationMs !== undefined ? ` · ${trace.durationMs} ms` : ''} · {trace.storyId?.slice(0, 8) || 'application'}</small></button>{:else}<p class="muted">No traces yet. Build a context preview or save an edit to create one.</p>{/each}
    {#if selectedTrace}<section class="dev-section"><div class="heading-row"><h2>{selectedTrace.kind}</h2><button onclick={() => selectedTrace = null}>Close trace</button></div><pre class="dev-json">{pretty(selectedTrace)}</pre></section>{/if}
  {:else if tab === 'jobs'}
    <h2>Generation jobs</h2><p class="muted">Durable status, phases, attempts, and saved drafts. Text interrupted by a server restart requires an explicit retry from its original screen. Images reconcile against their original ComfyUI endpoint; no automatic resubmission.</p><div class="row"><button onclick={refresh}>Refresh jobs</button><a class="button" href="/api/dev/jobs?download=1" download>Export recent jobs</a></div>
    {#each jobs as job}<section class="dev-record"><div class="heading-row"><h3>{job.kind} · {job.state}</h3><small>Attempt {job.attempt} · {new Date(job.updatedAt).toLocaleString()}</small></div><p class="muted">{job.storyId ? `Story ${job.storyId.slice(0,8)} · revision ${job.expectedRevision}` : 'Application test'} · {job.id}</p>{#if job.error}<p class="dev-warning">{job.error}</p>{/if}<div class="row"><button onclick={() => inspectJob(job.id)}>Inspect job</button>{#if ['queued','generating','validating'].includes(job.state) && !job.recoverable && job.kind !== 'image-test'}<button onclick={() => stopJob(job.id)}>Cancel job</button>{/if}{#if job.kind === 'image-test' && job.recoverable && !['failed','complete','cancelled','interrupted'].includes(job.state)}<button onclick={() => reconcileImage(job.id)}>Check original ComfyUI job</button>{/if}</div></section>{:else}<p>No generation jobs recorded yet. Generate a recap, continuity memory, or Settings test.</p>{/each}
    {#if selectedJob}<section class="dev-section"><div class="heading-row"><h3>Job details</h3><button onclick={() => selectedJob = null}>Close job</button></div><pre class="dev-json">{pretty(selectedJob)}</pre></section>{/if}
  {:else if tab === 'passage'}
    <h2>Passage validation lab</h2><p class="muted">Exercise the live narration → effects → atomic commit contract without calling a model or saving a scene. Effects require exact source quotes and existing IDs or explicit new-entity references. New cast members default to No NSFW; generation cannot change content preferences or pinned appearance/outfits.</p><div class="row"><button onclick={exampleProposal} disabled={!story || working}>Load example proposal</button><button class="primary" onclick={validateProposal} disabled={!story || working || !proposalText.trim()}>Validate proposal · dry run</button></div><label>Passage proposal JSON<textarea class="proposal-input" bind:value={proposalText} maxlength="900000" rows="18"></textarea></label>{#if proposalPreview}<h3>Validated preview · nothing saved</h3><pre class="dev-json">{pretty(proposalPreview)}</pre>{/if}
  {:else if tab === 'context'}
    {#if story}<h2>Next-passage context</h2><p class="muted">Uses the latest committed story and saved Memory settings. This is the context builder used by live narration; deterministic sample continuation does not call a model.</p><label>Reader direction<textarea bind:value={direction} maxlength="10000" placeholder="Leave blank for natural continuation"></textarea></label><div class="row"><button class="primary" onclick={() => previewContext()} disabled={working || busy}>Build context preview</button><span class="muted">No model call or story mutation.</span></div>
      {#if report}<div class="dev-section"><h3>{report.runnable ? 'Required context fits' : 'Required context does not fit'}</h3><p class="muted">Revision {report.revision} · {report.inputTokens.toLocaleString()} / {report.inputBudget.toLocaleString()} estimated input tokens · {report.reservedOutput.toLocaleString()} output tokens reserved</p><p class="muted">Input uses a conservative local token estimate, not an exact model tokenizer count. {report.contextTokens.toLocaleString()} total configured tokens, with {report.overheadTokens.toLocaleString()} reserved for overhead and {report.taskReserveTokens.toLocaleString()} estimated tokens for service formatting. Narrator output/schema and pacing instructions are included in the required sources.</p>{#each report.warnings as warning}<p class="dev-warning">{warning}</p>{/each}
      <p class="muted">History coverage: {report.memoryCoverage.representedPassages} / {report.memoryCoverage.totalPassages} passages represented · {report.memoryCoverage.chapterSummaries} chapter summaries · Book overview {report.memoryCoverage.bookOverview ? 'included' : 'omitted / unavailable'} · {report.memoryCoverage.preciseRecords} precise event record(s)</p>{#if report.memoryCoverage.missingPassageIds.length}<details><summary>Passages without full history coverage</summary><p class="muted">{report.memoryCoverage.missingPassageIds.map(id => story!.passages.find(p => p.id === id)?.title || id).join(', ')}</p></details>{/if}<div class="context-sources">{#each report.sources as s}<details><summary><span class:included={s.included}>{s.included ? 'Included' : 'Omitted'}</span> · {s.title} <small>({s.kind}{s.required ? ', required' : ''})</small></summary><p>{s.reason}{s.clipped ? ' · Beginning clipped; ending preserved verbatim.' : ''}</p><p class="muted">{s.tokens} estimated tokens · {s.bytes} bytes · ID: {s.id}</p></details>{/each}</div><h3>Assembled messages</h3><pre class="dev-json">{pretty(report.messages)}</pre></div>{/if}
    {:else}<p>Select a story first.</p>{/if}
  {:else if tab === 'lore'}
    {#if story}
      <label>Lore context preview direction<textarea bind:value={loreDirection} maxlength="10000" placeholder="For example: prepare to feed the pony"></textarea></label>
      <button class="primary" onclick={() => previewContext(loreDirection)} disabled={working || busy || loreDirty}>Preview lore selection</button>
      {#if onReload}<button onclick={onReload} disabled={working || busy || dirty}>Load latest saved story</button>{/if}
      <p class="muted">Uses the actual next-passage context builder without a model call. Save lore edits first. This preview direction does not change the reader’s next-passage direction.</p>
      {#if report}<p class="muted">Last preview direction: {reportDirection || 'Natural continuation'}.{reportDirection !== loreDirection ? ' Rebuild to inspect the edited direction.' : ''}</p>{/if}
      <LoreDevPanel {story} {report} busy={busy || working || dirty} {onMutate} onDirty={value => loreDirty = value} />
      {#if dirty}<p class="notice">Save or reset the existing Memory context draft before changing lore here.</p>{/if}
    {:else}<p>Select a story to inspect its lore.</p>{/if}
  {:else if tab === 'memory'}
    {#if story}<div class="heading-row"><h2>Continuity & scene direction</h2><button class="primary" onclick={saveContext} disabled={busy || working || !dirty}>Save context records</button></div><p class="muted">{dirty ? 'Unsaved context edits.' : 'Saved context records loaded.'} These are separate from the editable reader recap. Source-linked notes are excluded from prompts if their passage changes.</p>
      <MemoryCompactionPanel {story} busy={busy || working} {dirty} {canGenerate} {onStorySaved} />
      <section class="dev-section"><h3>Scene brief</h3><div class="form-grid"><label>Purpose<textarea bind:value={draft.sceneBrief.purpose} maxlength="3000"></textarea></label><label>Current tension<textarea bind:value={draft.sceneBrief.tension} maxlength="3000"></textarea></label><label>Viewpoint<select bind:value={draft.sceneBrief.viewpointId}><option value={null}>Automatic from latest passage</option>{#each story.canon.characters as c}<option value={c.id}>{c.name}</option>{/each}</select></label><label>Location<select bind:value={draft.sceneBrief.locationId}><option value={null}>Automatic from viewpoint</option>{#each story.canon.places as p}<option value={p.id}>{p.name}</option>{/each}</select></label></div><label>Stopping point<input bind:value={draft.sceneBrief.stopAt} maxlength="2000" /></label><label>Direction scope<select aria-label="Direction scope" bind:value={draft.sceneBrief.scope} onchange={() => draft.sceneBrief.clearAfterPassage = draft.sceneBrief.scope === 'next-passage'}><option value="next-passage">Next passage</option><option value="current-scene">Current scene</option><option value="ongoing">Ongoing</option></select></label><div class="row">{#each story.canon.characters as c}<label class="check"><input type="checkbox" checked={draft.sceneBrief.castIds.includes(c.id)} onchange={e => draft.sceneBrief.castIds = toggle(draft.sceneBrief.castIds, c.id, e.currentTarget.checked)} />{c.name}</label>{/each}</div><p class="muted">No selected cast means use the viewpoint and current location. These are planning notes, not completed events. Next passage clears only on an accepted continuation. Current scene clears with End scene in the reader; chapter endings do not clear it. Ongoing stays until changed or cleared.</p></section>
      <SceneResourceHints canon={story.canon} lore={draft.lore} bind:ids={draft.sceneBrief.resourceIds} saveLabel="Save context records" disabled={busy || working} />
      <section class="dev-section"><div class="heading-row"><h3>Lorebook</h3><button onclick={addLore}>Add lore entry</button></div>{#each draft.lore as lore, i}<div class="dev-record"><div class="form-grid"><label>Title<input bind:value={lore.title} maxlength="200" /></label><label>Include in prose context<select bind:value={lore.visibility}><option value="relevant">When relevant</option><option value="always">Always</option><option value="hidden">Hidden</option></select></label></div><label>Lore text<textarea bind:value={lore.text} maxlength="10000"></textarea></label><label>Keywords, comma-separated<input value={lore.keywords.join(', ')} onchange={e => lore.keywords = e.currentTarget.value.split(',').map(s => s.trim()).filter(Boolean)} /></label><button onclick={() => draft.lore.splice(i, 1)}>Remove lore entry</button></div>{:else}<p class="muted">Add concise world details here. Hidden entries stay out of the prose prompt.</p>{/each}</section>
      <section class="dev-section"><div class="heading-row"><h3>Who knows what?</h3><button onclick={addKnowledge}>Add fact or belief</button></div>{#each draft.knowledge as k, i}<div class="dev-record"><label>Fact, belief, or possibility<textarea bind:value={k.fact} maxlength="4000"></textarea></label><div class="form-grid"><label>Type<select bind:value={k.truth}><option value="established">Established fact</option><option value="belief">Belief (may be false)</option><option value="possibility">Future possibility</option></select></label><label>Source passage<select bind:value={k.sourcePassageId}><option value={null}>Manual world note</option>{#each story.passages as p}<option value={p.id}>{p.title}</option>{/each}</select></label></div><label class="check"><input type="checkbox" bind:checked={k.readerRevealed} />Revealed to the reader</label><div class="row">{#each story.canon.characters as c}<label class="check"><input type="checkbox" checked={k.knownBy.includes(c.id)} onchange={e => k.knownBy = toggle(k.knownBy, c.id, e.currentTarget.checked)} />{c.name} knows/believes this</label>{/each}</div><p class="muted">Unrevealed content is omitted from the prose prompt. Reader knowledge does not imply viewpoint knowledge.</p><button onclick={() => draft.knowledge.splice(i, 1)}>Remove knowledge entry</button></div>{:else}<p class="muted">No explicit knowledge records yet.</p>{/each}</section>
      <section class="dev-section"><h3>Source-linked memories</h3><label>Source for a new memory<select bind:value={memoryPassageId}>{#each story.passages as p}<option value={p.id}>Chapter {p.chapter} · {p.title}</option>{/each}</select></label><div class="row"><button onclick={addMemory} disabled={!memoryPassageId}>Add manual memory</button><button onclick={generateMemory} disabled={busy || working || dirty || !canGenerate}>{working ? 'Generating…' : 'Generate passage memory'}</button>{#if working}<button onclick={() => activeController?.abort()}>Cancel request</button>{/if}</div><p class="muted">{dirty ? 'Save context edits before model generation.' : !canGenerate ? 'Configure a text model in Settings for automatic extraction; manual memory is available now.' : 'Extracts a summary, established events and open questions from the selected passage. It does not change canon.'}</p>
      {#each draft.memories as m, i}<div class="dev-record"><h3>{m.source === 'generated' ? 'Generated' : 'Manual'} memory</h3><p class="muted">Source: {m.passageIds.map(id => story!.passages.find(p => p.id === id)?.title || id).join(', ')}</p><label>Summary<textarea bind:value={m.summary} maxlength="6000"></textarea></label><div class="form-grid"><label>Established events (one per line)<textarea value={m.facts.join('\n')} oninput={e => m.facts = lines(e.currentTarget.value)}></textarea></label><label>Open questions (one per line)<textarea value={m.openQuestions.join('\n')} oninput={e => m.openQuestions = lines(e.currentTarget.value)}></textarea></label></div><div class="row">{#each story.canon.characters as c}<label class="check"><input type="checkbox" checked={m.characterIds.includes(c.id)} onchange={e => m.characterIds = toggle(m.characterIds, c.id, e.currentTarget.checked)} />{c.name}</label>{/each}</div><button onclick={() => draft.memories.splice(i, 1)}>Remove memory</button></div>{:else}<p class="muted">No continuity memories yet. A readable recap is intentionally not used as a substitute.</p>{/each}</section>
      <button class="primary" onclick={saveContext} disabled={busy || working || !dirty}>Save context records</button>
    {:else}<p>Select a story first.</p>{/if}
  {:else if tab === 'media'}
    <h2>Media library</h2><p class="muted">Inspect associations, snapshots, portrait/reference choices, and original-file integrity. The file audit covers every story in this instance, including imported copies sharing an original. It never removes files.</p><button onclick={auditMedia}>Check image files &amp; checksums</button>{#if mediaAudit}<pre class="dev-json">{pretty(mediaAudit)}</pre>{/if}
    {#if story}<h3>Current story · {story.media.assets.length} image records</h3><pre class="dev-json">{pretty(story.media)}</pre>{/if}
  {:else if tab === 'state'}
    {#if story}<h2>{story.title}</h2><p class="muted">Story ID: {story.id} · Revision: {story.revision}</p><div class="state-grid"><section><h3>Current save</h3><p>{story.passages.length} passages · {story.canon.characters.length} characters · {story.canon.places.length} places · {story.canon.items.length} item records</p><p class="muted">Latest: {story.passages.at(-1)?.title}</p></section><section><h3>Recovery & recap</h3><p>Latest replacement baseline: {story.recovery?.valid ? 'valid' : 'unavailable after manual edits'}</p><p>Recap: {!story.recap ? 'none' : story.recap.stale ? 'needs refresh' : 'up to date'}</p></section></div><h3>Ownership</h3>{#each story.canon.items as item}<p class="muted">{item.name}{item.unlimited?' · Always available':` × ${item.quantity}`} → {inventoryPath(story.canon, item.ownerId)}{item.equipped ? ' (equipped)' : ''}</p>{/each}<details class="dev-section"><summary>Full saved story snapshot (read-only)</summary><pre class="dev-json">{pretty(story)}</pre></details><p class="muted">Use normal editors or Memory to change data with revision checks. Local connection keys and diagnostic storage are separate from story exports.</p>{:else}<p>Select a story first.</p>{/if}
  {/if}
</main>
