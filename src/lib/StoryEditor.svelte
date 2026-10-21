<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { reportUiError } from './ui-feedback';
  import type { Story } from './story';
  import type { EditorResult, EditorRequest } from './editor';
  import AnswerText from './AnswerText.svelte';
  let { story, passageId, mode, canGenerate, initialText='', busy = $bindable(false), onSaved, onJump, onClose }: {
    story: Story; passageId: string; mode: 'ask'|'polish'; canGenerate: boolean; initialText?:string; busy?: boolean;
    onSaved: (story: Story) => void; onJump: (id: string) => void; onClose: () => void;
  } = $props();
  let text = $state(''), working = $state(false), problem = $state(''), note = $state('');
  $effect(() => { if (problem) untrack(() => reportUiError(problem, mode === 'ask' ? 'Ask about the story' : 'Wording polish')); });
  let result = $state<EditorResult | null>(null), history = $state<EditorResult[]>([]);
  let controller: AbortController | null = null, pending: { key: string; input: EditorRequest } | null = null;
  let acceptRequest: { expectedRevision: number; requestId: string } | null = null;
  let editorElement: HTMLElement, instructionField: HTMLTextAreaElement;
  const passage = $derived(story.passages.find(p => p.id === passageId));
  const inputId = $derived(`story-editor-input-${mode}-${passageId}`);
  const helpId = $derived(`${inputId}-help`);
  const matches = $derived(history.filter(r => r.kind === mode && (mode === 'ask' || r.passageId === passageId)));
  const stale = $derived(!!result && result.sourceRevision !== story.revision);
  const draftKey = () => `storyweaver-editor:${story.id}:${passageId}:${mode}`;
  async function read(response: Response) { const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Story editor request failed.'); return body; }
  async function refresh() { const data = await read(await fetch(`/api/stories/${story.id}/editor`)); history = data.results; }
  onMount(() => {
    let mounted = true;
    try { text = initialText || localStorage.getItem(draftKey()) || ''; } catch { text = initialText; }
    tick().then(() => {
      if (!mounted) return;
      editorElement?.scrollIntoView({ block: 'start', behavior: 'auto' });
      instructionField?.focus({ preventScroll: true });
    });
    refresh().catch(e => problem = e.message);
    return () => { mounted = false; controller?.abort(); };
  });
  function remember(event: Event) { try { localStorage.setItem(draftKey(),(event.currentTarget as HTMLTextAreaElement).value); } catch { /* The current draft remains usable when browser storage is unavailable. */ } }
  async function generate() {
    if (busy || !canGenerate) return;
    const body = { expectedRevision: story.revision, passageId, kind: mode, text: text.trim() }, key = JSON.stringify(body);
    if (!pending || pending.key !== key) pending = { key, input: { ...body, requestId: crypto.randomUUID() } };
    working = true; busy = true; problem = ''; note = ''; controller = new AbortController();
    try {
      result = await read(await fetch(`/api/stories/${story.id}/editor`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pending.input), signal: controller.signal }));
      pending = null; acceptRequest = null; await refresh();
    } catch (e) { problem = controller.signal.aborted ? 'Request cancelled. Your saved passage was kept. Recent results will show any preview that finished before cancellation.' : e instanceof Error ? e.message : 'Could not complete the editor request.'; }
    finally { busy = false; working = false; controller = null; }
  }
  async function cancel() {
    const active = controller; if (!active || !pending) return;
    try { await read(await fetch('/api/generation/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storyId: story.id, requestId: pending.input.requestId }) })); }
    catch { problem = 'Cancellation could not be confirmed. Inspect Dev → Jobs.'; }
    finally { active.abort(); }
  }
  async function accept() {
    if (busy || !result || result.kind !== 'polish' || stale || result.acceptedAt) return;
    busy = true; problem = ''; note = '';
    if (!acceptRequest) acceptRequest = { expectedRevision: story.revision, requestId: crypto.randomUUID() };
    try {
      const saved: Story = await read(await fetch(`/api/stories/${story.id}/editor/${result.id}/accept`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(acceptRequest) }));
      result = { ...result, acceptedAt: saved.updatedAt, acceptedRevision: saved.revision }; acceptRequest = null; onSaved(saved);
      note = 'Wording saved. Events, inventories and the latest replacement baseline were kept.'; await refresh();
    } catch(e) { problem = e instanceof Error ? e.message : 'Could not apply wording.'; }
    finally { busy = false; }
  }
</script>

<section class="story-editor" bind:this={editorElement} aria-label={mode === 'ask' ? 'Ask about the story' : 'Wording polish'}>
  <div class="heading-row"><h2>{mode === 'ask' ? 'Ask about the story' : 'Polish wording'}</h2><button onclick={onClose} disabled={busy}>Close editor</button></div>
  {#if passage}<div class="editor-context"><span class="eyebrow">{mode === 'ask' ? 'Reading context' : 'Passage to polish'}</span><p>Chapter {passage.chapter} · {passage.chapterTitle}<strong>{passage.title}</strong></p></div>{/if}
  <p class="muted">{mode === 'ask' ? 'Ask a question using current story facts and relevant saved passages. The answer does not advance the story or change its records.' : 'Polish only the selected passage, not the whole chapter. Events and facts stay intact; review a preview before applying any wording changes.'}</p>
  <form class="editor-request-form" onsubmit={e => { e.preventDefault(); generate(); }}>
    <label for={inputId}>{mode === 'ask' ? 'Your story question' : 'Optional wording instructions'}</label>
    <textarea id={inputId} bind:this={instructionField} bind:value={text} oninput={remember} rows="5" maxlength={mode === 'ask' ? 3000 : 2000} required={mode === 'ask'} aria-describedby={helpId} placeholder={mode === 'ask' ? 'What would you like to know? For example: who has the access fob, and what do we know about the cargo?' : 'How should this passage read? For example: use shorter sentences, reduce repetition, and keep the tense atmosphere.'} disabled={busy}></textarea>
    <p id={helpId} class="muted editor-input-help">{mode === 'ask' ? 'Write your question above, then choose Ask without advancing to send it.' : 'Leave blank for a general pass on clarity, flow and repetition, or describe the style you want. Choose Preview wording polish when ready.'}</p>
    <div class="row"><button class="primary" disabled={busy || !canGenerate || (mode === 'ask' && !text.trim())}>{working ? (mode === 'ask' ? 'Finding an answer…' : 'Drafting and reviewing…') : mode === 'ask' ? 'Ask without advancing' : 'Preview wording polish'}</button>{#if working}<button type="button" onclick={cancel}>Cancel editor request</button>{/if}</div>
    {#if !canGenerate}<p class="muted">Choose and save a text model in Settings.</p>{/if}
  </form>
  {#if problem}<p class="notice" role="alert">{problem}</p>{/if}
  {#if note}<p class="muted" role="status">{note}</p>{/if}
  {#if matches.length}<label>Recent {mode === 'ask' ? 'answers' : 'previews'}<select value={result?.id || ''} disabled={busy} onchange={e => { result = matches.find(r => r.id === e.currentTarget.value) || null; acceptRequest = null; }}><option value="">Choose a saved result</option>{#each matches as entry}<option value={entry.id}>{new Date(entry.createdAt).toLocaleString()} · {entry.kind === 'ask' ? entry.question.slice(0,80) : entry.acceptedAt ? 'Applied wording' : 'Reviewed preview'}</option>{/each}</select></label>{/if}
  {#if result}
    {#if result.kind === 'ask'}
      <div class="story-answer"><h3>{result.question}</h3><p class="muted">Answer from saved revision {result.sourceRevision}{stale ? ' · The saved story has since changed.' : ''}{result.uncertain ? ' · Includes uncertainty or interpretation.' : ''}</p><AnswerText text={result.answer} />
      {#each result.sources as source, n}<blockquote><p>{source.quote}</p><button onclick={() => onJump(source.passageId)} disabled={busy}>Read source {n+1} · {story.passages.find(p => p.id === source.passageId)?.title || source.passageId} ↗</button></blockquote>{/each}
      <details><summary>Answer context coverage</summary><p class="muted">{result.coverage.representedPassages} / {result.coverage.totalPassages} passages represented in prose or summaries. This does not guarantee exhaustive recall.</p>{#each result.coverage.warnings as warning}<p class="muted">{warning}</p>{/each}</details></div>
    {:else}
      <h3>Compare wording</h3><p class="muted">{result.acceptedAt ? `Applied at revision ${result.acceptedRevision}.` : stale ? 'The story changed after this preview. Generate a fresh preview before applying.' : 'Wording checks passed. Review both versions before applying; model review can miss subtle changes.'}</p>
      <div class="wording-grid"><section aria-label="Original wording"><h4>Original</h4>{#each result.original as paragraph}<p>{paragraph}</p>{/each}</section><section aria-label="Proposed wording"><h4>Proposed</h4>{#each result.paragraphs as paragraph}<p>{paragraph}</p>{/each}</section></div>
      <button class="primary" onclick={accept} disabled={busy || stale || !!result.acceptedAt}>{result.acceptedAt ? 'Wording applied' : 'Apply wording only'}</button>
    {/if}
  {/if}
</section>

<style>
  .story-editor{scroll-margin-top:20px}
  .editor-context{padding:15px 0 12px}
  .editor-context p{font-size:12px;color:var(--muted);margin:5px 0 0}
  .editor-context strong{display:block;font-size:14px;font-weight:500;color:var(--text);margin-top:3px}
  .editor-request-form{padding:16px;background:var(--page);border:1px solid var(--line);border-radius:7px;margin:18px 0}
  .editor-request-form label{font-size:14px;font-weight:600;margin:0 0 8px}
  .editor-request-form textarea{min-height:135px;margin-top:0;font-size:16px;line-height:1.6;border-color:var(--accent)}
  .editor-input-help{margin:10px 0 16px}
  @media(max-width:650px){.editor-request-form{padding:12px}.editor-request-form .row>button{width:100%}}
</style>
