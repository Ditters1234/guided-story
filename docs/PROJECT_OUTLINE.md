# Guided Story — project outline

Design baseline: October 17, 2026. Implementation now includes live setup/narration, chapter pacing, passage/chapter/book memory, illustrations and photobooks. This outline retains broader product targets; [Project status](PROJECT_STATUS.md) distinguishes implemented controls from remaining scope.

Next approved architecture milestone, October 21, 2026: [node-based story workflows](NODE_WORKFLOWS.md), evolving the existing engine with executable built-in graphs and a connected location-first world map. Its phase gates govern new work; the broader/historical outline below remains reference. The runner and canvas are not implemented yet.

## Product intent

The reader supplies a premise, the application proposes a cast and a small world, and an LLM tells an ongoing story. The reader steers what happens next through suggestions, questions, and optional suggested directions. They do not have to embody or directly control a character.

Example premise: “I want a sci-fi story about a rogue space trader and his crew.”

The resulting setup could contain the trader, several crew members, their ship, a few connected destinations, cargo, relationships, and an opening problem. These are illustrative outputs, not mandatory sci-fi mechanics.

## Confirmed requirements

- Svelte web interface.
- API connection for LLM text generation and a ComfyUI connection for graphics.
- Guided creation from a user-supplied story idea.
- Generated cast, world details, and initial points of interest.
- Reading and directing a story rather than controlling one player character.
- User-editable story and world information.
- Use the preferred “Reader & notebook” mockup: story reading and direction on the left, cast/world notebook on the right, with responsive stacking on smaller screens.
- Each cast member has a photobook containing previous story pictures associated with them.
- Event-changing revisions are available only for the most recent passage. The story has one linear history; forks and branching are out of scope.
- Present reading history as a table of contents with editable chapter and passage titles, rather than a numbered scene list.
- Resume at the latest passage in the latest chapter. No separate bookmark feature is needed.
- Include an optional “Story so far” recap, reading preferences, pinned facts, a shared story gallery, a clear Continue reading action, and natural chapter-end pauses.
- Persistent inventories, outfits, and other relevant facts maintained by the application as the LLM develops the story.
- Use Corvus Story Core as a source of reusable components and reference patterns.
- Design stage completed; live LLM/ComfyUI integration, current-record editors and basic library controls are working. See [Project status](PROJECT_STATUS.md) for the remaining scope.
- During development, breaking save-format changes are acceptable. Old saves may be discarded/reset; backward compatibility and migration work are not required.
- Keep LLM connections and generation settings configurable. Use the same development connections and API credentials as `C:\Users\n_tin\Documents\ChatGPT\HTML Game`.
- Support selectable ComfyUI workflows, editable image templates with granular shot-aware variables, editable narrator style, and explicit adult-content preferences. See [Generation profiles](GENERATION_PROFILES.md) for controls, boundaries, and acceptance examples.

## Proposed first-version defaults

- Local, single-user application; one local server serving the browser UI and handling external API requests.
- SvelteKit with TypeScript; no React application embedded in the interface.
- Provider-neutral LLM adapter, initially using HTML Game's Unsloth/OpenAI-compatible connection setup. Match its active development connection, model, and credentials when configuring the application; retain editable settings.
- Narration in third person by default, with editable viewpoint and prose preferences.
- Story advances one scene or substantial scene segment at a time.
- Several stories can be saved independently; only one generation runs at a time within a story.
- Images generate on demand initially. Automatic illustration can be added as an explicit preference.
- No required health bars, combat system, dice, or progression statistics. Genre-specific attributes may be added when useful.
- SQLite local persistence, with image files stored alongside the database. See [Foundation specification](FOUNDATIONS.md) for save/load and transaction behavior. No development save migrations or backward-compatible loaders are required; incompatible saves may be reset.

## New story experience

1. **Premise:** enter the story idea. Optional tone, genre, length, boundaries, and art preferences can refine it without blocking a quick start.
2. **Setup draft:** generate a concise premise expansion, central cast, relationships, initial places and connections, shared assets, and an opening situation.
3. **Review:** edit, add, remove, or regenerate individual elements. Preserve accepted elements when regenerating others.
4. **Opening:** generate the opening using the accepted setup. The reader can accept it, revise its direction, or regenerate it.
5. **Continue:** read, select a suggested direction, type their own direction, or ask the story to continue naturally.

Setup should create enough material to support the opening. New places and characters can appear later; generating an entire universe or a fixed plot is unnecessary.

## Reading and directing

The main view is a comfortable reading surface with scene art, prose, dialogue, and a direction composer. Supporting panels provide the cast, places, possessions, and story threads. Smaller screens use drawers or dedicated views.

Example directions:

- “Have them visit the salvage station.”
- “Focus on the pilot for a while.”
- “Let the captain and engineer argue about the cargo.”
- “Slow down and show daily life aboard the ship.”
- “Maybe the engineer betrays the captain later.”

The last example is a possible future direction, not an event that has happened. Ask about the story now answers without advancing events.

Implemented actions separate **Continue / Direct**, **Ask about the story**, latest-only **Change what happens**, and **Polish wording** with a reviewed preview. Natural language can assist classification, but ambiguous requests should not silently rewrite established events.

Suggested directions should offer meaningfully different developments. They are optional prompts, not exhaustive branches. User directions guide the storyteller without requiring characters to behave implausibly or making every desired outcome automatic.

### Reading, contents, and chapter boundaries

- Open at the latest passage; earlier chapters and passages remain accessible through Contents. Browsing older material does not move the story's continuation point.
- Offer **Continue reading** without requiring a direction. The reader may optionally supply direction or select a suggestion.
- Group passages under editable chapter titles. Suggest chapter breaks at meaningful transitions rather than requiring one chapter per generation. Future chapters remain unwritten and hidden from Contents.
- At chapter ends, offer Continue reading and an optional direction for the next chapter. Avoid forcing a questionnaire between passages.
- Provide device-level font size, reading width, and light/dark appearance preferences separately from fictional story settings.

### Story so far

An optional recap describes established events through the latest committed passage. Opening it must not advance the story or reveal hidden plans, secrets not yet told, or discarded events.

The reader recap currently uses a separate bounded hierarchical chunk pipeline with source-keyed intermediate caching and a final saved coverage fingerprint. Internal generation memory now has source-linked chapter summaries and an earlier-book overview, separately maintained and inspected in Dev. Sharing those layers with reader recaps is a possible later optimization; edited recaps are never narration memory.

Summaries are derived material, not authoritative facts. Record which passages each summary covers, update affected summaries after latest-passage replacement or fact correction, and retain access to original passages for resolving uncertain details. Repeated compression can lose or distort information: give important established facts and active threads structured context, validate entity references where practical, and avoid presenting a recap with missing coverage as complete. A recap is a useful overview, not guaranteed exhaustive memory of a long novel.

### Pinned facts

Readers can pin important character details, relationships and world rules. In addition to appearance/outfit pins, the Pins view and setup's Pins & rules section support field pins for cast, places, items, relationships, threads and world records, plus established reader-visible world rules. See [Pinned facts](FACT_PINS.md) for behavior and verification status. Pins resolve the current saved field value, so explicit manual edits can change it while leaving the pin active. Generated structured updates must not change or remove a pinned field; a violation rejects the complete proposal. All saved pins/rules are required context for targeted setup, opening narration, Ask, extraction and AI corrections. If they cannot fit the context budget, the operation surfaces the constraint instead of silently dropping them. Setup ZIPs and chapter-one publication retain the controls; full cast/world regeneration requires unpinning individual fields first. Rules constrain established facts, not desired future outcomes or hidden plans; semantic prose adherence remains model-limited.

## Three kinds of information

| Kind | Meaning | Example |
| --- | --- | --- |
| Established facts | Accepted setup, manual canon edits, and events committed through accepted scenes | The ship is docked at Halcyon Station. |
| Reader directions | Instructions about what to explore, emphasize, or change | Give the pilot a scene at the station. |
| Future possibilities | Mutable plans, potential twists, and unresolved story threads | Someone at the station may know the pilot's past. |

Only established facts belong in the authoritative world record. A rumor may be established as something a character said without establishing that its contents are true. Characters' beliefs and knowledge can differ from world truth.

Hidden plans and secrets need an optional reveal control in editors so the reader can inspect everything without accidental spoilers while browsing.

## Scene lifecycle

1. Interpret the request as direction, question, continuation, or revision.
2. Load relevant facts, current scene, cast, locations, unresolved threads, recent prose, and summaries within a context budget.
3. Form a short scene plan: purpose, viewpoint, participants, location, likely development, and stopping point. Avoid fixing distant outcomes.
4. Generate scene prose grounded in those facts and the reader's direction.
5. Extract structured proposed changes from what the prose actually establishes, with references to affected entities.
6. Validate references, ownership, quantities, and other consistency rules. Reconcile incompatible prose and updates before finalizing the scene.
7. Commit the scene and validated changes together, retaining a recovery point. Automatic acceptance is a proposed default; every scene need not require an approval click.
8. Offer next directions and queue optional illustrations. Update summaries when needed.

Planning is a responsibility, not necessarily a separate LLM call. Determine call boundaries after checking latency, cost, and model reliability. Corvus's narration-then-extraction loop is a starting point to evaluate.

Streaming prose is a draft until finalization succeeds. If text generation or state extraction fails, keep the prior canonical state intact and show retry/recovery controls. Failed extraction must not silently appear as a fully committed turn.

## Proposed data model

All durable entities have stable application-assigned IDs. Names and descriptions can change without breaking references.

| Record | Responsibilities |
| --- | --- |
| Story | Premise, preferences, current chapter/passage, creation metadata |
| Character | Appearance, personality, background, motives, location, role in the cast, condition, knowledge |
| Relationship | Links two characters; supports direction-specific trust, feelings, history, and secrets |
| Place | Description, parent place, links/routes, occupants, discovered/hidden details |
| Asset | Ships and other notable movable entities with condition, location, and optional interior places |
| Item | Description, quantity, owner/container, location, properties, worn/equipped status |
| Account | Optional funds owned by a character, group, or asset; currency tracked explicitly |
| Group | Crew, faction, household, or other collection with membership and shared assets |
| Thread | Unresolved question, goal, conflict, or possible development; status and relevant entities |
| Scene | Prose, viewpoint, participants, location, direction that prompted it, and generated suggestions |
| Event / change set | Committed facts and entity updates associated with a scene or manual edit |
| Summary | Derived continuity notes tied to source scenes and revision state |
| Image | File reference, associated character IDs and scene, editable caption, prompt, workflow settings, seed, generation status, history |

Ownership and containment must be explicit: a sidearm belongs to a crew member, cargo sits in a ship hold, and a jacket may be worn rather than merely carried. A quantity cannot become negative. Physical item transfers must update source and destination consistently.

Implemented inventory uses `ownerId` for the immediate character, place or container item. A container is a single item marked `isContainer`; nested storage is acyclic, moves with its container and cannot hold equipped items. Explicit stack splitting conserves quantities and assigns the new stack an application ID. General properties, capacity/weight and multiple currency accounts remain broader targets. See [Inventory](INVENTORY.md).

Unfinished premises and reviewed setups now have their own metadata-only ZIP export/import. Imports become independent editable drafts; current edits can be saved before exporting, and published setups use story backups instead. This is separate from written-story/media ZIPs. See [Setup archives](SETUP_ARCHIVES.md).

A ship may move between map points while its interior places move with it. The first map can be a list or simple node-and-link view; a simulated galaxy is outside the initial scope.

## Editing, revisions, and continuity

- Entity profiles support manual editing and targeted generation; manual edits take precedence over generated suggestions.
- Distinguish correcting a fact from asking for an in-story change. Editing a character's hair is not automatically a narrated haircut.
- Generated proposals must not overwrite a manual edit made while generation was running; use version checks.
- **Change what happens:** only available for the latest passage. Restore its pre-passage state and replace its text and changes together. Enforce this restriction on the server, not just in the interface.
- **Rewrite the wording:** may be available on earlier passages, but preserves events, dialogue meaning, ownership, relationships, and other facts. This is a prose edit, not a new state-extraction turn. If a requested rewrite changes events, reject it for an earlier passage and explain the restriction.
- Reading an earlier passage from Contents or a photobook does not make it eligible for event-changing revision. Generating the next passage locks the previous passage's events.
- Summaries, memories, and images retain source references so dependent material can be marked stale or rebuilt.
- Keep one linear story and a recovery point for replacing the latest passage. Do not build branch records, fork navigation, or a cascading history-rewrite system. Do not offer repeated undo as a way to erase later passages and revise earlier events.
- Local save, reopen, and portable export/import are first-version requirements proposed by this outline.

## Graphics and supplied workflow

The supplied `AI/Comfy Workflow/portrait.api.json` is already an API-format graph. A structural inspection found separate UNET, CLIP, and VAE loaders, a model-only LoRA loader, text conditioning, a sampler, and a custom image-saving node. The separate working copy portrait.comfy-desktop.api.json corrects three model loader paths and has passed real portrait/scene generation against the running ComfyUI instance; the original is preserved.

Implemented default input/output bindings:

- Node `4`: positive text prompt.
- Node `6`: width, height, and batch size.
- Node `7`: seed and sampling settings.
- Node `9`: output prefix and output retrieval; custom type `SeeSeeCivitaiSaveImage` is supported by the local installation and passed history/output checks.

Preserve the original workflow. If changes are needed, create a separate application variant with explicit input/output bindings. Check installed models, custom nodes, and output history behavior before deciding whether to replace anything.

Corvus includes a direct ComfyUI HTTP client, but its basic workflow builder differs from this graph. Reuse transport and job-handling ideas where compatible; do not substitute its default graph for the supplied workflow.

Store character identity separately from current outfit, pose, and setting. Seeds and repeated descriptions alone do not guarantee consistent faces; reference-image conditioning is a later workflow investigation. Story reading remains usable when image generation is unavailable or fails.

### Character photobooks

Each character profile has Details and Photobook sections. The photobook is a chronological visual history of portraits and story illustrations featuring that character. Selecting a thumbnail opens the picture, its editable caption, pictured characters, and a link to its source scene when available.

A shared story gallery also includes ships, locations, objects, and other illustrations without characters. The gallery and character photobooks are different views of the same image records.

Use a shared image record with multiple character associations: a crew picture appears in every pictured character's photobook without copying the file. Associations describe who is pictured, not merely mentioned in scene text, and are user-editable. Regenerating or changing the current portrait preserves previous images. Historical outfits and appearance remain attached to their original pictures rather than updating to match the current profile. Images from replaced scenes remain available with their source marked as superseded; they do not imply those events are still canonical.

The application now generates real portraits and scenes through ComfyUI, with shared photobooks, portrait selection and source-safe history. Earlier standalone HTML mockups retain placeholder artwork. See [Illustrations](ILLUSTRATIONS.md).

## Corvus adaptation plan

Reference: https://github.com/JustLateNightAI/Corvus-Story-Core

Inspected checkout: `8e5e7345eb349581febfd9d73bd45d4edea59717`.

The reference checkout remains separate. Selected reasoning-output and atomic-write code has been adapted with its MIT notice, and ensemble state proposals, per-story orchestration, and provider recovery patterns now have local implementations. No upstream React application or services are booted. See [reference adoption](REFERENCE_ADOPTION.md) and [third-party notices](../THIRD_PARTY_NOTICES.md) for exact provenance and deliberate differences.

| Upstream area | Intended treatment |
| --- | --- |
| React client | Replace with the Svelte reading, directing, and editing interface |
| `server/types/index.ts` | Redesign player/NPC distinction into ensemble entities, ownership, scenes, and directions |
| `server/routes/games.ts` | Adapt setup and editing endpoints to cast/world generation without a mandatory player |
| `services/lmStudio.ts` | Evaluate reuse behind a provider-neutral connection interface |
| `services/contextAssembler.ts` | Adapt context selection to scene focus, cast relationships, threads, and knowledge |
| `services/narrator.ts` | Replace roleplay assumptions with prose-scene and reader-direction instructions |
| `services/orchestrator.ts` | Adapt turn flow for request modes, scene planning, validation, and recoverable commits |
| `services/gameMaster.ts` and `stateManager.ts` | Redesign player-focused updates into referenced changes across entities |
| `services/summarizer.ts` | Reuse ideas, adding source tracking and revision-aware rebuilding |
| `services/comfyui.ts` and image services | Evaluate transport/job reuse; bind supplied workflows and cast/scene context |
| `services/fileManager.ts` | Evaluate persistence helpers; support consistent scene/state recovery without development save migrations |

This is an adaptation, not a prompt-only reskin. Review reused modules for dependencies and correctness before treating them as production-ready.

## Architecture boundaries

- **Svelte UI:** reading, directions, editors, scene history, and job status.
- **Application server:** API credentials, LLM and ComfyUI connections, context assembly, generation coordination.
- **Domain layer:** world facts, entity references, validation, ownership, revisions, and scene commits.
- **Persistence:** stories, source scenes, change sets/recovery points, and image metadata/files.

Keep model output separate from domain mutations. API keys stay server-side and out of exported stories and reference material. A standalone static HTML file is insufficient for this proposed server-managed architecture; the interface is served as a web application.

## Development connection baseline

Use `C:\Users\n_tin\Documents\ChatGPT\HTML Game` as the existing connection reference. Inspection of its source found:

- LLM: Unsloth through an OpenAI-compatible API; source default `http://127.0.0.1:8888/v1`, with model discovery and bearer-key authentication when configured.
- Configurable model, temperature, output length, recent-message/context budgets, and structured-output mode (`auto`, JSON schema, JSON, or prompt-based).
- Actual selected connection/model and credentials are loaded from browser storage, not hardcoded into the inspected source. Storage keys are `lineage-roleplay-connection-v1` and `lineage-roleplay-api-key`; key persistence is opt-in.
- ComfyUI: source default `http://127.0.0.1:8188`, with configurable connections and a `COMFYUI_URL` initial default.

These are source defaults, not verification of the currently selected live settings. The application stores its own ignored connection configuration; browser storage is origin-specific and will not automatically carry over to a new application. The user subsequently configured a local server-side key and model; real service checks have passed. Do not commit API keys or embed them in documentation. HTML Game remains unchanged.

Save compatibility across application versions is separate from story continuity: undo, consistent scene commits, and recovery from failed generation still matter within the current development version.

## Open decisions

Current decisions and remaining questions:

1. Local Unsloth/model authentication and structured extraction are working; keep validating output quality with actual stories.
2. Confirm local-only use versus eventual remote hosting and multiple users.
3. Storage uses Node 24 native SQLite plus content-addressed immutable media files.
4. Defaults are 800 words per passage and about 3,000 per chapter, both editable. Reader-facing Ask, reviewed polish and scene direction are now implemented.
5. Corrected supplied ComfyUI text-to-image workflow works for portraits/scenes. Reference-image conditioning remains pending.
6. Hidden lore/unrevealed knowledge are excluded from prose context; planning remains distinct from completed events.

## Deferred scope

Multiplayer, autonomous background simulation, combat rules, crafting, elaborate economies, voice generation, interactive galaxy navigation, plugin systems, cloud accounts, and public publishing. Forks and branching are out of scope; latest-passage replacement still requires consistent state recovery.
