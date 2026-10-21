# Workflow phase 2 — continuation runner and durable artifacts

October 21, 2026. **The first phase-2 slice is implemented; phase 2 is not complete.** Continuation can execute through the built-in dependency graph using shared engine operations. Opening/replacement workflow adapters, their parity gates and production entry-point integration remain next. No canvas or editable workflow UI is implemented.

## Implementation boundary

`src/lib/server/story-workflow/` provides:

- `runner.ts`: a serial dependency runner with typed ports, exclusive branch joins, skipped-branch propagation, trusted adapter/output checks, per-node provider ceilings, cancellation checks and durable attempt/output records.
- `adapters.ts`: built-in continuation operations over existing generation, scope, evidence, inventory review, bounded repair, recovery and atomic commit functions. Successful optional reviews produce a labeled not-required report when no model request is needed.
- `store.ts`: full local run definitions, append-only stage attempts, immutable artifact payloads with hashes/dependency provenance, and complete bounded provider request/response bodies including usage when supplied. Request headers, endpoint URLs and private connection objects are excluded. Artifact hashes are checked when read.
- `continuation.ts`: opt-in server entry points for normal continuation, explicit effects-only retry, author acceptance and recovery of a complete persisted content artifact. Only the exact built-in continuation graph is executable in this slice; edited/unknown graphs fail before provider work.

Internal stages were extracted from `story-generation.ts` into shared functions. Existing `generatePassage` and `extractPassageUpdates` remain sequential orchestrators over those functions; normal routes still use `generateRetainedPassage`. Prompt wording, selection, budgets, chapter/pacing rules, viewpoint checks, conditional review and one-repair behavior are preserved by existing regressions and full-wire controlled comparisons. This is a refactor of the existing application, not a second implementation of its prompts or canon rules.

The default graph definition is now **version 2**, with the first executable node implementations at version 1. An explicit `acceptance.review` output retains the exact ready proposal/version for recovered review while the normal `approved` output leads to commit. Workflow/node version fingerprints are recorded on attempts/artifacts; the phase-1 descriptor state remains in Git history.

## Persistence, jobs and atomic boundaries

`StoryRepository.workflows` initializes workflow tables lazily on its existing SQLite connection. Ordinary repository construction and production generation do not create workflow tables. No story/setup JSON migration, second database or archive-format change is required.

The tables are `workflow_runs`, `workflow_attempts`, `workflow_artifacts` and `workflow_provider_io`. A run stores its exact graph and request/source fingerprints. Each artifact has a full JSON payload, payload key, content hash, implementation/workflow versions and dependency IDs. Model request/response capture is separate from diagnostic traces; it does not use scrubbed/truncated job details as execution data. Responses beyond the existing transport limit are marked incomplete, never promoted as usable outputs. There is no generic automatic artifact cache or cross-run replay of model requests.

Existing `runStoryJob` provides the source lock and duplicate-request coalescing. Both legacy generation and the experimental runner use the same `story:<id>` lock. The runner does not introduce a parallel lock system. Conflicting inputs under a request ID fail; a failed/interrupted root request cannot silently narrate again under that ID. Explicit retry uses a new request/action receipt.

Complete normalized prose is retained before extraction, using the current retained-passage repository behavior. Each successful node writes its outputs and completed attempt together. For final saves, optional **internal** repository callbacks join workflow output persistence to the existing canonical transaction: passage/effects/memory, retained-draft state, operation/generation receipts and the final committed artifact either commit together or roll back together. The normal repository callers supply no callback and keep their existing behavior. Author acceptance uses the same boundary. A later failure updating the run summary is reconciled from the durable commit artifact/receipt and cannot report the passage as unsaved.

Workflow tables and their private snapshots/model data are excluded from story/setup ZIPs. This slice does not add run export, deletion/retention controls or normal-data migrations; those remain separate lifecycle work before general exposure. Historical Brasswater/ranch fixture files were not regenerated.

## Explicit recovery and acceptance

- Extraction/preflight/review/provider failures and cancellation preserve completed prose outside canon. Full raw model responses remain local even when JSON/schema checks fail. Incomplete or malformed narration is inspectable but cannot be promoted into a complete passage.
- Explicit effects retry reuses immutable prose and original provenance, reads current saved facts/constraints and submitted guidance, and executes only the downstream extraction/check/repair branch. The existing history, viewpoint, version and repository recovery guards remain authoritative. A retry does not impose narration-length/output-token requirements.
- The retry run reaches `awaiting-acceptance`; its provider job completes and releases the source lock. The exact ready record/version/proposal is an authoritative acceptance artifact. Newer retries supersede older checks. Unsubmitted notes and later saved-fact/history edits still refuse acceptance.
- Explicit acceptance appends a new commit attempt after the previously skipped commit stage, revalidates through `applyRetained`, and saves once under replayed actions. It records the committed output in the same transaction.
- Reopening storage alone does not resume a run or mark other connections' work interrupted. Explicit work under the shared source lock reconciles abandoned run/attempt states. Pending provider requests are labeled unknown/interrupted, without resubmission.
- If a process failed after producing a complete content artifact but before the ordinary retained record was written, `recoverContinuationWorkflowDraft` can promote that checked complete content into a blocked recovery draft without a provider call. An explicit downstream retry is still required. It does not salvage an incomplete stream or automatically repeat an uncertain narration/expansion request.

## Deterministic evidence

The 23 new continuation tests cover:

- Complete provider message/schema/settings parity and equal proposed effects/memory for quiet, expanded, inventory and repaired scenes. The quiet branch uses two calls; the exercised full expansion/review/repair/recheck branch uses six. No new default model stage or larger context window was added.
- Duplicate coalescing, conflicting story-job requests, unknown/invalid graphs and preflight refusal without calls; actual-prose extraction overflow after narration retains the full passage.
- Malformed extraction/narration, cancellation, stale saved facts, pinned final facts, bounded repair and unresolved semantic review; canon remains unchanged on failure.
- Effects-only retries after saved-count correction, released locks during author review, stale/unused guidance refusal, superseded checks and repeat-safe author acceptance.
- Reopening storage with complete artifacts, explicit recovery from interrupted persisted state, promotion of complete content after retention failure, dependency provenance and payload-integrity refusal. The interrupted-state test reconstructs a killed-process database state deterministically; it is not a real-provider restart measurement.
- Injected final-artifact write failures rolling back normal and recovered saves/receipts; summary-status failure after commit returning the saved result without duplicate provider calls.
- Brasswater at the existing 32k budget, with full-wire parity and complete 24-character/170-item reference directories alongside scoped full records. These are deterministic request/selection checks, not model-quality or semantic-completeness claims.

The pre-existing 380 tests continue to cover opening/replacement, canon, inventory, recovery, settings and archive behavior through the legacy path. Production browser suites verify that path after shared-stage extraction; they do not establish opening/replacement execution through the new runner.

Verification: **403 automated tests**, zero Svelte errors/warnings, a successful production build (existing non-blocking chunk-size advisory), and **two isolated production browser suites** (`story-smoke` and `passage-recovery-smoke`). Those suites include opening, continuation, replacement, failure/cancellation/restart, another-window recovery and narrow-screen checks against deterministic mock providers. Initial sandbox browser readiness probes could not reach their temporary servers; both suites passed outside the sandbox using the same ignored temporary data/config directories. No real provider requests, normal library/settings changes or release ZIP rebuild were performed.

## Remaining phase-2 gate

Next implement opening and latest replacement adapters and equivalent durable recovery, including pre-event canon with **current** author constraints, setup publication receipts, replacement/history refusals and cross-window behavior. Then verify post-commit memory maintenance through the intended entry-point integration: it remains outside this passage graph, conditional on existing settings/pending work, and must not convert an already committed passage into a failed generation or resubmit failed maintenance on replay.

Before changing normal generation routes, complete those mode/parity gates and isolated browser coverage for the integrated entry points. Keep the legacy path available. After phase 2 passes, proceed to workflow inspection/supported reruns, followed by the location-first map and editable built-ins; do not start the canvas early.
