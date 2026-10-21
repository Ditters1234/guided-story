# Workflow phase 3 — inspection, supported recovery and local history

October 21, 2026. **Phase 3 is implemented.** Open **Workflows** in the workspace navigation. New passage runs can be inspected through a read-only dependency diagram and a matching keyboard-accessible stage list. Existing reading/setup/record editors remain available. The next implementation phase is the location-first world map; graph editing and arbitrary node execution remain deferred.

## What is visible

Workflow history lists recent opening, continuation and latest-rewrite runs with source title, status, time and provider-call count. Search filters the loaded pages; Load older runs pages backward without loading model bodies. The selected run is remembered locally in the browser. Removing detailed history is explicitly labeled rather than presented as zero historical model work.

The saved definition supplies the diagram and typed connection list. Each stage shows its recorded attempt(s), implementation version, skipped/not-reached/interrupted state, and relevant conditional outcome. A completed deterministic stage that reports unresolved issues is labeled blocked/repair-needed without rewriting its durable attempt record. Model operations and deterministic stages remain distinguishable.

The node inspector loads one attempt at a time. It exposes:

- Resolved input and output payloads, typed ports, parent run/artifact IDs, source revision, version/configuration/input fingerprints and content hashes.
- Sent messages, supported request settings, complete returned transport bodies or explicit incomplete/unknown status, actual provider usage when supplied, and separately labeled input estimates/output ceilings. Estimates exclude configured connection overhead; the existing context report retains its own budget accounting.
- Narration context selection reports and records found in the actual structured request. Scoped records, compact directory references and reference-only people are labeled separately. The full prepared canon is not misreported as prompt inclusion. Inclusion never establishes physical presence, access, viewpoint knowledge or a completed event.
- Deterministic validation and model consistency checks, issue reports, preserved prose and copy controls. Schema-valid output or a model check is not proof of semantic completeness.

Reading history does not call a provider, resume a job, promote prose, change canon or mark another connection interrupted. Interrupted status can be derived from a stopped job for display while the underlying historical records remain unchanged. Displayed payloads are credential-redacted copies; full bounded arrays/messages are preserved for inspection rather than using diagnostic truncation as execution data. Stored artifact hashes still validate against the original immutable payloads.

## Freshness and supported actions

Run inspection compares the original source with the current saved source and explains changed facts, history, replacement baseline, author constraints, revision, implementation and model/request settings. A completed run remains a historical result; a settings change does not silently repeat its model requests. A recovered review is separately labeled superseded if a newer check or draft version has replaced it, even when the saved world source still matches.

Supported recovery uses the existing phase-2 operations and the same source job lock:

1. If complete normalized prose survived before ordinary retention, Recover complete stored prose explicitly promotes it into a blocked retained draft without a model call. Partial/raw narration cannot be promoted.
2. Open current setup/story editors to correct saved facts. Inspection alone makes no source change. Existing record editors, explicit saves and unsaved-edit guards remain authoritative.
3. Retry world updates explicitly reuses immutable retained prose, builds current scoped extraction/check inputs and permits one bounded repair. Narration and short-prose expansion do not rerun. Changed history, removed viewpoints and invalid latest-rewrite baselines preserve their refusal rules.
4. Review the complete checked updates/memory, then Save recovered passage through the existing atomic/versioned acceptance path. Unsubmitted guidance, a newer retry or later saved edits prevent acceptance of older checks.

The inspector embeds the existing retained-passage controls and refreshes stage history after a settled check. Its parent-stage provenance links make the retained origin inspectable across retry runs. Generic arbitrary-node replay, automatic model caching, manual prose rebasing and editable graphs are not added.

Loading/failure guards disable mutation controls while the current run/source is unconfirmed. Separate request sequences prevent a slower previous node response from replacing the latest selected inspector. Rechecking guidance participates in navigation and unload guards. Keyboard/list operation, heading focus and 320/390px layouts work without opening the diagram. Another-window opening publication is explained and opens the saved story instead of proposing a second publication.

## Local history lifecycle

Detailed snapshots, stage payloads and provider bodies remain on this computer until explicitly removed. They are excluded from canonical story/setup ZIPs and Git. Portable run export and automatic time-based retention are not introduced.

Remove stored details asks for confirmation and deletes a run’s attempts/artifact payloads/provider bodies in one SQLite transaction. It keeps a minimal run definition/source identity/request fingerprint/status receipt plus a removal timestamp. Thus cleaning history cannot authorize a second narration or duplicate passage under the old request ID. Source canon, passage text and operation receipts are unaffected.

Removal is refused while source work is active or a cancelled provider promise is still unwinding, while an open retained passage needs the source’s history, or while a later run references the artifacts. Remove dependent runs first after recovery/discard. An older superseded awaiting-review run becomes removable once the retained draft has actually been saved/discarded; its historical status alone cannot lock cleanup forever.

Confirmed Library deletion also removes all detailed workflow history for that source inside the existing source-deletion transaction. It does not leave a deleted story’s full canon/prose copies in workflow artifacts. The minimal history/removal receipts remain, and a cleanup write failure rolls back both source deletion and history cleanup. Existing shared image-file retention behavior is unchanged. Ordinary repository construction and deletion without workflow tables do not initialize workflow storage.

`workflow_history_removals` is a lazy table alongside the phase-2 tables on the existing repository connection. Story/setup JSON formats and archive formats do not change.

## Implementation entry points

- `src/lib/WorkflowPanel.svelte`, `WorkflowGraph.svelte`: workspace history, accessible diagram/list, node inspector and existing recovery integration.
- `src/lib/server/story-workflow/inspection.ts`: read-only display views, freshness/provenance, supported-action availability and guarded cleanup.
- `src/lib/server/story-workflow/store.ts`: bounded metadata pages, per-attempt body reads, dependency checks and transactional detail removal.
- `/api/story-workflows`: paged run metadata; `/api/story-workflows/[runId]`: inspection/detail removal; `/nodes/[nodeId]`: one recorded attempt; `/recover`: explicit complete-prose recovery. These are separate from the existing ComfyUI `/api/workflows` service.
- Existing recovery HTTP routes still perform retry and acceptance; there is no client-supplied proposal or unchecked node execution endpoint.

## Verification

**449 automated tests pass**, with zero Svelte errors/warnings, a successful production build and **four isolated production browser suites**: `workflow-inspection-smoke`, `story-smoke`, `passage-recovery-smoke` and `ui-navigation-smoke`. The existing non-blocking bundle-size advisory remains.

The 16 additional deterministic tests cover metadata pagination, exact typed/provider provenance, display-only secret redaction with complete bounded structures, sugar-cube diagnostics and current-fact retry, superseded reviews, attempt ownership, detail-removal tombstones and committed/failed replay, open-draft/dependency/active-work protections, cancelled promises still stopping, complete-content promotion, current model-setting explanations, reopened interrupted state and atomic source/history deletion rollback.

The new browser suite uses a controlled local provider and isolated data. It follows a failed opening through visible deterministic issues, editor correction, effects-only checks, cancellation, superseded proposals, unused-guidance guards, loading failure/reload, another-window publication, cleanup, server restart and exact-once replay. It also tests a delayed old node response, keyboard stage selection, diagram/list access and 320/390px overflow. Only one narration is performed throughout the new suite. Its first iterations caught a test route-interception cleanup error, a transient cancellation-message expectation and the historical awaiting-review cleanup guard; the final suite passes.

The existing story/recovery suites retain opening, continuation, replacement, atomic updates, failure/cancellation/restart and narrow-screen coverage. Navigation coverage checks existing search/draft/keyboard behavior, 13 routes at 320/390px and ten routes with touch emulation. Screenshots of the new desktop and mobile inspectors were visually checked. Browser runs use temporary databases/settings outside this Windows sandbox so readiness probes can reach the temporary servers.

Default provider-call/context budgets, deterministic selection, pins/evidence/ownership/reference checks and atomic recovery remain unchanged. No real-provider generations, normal library/settings changes, historical fixture rewrites or release ZIP rebuilds were performed. This is deterministic/browser workflow verification, not new live-model quality evidence.

## Next phase

Start phase 4 with collapsed root locations, explicit containment/presence/storage links, scene focus/search and existing editors. Layout changes must not become physical moves. Preserve author draft guards and deterministic model scope. Editable workflow nodes/presets remain phase 5.
