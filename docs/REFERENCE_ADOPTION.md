# Reference adoption and foundation audit

Photobook/gallery candidates and the media integration plan are tracked separately in [Media references](MEDIA_REFERENCES.md).

Audited October 17, 2026 against Corvus Story Core commit `8e5e7345eb349581febfd9d73bd45d4edea59717`, from https://github.com/JustLateNightAI/Corvus-Story-Core. The reference checkout remains under `references/`, ignored by Git. Adapted code's MIT notice is retained in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

## What was adopted

| Corvus source | Useful element | Guided Story implementation |
| --- | --- | --- |
| `server/services/thinkStripper.ts` | Reasoning-tag families and finalized-output filtering | `model-output.ts` adapts tag handling, supports attributes/nesting, drops unclosed blocks, and never treats reasoning-only output as an answer. |
| `server/services/gameMaster.ts` | Narrate first, then extract explicit structured effects | Strict proposal/effects schemas and a balanced JSON-object reader; malformed, missing, ambiguous, or extra-field results fail rather than becoming empty successful changes. |
| `server/services/orchestrator.ts` | Per-story orchestration around narration and extraction | Durable job phases, cross-kind per-story generation exclusion, cancellation before commit, deduplicated in-flight requests, and explicit retry. |
| `server/services/stateManager.ts` | Separate generated proposals from authoritative state; prevent duplicate cast creation | Ensemble-oriented effects engine, application-assigned IDs, ownership/quantity preconditions, duplicate-name checks, source quotes, and immutable user content preferences/pins. |
| `server/services/fileManager.ts` | Per-game coordination and temp/fsync/rename writes | SQLite transactions for story/jobs; unique staging files, file fsync, and rename for connection files and image previews. |
| `server/services/contextAssembler.ts`, `summarizer.ts` | Select relevant character cards and recent history, retain summaries | Existing selective context and source fingerprints retained. Equal-relevance memories now prefer newer source passages under budget pressure. Reader recap remains separate from authoritative continuity. |
| `server/services/comfyui.ts` | Queue/history/view lifecycle | Persist provider prompt IDs and original endpoints, reconcile after restart, validate/download image outputs, and keep ready previews readable across restarts. Workflows remain user-selectable instead of using Corvus's fixed graph builders. |

Only the reasoning filtering and atomic-write portions contain small code adaptations. The job store, ensemble effects, passage transaction, and UI are new implementations informed by the reference. No new runtime dependencies were required.

## Deliberate changes from upstream

- No required player character, RPG statistics, or player-only inventory. Effects can address any cast member, place, item, relationship, or thread.
- No malformed-JSON-to-empty-effects fallback, and no promotion of a provider's reasoning channel into visible prose.
- No silent omission of invalid changes. A bad reference, quote, ownership precondition, pinned-field edit, or stale revision rejects the whole passage result.
- No branch/rewind framework. Event-changing replacement still targets only the most recent passage and restores its pre-passage canonical baseline.
- No model-controlled No NSFW flag or pin flag. New generated cast defaults to No NSFW. Manual controls retain authority.
- No provider request while holding a story SQLite transaction. Model calls happen outside the final short commit transaction; a revision check catches intervening manual edits.
- No automatic replay of an interrupted text request, and no duplicate image submission to compensate for a missing response. Unknown submissions require checking the provider before retrying.

Corvus's React UI, chat speaker splitting, TTS, name-based item mutation, fixed image graphs, and destructive chat-history operations were not imported. Character-card import, semantic retrieval, more image modes, and speech remain optional future work rather than foundation dependencies.

## Passage contract

`passageProposalSchema` separates prose from an explicit `effects` array. Each saved effect needs a verbatim source quote of 8–1,000 characters. Live extraction prefers a numbered source anchor that the app resolves to an exact excerpt; direct quotes must still match. Quote matching establishes traceability; it does not prove that a sentence describes a completed event rather than a plan or belief. The reader's optional continuity review is advisory and source-linked; automatic semantic review before passage commits remains future work. The wording editor has its own explicit semantic-equivalence review. See [Director/editor tools](DIRECTOR_EDITOR.md).

Supported effects cover cast/place/item creation, selected character/place updates, evidenced item name/description/condition and container-status updates, character movement, full-stack item transfer, quantity adjustment/removal, partial-stack splitting, equipped state, relationship creation/update, thread creation/update, and shared funds. Item description updates cannot change ownership, quantity or equipped state; those require their own effect types. Container moves carry nested contents through their unchanged immediate links. An evidenced `item.split` checks the source quantity, preserves the total and assigns a new record ID; follow-up effects must come after the split that introduces their reference. New references use temporary `new-...` aliases; the app assigns permanent IDs and resolves cross-references. All additions and changes are applied to a clone, then the final graph and pins are validated before persistence. See [Inventory](INVENTORY.md). More complex currencies/accounts remain future scope.

`commitGeneratedPassage` commits prose, canon, the latest recovery baseline, revision, and request receipt together. The passage retains its effects/assigned-ID receipt in the story and ZIP export, independently of bounded diagnostics. Duplicate requests cannot append twice; a reused request ID with different content is rejected. A late model result cannot overwrite manual edits. Replacement refuses to silently delete entities still referenced by manually edited context.

The deterministic sample continuation/replacement now uses the same preparation/validation boundary. Dev → Passage lab exercises a proposal and displays the resulting passage and world diff without calling a model or saving anything. There is intentionally no lab Commit button.

## Durable jobs and recovery

`data/<instance>/jobs.sqlite` stores job identity, input fingerprint (not raw credentials), expected revision, target, attempt history, phases, errors, and inspectable drafts/results. Dev → Jobs lists the latest 100 jobs, offers inspection/export, and cancels active local text jobs before commit. Job records are audit/recovery metadata, not story branches.

Text phases are queued → generating → validating → committing → complete, with failed/cancelled/interrupted terminal outcomes. On startup, unfinished non-resumable requests become interrupted. Explicit retry can start a new attempt. If the story transaction committed just before a crash, its operation receipt is recognized on retry so the provider is not called twice.

Image jobs persist their original endpoint, prompt ID, output binding, seed, timings, and preview-file metadata. After a restart, status checks use that same endpoint even if the active connection changed. Image request IDs deduplicate repeated submissions before and after restart; the Settings client retains a request ID when a submission response is not confirmed. A queued image is not re-queued. If submission was interrupted before a prompt ID was saved, the job is marked interrupted; inspect ComfyUI before requesting another image. Completed preview files are staged atomically before ready metadata is finalized. Clearing previews leaves the job audit record marked discarded and also removes this app's matching interrupted staging files from its test-image folder.

The current coordinator is for one local app server per instance. It is not a distributed worker queue. Jobs are not portable story-save contents; keys and device/service configuration remain separate from story ZIPs. Automatic background scene generation and full crash-resumable token streaming are not implemented.

## Verification

- `npm run check`, `npm test`, `npm run build`.
- `node scripts/browser-smoke.cjs`: current reading/settings flows plus Jobs inspection and passage-validation dry runs; isolated dev QA records and a temporary mock provider.
- `node scripts/restart-smoke.mjs`: launches a separate temporary server/config/data/cache, interrupts a text request, changes the active ComfyUI endpoint, restarts, reconciles the original queued image exactly once, then restarts again and reads its completed preview. It leaves the normal dev/play instances untouched.

Windows sandboxed shells may prohibit atomic renames in their virtual temporary directory; the full filesystem test should run in the normal local Node environment. No fallback to partial in-place writes is used.

Premise → editable cast/world setup → opening and the live narration/extraction loop are now implemented; see [New story flow](NEW_STORY_FLOW.md). The design-draft pattern from Corvus `routes/agents.ts` populates our editable ensemble setup, with direct generation from a premise rather than mandatory chat questions. A single-character redesign retains identity/content preferences and other setup records. Gallery/photobook associations are implemented in the media core. Chapter/book memory compaction now builds on this foundation; see [Memory compaction](MEMORY_COMPACTION.md).
