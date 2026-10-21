# New story creation and live narration

Implemented flow and outline, updated October 20, 2026.

All setup sections now have targeted LLM controls: create/revise/redesign places, possessions, relationships and story threads; reroll names/titles; and revise/regenerate world foundations and the opening plan. Existing edits are saved first, selected IDs are kept, and all generated results stay editable. See [Targeted setup generation](SETUP_DESIGN.md) for exact scopes, reference validation and API behavior.

The seventh section, **Pins & rules**, protects individual record/world fields and establishes reader-visible world rules before any prose is written. Normal setup saves and ZIPs retain them, targeted AI receives checked mandatory context, and opening publication carries them into the written story. Conflicting generated fields reject the entire operation. Manual edits remain allowed; unpin a setup record before deleting it. Full cast/world regeneration requires removing field pins first while retaining rules. See [Pinned facts](FACT_PINS.md).

Character setup/redesign requires complete shared visual identity, persona and wardrobe profiles described in [Character profiles](CHARACTER_PROFILES.md); missing nested fields are rejected instead of silently becoming blank. Appearance/outfit summaries are derived. The setup editor enables **Allow appearance / outfit changes** by default so an explicit physical redesign can carry through related clothing, presentation and supplemental notes. Turning it off preserves physical identity, clothing, injuries and location; pins remain enforced. A personality-only direction still asks the model to retain physical details. Setup output budgeting reserves approximately 400 tokens per cast member plus 350 for the world/setup envelope.

Each cast member has three generation controls. **Redesign this cast member** follows the direction and preserves unrelated traits, checking dependent descriptions for consistency. **Full redesign** rebuilds the name, persona, visual identity, wardrobe, condition and notes as a coherent whole within user constraints, appearance permission and pins. **Reroll name** requests only a distinct fitting name; the server accepts no other fields and preserves the entire profile and linked IDs. API `/character` accepts `mode: revise | full | name` (default `revise`) and explicit `allowAppearanceChanges` (default false for callers that omit it). Scope is included in request fingerprints, so different operations cannot replay each other's results.

These controls save local edits before generation and display which profile sections changed. Separate possessions, relationship descriptions and opening notes stay intact; review authored text there if it mentions a previous name, outfit or history. There is no automatic global text replacement or invented numerical RPG-stat system.

Setup possessions now share the written-story container graph: a quantity-one item can be marked Container and hold other possessions through their immediate `ownerId`. Holder choices show nested paths, exclude cyclic destinations and clear equipment on movement; only directly cast-held items can be equipped. Full containers must be emptied before removal or conversion. Generated setup/design records use the same container rules. Explicit stack splitting is a saved-story Records operation; setup quantities remain directly editable before publication. See [Inventory](INVENTORY.md).

## Reference decisions

| Reference | Adopt | Adaptation |
| --- | --- | --- |
| Corvus `server/routes/games.ts` | Separate story/world/cast setup from actual narration | A durable editable setup draft; no required player avatar or dummy opening passage. |
| Corvus `server/routes/agents.ts` | Structured design suggestions that populate an editable new-game form | Generate directly from a premise, then review/edit; no mandatory design chat or repeated questions before producing a draft. |
| Corvus `server/services/orchestrator.ts` | Narration followed by a hidden state-extraction pass | Strict application IDs, source evidence, and one atomic prose/world commit; no partial successful scene when extraction fails. |
| Corvus `server/services/gameMaster.ts` | Structured inventory, cast, relationship, and world changes | Existing ensemble effects schema; never name-based mutation, malformed-output fallback, or model-controlled content/pin flags. |
| Existing Storyweaver context and memory core | Selective canon/history and source-linked memories | Use it for real narration; extract an incremental continuity note with each new passage. |

Reference checkout: Corvus commit `8e5e7345eb349581febfd9d73bd45d4edea59717`. This slice uses its architectural patterns; new implementation code does not import its React/chat UI.

## Flow

1. New story: premise, optional title, cast size, narrator/art styles, content notes, and reading/narration preferences. Adult content defaults off.
2. Save a setup draft before calling the model. Generate a compact ensemble, locations/POIs, possessions, relationships, open threads, world notes, and proposed opening brief. IDs are allocated by the app; generated cast defaults to No NSFW.
3. Review/edit/save the entire setup, including adding/removing records with reference validation. Redesign one cast member while retaining their ID, content preferences, pins, and every other record. The library lists unfinished drafts. Starting manually also works without a model.
4. Begin chapter one from the approved setup. Generate its first titled prose passage, then extract evidenced effects and a continuity note. Validate everything before atomically creating the story and marking the setup published.
5. Continue with optional direction. Use selected context, narrator preferences, and source-linked memories. Beginning a new chapter follows the previous passage's chapter-ending flag.
6. Change what happens targets the latest passage only, generating from its pre-passage canon and earlier prose. Existing illustration supersession and memory invalidation remain in force.

## Recovery and review

Setup saves and generation have revision checks and request IDs. Durable jobs retain phases, output drafts, failures, and attempts for Dev inspection. Failed/cancelled/late output leaves the approved setup or story unchanged. A committed opening cannot produce a duplicate novel after an uncertain response or restart. Model calls run outside SQLite transactions. No automatic provider retries, hidden provider switching, or reasoning-only prose fallback.

Unsaved premise/setup edits prompt before leaving New story or starting another setup, and request the browser's standard warning on reload/close. Cancelling navigation keeps the form intact. Accepting discard leaves the last saved draft available in Library. Untouched defaults and acknowledged saves do not trigger the warning; form typing is not autosave.

Unfinished premises and complete plans are portable through setup ZIPs. **Save & export setup ZIP** saves current edits first; a validation failure or stale revision keeps the edits and stops the download. Library exports its saved draft and imports each ZIP as a new editable copy with revision zero, preserving content preferences, profile pins, record IDs, hidden lore, opening plans and nested container links. Import does not call AI or publish a chapter. Setup ZIPs exclude private connections, jobs and media; published setups use ordinary story ZIPs instead. See [Setup archives](SETUP_ARCHIVES.md).

The first slice uses complete responses rather than token streaming. Context budgets and output limits are checked before calls. A substantially short passage gets one explicit length-expansion call (visible in Dev), then fails without saving if still below the minimum; network/format/provider failures are not retried automatically. Illustration generation remains explicit through the media core; opening creation does not queue an image automatically.

## Acceptance

- A premise yields an editable, durable cast/world draft with valid links and explicit inventory ownership.
- Draft edits survive reload and are the actual inputs to chapter one.
- An opening and a continuation save prose, effects, memories, and recovery baselines together.
- Unknown IDs, malformed JSON, failed extraction, cancelled jobs, and stale revisions never partially change the novel.
- Repeated opening/continuation requests do not duplicate stories or passages.
- The user can resume an unfinished draft and inspect all model stages in Dev.

## Implemented interfaces

- New story and Library expose creation/resume. The setup editor has Cast, World, Possessions, Relationships, Story threads, and Opening sections. Preferences include narrative voice, art style, tense/person, passage length, content notes, and the story adult-content opt-in.
- `POST /api/setups` creates a durable premise draft; `GET/PATCH /api/setups/:id` reads/saves the reviewed input/plan. The editor saves before generation and restores its active draft after refresh. Other unfinished drafts remain accessible in Library.
- `GET /api/setups/:id/export` downloads the saved unfinished setup. `POST /api/setups/import` validates a metadata-only setup ZIP and opens an independent editable copy; premise-only `plan: null` drafts and nested containers are supported.
- `/api/setups/:id/generate` generates the ensemble/places/possessions/threads. `/character` redesigns one cast member. `/design` generates or revises one noncast record, world foundations or opening plan. `/opening` begins chapter one and marks the setup published in the same SQLite transaction.
- `/api/stories/:id/generate` generates a continuation or latest-passage replacement. It uses the existing strict proposal/effects engine and creates a source-linked continuity memory in the same commit.
- `/api/generation/cancel` addresses a running job by scope/request ID and aborts its local provider request before commit. Cancellation cannot undo a completed transaction; reload resolves an uncertain response.

The setup tables and operation receipts live in the instance's existing `library.sqlite`; setup plans are not fake stories and never appear as written chapters. There is no model call inside a SQLite write transaction. Opening receipts and live-passage receipts recognize a prior commit after a restart even if the job was not yet marked complete.

Generated setup aliases are resolved to application UUIDs. Manual editors preserve stable IDs; links are validated on save. Regenerating the whole setup explicitly replaces its draft records, while one-character redesign preserves every other record and the target's No NSFW/pin flags. A pinned appearance/outfit change is rejected.

Narration selects context with its complete required pacing/output/schema contract already accounted for, including service-formatting reserve and JSON escaping; optional memories cannot consume that space. Dev previews the same default continuation contract.

Narration uses the selected context builder, current shared funds/cargo, recent verbatim prose, relevant canon/lore, and current source-linked memories. Replacement restores the pre-passage canon and omits the removed latest prose from generation context. It updates generated memory and preserves the media core's earlier-version handling. Opening scene directions are consumed once; they do not keep instructing later passages to repeat the introduction.

The original sample retains its deterministic buttons for development walkthroughs; Continue with AI converts it to a live story. Generated stories show Continue story and latest-only Change what happens. There is no fixture ship/location artwork in a new novel unless a real story illustration has been attached.

## Passage length and chapter pacing

New stories default to 800 words per passage and approximately 3,000 per chapter, both editable in setup and Settings → Story. Begin chapter one writes its first passage; chapters develop over several continuations. Reader and Contents show actual word totals and chapter completion. Automatic endings wait until 80% of the chapter target, then allow a meaningful natural close; readers can explicitly keep a chapter open or request an earlier close. Replacement excludes removed prose from the word total; a new chapter starts at zero.

Narration below 60% of its requested passage length gets one expansion pass before effects extraction. The original draft and context guide the expansion; a second short output fails without publishing. Dev retains the expansion trace and final word/pacing counts with the narration draft. An acceptable word count is not a narrative-quality guarantee.

The extraction call provides a numbered excerpt catalog alongside the final prose. The model selects evidenceId anchors; the app resolves them to actual source quotes before domain validation. Unknown anchors, abbreviated direct quotes and mixed/extra fields fail. See [Director/editor tools](DIRECTOR_EDITOR.md).

The extraction call retains full required canon and prose, reserving at least 1,024 output tokens (or the configured ceiling when lower), then uses the remaining context up to that ceiling. It does not insist on reserving the narrator's full output limit again. If required inputs and this useful response reserve cannot fit, it fails clearly; output truncation still cannot commit partial JSON.

## Current limits and verification

Responses are buffered, then validated, rather than streamed into the saved novel. Cast generation targets 1–8 initial members. Output and conservative context-budget checks fail clearly before silently dropping required setup facts. The development text defaults are now 4,096 output tokens and a 300-second per-provider-call timeout; lower old defaults could truncate structured setup output. Settings remain editable. A full passage uses two calls (narration then effects/memory); a slow local model can take several minutes.

Automatic memories cover individual passages; completed-chapter and earlier-book compaction now follow saved live passages and can be rebuilt in Dev. See [Memory compaction](MEMORY_COMPACTION.md). Reader Ask, reviewed wording polish and scene briefs are implemented; see [Director/editor tools](DIRECTOR_EDITOR.md). Semantic retrieval and automatic illustrations after every passage remain future work. Unfinished setups can be discarded, exported or imported from Library; **Save & export setup ZIP** includes current setup edits. Imported setups open as separate editable copies without an AI call or written chapter. See [Setup archives](SETUP_ARCHIVES.md). Explicit story-linked illustration jobs are implemented. A generated story's ordinary export includes its prose, canon, memories, content preferences, and shared image library.

- `tests/story-generation.test.ts`: draft reopen/CAS/idempotency, application IDs/default preferences, targeted redesign, opening publication, failed extraction/invalid effects/late results, live inventory and memory commits, replacement baseline, and generation receipts.
- `node scripts/story-smoke.mjs`: isolated UI/model mocks, all setup sections at 320px, edits/reload/targeted redesign, opening and restart deduplication, continuation/replacement, failed extraction and retry, cancellation, Dev job history, and manual setup resume. Uses its own temporary app/config/data and leaves normal libraries untouched.
- [Setup archive tests](../tests/setup-archive.test.ts), [setup pin tests](../tests/setup-pins.test.ts) and [inventory integration tests](../tests/inventory-integration.test.ts) cover portable premise/planned/nested-container setups, protected facts, invalid storage, fresh imports and generated aliases carried through publication. The combined suite and clean Svelte/TypeScript checks pass; [Project status](PROJECT_STATUS.md) records the current count. `node --import tsx scripts/setup-archive-smoke.mjs`, `node --import tsx scripts/setup-pins-smoke.mjs` and `node --import tsx scripts/inventory-smoke.mjs` pass isolated browser walkthroughs; see [Setup archive verification](SETUP_ARCHIVES.md#verification) for portability scope.
- `node --import tsx scripts/story-live-smoke.mjs`: optional real local model check using the saved play text connection and temporary story storage. Successful story-content proof is written to ignored `test-results/new-story-live.json`; keys/settings are never copied into that proof.

Local integration note: Unsloth’s own OpenAPI schema exposes enable_thinking and guided response_format controls. Text LLM now has a Thinking mode selector; explicit Off/On sends that Unsloth control, while Provider default omits it. The local development connections use Off. Setup prompts include the exact result schema; narration additionally enumerates valid viewpoint IDs. These strengthen structure without accepting malformed output or inventing fallback state.

Verified against the saved local Unsloth model (Nimbz/Schattenblume-31B-GGUF): a three-member cast, four places and five possessions normalized successfully; the approved opening committed with continuity memory; a live continuation committed a valid empty effect set (investigation without a possession/location change) and a second memory. The first continuation exposed a nested-effect ambiguity; explicit complete effect-object examples fixed it. Retesting reused the already validated real setup/opening and made fresh continuation/extraction calls with Thinking Off. No application-side coercion or invalid-output fallback was added. The normal play library was not changed by these checks.

The optional --resume-opening --effects-probe mode exercises a nonempty ownership-transfer result using short synthetic handoff prose and the real local extractor. It saves separate proof so synthetic prose is not mixed into the real-novel verification artifact.

The targeted real-extractor handoff probe passed: an item.transfer effect used the required flat type field, valid existing IDs and an exact source quote, then committed the ownership change atomically. This specifically verifies the nonempty effect-object path that the earlier ambiguous prompt failed.

Chapter-length verification: `node --import tsx scripts/story-length-live-smoke.mjs` reuses the previously validated setup checkpoint in isolated storage and writes a fresh 800-word opening with the saved local model. The actual opening reached 811 words in 14 paragraphs and stayed in an open chapter. It exposed an over-reserved extraction budget and a missing item description update operation; both were corrected with regression tests. `--resume-prose` reused that validated opening while making a fresh real extraction call, then committed prose, evidenced item updates and continuity memory atomically. Proof is kept in ignored `test-results/chapter-length-live.json`; the normal play library is unchanged.
