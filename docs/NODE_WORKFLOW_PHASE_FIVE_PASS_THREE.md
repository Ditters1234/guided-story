# Phase 5, pass 3: passage workflows and independent story forks

Historical checkpoint: Phase 5 is now complete. See the [final acceptance gates and evidence](NODE_WORKFLOW_PHASE_FIVE_COMPLETE.md); the next-pass notes below record the state at this earlier pass.

October 21, 2026. The user redirected this pass toward workflow metadata attached to each scene, comparable to an image carrying its Comfy workflow, and explicitly requested loading a past passage as a new story. The durable narrative unit in this app is a passage. This pass checkpoints accepted passages; grouping several passages into a separately editable scene is still future design.

## Implemented behavior

Each newly accepted opening, continuation, latest-event replacement or recovered passage saves an immutable checkpoint inside the same SQLite transaction as the authoritative world, operation receipt and workflow commit artifact. A failure in any part rolls everything back. Failed/unaccepted prose remains in the existing recovery system and cannot become a fork checkpoint.

The checkpoint contains the exact accepted prose/history prefix, post-passage world, latest replacement baseline, author preferences and pins, background, viewpoint knowledge, memories, summaries and media metadata available at that save. It is an historical snapshot, not a claim that model omission establishes knowledge. Later world edits, narration, title/wording edits and memory maintenance cannot alter it. The reader identifies a prose/title difference and uses the original checkpoint when forking. A latest-event replacement updates that passage's current checkpoint; this first pass does not offer a browser for superseded alternatives.

Node-driven passages record both the original narration workflow and the workflow that checked the accepted world updates. Effects-only recovery can therefore preserve distinct run/configuration provenance. Definitions are pinned independently of saved preset revisions and local detailed workflow-history cleanup. Model metadata uses an allowlist of nonsecret text settings, with configuration/source fingerprints and configured connection references. Provider addresses, API keys, raw prompt messages, provider responses and detailed execution artifacts are excluded from this portable workflow metadata. Author-entered story/background text remains ordinary story content.

Reader → **Passage checkpoint & fork** loads metadata on demand. **Start new story from this passage** creates and opens a new library entry at that checkpoint, with a new story ID/revision and a lineage receipt. The original story remains independent. Only the chosen historical prefix and its checkpoints are copied; later facts, summaries, media, drafts and operation receipts are excluded. Loading/forking performs zero provider calls. Source revision/checkpoint guards, source-idle checks, atomic copying and idempotent request IDs protect stale windows and uncertain responses. Deleting the original story does not delete a fork.

**Download workflow preset** creates portable preset JSON with source bindings detached. **Edit workflow for this story** opens an unsaved continuation preset in the existing editor, retaining its model routing while adapting the passage mode/source binding. It requires an explicit save and later selection. A fork does not silently change global settings or select a new preset. Recorded model values are provenance; new runs resolve the current configured text profile and retain all compiler, current-source, validation, bounded repair and atomic acceptance gates.

## Storage, portability and efficiency

The SQLite checkpoint store is separate from the ordinary story response and every narration/extraction context. Content hashes share identical workflow definitions, unchanged top-level state values and linked history prefixes within a story. A new passage stores its own text and links to the existing prefix rather than duplicating all preceding prose. Forks own independent copies of the reachable objects, so source deletion cannot invalidate them. Unreachable replaced-checkpoint objects may remain locally until story deletion; a dedicated compaction control is deferred.

Story ZIP exports now include optional version-1 `passage-checkpoints.json`, with only reachable objects. Media originals referenced by historical checkpoints travel even if removed from the current gallery. Existing ZIPs without checkpoints still import. Imports validate checksums, strict metadata shapes, complete history chains, every checkpoint's world/reference invariants, referenced media and unexpected/unreferenced objects before inserting a library entry. Story insertion and checkpoint copying are atomic. Limits remain 10 MB for `story.json`, 110 MB of exported media and 128 MB total archive expansion; checkpoint metadata has a separate 32 MB expanded limit. An export refuses over-limit data rather than silently dropping checkpoints. Older versions of the app reject the additional ZIP entry; they need updating to open these new backups.

Historical passages that predate this feature have no trustworthy saved post-passage world/context snapshot. The UI says so and refuses to infer a fork from today's facts. New accepted passages create checkpoints going forward. Existing author libraries/settings and historical fixtures were not rewritten.

This removes repeated history/graph copies and adds no model requests or context bytes. It is not a measured generation-speed claim, model-result cache or arbitrary upstream-node replay system. Large-library checkpoint import/compaction and sustained-model latency still need dedicated measurements.

## Verification

- **496 automated tests pass**, including 14 new checkpoint/fork cases. Coverage includes historical world/context restoration, independent continuation, stale/wrong-hash/reused requests, missing legacy state, immutable presets and diagnostic cleanup, title/replacement history, separate narration/recovery provenance, injected canonical/copy failures, restart, source deletion, ZIP round trips, corrupt/dangling/unreferenced/credential-bearing metadata, removed historical images, shared workflow definitions and explicit adapted-preset execution.
- Svelte/type checks: zero errors/warnings. Production build succeeds with the existing nonblocking bundle-size advisory.
- **Eight isolated production browser suites pass**: the new `passage-checkpoints-smoke` plus `workflow-preset-execution-smoke`, `workflow-presets-smoke`, `workflow-inspection-smoke`, `story-smoke`, `passage-recovery-smoke`, `world-map-smoke` and `ui-navigation-smoke`.
- The new browser suite covers retryable checkpoint loading, safe workflow download, past-passage/fork-title navigation guards, independent/idempotent forks, routed workflow adaptation/save/selection/execution, restart and 320/390px access. Inspection/forking makes zero provider calls; explicit continuation makes the original two quiet-path calls. Desktop/mobile screenshots were visually checked. Existing full-wire default/preset parity remains covered.

All providers and stories used for this verification are controlled isolated fixtures. No live-model quality claim, normal-library/settings mutation or release ZIP rebuild is included.

## Next passes

Continue the node milestone with supported source/node configuration and clearer visual authoring, preserving the checkpoint and typed/list foundations. Potential fork follow-ups include clearer lineage browsing, user-managed alternatives, deliberate checkpoint refresh after author edits, deduplication across forks and measured long-history import/compaction. These are separate from the already working action to open a saved past passage as a new story.
