# Unfinished setup portability

An unfinished story can travel between libraries before chapter one is written. Library has separate **Import a setup ZIP** and **Export setup ZIP** controls. A setup with only its premise is valid; a generated or manually authored cast/world plan is optional.

Inside New story, **Save & export setup ZIP** saves current edits before downloading and checks that exact saved revision again for the ZIP request. A failed validation or revision conflict keeps the local form values and stops the download; it cannot silently export an older draft or another tab's newer edits as the edited result. Reload and review a concurrent change before retrying. Library exports the current saved draft. Imports always open a new editable setup, with a new application ID and revision zero. Repeated imports create independent copies. Importing, exporting and resuming a setup make no model or image requests and do not begin a chapter.

The copy preserves the premise, narration and art styles, passage/chapter length preferences, content notes, story adult-content preference, character No NSFW/appearance-pin preferences, record IDs and links, nested item/container ownership, hidden lore, planned knowledge and opening brief. Imported bag → pouch → possession chains remain editable and retain the same immediate and ultimate holders; cycles and noncontainer destinations are rejected. Editing an imported copy leaves the original unchanged. Saved imports remain available after an app restart. Ordinary story ZIPs retain their existing import/export controls and format.

The **Story settings · premise & storytelling preferences** section opens expanded for imported and resumed setups, including those with a cast/world plan. Edit and save these settings before beginning chapter one; no generation is required.

The **Background** setup tab exposes the complete lore collection, including World foundations, relevant notes and hidden entries. Add, edit or remove entries; change their titles/text, comma-separated keywords, related cast/place/item links and visibility, then use **Save setup draft**. Hidden entries remain excluded from narration. Relevant entries are selected by scene relevance and budget; background alone does not establish viewpoint knowledge. The World editor still edits its single foundations entry, and its targeted AI controls leave other background entries intact.

Background also offers targeted AI generation, revision, redesign and title rerolls. Requests use the selected entry and linked/named full records with a compact directory; IDs, visibility and other entries are preserved. **Always available (unlimited supply)** is an explicit item option in Possessions and survives setup ZIPs. See [Lore and supplies](LORE_AND_SUPPLIES.md) for the counting/authoring audit and the 313-test/four-browser-check follow-up; existing imported stock is never silently converted.

Initial **Generate cast & world** can now return zero to three concise background entries in the same model request. They describe useful customs, setting context or possible routines, with keywords and validated links to generated records. The app assigns IDs and `relevant` visibility. Guidance avoids duplicating profiles/current inventories, invented secrets and compulsory or already completed routines. Older model results without this collection remain valid. Imported setups are preserved rather than automatically enriched; whole cast/world regeneration retains its existing replacement confirmation and pin restrictions.

## Archive contract

Each setup ZIP contains exactly two entries:

- `manifest.json`: `{ "kind": "storyweaver-setup", "version": 1, "exportedAt": "<ISO timestamp>" }`.
- `setup.json`: the schema-validated saved `SetupDraft`, including a nullable plan and `storyId: null`.

The maximum compressed size is 5,000,000 bytes; expanded metadata is limited to 10,000,000 bytes, with at most 2,000 bytes for the manifest. Duplicate entries, extra files, unsafe paths, wrong archive kind/version, malformed UTF-8/JSON and unknown data fields are rejected. Canonical links, place/item containment, opening references and unwritten-story context restrictions use the same validators as normal setup saving. No database write occurs until the entire archive has passed validation.

Archives exclude connections, API keys, media, jobs, editor results, request receipts, references and application files. Import assigns a fresh UUID, revision, timestamps and internal creation request ID; receipt/job history is never copied. An already published setup is refused on both export and import. Use its written-story ZIP instead.

Unwritten plans can contain lore and planned knowledge with no passage source, but cannot carry passage/chapter/book memories, a nonzero memory correction epoch or knowledge source hashes. The same rule applies to normal setup saves, so an archive cannot introduce fictional written-history caches before chapter one.

Missing adult-content flags continue using the application's defaults: story adult content off and character No NSFW on. Explicit opt-ins in a valid saved setup are preserved. There are no migration promises for future development formats.

## Verification

The combined unit suite, Svelte/TypeScript checks with zero errors or warnings, production build and isolated setup/archive and inventory browser walkthroughs pass. The setup check includes concurrent edits between Save and download, retained form values, no stale download, bottom errors and mobile Help. The setup-pins walkthrough additionally verifies protected fields/rules through independent draft imports, chapter-one publication and story ZIPs. [Project status](PROJECT_STATUS.md) records the current count and broader verification. These checks do not require repackaging a production ZIP; packaging remains on demand through **Build Production ZIP.bat**.

- [tests/setup-archive.test.ts](../tests/setup-archive.test.ts): covers planned and premise-only roundtrips, nested containers, independent repeat imports, preferences/pins, invalid references, published rejection, strict field/file allowlists, malformed/oversized archives and repository reopen.
- [tests/inventory-integration.test.ts](../tests/inventory-integration.test.ts): covers generated container aliases → portable setup → approved opening, plus item effects, splits, pins, context retrieval and written-story archives.
- `node --import tsx scripts/setup-archive-smoke.mjs` ([script](../scripts/setup-archive-smoke.mjs)): build first; downloads, editable imports, saved current edits, unsaved navigation protection, bottom-panel errors, zero AI jobs and mobile layout.
- `node --import tsx scripts/inventory-smoke.mjs` ([script](../scripts/inventory-smoke.mjs)): nested ownership, moves, equipment, full-container protection, split conservation, failed revision checks, draft protection, story ZIP and restart persistence.

Both browser scripts use temporary app/config/data directories and leave normal user libraries and connection settings untouched.

October 20 background-editor checkpoint: 281 tests pass; Svelte check has zero errors/warnings and the production build passes. The isolated setup/archive browser check covers original settings before generation, all imported lore including hidden entries, title/text/keyword/link/visibility edits, add/remove, saved reload, ZIP export, independent original/import copies, unsaved navigation protection and 320px layout. Mocked setup-generation tests verify the single request, bounded entries, generated IDs/reference resolution, archive preservation and rejection of unknown links/oversized output. No live-model generation or release ZIP packaging was performed for this change.
