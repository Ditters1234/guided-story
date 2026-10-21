# Workflow-oriented UI pass

October 21, 2026. This follows the [completed five-phase workflow milestone](NODE_WORKFLOW_PHASE_FIVE_COMPLETE.md) and the earlier [overall UI pass](UI_IMPROVEMENTS.md). The existing application and workflow engine remain the foundation.

## Implemented

- **Navigation follows the writing cycle.** Library, Read, World map, Prepare scene and Workflows lead the header. Contents, recap, records, background, pins and image collections sit together under Story resources. Supporting editors remain directly reachable, with their existing dirty/busy guards and accessible current-page state.
- **Reader entry points.** Passage actions identify the latest or historical position and jump directly to the next-passage workspace or checkpoint/fork tools. Historical reading explains how to branch from its checkpoint and distinguishes current notebook facts. Jump targets accept keyboard focus. Continuation direction, scene brief, ending and workflow selection share a visually marked workspace.
- **Customize from the passage.** Opening, continuation and rewrite selectors can open an independent draft from the default or selected workflow, already bound to the saved setup/story. Existing preset revisions remain intact. The draft editor can return to its bound source; saving and returning never automatically selects a new preset. Reader/setup edits still require the existing discard confirmation, and browser-saved continuation direction survives the round trip. Failed or stale selected-preset refreshes keep the selection and disable customization until resolved.
- **Graph-first preset editing.** The grouped canvas opens by default. On wide screens its selected-node configuration and port inspector sit alongside it; narrow screens stack them with selection-to-configuration focus. Hide workflow canvas retains the typed/list editor. A searchable, bounded preset library keeps the loaded preset visible through filtering. Source selection, graph editing and validation have a clear sequence, and a jump returns to the save controls. Connection replacement is beside the graph controls; node and edge lists scroll within bounded areas. Archive/restore, independent copies, historical revisions and portable JSON stay available.
- **Contextual history.** Workflow history pairs inspection/recovery with an authoring entry point and return to the active story. The source filter uses story identity, rather than title, and reports loaded-run counts. Search/filter no-match states have a reset action. Filtering leaves the selected inspector and its recovery guidance open; Load older runs still exposes earlier pages.
- **Production appearance fix.** Explicit Light/Dark now uses stylesheet theme rules. The prior inline color-scheme changed form controls while compiled palette fallbacks could stay light. Browser assertions check actual background colors for explicit Dark, explicit Light against a dark system, and Automatic against the system. Selected canvas connections use the theme accent.
- **Help reflects the new flow.** It describes customization, explicit preset selection, source returns, default canvas, typed alternatives, story filtering and passage shortcuts.

## Verification

**508 automated tests pass**, Svelte/type checking reports **zero errors and warnings**, and the production build succeeds with the existing nonblocking bundle-size advisory.

**15 isolated production browser suites pass:**

| Coverage | Suites |
| --- | --- |
| New navigation/customization journey, source returns, independent copies, explicit selection, direction retention, draft/failure guards, source-identity filtering, preset search, 320/390px layouts, appearance and coarse-pointer touch | `workflow-ui-smoke` |
| Graph/list authoring, connections, focus, source references, model routing, lifecycle, revisions and recovery | `workflow-authoring-smoke`, `workflow-presets-smoke`, `workflow-preset-execution-smoke`, `workflow-inspection-smoke` |
| Historical checkpoint inspection, independent forks, reused workflows, persistence and guarded acceptance | `passage-checkpoints-smoke`, `passage-recovery-smoke` |
| Main navigation, older editor entry points, large setup/record collections, media, settings and map | `ui-navigation-smoke`, `ui-coverage-smoke`, `setup-records-ui-smoke`, `ui-media-settings-smoke`, `world-map-smoke` |
| Opening/continuation/rewrite, reader actions, scene direction and cancellation | `story-smoke`, `reader-actions-smoke`, `director-smoke` |

The [new browser suite](../scripts/workflow-ui-smoke.mjs) uses imported synthetic stories, a saved setup and controlled history-list responses, including distinct sources with the same title. It verifies unchanged saved story/setup data and zero provider jobs for UI authoring. Other suites exercise real run history and controlled provider execution/recovery. Desktop, narrow-screen, dark-mode and touch screenshots were visually inspected; outputs/logs stay in ignored `test-results/`.

## Preserved boundaries

No server routes, canonical schemas, source-scoping algorithms, provider budgets or acceptance policies changed. Required checks, explicit saved revisions, immutable checkpoints, source freshness and atomic save/recovery remain in force. No installed stories/settings, historical investigation fixtures or release ZIPs were replaced. This pass improves access and layout; it makes no new live-model quality or generation-speed claim. Physical-device and additional-browser validation, route-level loading and broader lineage browsing remain possible follow-ups.
