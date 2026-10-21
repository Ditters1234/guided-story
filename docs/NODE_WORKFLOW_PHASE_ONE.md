# Story workflow phase 1 — contracts and preparation

October 21, 2026. Phase 1 adds descriptors and validation inside the existing application. It does not execute a graph, switch production generation, choose a canvas library or migrate saved stories. The [milestone plan](NODE_WORKFLOWS.md) remains the delivery sequence.

## Source checkpoint and Git hygiene

The existing application is checkpointed in commit `fb8a6cc`, and the phase-1 implementation is `2ae0a4c`. The user subsequently requested GitHub hosting and explicitly selected public visibility: [Ditters1234/guided-story](https://github.com/Ditters1234/guided-story) is linked as `origin`. The initial upload includes the complete audited history and phase 1 on `main`, plus `codex/story-workflow-contracts`. The local `master` branch retains the original baseline checkpoint.

`.gitignore` excludes saved libraries/media, local connection files, imported private workflows, environment files, databases, credential/key files, build/release output, test output, reference checkouts, editor caches and model scratch files. Only the three existing documented fictional fixture directories are allowed under `exports/`; a new personal export directory is ignored by default. Keep personal exports in ignored data/export locations rather than adding them to a fixture directory.

`scripts/git-audit.mjs` checks the **index**, including ZIP entries, for ignored/private paths, unexpected large files, recognizable credential formats and credential values from local connection settings. It prints filenames/reasons, never matching values. Run `npm run git:audit` after staging. The repository-local pre-commit hook runs the same scan when `core.hooksPath` is `.githooks`; a new checkout must enable it with `git config core.hooksPath .githooks` after installing dependencies. Hooks and pattern checks are guardrails, not a guarantee against every possible private-data format. Nothing automatically stages, publishes or pushes changes.

## Module boundary

`src/lib/story-workflow/` contains versioned graph/node/port/binding, layout, run, attempt and artifact metadata contracts; a static registry of trusted built-ins; default graph factories for opening, continuation and replacement; structural validation; and pure reuse/staleness predicates. No module reads settings, opens a repository or calls a provider on import.

`src/lib/server/workflows.ts` continues to mean ComfyUI image workflows. No working engine/editor code was moved to reference. Current production routes, jobs, recovery and commit boundaries remain the owners below.

## Existing operation map

| Descriptor | Required data and result | Existing owner |
| --- | --- | --- |
| `source`, `model` | Revision-guarded source and a configured text connection reference; no provider call | Repository `readPreparationSource`; connections `readPrivateConnections`; route guards |
| `prepare` | Source → working before-state, current author constraints, direction, viewpoint and chapter position | `generatePassage`; `setupStoryBase`; recovery `recoveryBaseline` for retries |
| `preflight` | Prepared state + model → scoped narration messages/schema/budget and extraction feasibility check | `generatePassage`, `openingContext`, `buildStoryContext`, `extractionMessagesFor`, `checkedBudget` |
| `narrate` | Scoped request + resolved model → parsed, viewpoint-validated narration | `generatePassage` / `completeText` |
| `length`, `expand`, `content` | Narration + prepared/request metadata → final complete passage content; one expansion only below the current 60% minimum | `generatePassage`, including pacing/chapter-ending normalization and expanded-result validation |
| `retain` | Final content + original source → durable immutable prose and recovery identity **before extraction** | `generateRetainedPassage` callback → repository `retainPassage` |
| `extraction-preflight`, `extract` | Retained prose + working state/pins/model → actual-passage scope/evidence directory, wire budget and raw proposed effects/memory | `extractPassageUpdates`, `extractionContext`, `evidenceSources`, `checkedBudget` |
| `validate` | Raw proposal + prose/baseline → evidence-resolved structurally applicable candidate or repair issues | `resolveEffectEvidence`, `applyStoryEffects`, inside `extractPassageUpdates` |
| `review` | Candidate + baseline/prose/memory + trigger metadata → checked proposal or repair issues | `needsInventoryReview`, `reviewInventory`, inside `extractPassageUpdates` |
| `repair-input`, `repair` | Structural OR semantic issues + original extraction request/response + model → one complete repaired effects/memory response | `extractPassageUpdates` |
| `revalidate`, `rereview` | Repaired response + original prose/baseline/trigger provenance → checked proposal or unresolved result; no second repair edge | `extractPassageUpdates`; preserve sticky `inventoryReviewRequired` behavior |
| `acceptance`, `commit` | Complete checked proposal + current source/request → normal validated save OR explicit recovered review, then full atomic validation/save | Routes and repository `commitOpening`, `commitGeneratedPassage`, `applyRetained`; `prepareOpening`, `preparePassageCommit` |
| `blocked` | Unresolved issues + retained prose → readable recovery draft | `generateRetainedPassage`/`retryRetainedPassage` catch paths → `blockRetained` |

These are **descriptors of boundaries to extract**, not callable adapters. Some operations are private/local functions inside `story-generation.ts`; tests and the registry identify their enclosing exported owner rather than pretending they are independent services.

## Mode differences and surrounding work

| Mode | Before-state, constraints and commit |
| --- | --- |
| Opening | Validate approved setup; derive story base; use opening scope and first-chapter rules. Source revision belongs to the setup. `commitOpening` publishes the story and setup receipt atomically. Another-window publication still resolves through existing recovery/source guards. |
| Continuation | Clone current story; use current canon and constraints, scoped recent history and chapter position. `commitGeneratedPassage` checks the original revision and commits one new passage. |
| Latest replacement | Capture **current** author pins first, then restore pre-event canon/lore links and remove the latest passage from the working history. Keep its passage identity/chapter; validate against today's constraints. Invalid/manual-changed replacement baselines remain refused. |
| Explicit effects retry | Reuse immutable retained prose; reread saved facts, constraints and submitted guidance; re-extract/recheck without narration. Invalidate older proposals/checks. History/baseline changes, missing viewpoint or a published setup still use existing repository refusal/recovery rules. |

Route request parsing, revision checks, per-story/setup job serialization, request fingerprints, replay receipts, cancellation and HTTP error handling stay outside the descriptive DAG for now. A future runner must preserve them rather than adding a second lock/receipt system accidentally.

`maintainMemoryAfterPassage` is also outside the passage DAG: it runs **after successful commit**, only when existing automatic-compaction settings and pending chapter work require it. It has a separate job/request identity and budget. Its failure cannot make a committed passage appear unsaved; route replay cannot silently retry failed maintenance. Passage-generated memory remains part of extraction and atomic passage save. This distinction must be included in phase-2 parity tests.

## Graph and artifact semantics

- Edges connect typed output/input ports. Ordinary inputs accept one connection. An `alternatives` input is an exclusive branch join: exactly one candidate may be produced; other branches must settle as skipped. It does not combine effects or wait for both branches to produce values. Multi-candidate output is an execution error in the future runner.
- `length` emits ready content OR a short draft. `validate` emits a candidate OR repair issues. `review` emits checked content OR repair issues. After repair, failures emit blocked results. The DAG unrolls the single repair, so ordinary dependency cycles are invalid.
- The review descriptor always resolves a valid candidate. Its `inventory-trigger` condition governs **whether it makes a model request**: an untriggered review passes through with an explicit not-required check report, rather than leaving acceptance without an output. The same applies to rereview; sticky review-trigger metadata survives a repair.
- A port describes a stage envelope, not permission to strip provenance. Prepared inputs retain original source/revision, working canon, current pins, direction and chapter/viewpoint requirements. Request artifacts retain full messages, wire schema, exact request settings, budget and selection reasons. Proposal/repair/check envelopes retain the raw response, parsed effects/memory, issues and trigger history. Complete content/proposal payloads must validate with existing `passageContentSchema`/`passageProposalSchema`; an artifact type label alone is not payload validation.
- The artifact schema is the **metadata/reference envelope**, not an implementation of payload persistence. Each record identifies its run, node attempt, output port/type, versions, original source, dependency artifact IDs, input/configuration/content fingerprints and an opaque key for the complete immutable payload. Phase-2 adapters must validate each stage's payload before storage/reuse. Scrubbed/truncated job details or diagnostics cannot satisfy a payload reference.
- Input fingerprints include relevant saved facts/history/constraints, submitted guidance, dependency payload hashes and implementation versions. Configuration fingerprints identify relevant model/prompt/budget settings, excluding credentials. Connection references resolve only on the server. A matching model result is a retained attempt result, never authorization for a new request or a claim that the model is deterministic.
- Saved-fact/constraint edits stale checked proposals. Explicit effects retry may retain prose with its original provenance while using new facts; it must produce new downstream attempts/artifacts. History or replacement-baseline changes retain current refusal rules. Pure contract predicates are necessary checks, not substitutes for repository guards, viewpoint checks, receipts or full final validation.
- Normal generation keeps today's acceptance policy. Recovered proposals require author review and checks against the current source and submitted guidance. Waiting for acceptance releases the active provider job and source lock. Repeated requests/acceptance use durable receipts; cancellation/restart never silently resubmit a model call.
- Provider ceilings per passage attempt are one narration, optional one expansion, one extraction, conditional one review, optional one repair and conditional one rereview. The quiet fixture uses two calls; the full conditional fixture uses six and then blocks. This is a characterization of those controlled branches, not a new default call allowance. Existing independent provider transport behavior and optional post-commit memory work stay unchanged.

## Storage decision before persistence

Version workflow definitions, layout and execution records independently of the canonical story/setup schemas. Built-in definitions are currently source-controlled factories; future authored definitions/layouts should use separate local repository tables. Future runs/attempts/immutable payloads should use separate local tables alongside existing recovery records, with transactional artifact writes and explicit receipt/retention rules. No parallel database, story-schema migration or new table is created in phase 1.

Canonical stories and existing archives remain unchanged. Workflow runs/payloads contain private source snapshots and request data and stay local; they do not enter story/setup ZIPs. Exporting a workflow definition eventually exports portable definitions and binding references only, with missing bindings reported. Portable run export and cleanup/retention policy require a later explicit design. Do not delete current retained drafts when adding these records.

## Verification and next gate

Verification on October 21: **380 automated tests pass** (366 existing plus 14 Git/workflow checks), Svelte check reports **zero errors/warnings**, and the production build succeeds. The build retains the existing non-blocking large-chunk advisory. The first sandbox run hit temporary-file rename permission errors; rerunning with `TEMP`/`TMP` under ignored `test-results/tmp` passes the complete suite without application changes to work around the sandbox. Test logs remain ignored. No live providers, new browser suites, normal libraries/settings or release ZIP generation were used in this slice.

The phase-1 tests structurally validate all three default graphs, reject invalid ports/bindings/duplicate wiring/cycles/extra repair nodes, verify owner mappings, and exercise source/input/configuration staleness and recovered-review contracts. Controlled existing-engine characterization covers opening/continuation/replacement order and commit replay, one length expansion, preflight refusal before calls, retained prose on malformed extraction, and the full six-call conditional branch ending in a failed recheck.

These tests do **not** prove executable-runner equivalence. The runner, payload adapters/persistence, restart/deduplication mechanics, workflow UI/map and editable presets remain future phases. Phase 2 begins with continuation adapters and controlled parity, then opening/replacement, before changing any production entry point. Preserve the Brasswater/ranch snapshots and use current audits separately; no live-model quality claim follows from these tests.
