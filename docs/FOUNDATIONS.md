# Guided Story — foundation specification

Shared gallery/photobooks, media export/import and story-linked illustration generation are implemented. See [Media core](MEDIA_CORE.md) and [Illustrations](ILLUSTRATIONS.md) for storage, history, durable jobs and workflow boundaries. Reference-image execution and automatic images after every passage remain follow-ups.

Status: the local foundation includes durable generation jobs, interrupted-text recovery, original-endpoint ComfyUI reconciliation, atomic preview/settings writes, strict model-output handling, and an ensemble effects/passage commit contract. Premise/setup generation, live narration/extraction, automatic passage memories, chapter-length controls, shared media and story-linked image generation are implemented. Dev adds Jobs and a dry-run Passage lab. Real text/image service tests have passed. Chapter/book memory compaction is implemented; see [Memory compaction](MEMORY_COMPACTION.md). See [reference adoption](REFERENCE_ADOPTION.md), [New story flow](NEW_STORY_FLOW.md), [Illustrations](ILLUSTRATIONS.md) and [Next development slices](NEXT_STEPS.md).

## Working architecture decisions

| Concern | Initial decision | Reason |
| --- | --- | --- |
| Application | SvelteKit + TypeScript, local server | UI and server-side service connections in one project |
| Canonical saves | One local SQLite database for the story library | Commit a passage, world changes, and latest pointer together |
| Illustrations | Immutable files in a local media directory; database metadata and associations | Avoid duplicating pictures across cast photobooks |
| Saves across development versions | Disposable; no migrations | Respect current development scope |
| History | One ordered sequence of passages grouped into chapters | No forks, branch records, or rewind through earlier event history |
| Latest revision | One pre-passage recovery snapshot plus its change set | Replace the latest passage consistently without a general time-travel engine |
| Connections | Configurable profiles, initially matching HTML Game | Keep development services while avoiding coupling stories to one model |
| Credentials | Local server-only configuration, excluded from exports/version control | Reuse authorized credentials without embedding them in story data |
| Reader preferences | Device/browser preferences | Font, width, and appearance need not travel with fictional state |
| Background jobs | Durable job metadata, no assumed resume of an interrupted LLM stream | Recover explicitly after process termination |

SQLite uses Node 24’s built-in node:sqlite DatabaseSync. Do not add compatibility layers for formats we have not shipped.

## Local layout

Current runtime storage, excluded from Git:

```text
data/
  <instance>/library.sqlite # stories, setups, receipts and separate retained editor results
  <instance>/diagnostics.sqlite
  <instance>/jobs.sqlite
  <instance>/media/<sha256>.original
  <instance>/media/<sha256>.thumb.webp
  <instance>/test-images/
  <instance>/illustration-previews/
config/
  connections.<instance>.local.json
  workflows/
```

The local config stores endpoint profiles and credential references/secrets as appropriate for a local development app. A checked-in example contains placeholders only. The user has configured the local development key; saved keys remain server-side, ignored by Git and excluded from exports.

The reference checkout under `references/Corvus-Story-Core/` remains separate from the application. Adapt selected modules with their license notices rather than importing or booting its whole React application.

## Save and load behavior

### Saving and reopening

- Setup/editor Save controls, accepted generations, ownership transfers and media actions persist through the server. Unsaved form typing is not autosave.
- Show Saving, Saved, or Save failed based on server acknowledgement. Never display Saved solely because the browser updated optimistically.
- Draft direction text may be locally recovered, but is not part of canon. Discarding it must not change the story.
- On reopening a story, load its current entities and latest committed passage. There is no bookmark field.
- Reading older passages does not change the latest pointer. Show Return to latest rather than continuing from an old page.
- Save failure keeps the editor's unsaved content available and offers retry. Generation cannot use an uncommitted edit without explicit handling.

### Passage commit

1. Capture a story revision number, latest passage ID, relevant entities, and current pinned constraints.
2. Create an operation record with a unique request ID. Serialize generation/state mutations for that story.
3. Generate a draft, extract proposed changes, validate, and reconcile before applying anything to canon. Narration is buffered rather than token-streamed.
4. Recheck the expected revision/latest pointer. If an edit occurred meanwhile, reject the stale result; do not overwrite it or automatically charge for a retry.
5. In one database transaction, save prose, chapter/title information, validated world changes, committed events, recovery snapshot, source-linked memories, operation receipt, and the latest pointer/revision. Derived summaries are excluded when source fingerprints change. Job metadata lives in a separate SQLite database and is finalized after the story commit.
6. Acknowledge completion. Illustrations and recap refresh run independently. Automatic chapter/book memory maintenance follows the committed live passage; its failure never rolls back that passage.

An idempotency key prevents a double-click or retry from appending the same passage twice. A lost browser connection does not prove generation failed: reconnect by operation ID and query its status before submitting another paid request.

### Latest passage replacement

- Require the target to still be the latest committed passage on the server.
- Build the replacement against its saved pre-passage state in isolation. Keep the current accepted passage readable until a valid replacement is ready.
- Commit replacement text, world changes, latest pointer, and derived-data invalidation together. No alternate continuation or selectable fork is created.
- Keep the prior illustration files in galleries as superseded when they no longer depict canon.
- If a manual canon edit happened after the latest passage, do not restore a stale recovery snapshot over it. Initial policy: refuse event regeneration until the conflict is resolved; do not invent a merge. Tell the reader the edit changed the revision baseline. Reviewed wording-only polish is available and leaves that baseline unchanged.
- Earlier-passage wording polish uses a reviewed preview and explicit acceptance; canon/effects/recovery stay unchanged. Cascading undo and delete-to-rewind controls remain out of scope.

### Library and portable files

- Library lists stories with title, latest chapter, and last committed update. Resume opens the latest passage.
- Export a story as a single ZIP containing a manifest, structured current story records, passages, chapter information, the latest replacement recovery point, and referenced media. Export from a consistent read snapshot.
- Include image metadata and history, relationships, possessions, pins, directions/threads, and source-linked summaries. Exclude credentials, device settings, temporary jobs, debug logs, and unfinished output.
- Import into a staged location, validate structure and all story-scoped references, check media paths, then commit as a new story with a new library ID. Never overwrite an existing story by accident. IDs inside the story can remain stable because they are scoped to that story.
- Reject malformed files and incompatible development formats with a clear explanation. A simple format marker permits rejection; it does not imply migration support.
- Library rename/delete and unfinished-setup discard are implemented, with revision checks, scoped active-job blocking and durable removal receipts. Late results cannot recreate removed records. Content-addressed originals may be shared by imported story copies; metadata removal never deletes those files. Dev audits orphaned files without deleting them. See [Record editors and library controls](RECORD_EDITORS.md).
- Unfinished setups have a separate strict ZIP contract containing only `manifest.json` and `setup.json`. A nullable plan permits premise-only preparation; import validates the complete archive and every entity link before assigning a fresh setup ID/revision and committing. Repeated imports are independent. Library exports the last saved draft; New story's Save & export saves current edits first. No model calls, publication, credentials, media, jobs or receipts travel through this path. See [Unfinished setup portability](SETUP_ARCHIVES.md).

## Initial records and invariants

This table includes broader target concepts. Current stories are validated JSON payloads in SQLite: chapters are numeric passage groups, places use parent containment, funds are one shared balance and holdings use immediate character/place/container-item owners. Supported [field/world-rule pins](FACT_PINS.md) extend existing appearance/outfit pins from setup into written stories, including derived ultimate-holder and effective container-status pins. Route records and multiple accounts remain future scope.

| Record | Required identity/context | Invariants |
| --- | --- | --- |
| Story | ID, title, premise, preferences, revision, latest passage ID | Latest points to a committed passage in this story |
| Chapter | ID, story ID, order, editable title | Unique order within story; no future unwritten chapters in Contents |
| Passage | ID, chapter ID, order, title, prose, viewpoint, source direction | Exactly one canonical linear order; browsing never changes it |
| Entity | ID, story ID, kind, name, typed fields | Stable ID, independent of editable name; allowed kinds validated |
| Relationship | Story ID, source character ID, target character ID, facts | Both characters exist; directional feelings need not be symmetric |
| Place connection | Story ID, endpoints, route details | Both endpoints are places; no dangling route references |
| Item / holding | Entity ID, immediate owner/container reference, quantity, equipped status, optional isContainer | Quantity 1–1,000,000; containers quantity 1; existing holders and no cycles; only directly cast-held items equipped |
| Shared funds | Holder ID, currency, amount | Currency changes target explicit holders; prevent invalid amounts |
| Pin | Allowlisted record/field pointer resolving its current value; world-rule ID and text | Structured AI changes cannot alter pinned fields; explicit manual edits are allowed; rules guide prose without a semantic guarantee |
| Direction / thread | ID, text, status, source, linked entities | Plans and possible events do not become historical facts |
| Event / change set | Passage or manual-edit source, affected IDs, validated changes | Only committed outcomes affect canon |
| Recovery point | Latest passage ID, pre-passage state, baseline revision | Replacement only; not an accessible earlier-world save slot |
| Image | ID, stored relative path, caption, provenance, source passage, status | File immutable; paths confined to media root |
| Image association | Image ID, depicted character/entity ID | One picture can be in several photobooks without file copies |
| Summary / recap | Coverage IDs, source revision, text, stale flag | Stale or incomplete coverage cannot be displayed as a current full recap |
| Operation | ID, story ID, request key, baseline revision, stage, result/error | Retrying status lookup cannot run generation again |

Keep core story canon separate from historical presentation. Visiting an old passage shows that passage's prose and original pictures; the notebook shows current character/world records with a clear “Current notebook” label. Historical notebook snapshots are not required.

Item containers use the same `ownerId` edge as ordinary possessions, with missing `isContainer` interpreted as false. Container movement carries all descendants through their unchanged immediate links. Full containers cannot be deleted or converted while their contents would be left without valid storage. `item-split` is an explicit manual revision/request mutation: at least one unit moves and one remains, exact metadata is retained, a new application ID is allocated and the new record starts unequipped. Narration uses an evidenced `item.split` with a quantity precondition; follow-up references come after that split. Both paths conserve quantities atomically, and no automatic merge is performed. Manual changes invalidate recovery/derived memory as existing corrections do. AI final-state checks preserve all current pins, including a child's ultimate holder when an ancestor container moves. See [Inventory](INVENTORY.md).

## Service interfaces

| Building block | Responsibilities |
| --- | --- |
| Story repository | Library, persistence, transactional mutations, revision checks, exports/imports |
| Canon validator | Entity references, ownership/quantity rules, pins, scene consistency |
| Setup service | Structured cast/world draft, targeted regeneration, acceptance |
| Passage coordinator | Request classification, context assembly, generation, validation, commit/recovery |
| LLM adapter | Model discovery, text generation, structured output, cancellation and sanitized errors |
| Context builder | Relevant cast/places, pinned facts, current threads, summaries, recent prose, token budget |
| Summary service | Incremental summaries, coverage tracking, bounded recap generation and invalidation |
| Media service | Workflow binding, ComfyUI job status, immutable outputs, gallery/photobook associations |

### Application commands and remaining targets

All mutating commands include an expected story revision; generation commands also include a request ID.

- List, create, read, and explicitly delete a story.
- Save a setup draft, regenerate a setup element, accept setup.
- Read Contents and a passage; rename chapters/passages.
- Continue with optional direction; ask without advancing.
- Polish wording for a passage; replace events in the latest passage only.
- Edit entity facts, relationships, pins, holdings, and future threads.
- Read/generate a recap and inspect coverage/status.
- Start/cancel/query an illustration; edit captions and pictured-entity associations.
- Export/import a story; query operation status after reconnection.
- Export/import an unfinished setup independently of written stories; split a saved stack and edit nested storage.
- Read/update connection profiles and probe models/output capabilities.

Current route implementations cover setup/save/character redesign, continuation/latest replacement, recap, memory maintenance, illustrations, settings and import/export. Ask, reviewed wording polish, typed record editing/removal, story deletion and setup discard are implemented; see [Project status](PROJECT_STATUS.md). Avoid a public SDK or generic plugin framework.

## Generation and job states

Use `queued → generating → validating → committing → complete` for text, with terminal `failed`, `cancelled`, or `interrupted` states. Validation may retain the draft for a deliberate retry without committing it. A failed result is never silently equivalent to success.

At server startup, unfinished LLM operations become interrupted. Keep the last committed story intact and offer retry. Do not claim an interrupted provider request resumes at its last token.

For ComfyUI, persist the prompt ID and the original endpoint/workflow bindings. Reconcile against that same endpoint after restart. A job whose server no longer has it is unavailable/failed; do not fabricate a completed picture or silently submit a duplicate. Changing the active connection must not redirect an existing job's status lookup or cancellation.

Store files to staging before finalizing media records. An image is ready only once the final file exists and its metadata is committed. Orphan cleanup is scoped, deliberate, and separate from story commits. Reading/continuing remains possible if illustrations fail.

## Connection configuration

See [Generation profiles](GENERATION_PROFILES.md) for selectable workflow bindings, template variables, granular visibility/coverage, adult-content controls, narrator styles, and default/story/request override precedence. These are configuration/domain building blocks rather than hardcoded prompt strings.

- Use the user-configured development connection matching HTML Game. Source defaults are Unsloth at `http://127.0.0.1:8888/v1` and ComfyUI at `http://127.0.0.1:8188`; the saved local model/key and corrected portrait workflow have passed real service checks.
- Configure endpoint, model ID, temperature, output-token limit, context budget, and structured-output mode. Prose and structured extraction currently share one connection/model; extraction uses a lower temperature and fitted output ceiling.
- Read model capabilities rather than assuming every endpoint supports schema-enforced output or streaming. Validate model output regardless of advertised capability.
- Configurable ComfyUI endpoint and workflow bindings; preserve the supplied original graph.
- Resolve prompt variables per subject and framing. Apply effective story/request content constraints before queueing generation; optional adult details never enter unrelated portraits by default.
- Character configuration includes a user-managed `noNsfw` flag, defaulting to `true` for all new/generated characters and imports missing the field. Users may opt adult characters in individually. Propagate it into relevant prose/image context and omit that character's adult-detail variables when selected. Story updates cannot toggle it, and a story-level adult preference cannot clear it. Use straightforward configuration and prompt assembly rather than a separate scenario-enforcement system.
- Report service status independently. ComfyUI being offline must not mark text generation unavailable.
- Copy/import only connection configuration from the other project, not its story saves or application-specific prompts.

## Build order and checks

1. Scaffold the local application, Git ignores, configuration example, and database/repository boundary.
2. Implement a fixed space-trader fixture with cast, ship, places, holdings, chapter, passages, and a recovery point. No API required.
3. Prove save/reopen and export/import, story isolation, and transaction rollback on failed commit.
4. Prove latest-only replacement, item transfers, pin enforcement, stale-revision rejection, and idempotent generation commit using deterministic fake results.
5. Connect LLM setup and passage generation with failure handling, then implement actual reading controls.
6. Add summary/recap coverage, workflow validation, ComfyUI jobs, and image associations.

Use meaningful automated checks for these invariants. Exercise realistic interruption/retry cases, not just successful model responses. UI appearance and narrative quality are walkthrough checks.

## Remaining implementation checks

- Runtime, SQLite, provider authentication/discovery, corrected supplied workflow and real local prose/images have been verified.
- Reference-image workflow execution remains pending.
- Continue evaluating narrative quality and generation latency through actual multi-chapter use.

October 19 setup/inventory verification: 200 automated tests, zero Svelte errors/warnings and the isolated setup-archive/inventory browser checks pass. They cover strict imports, independent copies, graph and quantity invariants, pins, stale/replayed requests, recovery, archive/restart persistence and mobile controls. See [Project status](PROJECT_STATUS.md) for final build state. Distribution packaging remains an explicit **Build Production ZIP.bat** action; no new archive verification is claimed here.

These are concrete environment checks, not new product features. They do not require inventing save migrations, forks, multiplayer, or a background world simulation.
