# Reader direction, questions and wording polish

Implemented October 17, 2026; current-record correction tools added October 19. The reader has distinct tools for advancing the story, asking about established material, polishing existing prose and repairing current records. Event-changing replacement remains latest-passage-only; previews do not create alternate timelines.

The reader's ordinary next-passage direction and chapter-ending choice persist as a per-story browser draft. Reloading or switching stories restores the corresponding draft; failed or unconfirmed requests retain it. Only acknowledged continuation clears it. Latest-passage replacement preserves future direction, and **Clear direction draft** explicitly resets both fields. Dev's reader-direction control shares the same draft. Device drafts are separate from canonical scene briefs and are not included in story ZIPs. If device storage fails, the open page retains drafts and warns before unloading unpreserved work.

`node --import tsx scripts/direction-draft-smoke.mjs` verifies reader/Dev synchronization, independent story drafts, reload, provider failure, replacement preservation, confirmed continuation, explicit Clear, 320px layout and storage outage/recovery using temporary libraries and a deterministic provider.

## Ask about the story

Choose **Ask about the story** under any written passage. The editor scrolls into view and focuses a prominent question field, showing the chapter and passage being read. Enter a question and choose **Ask without advancing**; opening the editor never calls the model. Closing returns focus to the initiating control, and the device-local question draft is retained. Answers use the latest saved canonical facts, including when the reader is browsing an earlier passage. This is stated in the interface; Ask is not a historical notebook snapshot or a spoiler-free rereading mode.

The context builder omits the scene brief, narrator craft instructions, hidden lore, unrevealed knowledge and future thread plans from question context. It selects current relevant records, available passage/chapter/book memories and up to six full source passages. Question matches, weighted toward distinctive terms, take priority over a small focused-passage bonus; short terms such as “fob” count. Ask spends its prose budget on these citable passages instead of duplicating an obligatory recent ending. A directly named current item is required context so historical quotes do not displace its present ownership. It does not assume the entire novel fits. Answers show source excerpts with links back to the prose and expandable context-coverage warnings. A quote must match a passage actually included in the question prompt; unknown IDs and fabricated excerpts reject the result. Interpretation or missing evidence should be labeled uncertain. Source validation establishes traceability, not guaranteed correctness of every sentence in an answer.

Asking cannot append prose, transfer inventory, alter canon, consume a one-shot brief, refresh summaries or increment the story revision. Completed answers are stored outside the story payload as editor results. Reader recaps are excluded from Ask context. Secrets written in ordinary public biographies remain ordinary profile text; only explicitly hidden records have visibility controls.

## Advisory continuity review

**Review continuity** is a read-only Ask shortcut: it preloads a comparison of the focused passage with its two preceding passage titles and asks for supported contradictions, physical inconsistencies, unsupported certainty or repeated beats. The question stays editable and uses the same bounded retrieval, exact source checks, uncertainty display and saved history as Ask. It never automatically edits prose or canon and does not add a model call to ordinary continuation. Unsupported or missing context should remain uncertain; source provenance does not prove a review's literary judgment.

Question context gives each supplied passage a set of bounded, exact excerpts with citation IDs. The preferred model response selects those IDs; the server attaches their original text and passage IDs. This avoids quote/UUID copying errors without accepting invented sources. Unknown or mixed citation formats are rejected; the earlier direct-quote response format still receives strict passage/quote checks. Technical IDs are displayed as numbered source references, and answer text supports paragraphs and bold without interpreting HTML. Quoted passage titles receive retrieval priority when explicitly comparing scenes. The review asks for evidence on both sides of a claimed contradiction and does not treat a missing explanation as proof of an inconsistency.

## Wording polish

Choose **Polish wording** to open and focus its instruction field, optionally describe a copyediting goal, then **Preview wording polish**. Leaving the field blank requests a general clarity/flow/repetition pass, as the form explains. This works for earlier and latest passages and explicitly targets the selected passage rather than the entire chapter. Opening the form sends no model request. A draft call is followed by an independent meaning-review call through the same configured text connection. Both see the full original passage; a source/review that cannot fit the conservative context budget is refused rather than truncated.

The first version keeps quoted speech, written numeric values and source excerpts supporting saved event receipts verbatim. Established full entity names present in the source must remain. The review checks events, causal order, speaker attribution, possession, quantities, locations, identity, clues, knowledge, negation, uncertainty and stopping point. A failed check or ambiguous review produces no applicable preview. Full excerpts selected by indexed extraction can lock an entire paragraph; polish the remaining narrative wording rather than changing those anchored facts.

The reader compares **Original** and **Proposed**, then explicitly chooses **Apply wording only**. Model review can miss subtle meaning changes; comparison remains part of the interface. There is no claim of a deterministic semantic-equivalence proof. Changes to dialogue or events need the appropriate future editor or latest-passage event revision, not this copyediting tool.

Acceptance loads the stored reviewed preview; the endpoint does not accept replacement prose/effects from the browser. It rechecks story revision, source fingerprint and protected text. Any intervening saved edit requires a fresh preview. The transaction changes only the selected passage's paragraphs and save metadata, preserving passage IDs, chapter boundaries, viewpoint, canonical records, effects and the latest recovery baseline. Duplicate acceptance cannot apply twice.

Previously current passage memories and source-linked knowledge are rebased to the reviewed equivalent wording; already stale records remain stale. Chapter/book fingerprints expire and reader recaps need refresh. Existing accepted pictures retain their immutable original source provenance and status. A picture still queued against older text may conservatively be accepted as an earlier source version; polishing does not rewrite its captured prompt/snapshots.

## Change what happens

**Change what happens** now opens a dedicated rewrite form; it does not immediately generate. The form scrolls into view and focuses **What should happen instead?**, with the selected chapter/passage and latest-only scope visible. Enter a nonblank direction, optionally set **Chapter ending for this rewrite**, then choose **Rewrite latest passage** and confirm. The usual generation/effects transaction replaces only the latest passage from its earlier world state. Existing older prose remains intact, and previous pictures retain their earlier-version handling.

Rewrite instructions and chapter-ending choice are separate from continuation. A future-passage direction already entered below the reader is not sent as rewrite guidance or erased after a successful rewrite. Cancel rewrite closes the form without a model call, retains the device-local draft for that story/passage and returns keyboard focus. A failed/cancelled generation keeps the form and draft available. Successful replacement clears the old rewrite draft. Browser storage is optional; unavailability does not prevent typing or generation.

Historical passages and an invalidated replacement baseline still disable this action. Opening the form does not discard notebook edits; the existing discard protection is checked when submitting. An unsaved title edit requires confirmation before the rewrite form replaces it; cancelling keeps the title fields without a model request. Cancelling an active request follows the normal durable-job cancellation flow. An uncertain server result still requires reloading before retrying.

## Correct a missed story fact

**I noticed something needs correction** opens and focuses **What needs correction?** under any passage. Describe the expected state, then **Preview corrections**, review the explanation and field-by-field Before/After, and explicitly **Apply corrections**. A clothes-for-item trade can propose both ownership changes, create a missing wardrobe-only garment as inventory, and update affected worn clothing together. These are model-guided, validated proposals; there is no guaranteed garment-to-item matching system. Pins and content preferences are preserved, and AI deletion is unavailable.

This edits current canon, including when opened from an older passage. It never rewrites that chapter, restores an old inventory or creates branches. Current saved canon, the full selected passage and the latest passage are required context; other selected-chapter passages fit within the remaining budget, with omissions reported. It does not promise exhaustive history. A long required source can need a larger supported context budget.

Manual notebook edits must be saved or reset first. Changing the story/source, request direction or AI edit type prevents applying an outdated preview; request changes can be restored or regenerated, while saved-source changes require a fresh preview. Accepted canon fixes use normal correction invalidation: latest event replacement is paused until continuation establishes a new baseline, and derived chapter/book memory and recap become stale. **Records** also has selected-record revise/full/name/create AI options. See [In-story corrections](STORY_CORRECTIONS.md) for exact scope, preservation, cancellation and archive behavior.

## Scene direction

Under the latest passage, expand **Scene direction** to edit purpose, tension, viewpoint, location, cast focus and stopping point. These are planning notes, not completed fictional events. Save them separately from the optional one-passage direction box. A dedicated scene-brief action leaves unrelated memory records intact and does not invalidate the world recovery baseline.

Saved/unsaved status and **Reload saved brief** make the draft explicit. Unrelated story saves preserve edits, and failed saves keep them on screen. If the saved brief changes while a local draft is dirty, saving is blocked until the saved brief is reloaded. Leaving the screen or latest passage asks before discarding a changed brief; browser reload/close also warns. Saving remains explicit.

An explicitly selected viewpoint constrains narrator output and is validated before effects can commit. Scene location is a framing instruction; actual character/ship movement still needs an evidenced fictional event. **Direction scope** controls its lifespan:

- **Next passage** clears after the next accepted continuation. Failed/cancelled requests, latest-passage rewrites, Ask and wording polish keep the plan.
- **Current scene** remains across passages until **End scene** explicitly clears the direction. Chapter endings do not infer a scene ending. This action changes planning notes only, not written events or canon.
- **Ongoing** remains until changed or explicitly cleared with **Clear saved direction**.

The summary shows the active saved scope. Save or reload pending edits before clearing saved direction. Dev → Memory edits the same scope. Old archives with only `clearAfterPassage` retain their original next-passage/ongoing behavior; explicit scope becomes authoritative and the legacy flag remains synchronized for compatibility.

## Context and structured output

Narration selects context with its full pacing/output/schema instructions included as required sources, reserving service formatting before optional history. Dev Context previews the same default continuation contract. Budget accounting includes JSON string escaping; output and overhead reserves remain conservative byte allowances rather than tokenizer measurements. Ask has its own required answer contract.

The 1.0 prompts explicitly track object/hand/tool continuity, numerical consistency and requested stopping points, and discourage repeated imagery/gestures without narrative purpose. Extraction, passage/chapter/book memories and reader recaps preserve observations versus attributed suspicions, including inside their summaries. These are model instructions, not a deterministic truth classifier. Summary chunking counts JSON escaping and complete system/schema overhead. Changed recap instructions invalidate intermediate-cache keys; chapter fingerprints include the confidence contract so older summaries cannot remain apparently current after that contract changes. Explicitly quoted passage titles take priority during Ask/review retrieval, within the available budget.

Auto structured output now requests JSON-object syntax for structured tasks; Prompt only remains available for APIs without it. The live check initially caught a missing JSON array terminator in unconstrained output. JSON-object mode and source anchors address syntax/quote copying; field validation and review are still required. No provider switching or automatic failure retry is added.

## Evidence anchors

Live effect extraction now offers numbered source excerpts from the final written draft. Each entry identifies its paragraph and starting text without duplicating the full prose in the prompt. The model selects an `evidenceId`; the server attaches that exact bounded excerpt as the saved `evidence` quote. This avoids the local model's observed habit of abbreviating long quotes with ellipses. Exact directly supplied quotes remain valid, while fabricated/abbreviated quotes, unknown anchors, extra fields and mixed ID/quote answers are rejected. Domain ownership, quantity, pin, reference and latest-only checks are unchanged.

Anchors demonstrate that evidence came from the written passage. They do not prove that the model interpreted an event correctly; narrative continuity review remains separate work.

## Persistence, jobs and API

The instance library database contains a separate `editor_results` table, retaining the latest 100 answers/previews per story and exposing the most recent 20. Creating a result leaves the fictional story payload/revision unchanged. Accepted wording enters the ordinary story save and ZIP; Q&A, previews, jobs and diagnostics do not travel in story ZIPs. Imported copies begin without editor history. Evicted results require a new request rather than a silent provider resubmission.

Current-record proposals use a separate `correction_results` table with the same 100-retained/20-exposed limits. Accepted corrections enter the story and portable ZIP; proposal history does not. `GET/POST /api/stories/:id/corrections` lists/generates previews, and `POST /api/stories/:id/corrections/:resultId/apply` accepts a retained preview with revision/source/receipt checks. The `story-correction` job uses the existing story lock and cancellation flow.

| Route/action | Behavior |
| --- | --- |
| `GET /api/stories/:id/editor` | Recent scoped answers/previews |
| `POST /api/stories/:id/editor` | Ask or generate/review a polish preview; expected revision and request ID required |
| `POST /api/stories/:id/editor/:resultId/accept` | Apply a stored reviewed wording preview with revision/receipt checks |
| `PATCH /api/stories/:id`, `scene-brief` | Save reader/Dev planning fields |

Jobs include `story-question` and `wording-polish`; Requests shows question context, draft, review and wording commit stages. Story text jobs share the per-story lock. Cancellation reaches the active job before aborting the browser request. Interrupted jobs require explicit retry, and completed request IDs replay retained results without another provider call. Keys remain server-side.

## Verification

`tests/story-editor.test.ts` covers read-only answers, source grounding, hidden-plan exclusion, full-input budgeting, dialogue/number/evidence protection, review rejection, stale/cross-story previews, earlier-passage acceptance, memory invalidation/rebasing, inventory recovery, media provenance, one-shot briefs and viewpoint enforcement. `tests/evidence-sources.test.ts` covers bounded exact source anchors, Unicode, invalid IDs, extra fields and abbreviated quotes.

Run `node --import tsx scripts/director-smoke.mjs` after a production build for the isolated browser/API walkthrough. It exercises preview/apply, failures, cancellation, source navigation, writing-guide save/reload and narrator inclusion, scoped direction with explicit End scene, one-shot reader plans, restart, ZIP scope and the 320px layout. `tests/narrative-controls.test.ts` covers legacy scope migration, ordinary save/reopen, one-shot continuation/replacement semantics, persistent chapter-spanning scopes and required writing-guide context. `node --import tsx scripts/director-live-smoke.mjs` exercises a real two-chapter local-model story and the new tools using temporary data/configuration; its acceptance profile requests JSON-object output. Normal play saves and saved connection preferences are not changed.

`node --import tsx scripts/reader-actions-smoke.mjs` verifies all three request forms: visible focused inputs before any provider call, exact instructions in sent payloads/prompts, read-only Ask/polish previews, rewrite/continuation separation, retained cancellation drafts/focus, historical/recovery guards, busy cancellation and 320px layouts. `scripts/story-smoke.mjs` uses the explicit rewrite form for its world-state replacement acceptance.

`node --import tsx scripts/draft-cleanup-smoke.mjs` checks scene-brief save/reset and navigation/unload guards, plus title focus and the explicit recap/notebook draft controls, using isolated data and mock services.

The October 17 live case retrieved and cited the earlier fob handover, then applied a reviewed one-sentence copyedit to the opening without changing canon or recovery. See [Local narrative walkthrough](NARRATIVE_WALKTHROUGH.md) for the generated case and its remaining limits.
