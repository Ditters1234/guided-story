# Node workflows phase 5 — editable built-ins and presets

October 21, 2026. **Passes 1–2 are implemented; phase 5 remains in progress.** The user requested multiple passes. This document records pass-1 authoring/persistence; [pass 2](NODE_WORKFLOW_PHASE_FIVE_PASS_TWO.md) now enables compiled saved presets through explicit passage selectors.

## Implemented in pass 1

Open **Workflows → Edit workflow presets**. Start from the opening, continuation or latest-rewrite default graph. Add/remove supported built-in nodes, inspect their ports/invocation rules, select node bindings and connect compatible output/input ports. Connections can be removed explicitly. The keyboard-accessible list editor works without a canvas. Semantic errors remain visible while editing: missing required ports/stages, incompatible types, duplicate wiring/IDs, unknown built-ins, cycles, source-mode mismatches and the one-repair limit. A structurally shaped but incomplete graph can be saved as a draft.

Source bindings choose an existing story/setup or remain explicitly unbound. The current model reference is the configured text profile in Settings; no provider URL, credential field or automatic fallback is added. Missing/deleted sources and unavailable model references are labeled. These are authoring diagnostics and availability snapshots, not runtime authorization. Source/model availability must be checked again at execution time.

Save draft and Reload saved preset use separate SQLite records. Every successful save gets an immutable preset revision and a matching unique workflow ID/version; previous snapshots and request receipts remain in independent tables. Expected revisions reject another-window overwrites. Identical requests replay the original result without creating another preset/version; changed payloads cannot reuse a request ID. The library currently holds up to 100 drafts. Previous snapshots are stored but revision browsing/restoration and deletion controls are not implemented in this pass.

Import/export uses strict version-1 preset JSON. Unknown schema fields, copied canon, scripts, layout and credential fields are refused. Portable definitions detach source IDs and unavailable model references; only the known configured-text connection reference is retained. Import creates an unsaved draft and does not overwrite an existing preset. Unknown node types can remain as diagnosed invalid drafts; prototype names are treated as unsupported types rather than registry entries. Node descriptors contain no provider credentials or copied story data.

Search/selection in run history remains separate from draft authoring. Global navigation/unload and new/open/reload/import operations guard unsaved preset edits. Failed reads/saves/imports preserve the current draft. Preset creation is lazy: ordinary repository use does not create these tables until the preset library is used. Story/setup archives and canonical revisions do not include preset state.

## Pass-1 execution boundary — historical

**Pass 1 did not enable draft execution.** Its normal generation path used `defaultStoryWorkflow`, with the matching-default-only raw graph gate. Pass 2 retains that gate for raw overrides and adds a separate trusted saved-preset compiler and binding path. Existing final validation, one bounded repair, source serialization, provider/context budgets, retained prose and atomic save/recovery remain authoritative.

Pass 1 did not complete the phase-5 acceptance gate. A structurally valid draft is not necessarily executable; pass 2 defines the initial supported subset and resolves its source/model inputs. Editable canvas positioning/groups, richer model settings, explicit record/context source configuration and broader check branches remain future passes.

## Verification

**466 automated tests pass**, with zero Svelte errors/warnings and a successful production build. The existing non-blocking bundle-size advisory remains.

Eight new deterministic checks cover default graph/policy preservation and unresolved bindings; portable source/model detachment; strict import boundaries; unique built-in IDs and incident-edge removal; required-stage/type/unknown-node diagnostics; immutable preset revisions and exact request replay; stale/reused-request/schema rollback; and unchanged canon, story archive contents and empty run history after saving an incomplete draft. Existing default-runner parity, provider budgets, recovery, scoping and atomic mutation tests also pass.

Six isolated production browser suites pass:

- `workflow-presets-smoke`: add/remove/reconnect, required-port errors, incomplete-draft saving, independent revisions, another-window save refusal, dirty navigation/reload guards, portable import/export, malformed/unknown-type handling, library loading failure/retry, server restart and 320/390px layouts. Its provider is unreachable; no jobs, runs or canonical changes occur.
- `workflow-inspection-smoke`: existing typed stage inspection, saved-fact/source guards, retained-prose retries, cleanup and narrow-screen recovery.
- `ui-navigation-smoke`: existing author drafts, heading focus, narrow layouts and coarse-pointer navigation.
- `story-smoke`: controlled setup/opening/continuation/replacement, ownership/memory saves, cancellation and restart.
- `passage-recovery-smoke`: effects-only checking, source/history guards, another-window publication and atomic acceptance.
- `world-map-smoke`: existing Brasswater/ranch maps, separate layout, explicit hints, dirty/stale records and setup editors.

One parallel inspector run reached its focus assertion before the asynchronous focus update; its isolated rerun passed without code changes. The new preset suite identified missing accessible select names, which were corrected before its final pass. Desktop/mobile preset screenshots were visually inspected. All browser data/configuration is temporary; normal libraries/settings, historical fixtures and release ZIPs remain untouched. No real-model quality probe was performed.

## Next pass

The compiler/binding pass is now implemented in [pass 2](NODE_WORKFLOW_PHASE_FIVE_PASS_TWO.md), with 482 tests and seven browser suites. Continue with explicit supported source/node configuration and visual authoring while preserving typed/list access, default budgets and atomic recovery. Broader check branches require additional compiler/parity gates before execution.
