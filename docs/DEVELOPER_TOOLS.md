# Developer tools and continuity context

Open **Dev** in the top navigation. Each instance has independent diagnostics in `data/dev/diagnostics.sqlite` or `data/play/diagnostics.sqlite`.

## Bottom API request viewer

The fixed **API requests** strip is available on every screen, including while the main controls are busy. Expand it to inspect active/recent external calls and generation-job phases without leaving the current editor. Calls show elapsed time, model/service and success/failure status. Select one for its captured, credential-redacted request payload, response and error. Text responses appear after each call completes; this is not token streaming. Escape collapses the viewer and returns focus to its toggle.

The adjacent **Errors** button shows a count and an unread indicator. Its inbox combines explicit form/save failures, native field validation, console errors, uncaught browser exceptions/rejections, failed picture loads, failed API calls/jobs and recent server error messages. Inline errors remain beside the original control. Errors never automatically open the drawer or move keyboard focus. Matching reports are grouped; Copy errors, Dismiss and Clear errors operate on this browser session only, with up to 100 messages retained. Clearing also ignores older failures arriving on a delayed poll. Browser console transport is not ingested again, preventing dismissed messages from returning. Full persistent history remains in Dev. Browser-session errors reset on page reload; retained server/request failures can then be shown again.

Requests and Errors support keyboard tab navigation; Escape collapses from either view. The entire drawer is height-limited on short screens. The closed strip also shows the latest application save/generation status. Keys use the same client/server redaction as diagnostics. Status polling includes up to 30 bounded server error messages without log payloads, prompts or stack traces; per-message display is capped at 6,000 characters.

`GET /api/dev/activity` returns lightweight summaries: all active calls/jobs, the 20 most recent completed API calls and five recent finished jobs. Prompt, response, saved-draft and graph bodies are excluded from polling; full trace detail loads only when selected or its completion status changes. Local saves, context dry runs and the viewer's own polling are excluded from the call list. Status refreshes every two seconds while busy/open/active and every five seconds while idle; hidden browser tabs pause it. A connection failure is labeled unavailable while retaining the last known status.

While visible, the viewer checks one recoverable ComfyUI job every five seconds, rotating through pending images and using their retained original endpoints. This can download a ready preview and mark its job complete; it never resubmits, interrupts or accepts a picture into the story. Opening/collapsing the viewer does not unmount the current story or Settings form. Full diagnostic history and cancellation remain available in Dev/original generation controls.

## Console and requests

Console combines browser log/info/warn/error/debug calls, uncaught browser errors and rejected promises, application server console calls after initialization, HTTP request results, model activity, and storage events. Search and filter by level/source; choose 250, 1,000, or 2,000 recent entries. Automatic refresh runs every two seconds while visible. Launcher/Vite output before application initialization remains in the terminal.

Requests records model messages, returned text, token usage when supplied by the provider, duration, errors, context dry runs, and field-level before/after state changes (up to 100 changed fields per edit). Inspecting a context preview does not call the model. Failed model output is retained when available, including a truncated completion, to help diagnose failures. Traces are diagnostic records, not resumable jobs or undo history.

Retains 2,000 logs and 100 completed traces plus active calls across restarts. Live calls are not evicted by newer completed history. Export diagnostics downloads retained records; clearing the console and clearing completed traces are separate actions. Pending traces are marked interrupted after a server restart; recoverable image-job records can still reconcile with ComfyUI and finish their original trace. Console capture starts on page mount and does not recover earlier browser output.

Configured keys, credential fields, bearer strings, and common credential text patterns are redacted before persistence and display. Diagnostic details are bounded in size. Story text and ordinary profile data remain visible in local diagnostics; review an export before sharing it. Keys are excluded from story exports and public connection responses.

## Context preview

Dev also has **Jobs** and **Passage lab**. Jobs shows durable phases/attempts, errors, saved drafts, cancellation of active local text requests, original-endpoint ComfyUI reconciliation, and recent-job export. Unfinished text is marked interrupted after restart; retry from its original screen. A job that already committed is recognized by its operation receipt rather than calling the provider twice. Passage lab checks a proposed passage and evidenced ensemble effects against the current revision and displays a dry-run world diff. It does not call a model or save a scene. See [Reference adoption](REFERENCE_ADOPTION.md) for invariants and restart tests.

Build context preview uses the saved story and the editable next-story direction. It assembles:

- Story premise, narration style, content preferences, and a narrator contract.
- Scene cast/viewpoint/location, relevant places, possessions, relationships, and pinned appearance/outfits.
- Every saved field pin with its current canonical value and all established world rules, even for records outside the selected scene.
- Relevant lore, current source-linked memories, revealed knowledge, and unresolved threads.
- A bounded verbatim ending of the latest two passages, scene brief, and reader direction.

Each source shows whether it was included and why. Narration output/schema/pacing instructions are required sources, and service-formatting reserve is shown separately; the default continuation preview uses the same complete contract as live continuation. The budget includes JSON string escaping and uses a conservative UTF-8 byte allowance against configured context tokens, with output and overhead reserved. This is an estimate, not a model tokenizer. Required facts that cannot fit make the preview unusable for generation; they are not silently treated as optional. Recent prose may be clipped from the beginning, preserving its ending. Relevant memories receive priority over unrelated older records.

The `fact-pins` source is mandatory for narration and Ask. Inspect it to see each pinned record/field, resolved saved value and world rule. Its input cost counts toward the full wire budget; too many pins/rules stop the operation instead of being omitted through relevance selection. Effect extraction and AI corrections likewise require the complete constraints. Pins → Save pins & rules changes the configuration, while explicit manual record edits change the current value protected by a field pin. See [Pinned facts](FACT_PINS.md) for recovery and validation limits.

Selection currently uses explicit IDs, entity names, location links, and lore keywords. There is no embedding search. Reader recap text is excluded from this context so editing a pleasant recap cannot establish fictional facts.

Inventory selection follows immediate container links: relevant cast/place holdings include eligible nested possessions, and selected items bring their storage ancestors into consideration. Included item records contain canonical fields plus derived `rootOwnerId` and `storagePath`; these derived values are context, not editable effect fields. Ordinary inventory candidates may still be omitted by the budget. Item **Owner / storage** pins constrain the immediate link, while **Ultimate owner / location** pins constrain the eventual cast/place holder through ancestor moves. Both appear in the mandatory fact-pins source; `isContainer` pins resolve missing legacy values to false.

Chapter/book summaries now participate in live context, with precise event records selected separately. Context reports represented/missing passage coverage and omitted sources. See [Memory compaction](MEMORY_COMPACTION.md).

## Memory editor

Scene brief holds purpose, tension, stopping point, viewpoint, location, cast and optional clear-after-next-passage behavior. The reader edits the same fields. These are planning notes, not completed events; Ask and polish do not consume them.

Lore can be always included, included when relevant, or hidden. Knowledge entries distinguish established facts, character beliefs, and future possibilities, and track who knows each entry and whether the reader has seen it. Unrevealed knowledge and hidden lore stay out of prose context. A future planner may use them through its own separate context; no such planner exists yet. Secrets written in an ordinary character biography are not automatically hidden.

Continuity memories contain a summary, factual events, open questions, entity links, and source passage IDs. Add/edit them manually or choose a passage and Generate passage memory using the configured model. Save other context edits first. Generated notes are editable and never directly change canonical world records. Invalid JSON, unknown IDs, cancellation, or intervening story edits prevent a model result from being saved.

Source fingerprints exclude stale memories and source-linked knowledge after source prose changes. Editing unrelated scene notes does not relabel stale memory as current. Correct the affected note or regenerate its memory to review it against the new passage.

Chapter & book memory shows open/missing/current/stale chapter status, book coverage, pending work and source fingerprints. Rebuild pending memories processes up to four completed chapters; automatic maintenance processes one after each saved live passage. Save context edits first. Manual notebook fact corrections conservatively invalidate derived summaries. Rebuilding changes no canon or prose.

State shows the saved story snapshot, revision, inventories, recap coverage, and replacement-baseline availability. It is read-only; use the normal editors or Memory tab to change records.

State ownership uses complete container paths. Manual `item-split` saves produce normal state-change traces showing the original remainder and new unequipped record; they make no provider request. Passage lab accepts the evidenced `item.split` contract with expected quantity and a new ref, plus container-aware creates/updates/transfers. Put the split before effects naming its new ref. A bad destination, graph, quantity precondition or pinned final-state change rejects the dry run or commit as a whole. Moving a container preserves its descendants' immediate IDs/links.

## Current limits and next work

Settings now has seven tabs with independent saves, real text/image generation tests, workflow import/bindings, editable templates, context controls, and storage tools. See [Settings](SETTINGS.md) for supported behavior and limits. Tests do not save form changes or alter story records.

Recaps, passage memories, live narration, chapter/book memory maintenance and story illustrations use the configured providers and durable jobs. The original sample remains deterministic; generated stories use the live prose/effects commit boundary. Reader Ask, reviewed wording polish and scene direction are implemented; see [Director/editor tools](DIRECTOR_EDITOR.md). A general pre-commit narrative continuity review and semantic retrieval remain future work. Equally relevant passage memories prefer newer sources when space is limited.

On October 17, 2026, the selected local Unsloth model passed a real prose test and ComfyUI generated a real portrait through the corrected supplied workflow. Test results are separate from canonical story records. The original workflow is unchanged.

Run `npm run check`, `npm test`, and `npm run build`. The optional `scripts/browser-smoke.cjs` walkthrough exercises both app ports, real HTTP endpoints with a temporary local mock provider, context selection, generated memory, request/console diagnostics and redaction, recap generation, navigation, persistence, imports, and responsive layouts. It restores the exact development connection file and removes only records it created; it does not alter the play library.

## Media

Media shows the saved asset associations, source/snapshot history, and portrait/reference selections. Check image files & checksums audits originals across every story in the instance, identifying missing/corrupt files, unreferenced originals, cached thumbnails, and interrupted staging files. It does not delete shared assets. See [Media core](MEDIA_CORE.md).

## Setup and live narration jobs

Jobs/Requests also include story-question and wording-polish, with actual question context, wording-draft/review stages and retained results. Wording acceptance records a separate wording-commit trace. Live extraction offers numbered source anchors and saves the resolved verbatim quotes in canonical effect receipts.

Jobs/Requests now include story-setup, setup-character, story-opening, story-narration, story-replacement, and story-effects stages. Setup scope IDs become the story ID when chapter one is published. Narration drafts are retained before effect extraction, so a failed extractor can be diagnosed without changing the saved novel. Retries preserve failed/interrupted attempts in job history; completed opening and passage receipts suppress duplicate provider calls after uncertain responses or restart.

Setup ZIP import/export does not enqueue a generation job or call either provider. Imports create independent setup scope IDs; editor/job/request receipts are not copied. Archive failures appear in the bottom Errors panel. The isolated `scripts/setup-archive-smoke.mjs` and `node --import tsx scripts/inventory-smoke.mjs` walkthroughs pass, alongside the current 204-test suite and zero-error/warning Svelte checks. Use [Project status](PROJECT_STATUS.md) for the current build checkpoint; production packaging remains on demand.
