# Chapter and book memory

Implemented October 17, 2026. This builds on the chapter/scene separation researched from Novelcrafter and hierarchical history/context patterns in Re3, DOC and Corvus. It is Storyweaver code, using the existing provider, jobs, repository and context builder. No vector database or new runtime dependency is required. See [context strategy](CONTEXT_STRATEGY.md) and [reference adoption](REFERENCE_ADOPTION.md).

## Layers

1. Current canonical records and constraints remain authoritative.
2. A bounded verbatim ending of recent passages preserves immediate prose continuity.
3. Source-linked passage memories retain summaries, factual events and unresolved questions. Surviving passage effect receipts preserve exact operations and their source quotes independently of lossy summaries.
4. Completed chapters receive compact summaries with facts, questions and entity links. Open chapters are not compacted yet.
5. With the default two recent completed chapters retained, an earlier-book overview begins after four chapters finish. It covers the older prefix, rebuilt from chapter memories rather than repeatedly compressing its own previous output. Settings can retain one to six recent chapters before book compaction.

The context builder prioritizes the book overview and chapter summaries, folds redundant passage summaries when their included higher layer covers them, and still considers relevant exact passage facts/effect receipts. It keeps original prose, memories and receipts in the save. Compression does not erase source history.

Reader recaps are independent. Editing Story so far cannot create narrative facts, alter memory summaries or change their fingerprints. Hidden lore, unrevealed knowledge, scene plans and future reader directions are not inputs to chapter/book compression; only written history, its evidenced effects and current chapter-scoped passage notes are supplied.

## Source checks and corrections

Chapter fingerprints cover ordered source passage IDs, prose, completion state, evidenced effects and passage-local ID assignments, current chapter-scoped memory notes and an explicit manual-fact correction version. Book fingerprints cover its ordered chapter prefix and exact chapter-memory contents/fingerprints. Stored coverage must match the source order.

Replacing the latest passage expires its affected chapter memory and any dependent book overview. Older unaffected chapter memories remain usable. Manual canonical fact edits increment the correction version and conservatively expire all chapter/book summaries; advancing the story through generated effects does not. Editing a source-linked passage note expires the chapter that used it and dependent book coverage. Styles, artwork, recaps and unrelated scene briefs do not expire historical summaries.

Stale derived memories remain inspectable but are excluded from narration. Rebuilding describes surviving written history; current canonical facts still override historical descriptions. Correcting a notebook fact does not rewrite earlier prose. A source fingerprint verifies provenance, not literary/factual accuracy of an LLM summary.

## Scheduling, bounds and failure

Settings → Context enables automatic maintenance by default. After a live opening/continuation/replacement has committed, a separate durable memory-compaction job processes at most one pending completed chapter and updates the book overview when its source chapters are ready. An illustration or deterministic sample action does not trigger maintenance. Existing saves/backlogs can be maintained explicitly from Dev → Memory.

Maintenance is awaited before the successful generation response, so that response includes the final saved revision. It adds model latency at chapter boundaries. A maintenance error is logged and leaves work pending while the already committed passage still returns successfully. Narration failure does not start maintenance. Replaying the original passage request does not resubmit failed maintenance; explicit Dev rebuilding or a later newly saved passage retries pending work. Interrupted text jobs require explicit retry; they do not resume tokens automatically.

Dev rebuilding processes up to four pending chapters per request. Each request permits at most 32 model calls and eight compression levels, with per-call provider timeouts and cancellation. Oversized sources are packed into bounded UTF-8-safe chunks and summarized hierarchically; source prose is not silently dropped. Nonshrinking intermediate results, malformed JSON, unknown IDs, missing budgets, cancellation or provider errors keep the previous stored summaries. Larger backlogs may need multiple requests.

Input budgeting subtracts the actual system/schema/entity text, output ceiling and configured overhead using shared conservative token estimates. ASCII prose, JSON punctuation/escaping and non-ASCII content receive separate allowances; this is not an exact model tokenizer. The final commit rechecks the story revision, correction version and source coverage. Summaries, operation receipt and saved revision commit atomically without changing canon, passages or the latest replacement baseline. Ordinary context-editor submissions cannot forge the derived cache or its correction version.

## Dev controls

Dev → Memory shows each chapter as open, missing, current or stale, book coverage, pending work, source fingerprints and correction version. Rebuild pending memories uses the saved text connection. Cancel affects the active text request. Jobs/Requests retain phases and actual bounded inputs/outputs.

Dev → Context reports the assembled byte budget, included/omitted chapter/book/passage/event sources, and how many passages have full prose or summary representation. It lists missing passage IDs/titles rather than presenting partial context as complete. An included event receipt alone does not count as full passage coverage. Summary coverage means representation, not guaranteed exhaustive recall.

Accepted chapter/book memories travel with story ZIPs. Credentials, diagnostic traces and pending jobs remain local to the instance.

## Verification

`tests/memory-compaction.test.ts` covers multi-chapter bounded requests, book/chapter selection, old ownership and clue retrieval, source edits/replacement, hidden-plan/recap exclusion, manual corrections, no-canon-change rebuilding, receipts, archive round trips, concurrency, cancellation/provider failure, chunking and visible missing coverage.

`scripts/memory-smoke.mjs` exercises the real Svelte interface and HTTP routes with isolated temporary data/configuration. `scripts/memory-live-smoke.mjs` exercises the saved local text connection against an isolated fictional multi-chapter fixture. Neither changes the normal play library.

Run these with `node --import tsx scripts/memory-smoke.mjs` and `node --import tsx scripts/memory-live-smoke.mjs`. Both passed on October 17, 2026, along with all 80 automated tests, Svelte check and the production build. The live fixture retained the old ownership event and explicit ledger question while representing ten passages in 7,062 / 11,264 input bytes. The final prompt explicitly asks for no invented generic questions; source fingerprints and these checks do not guarantee perfect model summaries.
