# Workflow phase 2 — executable passage workflows and durable artifacts

October 21, 2026. **Phase 2 is implemented and integrated.** Opening, continuation and latest replacement execute through the built-in graph over the existing engine. Effects-only retries and recovered acceptance use the same workflow persistence. No canvas or editable graph UI is implemented; phase 3 inspection and supported reruns are next.

## Engine and entry points

`src/lib/server/story-workflow/` contains:

- `runner.ts`: sequential dependency execution, typed ports, exclusive branch joins, skipped branches, trusted output checks, cancellation, per-node provider ceilings and durable attempts.
- `adapters.ts`: shared built-in operations for all three modes. Selection, prompts, budgets, evidence, inventory checks, bounded repair and final validation call the existing engine operations.
- `passage.ts`: normal generation, explicit effects-only retry, author acceptance and complete-content recovery for story/setup sources. Only the exact matching built-in graph is executable. `continuation.ts` preserves the earlier continuation API as thin wrappers.
- `store.ts`: complete local definitions, attempts, immutable hashed artifacts with provenance, and bounded provider request/response bodies including supplied usage. Headers, endpoint URLs and private connection objects are excluded.

`src/lib/server/passage-entry.ts` is the application generation entry point used by the existing opening and story-generation HTTP routes. New requests use the workflow runner. Existing legacy jobs, generation receipts and retained requests preserve their original identities when replayed. Setting the server environment variable `STORY_PASSAGE_ENGINE=legacy` keeps the sequential engine available for new root requests; existing workflow requests retain their workflow identity. Recovery retries use the workflow runner for both new and historical retained drafts. Previously ready legacy proposals can still be accepted through the existing guarded repository path.

`generatePassage` and `extractPassageUpdates` remain available as sequential orchestrators over the same extracted stage functions in `story-generation.ts`. Controlled comparisons assert the complete provider messages, schemas and supported settings, together with equal proposals, for quiet, expanded, inventory and repaired scenes in all three modes. There is no second implementation of prompts or canon rules.

The default definition remains version 2; node implementations are version 1. A source artifact stores the setup draft for opening or the current story for continuation/replacement. Internal prepared state permits empty earlier history for opening and replacement of the first passage; committed stories still require valid written history. A replacement run fingerprints its recovery baseline and restores pre-event canon/lore links once. Narration, extraction, attempted-fact displays and semantic inventory review all use that working state. Pins and other author constraints come from the current saved source, including fields whose current values differ from the restored baseline.

## Persistence, jobs and atomic boundaries

`StoryRepository.workflows` lazily initializes four tables on the existing SQLite connection: `workflow_runs`, `workflow_attempts`, `workflow_artifacts` and `workflow_provider_io`. Ordinary construction still creates no workflow tables; generation/recovery entry points now access them. No story/setup JSON migration or second database is required.

Each run stores its exact definition, source/configuration identity and request fingerprint. Artifacts store full JSON payloads, hashes, implementation/workflow versions and parent IDs. Reads verify payload hashes. Model bodies are execution data independent of scrubbed diagnostic traces; incomplete/oversized raw responses are labeled and never promoted as complete prose. There is no automatic model resubmission or generic cross-run artifact cache.

The existing `runStoryJob` owns the same `story:<id>` or `setup:<id>` source lock. Duplicate active requests coalesce; conflicting work is refused. A failed/cancelled/interrupted root workflow request is refused before starting another job attempt, preserving the cancellation/failure receipt as well as preventing a repeated model call. Explicit downstream retries use new actions/request IDs. Reopening storage alone neither resumes work nor interrupts another connection; explicit work under the source lock reconciles abandoned attempts and labels pending provider completion unknown.

Complete normalized prose is retained before extraction. Node outputs and completed attempts persist together. Internal repository callbacks join final committed artifacts to the existing transaction for opening publication, setup/story receipts, canon/effects/memory and retained status. Recovered acceptance has the same boundary. Ready recovery records and their exact `acceptance.review` artifacts are also transactional: a failed artifact write cannot leave a ready proposal without its authoritative workflow artifact. A later run-summary failure cannot make a durable save appear unsaved.

Opening uses setup publication receipts and refuses another-window publication or changed setup revisions. Replacement preserves passage/history/recovery-point guards. Final acceptance revalidates the full proposal, references, evidence, current pins and saved version. There is no unchecked save or automatic stock correction.

Workflow snapshots/model bodies remain local private data and are excluded from story/setup ZIPs and Git. Their inspection/export/deletion and retention policy are phase-3 lifecycle work; this phase adds no artifact export or retention-control UI. Historical Brasswater/ranch fixtures and existing archive formats remain unchanged.

## Explicit recovery

Failures, cancellation and unresolved checks preserve completed prose outside canon. Malformed raw model results remain inspectable locally but cannot be promoted into a passage. A complete persisted content artifact can be explicitly promoted after interruption before ordinary retention, with no provider request. Partial/uncertain narration or expansion is never silently repeated.

An effects-only retry reads current saved facts/constraints and submitted guidance, reuses immutable retained prose and original provenance when available, and runs only downstream extraction/check/one-repair operations. It imposes no narration output allowance. Replacement restores the valid pre-event baseline once; opening reuses the current saved setup. Changed history, invalid replacement baselines and removed viewpoints refuse the retry before provider work.

Successful retry ends at `awaiting-acceptance` and releases the job/source lock. The exact ready draft/version/proposal is an authoritative review artifact. HTTP acceptance locates that check and still enforces stale versions, newer retries, unused guidance and current-source validation. Acceptance appends a commit attempt, saves once and replays through the existing action receipt. Older retained drafts without workflow provenance can enter an explicit workflow retry using their existing immutable content; no original model request is reconstructed or repeated.

## Post-commit memory maintenance

Memory maintenance stays outside the passage graph and runs only after the passage job releases its lock, conditional on the existing settings and pending completed chapters. It uses the existing chapter/book compaction algorithm and limits. Successful maintenance can advance the saved revision; failure/cancellation/configuration errors return the committed story and cannot turn the passage into a failed generation. A replay never silently resubmits failed/interrupted maintenance. Repository, configuration and provider dependencies are injectable for isolated tests; normal private settings behavior is unchanged.

The integrated browser cancellation check exposed a replay that created a second failed job attempt after cancellation. Root-request refusal now happens before job creation, and deterministic regression coverage asserts that replay preserves the original cancelled job/attempt and performs no provider call. Cancel buttons have explicit button types. Normal activity labels describe opening, narration, rewriting and recovery without exposing internal node names.

## Verification and limits

**433 automated tests pass**, with zero Svelte errors/warnings, a successful production build (existing non-blocking chunk-size advisory), and **two isolated production browser suites** against the integrated default entry points (`story-smoke` and `passage-recovery-smoke`). The sequential fallback also passes both suites with `STORY_PASSAGE_ENGINE=legacy`.

The 30 additional tests in this follow-up cover opening/replacement full-wire parity for four branches, raw malformed effects, cancellation, exact-once retry/acceptance, normal/recovered atomic rollback, transactional ready artifacts, reopen/content promotion, first-passage replacement, current pins over pre-event canon, invalid recovery points and another-connection setup publication. Entry-point tests cover conditional memory success/failure/replay, settings-read failure and legacy identity preservation. The earlier 23 continuation tests include duplicate/conflicting requests, bounded repair, stale edits, unused guidance, interruption, artifact integrity and Brasswater scoping at 32k.

Both browser suites exercise opening/continuation/replacement, recovery, failure/cancellation, server restart and ordinary UI behavior. Recovery coverage includes corrected saved quantities, repeated checks, another-window opening publication, retained unsubmitted notes, reload/failure guards and 320/390px layouts. Browser suites run outside this Windows sandbox so temporary server readiness probes work; all data/settings/providers are isolated. The first story-suite cancellation assertion failed during integration and passed after the replay-receipt fix; no provider request was repeated by that refused workflow replay.

Quiet passage graphs still use two model calls. The exercised expansion/review/repair/recheck branch uses six. Default context/provider budgets, deterministic scope, authoritative canon and one bounded extraction repair are preserved. These are controlled parity/request checks, not new live-model quality or semantic-completeness claims. No real-provider generations, normal library/settings edits, historical fixture regeneration or release ZIP rebuilds were performed.

## Next gate

Proceed to phase 3: inspect persisted runs and typed outputs, show deterministic versus model checks, explain stale results and support explicit safe reruns/recovery. Include artifact lifecycle controls. Then build the location-first map linked to existing editors and, later, editable built-in graphs/presets. Arbitrary scripts/plug-ins and unrelated expansion remain deferred.
