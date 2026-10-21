<script lang="ts">
  import type { Story } from './story';
  import { reportUiError } from './ui-feedback';
  import { untrack } from 'svelte';
  let { story, busy, dirty, canGenerate, onStorySaved }: { story: Story; busy: boolean; dirty: boolean; canGenerate: boolean; onStorySaved: (story: Story) => void } = $props();
  type Plan = { epoch: number; automatic: boolean; pending: number; chapters: { chapter: number; title: string; passageIds: string[]; status: string }[]; book: { status: string; chapterNumbers: number[]; needsUpdate: boolean } };
  let plan = $state<Plan | null>(null), working = $state(false), problem = $state(''), note = $state('');
  $effect(() => { if (problem) untrack(() => reportUiError(problem, 'Story memory')); });
  let controller: AbortController | null = null;
  let pendingRequest: { expectedRevision: number; requestId: string } | null = null;
  async function read(response: Response) { const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Memory maintenance failed.'); return body; }
  async function refresh(signal?: AbortSignal) {
    try { const result = await read(await fetch(`/api/stories/${story.id}/compaction`, { signal })); if (!signal?.aborted) plan = result; }
    catch (e) { if (!signal?.aborted) problem = e instanceof Error ? e.message : 'Could not inspect memory.'; }
  }
  $effect(() => { const revision = story.revision; const id = story.id; void revision; void id; const inspection = new AbortController(); refresh(inspection.signal); return () => inspection.abort(); });
  $effect(() => () => controller?.abort());
  async function rebuild() {
    if (busy || dirty || working) return;
    working = true; problem = ''; note = ''; controller = new AbortController();
    if (!pendingRequest || pendingRequest.expectedRevision !== story.revision) pendingRequest = { expectedRevision: story.revision, requestId: crypto.randomUUID() };
    try {
      const saved = await read(await fetch(`/api/stories/${story.id}/compaction`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pendingRequest), signal: controller.signal }));
      pendingRequest = null; onStorySaved(saved); note = 'Memory summaries saved. Passage text and canonical facts were kept.'; await refresh();
    } catch (e) { problem = controller.signal.aborted ? 'Memory request cancelled. Reload to check whether it finished before cancellation.' : e instanceof Error ? e.message : 'Could not rebuild memory.'; }
    finally { working = false; controller = null; }
  }
  async function cancel() {
    const active = controller; if (!active || !pendingRequest) return;
    try { await read(await fetch('/api/generation/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storyId: story.id, requestId: pendingRequest.requestId }) })); }
    catch { problem = 'Cancellation could not be confirmed. Inspect Dev → Jobs.'; }
    finally { active.abort(); }
  }
</script>

<section class="dev-section" aria-label="Chapter and book memory">
  <div class="heading-row"><h3>Chapter &amp; book memory</h3><button onclick={() => refresh()} disabled={working}>Refresh memory status</button></div>
  <p class="muted">Completed chapters are compressed separately from the reader recap. Once at least two older chapters sit behind recent chapter summaries, an earlier-book overview is built from those chapter memories. Original prose and precise event records remain saved.</p>
  {#if problem}<p class="dev-warning" role="alert">{problem}</p>{/if}
  {#if note}<p class="muted" role="status">{note}</p>{/if}
  {#if plan}
    <p class="muted">{plan.pending} pending update(s) · Automatic maintenance {plan.automatic ? 'on' : 'off'} · Fact correction version {plan.epoch}</p>
    <div class="row"><button class="primary" onclick={rebuild} disabled={busy || dirty || working || !canGenerate || !plan.pending}>{working ? 'Building memories…' : 'Rebuild pending memories'}</button>{#if working}<button onclick={cancel}>Cancel memory maintenance</button>{/if}</div>
    <p class="muted">{dirty ? 'Save context edits before rebuilding.' : 'Builds up to four pending chapters per request, then the book overview when ready. Continue larger backlogs with another request. Automatic maintenance handles one chapter after each saved passage.'}</p>
    {#each plan.chapters as chapter}
      {@const memory = story.context.compaction.chapters.find(m => m.chapter === chapter.chapter)}
      <details class="dev-record"><summary>Chapter {chapter.chapter} · {chapter.title} · {chapter.status}</summary><p class="muted">{chapter.passageIds.length} source passage(s){chapter.status === 'open' ? ' · Available after the chapter ends.' : ''}</p>{#if memory}<p>{memory.summary}</p>{#each memory.facts as fact}<p class="muted">{fact}</p>{/each}<p class="muted">Source fingerprint: {memory.sourceHash}</p><p class="muted">Source passages: {memory.passageIds.join(', ')}</p>{/if}</details>
    {/each}
    <details class="dev-record"><summary>Earlier-book overview · {plan.book.status}{plan.book.needsUpdate ? ' · update pending' : ''}</summary>{#if story.context.compaction.book}<p class="muted">Chapters {plan.book.chapterNumbers.join(', ')}</p><p>{story.context.compaction.book.summary}</p><p class="muted">Source fingerprint: {story.context.compaction.book.sourceHash}</p>{:else}<p class="muted">No overview is needed until enough completed chapters accumulate.</p>{/if}</details>
  {/if}
  <p class="muted">Stale summaries stay visible here but are excluded from narration. Context preview shows history coverage, omitted sources and budgets. Summaries are derived; edit source-linked passage notes below or correct notebook facts, then rebuild.</p>
</section>
