# Guided Story — build roadmap

## Approved next milestone: node-based story workflows

October 21, 2026. [Node-based story workflows](NODE_WORKFLOWS.md) is the official next development milestone, evolving this project rather than starting a new application. The delivery order is contracts/default graph → executable runner with parity/durable artifacts → canvas inspection and supported retries → location-first map/existing editors → editable built-in graphs and presets. Start with the phase-1 contracts and default fixture; preserve current saves, recovery, provider-call budgets and scoping through the parity gate. The milestone is planned, not implemented. The historical numbered roadmap below remains product history.

Current status: October 20, 2026. See [Project status](PROJECT_STATUS.md) for implemented/remaining scope and [Next development slices](NEXT_STEPS.md) for acceptance criteria. The application supports editable generated setups, live chapter development, atomic world updates/latest replacement, source-linked passage/chapter/book memory, reader recaps, story-linked ComfyUI illustrations and shared photobooks. Settings and Dev tools are implemented.

Reader Ask, reviewed wording polish and scene direction are implemented; see [Director/editor tools](DIRECTOR_EDITOR.md). Full manual/AI record editors and library rename/delete/setup discard are also implemented; see [Record editors](RECORD_EDITORS.md). Supported written-story field pins and established world rules now have dedicated controls, required generation context and atomic protection; see [Pinned facts](FACT_PINS.md) for separate verification evidence. Unfinished-setup ZIP portability and stack splitting/nested containers are implemented; see [Setup archives](SETUP_ARCHIVES.md) and [Inventory](INVENTORY.md) for their exact contracts. The next approved delivery milestone is node-based workflows above; sustained story quality remains an evaluation concern and identity-reference image workflows remain optional. Reference-image workflow execution and automatic illustrations remain optional follow-ups.

**Previous priority decision, October 20:** context scoping and token efficiency were made the main sustained workstream. The approved October 21 node milestone above now sets delivery order, carrying these requirements into every phase. Follow [the scoping plan and Brasswater baseline](CONTEXT_SCOPING.md), including narration and full-world effects extraction. The optional illustration upgrades mentioned above are deferred; reference images are not required for the current Krea 2/Sickollie workflow. Favor simple deterministic selection suitable for a roughly 30B local text model, and preserve full canonical validation and continuity.

The numbered milestones below preserve the full product target. Status labels distinguish working slices from remaining features; they are not a claim that every original acceptance criterion has passed. Storage/recovery contracts are documented in [Foundations](FOUNDATIONS.md), memory behavior in [Memory compaction](MEMORY_COMPACTION.md), and illustration behavior in [Illustrations](ILLUSTRATIONS.md).

## 0. Design checkpoint — baseline established

- Review the project outline and confirm the reader-as-director experience.
- Sketch setup, reading, cast/place editors, and scene revision flows.
- Reuse HTML Game's development connections and credentials; identify its active model and select the local persistence approach.
- Inspect reusable Corvus modules in more depth before selecting code to adapt.
- Validate the supplied ComfyUI workflow against the intended running instance when available.

**Ready when:** one example story can be walked through from premise to setup, first scene, direction, state changes, and revision without unresolved behavioral rules.

## 1. Application shell and editable story records — foundation working

- Create the Svelte application and local server boundaries.
- Define stories, cast, places, relationships, assets, and items. Breaking development save changes may reset old saves; do not build migrations or compatibility layers.
- Implement SQLite persistence, autosave acknowledgements, story-library load/reopen, and basic editors. Keep image files separate from database records.
- Prove consistent passage/state transactions, stale-revision rejection, and request deduplication with a fixture before live generation.
- Resume at the latest passage without bookmarks; provide chapter/passage Contents and device-level reading preferences.
- Add portable export/import with validation; do not include credentials.

**Accepted when:** a manually created crew, ship, destinations, outfit, and cargo survive closing/reopening and export/import with references intact.

## 2. Guided setup generation — working across all setup sections

- Connect the LLM through a configurable server-side adapter using HTML Game's active development connection and credentials. Keep secrets out of source control and story exports.
- Generate a structured setup draft from a premise.
- Add per-element edit, remove, accept, and regenerate controls.
- Generate the opening only from the accepted setup.

**Accepted when:** the space-trader example creates a coherent editable cast and small world without creating a player avatar. Regenerating one crew member preserves the rest of the accepted setup.

## 3. Scene storytelling loop — working, including non-advancing Ask

- Implement direction, continuation, and non-advancing question modes.
- Assemble relevant context and generate prose scenes with optional next directions.
- Add Continue reading with no required direction, editable chapter/passage titles, and natural chapter-end pauses.
- Extract and validate scene effects across the cast and world.
- Commit prose and state together with retry and recovery behavior.
- Add turn-linked summaries for longer stories.
- Add an optional cached Story so far recap using incrementally maintained chapter summaries, an earlier-story overview, and recent passages. Track coverage, respect context budgets, and exclude hidden plans and discarded events.
- Supported setup and written-story record/world field pins and established world rules extend appearance/outfit pins. Every pin/rule is required in the relevant setup, narration, Ask, extraction and correction context; an over-budget operation fails instead of omitting constraints. Generated structured field changes are rejected atomically while explicit manual edits remain allowed. Setup pins survive portable drafts and chapter-one publication. See [Pinned facts](FACT_PINS.md).

**Accepted when:** directing the crew to a destination produces a readable scene and consistent location changes. A suggested future betrayal is retained as a possibility, not recorded as a completed event. Asking a question changes no fictional state. Extraction failure leaves prior state intact.

## 4. Revision and continuity — latest replacement, layered memory and reviewed wording polish working

- Add latest-passage event regeneration with state restoration. Do not add cascading undo or branching.
- Support manual fact corrections and distinguish wording-only rewrites from event changes.
- Track sources and invalidate/rebuild derived summaries and memories.
- Invalidate recap caches when their source facts or passages change; verify coverage after latest-passage replacement.
- Enforce latest-passage-only event changes in the server and interface. Earlier passages remain readable through Contents and may receive wording-only edits that preserve established facts.
- Prevent late generation results from overwriting newer edits.

**Accepted when:** regenerating the latest passage that transferred cargo restores the cargo before applying the replacement outcome. Event-changing requests for any earlier passage are refused, including through direct API calls. Wording-only edits preserve its facts and current state. No forks or alternate timelines are created.

## 5. ComfyUI illustration — explicit text-to-image/photobook flow working

- Implement the [generation profile design](GENERATION_PROFILES.md): selectable imported workflows, explicit bindings, template/variable editor, resolved-prompt preview, and per-story/request overrides.
- Add a simple story-level adult-content preference and per-character No NSFW checkbox, both defaulting to nonsexual content. All new/generated characters and imports without a preference have No NSFW checked; adult opt-in is individual and user-controlled. Propagate preferences into narration and image context. Child profiles specify nonsexual treatment. Keep framing/coverage-aware variable selection; do not build scenario classifiers, age-inference systems, or an exhaustive moderation engine. Visual experiments do not mutate canon.
- Map inputs/outputs for a working copy of the supplied workflow.
- Add connection checking, generation status, retries, and output storage.
- Generate portraits and scene images from relevant established facts.
- Allow editable prompts, image history, and replacement selection.
- Add a photobook to each cast profile, with chronological thumbnails, editable captions/character associations, and source-scene navigation. Shared pictures appear in multiple photobooks through references to one image record.
- Add a shared story gallery for all illustrations, including places, ships, and pictures without cast members.
- Separate character identity from outfit and scene direction.

**Accepted when:** a portrait generates using the configured workflow, remains associated with its character, and can be replaced without losing the previous image. A crew picture appears in all tagged cast members' photobooks and links to its source scene. ComfyUI failure does not interrupt story reading or corrupt a scene.

## 6. MVP usability pass — 1.0 release scope implemented

- Refine reading layout, responsive panels, and editor navigation.
- Story-library rename/delete, setup discard and useful empty/error states are implemented. Unfinished-setup ZIP export/import and nested inventory controls are implemented. Further authoring refinements remain follow-ups.
- Walk through several scenes with shifting viewpoints, cast relationships, possessions, and travel.
- Verify reopening, export/import, generation recovery, and revision continuity.

The release adds a production launcher/package, first-use guidance and Help, Markdown novel export, read-only continuity review and expanded acceptance checks. See [1.0 release gate](RELEASE_1_0.md) for exact evidence and limits. Longer-novel quality evaluation continues after release.

**Accepted when:** the reader can start from a premise, review the generated setup, direct an illustrated ongoing story, edit its records, revise a scene, and reopen it later with continuity intact.

## Decisions to revisit after a working prototype

- Whether scene planning needs its own model call.
- Whether automatic images are worth their latency and compute cost.
- Whether retrieval beyond summaries and relevant-entity selection is necessary.
- Which genre-specific attributes improve the experience.
- Whether a richer map is useful next.

Use meaningful integration checks for persistence, state transfers, failure recovery, and revisions. Evaluate narrative quality through representative story walkthroughs rather than tests that merely repeat prompt wording.
