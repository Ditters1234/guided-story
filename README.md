# Storyweaver 1.0

A local SvelteKit application for reading and directing an ongoing illustrated story. The reader guides an ensemble cast and plot rather than playing a single character.

**Version 1.0:** The full premise → editable setup → ongoing illustrated novel loop is implemented, including current-record editors, linear revision, layered memory, recap/Ask/polish, advisory continuity review, photobooks and portable saves. The release includes a production launcher, in-app Help and readable Markdown novel export. See the [Quick start](docs/QUICKSTART.md), [release gate/evidence](docs/RELEASE_1_0.md) and [current status](docs/PROJECT_STATUS.md).

**Current milestone:** [node-based story workflows](docs/NODE_WORKFLOWS.md) over the existing engine. Phases 1–4 provide the default graph/runner, durable passage artifacts/recovery, workflow inspection/retries and the [location-first world map](docs/NODE_WORKFLOW_PHASE_FOUR.md). [Phase 5, pass 1](docs/NODE_WORKFLOW_PHASE_FIVE.md) adds editable built-in draft graphs and versioned portable presets; execution remains on the default graph while trusted compilation/binding work follows. Character/location/inventory scoping, efficient task-specific context and continuity remain mandatory acceptance requirements; see the [scoping baselines](docs/CONTEXT_SCOPING.md).

The [fourth phased pass](docs/SCOPING_PHASE_FOUR.md) follows bounded references for ordinary tasks, strengthens transport/parking/quantity checks and models occupied vehicles as moving places with cab interiors. At that checkpoint: 279 tests, type/build, three isolated production browser checks and focused local-model probes; see Project status for the latest implementation evidence. [Importable ranch fixtures](exports/ranch-scope-test/README.md) cover feeding, transport and a cab inside a field. Earlier reports remain historical comparisons.

## Run on Windows

To create the clean production distribution, double-click [Build Production ZIP.bat](Build%20Production%20ZIP.bat). It installs missing project dependencies, builds the current app and runs the existing production packager, stopping on any failure and keeping the window open. The ZIP and SHA-256 checksum appear in `dist/`; rerunning replaces the archive for the current version. Packaging is an on-demand step, not part of every development change. The terminal equivalent is `npm run build` followed by `npm run release:production`.

The resulting `dist/storyweaver-1.0.0-production.zip` contains the compiled runtime, an empty first-run library and a standalone launcher. Source, tests, references, developer documentation, source maps and personal data are excluded. Its batch file installs locked dependencies on first launch; see the [production installation guide](scripts/production/README.md). Verify the exact archive separately with `npm run release:production:verify`, which installs dependencies into an isolated extracted copy. The commands below describe the full development checkout; `npm run release` retains the separate source release.

Requires Node.js 24 or newer and separately running text/ComfyUI services for generation. Dependencies are already installed in this checkout; on a fresh release/checkout run `npm ci` first.

Double-click **Start Guided Story.bat**. It prepares the current production build, opens **http://127.0.0.1:5175/** and keeps the server in the batch window. Press Ctrl+C to stop it. Launching again reuses an existing Storyweaver instance; another program on that port produces a clear error.

| Instance | Command | Address | Save folder |
| --- | --- | --- | --- |
| Your play instance | Batch launcher or `npm run play` | http://127.0.0.1:5175/ | `data/play/` |
| Agent development | `npm run dev` | http://127.0.0.1:5173/ | `data/dev/` |

HTML Game's port 5174 is left alone. The instances have separate databases, connection overrides and browser preferences. Development receives reloads; the production play instance needs a restart after application changes. `npm run play:dev` enables development reloads against the play library when explicitly wanted. Use Export ZIP / Import to move a story between instances.

See [Current project status](docs/PROJECT_STATUS.md) for implemented and remaining scope.

## What works

- Model defaults now use 32k text context and 896 × 1152, 9-step Euler/beta Sickollie pictures. Text requests use shared conservative token estimates with explicit output/overhead reserves and separate byte diagnostics. See [Local model defaults](docs/MODEL_DEFAULTS.md) for prompt guidance, the sampling comparison and limitations.

- Focused story and picture controls: a separate Writing guide, current character feelings/intentions, next-passage/current-scene/ongoing direction, reusable visual descriptions for places/items, and per-character image placement, depth, gaze and detail switches. Prompt assembly uses the existing model stages; no reference-image workflow is required. See [Story and picture controls](docs/STORY_CONTROLS.md).

- A collapsible bottom activity panel across all screens, including during generation: elapsed times, current job phases, redacted prompts/workflows, completed responses and automatic original-endpoint ComfyUI status checks. Its Errors view collects failed saves, form validation, browser/server and generation errors with grouping, copy/dismiss/clear controls. Lightweight polling excludes request bodies and does not queue or accept images. See [Developer tools](docs/DEVELOPER_TOOLS.md).

- Production startup with source/configuration-fingerprint freshness checks, local HTTP origin handling, full-size upload/archive limits, 1.0 identity, first-use connection guidance and in-app Help. Connection shortcuts open Text LLM directly. New-story setup edits have navigation/reload protection until saved or explicitly discarded. Export novel downloads accepted chapters as Markdown with private internal records excluded.
- Full mid-story cast/place/item/relationship/thread editors, including creation/removal, ship containment, quantity, equipment and directional relationships. Library supports rename/delete and unfinished-setup discard, with stale-save and active-job protection. See [Record editors and library controls](docs/RECORD_EDITORS.md).
- Inventory browser, quantity-conserving stack splits and nested bags/crates. Storage paths distinguish immediate containers from ultimate cast/place holders; moving a container carries its contents, and only directly cast-held items can be equipped. Generated effects and item pins follow the same ownership graph. See [Inventory](docs/INVENTORY.md) and [current verification](docs/PROJECT_STATUS.md).
- **Pins & rules** protects supported cast/place/item/relationship/thread/world fields from setup through the written story. All pins/rules are required model context; over-budget constraints stop generation. Structured AI updates cannot change pinned fields, while explicit manual edits remain allowed. Setup ZIPs and chapter one retain the controls. Save/reset and unsaved-change protection are included. See [Pinned facts](docs/FACT_PINS.md).
- Story-linked illustrations: reader/cast/gallery entry points, editable granular shot details, optional LLM preparation, workflow selection and per-request settings, durable ComfyUI jobs, group photobooks, current portraits and source-safe image history. Use the Illustrations tab; see [Illustrations](docs/ILLUSTRATIONS.md).
- Illustration prompts have an explicit story-refresh button beside the preview and automatic preparation of stale/unprepared source details before generation. Manual shot edits/overrides remain under user control; submission resolves the current draft again and captures the exact workflow prompt.

- Ask about the story without advancing events, with source excerpts and saved answer history. Review continuity preloads a read-only comparison against nearby written passages. Wording polish offers a reviewed comparison and explicit acceptance for any passage, preserving canon/recovery. Reader scene direction supports viewpoint/cast/location/purpose and optional one-shot use. See [Director/editor tools](docs/DIRECTOR_EDITOR.md).
- Next-passage direction and chapter-ending drafts persist per story in this browser across reloads, story switches and failed requests. Latest replacement keeps future direction; confirmed continuation or **Clear direction draft** clears it. These device drafts are separate from saved scene briefs and ZIP backups.
- Chapters and Contents with passage/chapter word counts and completion state; resume at the latest passage. New stories default to 800-word passages and approximately 3,000-word chapters, editable in setup and Story settings. Very short responses get one expansion pass; chapter pacing supports natural endings, keep-open, and explicit close. Bottom-of-page buttons move between written passages and adjacent written chapters without advancing the story.
- A saved, editable Story so far recap, with coverage and a needs-refresh indicator. Generate/Refresh uses the saved text connection; manual editing works without a model. Checking the coverage box confirms a manual recap includes the latest passage.
- Editable character profiles, locations, pinned-appearance flag, and No NSFW (checked by default).
- World notes, shared funds, thread notes, and explicit item ownership transfers.
- Server-confirmed saving through the editor's Save controls; automatic commit after sample continuation, sample replacement, and ownership transfer. Closing/reopening retains accepted changes. Unsaved form typing is not auto-committed.
- One fixed sample continuation, including a real inventory transfer, plus a latest-only alternate ending that restores its prior world state.
- Separate story library, sample copies, and ZIP export/import of text, world records, images, and the latest recovery point. Imports never overwrite an existing story.
- Portable unfinished setup ZIPs, including premise-only drafts or complete cast/world plans with nested containers. New story can save current edits before exporting; stale/invalid saves keep the edits and stop the download. Imports open independent editable copies without an AI call or a written chapter. See [Setup archives](docs/SETUP_ARCHIVES.md) for format limits and verification.
- Device reading preferences and server-side connection settings.
- Layered generation memory: passage notes, completed-chapter summaries and an earlier-book overview, with precise event receipts, correction invalidation, bounded automatic maintenance and Dev coverage/rebuild controls. See [Memory compaction](docs/MEMORY_COMPACTION.md).
- Dev menu: persistent browser/server console viewer, request and state-change traces, context previews with selection reasons and budgets, editable scene briefs/lore/knowledge, source-linked manual or model-generated continuity memories, and saved-state inspection. See [Developer tools](docs/DEVELOPER_TOOLS.md).
- Dev Jobs tracks durable generation phases, attempts, errors, cancellation, and retained drafts. Passage lab validates evidenced world-change proposals without saving. The sample continuation/replacement uses the same atomic passage/world boundary as live generation. See [Reference adoption](docs/REFERENCE_ADOPTION.md).
- Seven Settings tabs: Reading, Story, Text LLM, ComfyUI, Prompts, Context, and Storage & Dev. Includes real prompt/image tests, workflow selection/import and bindings, sampling/timeouts, image dimensions/seed/steps/CFG, editable framing-aware templates, context controls, and independent saves. See [Settings](docs/SETTINGS.md).

Manual world/character/thread edits invalidate the latest replacement baseline to prevent a rollback from overwriting those edits. Continue forward to establish a new baseline. The sample's deterministic continuation has one predefined passage; Continue with AI switches it to live generation. Generated stories can continue and replace their latest passage with the model. Reviewed wording polish is available for earlier/latest passages; event changes remain latest-only.

## Connections and local files

Settings start with HTML Game's source defaults: text at `http://127.0.0.1:8888/v1`, ComfyUI at `http://127.0.0.1:8188`. In Text LLM, test the connection, choose a model, and save. Model IDs can also be entered manually. The user's saved key and selected Unsloth model passed a real prose-generation test on October 17, 2026; ComfyUI also generated a real test portrait. Do not put keys in source control.

To generate a recap, select and save a text model and any required API key in Settings, then choose Generate recap under Story so far. Long inputs are split within a conservative context budget and intermediate summaries are cached; refresh regenerates the final recap. Each request is limited to 32 model calls and three minutes. No recap is replaced if generation, validation, or the final revision check fails. Job metadata is durable; unfinished text becomes interrupted after a server restart and requires explicit retry. Tokens are not automatically resumed. Recap and continuity extraction pass mocked provider tests; local-model acceptance also exercised source-linked passage/chapter/book memory, historical questions, uncertainty and advisory review. See the release evidence for observed semantic limits.

Both bundled workflows select `Krea 2\nsfw\SICK_OLLIE_Krea2_BF16.safetensors` (Sickollie), confirmed in the local ComfyUI model list. The default `AI/Comfy Workflow/portrait.comfy-desktop.api.json` also uses the installed encoder/VAE subfolder paths; `portrait.api.json` retains the original encoder/VAE layout. Earlier real image checks used the previous diffusion model. Workflow files are loaded for each new request, so changing them does not require an app restart. Settings previews remain separate until explicitly copied into the story gallery. Story images then travel in ZIP exports, independently of the test previews.

Settings save into ignored `config/connections.dev.local.json` or `config/connections.play.local.json`. An optional `config/connections.local.json` is a shared initial default; otherwise `config/connections.example.json` supplies placeholders. Saved keys are never returned to the UI or included in exports. The UI can replace or explicitly clear them.

Databases live at `data/<instance>/library.sqlite`, `diagnostics.sqlite`, and `jobs.sqlite`. ComfyUI test prompt IDs and original endpoints are retained for reconciliation after restart; completed test previews persist separately. Data and local credentials are Git-ignored. Development saves are disposable when formats change; no backward compatibility or migrations are promised. Do not remove a data folder while its server is running.

## Verification

```text
npm run check
npm test
npm run build
npm run release
```

Repository tests cover reopen, independent libraries, transaction rollback, stale edits, request deduplication, item transfer/replacement, imports, and default character preferences. `scripts/browser-smoke.cjs` is an optional local acceptance walkthrough using the bundled Codex Playwright runtime; it exercises both ports and removes only its own QA records. It is not required to run the app.

`tests/fact-pins.test.ts` adds pin configuration/current-value validation, atomic AI protection, manual edits, deletion, recovery/archive behavior and mandatory-context budget cases. `node --import tsx scripts/fact-pins-smoke.mjs` passes the dedicated Pins UI walkthrough using isolated temporary saves and mock services, including save/reopen, conflict/draft recovery, trade/replacement protection, restart and 320px layout. See [Project status](docs/PROJECT_STATUS.md) for current results rather than assuming every listed script has run on every change.

`node scripts/restart-smoke.mjs` verifies real server restarts against mock providers using temporary config/data/cache. It proves interrupted text status, original-endpoint ComfyUI reconciliation without resubmission, and preview persistence through a second restart. `STORY_CONFIG_DIR`, `STORY_DATA_DIR`, and `STORY_VITE_CACHE` can isolate a test instance; ordinary launchers retain their existing defaults.

## Design documents

- [Quick start](docs/QUICKSTART.md): installation, launch, services, reading, editing, backups and troubleshooting.
- [1.0 release gate](docs/RELEASE_1_0.md): release scope, acceptance evidence, known limits and follow-ups.
- [Record editors and library controls](docs/RECORD_EDITORS.md): current-fact editing, dependency checks, history preservation and scoped removal.
- [Inventory](docs/INVENTORY.md): splitting, nested containers, storage paths, equipment, ownership pins and current limits.
- [Pinned facts](docs/FACT_PINS.md): supported field pins, world rules, manual edits, required context, atomic protection and limits.
- [Director/editor tools](docs/DIRECTOR_EDITOR.md): Ask, wording previews, scene direction, evidence anchors, persistence and validation.
- [Local narrative walkthrough](docs/NARRATIVE_WALKTHROUGH.md): a real two-chapter local-model acceptance case, fixes it exposed and remaining quality limits.
- [Project status](docs/PROJECT_STATUS.md): current implementation and remaining scope.
- [Memory compaction](docs/MEMORY_COMPACTION.md): chapter/book layers, source checks, scheduling, failure behavior and Dev coverage.

- [Story-linked illustrations](docs/ILLUSTRATIONS.md): studio flow, templates, durable image jobs, captured source facts, acceptance, portrait selection, variations and real-service checks.

- [Node-workflow milestone](docs/NODE_WORKFLOWS.md): approved next step, architecture, delivery phases, first implementation task and acceptance gates.
- [Next development slices](docs/NEXT_STEPS.md): current milestone, scoping requirements, historical completed slices and deferred work.

- [New story flow](docs/NEW_STORY_FLOW.md): reference decisions, setup review/editing, cast redesign, chapter one, live narration/effects/memory, cancellation/recovery, and verification scripts. [Targeted setup generation](docs/SETUP_DESIGN.md) covers AI options for places, possessions, relationships, threads, world foundations and opening plans.

- [Unfinished setup archives](docs/SETUP_ARCHIVES.md): saved-premise/cast/world ZIP export, nested container preservation, save-and-export current edits, independent editable imports and metadata-only limits. The setup archive and inventory integration suites cover these contracts; see Project status for current verification results.

- [Media core](docs/MEDIA_CORE.md): shared gallery/photobooks, portrait history, ComfyUI preview promotion, portable image archives, and integrity diagnostics. Verify with `node scripts/media-smoke.mjs` using isolated temporary data.

- [Project outline](docs/PROJECT_OUTLINE.md): experience, architecture, state model, and Corvus adaptation.
- [Build roadmap](docs/ROADMAP.md): implementation order and milestone acceptance criteria.
- [Foundation specification](docs/FOUNDATIONS.md): save/load, SQLite storage, configuration, domain contracts, and failure recovery.
- [Generation profiles](docs/GENERATION_PROFILES.md): selectable workflows, editable prompts, framing variables, narrator styles, and adult-content preferences.
- [Context strategy](docs/CONTEXT_STRATEGY.md): selective context and source-linked memories used by live narration.
- `AI/Comfy Workflow/portrait.api.json`: original-layout portrait workflow with the Sickollie diffusion model selected.
- [Reference adoption](docs/REFERENCE_ADOPTION.md): audited modules, reused patterns, differences, and foundation contracts.
- [Third-party notices](THIRD_PARTY_NOTICES.md): retained MIT notice for selected Corvus adaptations.
- `references/Corvus-Story-Core/`: separate upstream reference checkout; selected portions have been adapted, not its full application.

Start with Project status for the current build, then the outline for the broader design. Proposed items in older design sections are targets, not completed controls.
