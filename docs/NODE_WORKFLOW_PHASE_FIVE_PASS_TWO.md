# Phase 5, pass 2 — compiled preset execution

October 21, 2026. Pass 2 enables a bounded set of saved presets for opening, continuation and latest replacement. Phase 5 remains in progress; editable canvas/groups, richer source/context configuration, multiple model profiles and configurable check branches are not implemented yet.

## Supported execution

Create/edit a preset under **Workflows → Edit workflow presets**, bind it to a saved setup/story and save it. The editor now distinguishes general graph validation from execution eligibility. Passage forms expose **Opening workflow**, **Continuation workflow** and **Rewrite workflow**. Default workflow is the initial choice. Nothing changes the normal path until the author explicitly selects a saved preset revision.

The first executable subset retains every existing non-model stage with its built-in ID/version and every non-model connection. It preserves context preflight, conditional short-prose expansion, retained prose, extraction, deterministic validation, targeted inventory review, one repair, revalidation/review, acceptance and final atomic commit. One to eight connected model nodes may route the existing model inputs. Node/edge array order and source/model binding names can vary. Each model reference currently resolves to the app's single configured text profile; separate model nodes do not yet select different underlying models.

Required stages, check/repair/save edges, policy literals, port types, unique inputs/IDs, source kind and bounded cycles remain mandatory. Renamed/extra provider stages, disconnected checks, unused models/bindings and unavailable model references are refused. Those definitions can remain saved author drafts but cannot run. Stage/node IDs stay stable for retained artifacts and recovery. This is a deliberate bounded subset rather than a general graph interpreter or arbitrary script/plugin interface.

## Server trust and bindings

Clients submit only a strict `{id, revision}` preset reference through the existing passage endpoints. They cannot submit a graph or private provider settings through that reference. The server loads the immutable saved version and compiles it against the supported subset. A new operation requires the latest preset revision, a source binding matching the route's saved source and passage mode, the expected current source revision and a configured text model. Checks run before new provider work and repeat inside the source job lock. Explicit preset selection uses the workflow runner even when the environment's normal default is legacy; an existing legacy request ID cannot be repurposed.

Preparation consumes the resolved source artifact and verifies its ID/revision. Each model node resolves its declared configured-text binding. Provider stages verify that their model input matches the resolved public configuration snapshot before using the server-held connection. Artifacts omit API keys and provider URLs as before; configuration fingerprints and exact node input artifact references retain provenance.

The saved workflow ID/version, complete definition and binding routes remain attached to the run. Preset revisions are read immutably; editing the latest draft does not change an in-flight run. A completed request replays its original result after preset/source revisions change without making another call. New stale requests are refused. Requests without a preset retain their previous input/fingerprint shape, default graph and legacy replay behavior. The raw internal graph override still accepts only the matching built-in default.

Selectors list only presets bound to their current source/mode, disable unsupported drafts and preserve an unavailable selected revision visibly. A refresh failure blocks selected-preset generation; choosing Default workflow remains possible. Refresh never silently selects a newer preset version. Source/model/preset checks on the server remain authoritative if another window changes things after the selector loaded. Choices are session controls rather than a new saved global default or story setting.

## Recovery and inspection

Effects-only retries retrieve the original run's pinned preset definition, rather than the latest author draft. They retain prose and rerun extraction/checks using current saved facts and configured settings. Later edits that make the current preset invalid cannot strand an already retained passage. Cancellation, restart, repeated checks, source/history freshness, superseded proposals and explicit atomic acceptance keep existing rules. A retry cannot substitute a supplied raw graph.

The inspector displays the exact definition ID/version. A supported preset version is not mislabeled as a historical implementation merely because its preset revision differs from the default graph version. Additional model nodes have separate positions in the read-only diagram and remain selectable alongside the source/stage cards. Provider input/output inspection, local-history cleanup, complete-content recovery and canonical acceptance still use existing paths and guards.

## Verification

**482 automated tests pass**, with zero Svelte errors/warnings and a successful production build. The existing non-blocking bundle-size advisory remains.

Sixteen new deterministic tests cover compiler topology/model-routing limits; twelve full-wire comparisons for opening/continuation/replacement with quiet, expanded, inventory and repaired responses; graph/version/model-input provenance without credentials; invalid/missing/unbound/cross-source/stale/no-model refusals without provider work; immutable replay after preset edits; and retained-prose retries across preset edits with exactly-once acceptance. The existing default parity, context scoping, pins/evidence/ownership, atomic save and recovery suites also pass.

Seven isolated production browser suites pass: `workflow-preset-execution-smoke`, `workflow-presets-smoke`, `workflow-inspection-smoke`, `story-smoke`, `passage-recovery-smoke`, `world-map-smoke` and `ui-navigation-smoke`.

The new execution suite selects presets through all three normal forms, rejects stale preset/source revisions before narration, checks unsupported options and failed selector refresh, replays an opening after a preset edit, cancels/repeats effects-only checks, restarts the server and accepts the pinned proposal after the latest preset becomes invalid. It then rewrites with a preset and continues with the unchanged default. It makes **4 controlled narrations, 6 extraction requests and 0 reviews**; retries never narrate. Inventory review and one-repair wire parity are covered by the deterministic cases and existing controlled suites. The browser assertion for an unsupported option uses the native `option.disabled` property; the initial accessibility-based query did not report it accurately. Historical fixture files were read without rewriting them.

Desktop/mobile selector screenshots were visually inspected. Browser data/settings/providers are temporary; no real-provider quality probe, normal library/settings modification or release ZIP rebuild was performed. These are deterministic and browser results, separate from live-model quality evidence.

## Next pass

Continue phase 5 with explicit supported node/source configuration and a clearer visual authoring workflow, preserving typed/list access. Map-to-workflow record selections must remain separate bounded author actions and must not grant knowledge/presence or send the visible map to a model. Introduce additional model choices only through explicit server-resolved profile/settings contracts; no automatic fallback or call-budget increase. Canvas layout/groups and preset revision/lifecycle controls can follow without changing canon. Configurable checks/branches require their own trusted compiler cases and controlled failure/recovery tests before execution eligibility expands.
