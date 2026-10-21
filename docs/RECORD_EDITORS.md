# Story records and library controls

Implemented October 17, 2026; inventory and unfinished-setup portability expanded October 19. Use **Records** in the main navigation, or **Manage cast records / Edit places / Edit items / Edit relationships** in the reader notebook.

## Current records

Each section has a saved-record picker, an **Add** action, explicit **Create / Save record**, **Reload saved record** and **Remove record** controls. IDs are assigned by the server on creation and remain stable through edits.

| Section | Editable fields |
| --- | --- |
| Cast | Name, role, shared visual identity (actual/apparent age, gender/presentation, species, skin/build/face/hair/eyes/features), lasting personality/voice/motives/history, separate current feelings and immediate intentions, regional wardrobe, injuries, supplemental notes, location, appearance/outfit pin, No NSFW; derived appearance/outfit summaries |
| Places | Name, narrative description, optional reusable visual description, parent place/ship/location |
| Items | Name, narrative description, optional reusable visual description, positive whole-number quantity, immediate cast/place/container holder, container flag, equipped/worn state; saved-stack splitting and nested inventory browser |
| Relationships | From/to cast members and directional relationship notes |
| Threads | Title, notes and open/resolved status |

Setup, Records and the reader notebook share the same profile editor. Changes to structured fields regenerate appearance/outfit summaries; those summaries are read-only. Returning from image identity edits or record reloads refreshes the notebook draft so stale fields cannot overwrite a newer saved profile. See [Character profiles](CHARACTER_PROFILES.md).

**Current state** is a short text note for temporary feelings and immediate intentions; enduring traits remain in persona. **Visual description** captures place/object shape or layout, materials, colors, scale and distinguishing features for pictures. Its narrative description remains separate. These fields are optional for existing records, participate in field pins, and require no extra model calls. AI corrections and sparse narrated updates preserve an omitted value. Splitting an item copies its saved visual design into both stacks.

Shared funds/cargo notes remain in the reader's World notebook. Story title, premise, narrator/art styles, content preferences and length targets remain in Settings → Story. Existing character photobooks and the shared gallery retain their media controls. The dedicated **Pins** view protects supported written-story record/world fields and established world rules; see [Pinned facts](FACT_PINS.md) for behavior and verification. Multiple currencies, capacity/weight rules and automatic stack merging remain future scope.

Changing an item's owner clears its equipped checkbox; it can then be explicitly equipped when directly held by a character. A place or container cannot equip its contents. Ship/room containment must be acyclic: moving the ship to a destination carries its internal rooms without moving each room or crew member separately. Quantities must be 1–1,000,000; removing a whole stack uses Remove record.

**Inventory browser** groups possessions by ultimate cast/place holder and opens nested records. Check **Container** on a quantity-one item to make a bag/crate available as storage; choosing it under **Owner / storage** nests another item. Moving a container carries its contents without changing their immediate links. Empty it before removal or turning off Container. The server rejects missing holders, self/cycles and stacked containers.

For a saved ordinary stack of at least two, **Split this stack** opens a quantity/destination form with the remainder shown before **Split and save**. Manual/AI drafts save or discard first. The app preserves the total, exact name/description and original ID, assigns the new record an ID, and makes it unequipped. A pending split has normal discard/unload protection. Item pins may protect immediate storage, quantity/container status, or ultimate ownership through ancestor bags; AI changes remain atomic, and manual splits intentionally update the saved values protected by the source's existing pins. See [Inventory](INVENTORY.md) for contracts and current verification.

## In-story AI options

Each record editor now offers **AI edit type**, **Record edit direction** and **Preview AI changes**. Revise and full redesign edit only the selected saved record; name/title rerolls change one field (relationships have no name reroll). Select Add/new and describe it to preview creation of one record. Review the explanation and field-by-field Before/After, then explicitly **Apply corrections**. Pins, content preferences, stable IDs and reference checks remain protected; AI cannot delete records.

Save manual fields first or **Reload saved record** before using AI; the form explains that it reads saved values. Directions/previews are protected when switching sections, picking another record or leaving the page. Failed requests retain the direction. A changed revision/source or changed request/edit type requires a fresh preview or restoration of the original request. Applied additions select the newly assigned record. For a trade or another fix involving several records, use **I noticed something needs correction** below a passage. See [In-story corrections](STORY_CORRECTIONS.md) for context limits, wardrobe/item coordination and persistence.

## Save and correction behavior

Edits correct current canon; they do not insert a narrated event or rewrite historical passages. Saves use expected revisions and request IDs. A conflicting tab or generation cannot overwrite a newer save; failed fields remain on screen. Reload fetches the latest story after confirmation and clears the old pending request so another save can succeed.

Field pins protect against AI changes, while explicit manual record edits can still change the saved value a pin protects. In-story AI previews/apply and narrated structured updates reject pinned changes atomically. Removing a written-story record prunes only its field pins; the current pin configuration is preserved through latest-passage recovery. Setup has the same field/rule controls under **Pins & rules** and requires unpinning a record before removal. Setup pins transfer into chapter one. Existing appearance/outfit pins remain separate.

Switching record/section or leaving Records asks before discarding unsaved fields. Browser reload/close uses the normal unsaved-page warning. The reader notebook also tracks unsaved character, world and per-thread drafts, with saved/unsaved status and reset controls. Thread typing changes a separate draft rather than the saved canonical record; a failed save keeps the entered values.

Passage/chapter title editing opens and focuses its input, shows unsaved state and asks before cancelling a changed title, leaving its passage or opening a rewrite that would close it. Recaps have **Save recap** and **Reset recap to saved**. Leaving the reader or recap screen asks before discarding pending changes. Settings, scene direction and Gallery have their own matching draft protections. All still require explicit Save; no general draft autosave was added.

Acknowledged story refreshes update untouched notebook funds, cargo notes and threads while retaining edited fields. Reloading a newer saved balance therefore does not leave an old balance looking like a new unsaved correction.

An actual canon change invalidates the latest event-replacement baseline and derived chapter/book memory through the correction epoch. Continue forward to establish a new baseline. Saving identical values, renaming a story and ordinary media edits leave that baseline intact. Historical passage notes/event receipts can still describe past events; current canon takes precedence over them. Reader recaps become stale when their source facts change.

## Removing current records

Removal requires confirmation. Dependency failures explain the steps needed instead of silently moving people, deleting possessions or dropping relationships:

- A character must first transfer possessions and remove relationships. At least one cast member remains.
- A place must first move its child places, occupants and stored possessions. At least one place remains.
- A container must first move its contents. There is no cascading removal of nested possessions.
- Removing a current entity clears its active scene-brief references, lore links and cast/place indexing in continuity records. Historical prose, facts and event receipts remain.
- Photographs preserve depicted IDs and original snapshots. Current portrait/reference selections for removed characters are cleared; the pictures remain in Gallery.
- A relationship or thread can be removed independently. Removal has no cascading history rewrite or undo stack.

## Library

Library supports **Rename story**, **Delete story**, **Discard setup**, refresh, resume and separate story/setup ZIP export/import. An empty library shows a clear start/import state. Imports always create independent stories or editable unfinished setups.

**Export setup ZIP** downloads the last saved unfinished draft, including a premise-only draft or a complete editable plan. Inside New story, **Save & export setup ZIP** saves current edits first. **Import a setup ZIP** opens a separate editable copy without calling a model or beginning chapter one. Its preferences, record links and container contents are retained; credentials, media, jobs and receipts are excluded. Published setups use their written story's ZIP instead. See [Unfinished setup portability](SETUP_ARCHIVES.md).

Deletion/discard requires a browser confirmation and the current saved revision. Active text, setup, preparation, memory or image jobs block removal; finish or cancel them through Dev → Jobs first. The server checks all active scoped jobs before deleting, so a busy record cannot be removed through a direct DELETE request either.

Story deletion removes the story, its mutation/generation receipts, editor results, correction previews and linked original setup. Unfinished setup discard removes that draft and its setup receipts; a completed setup must be removed through its written story instead. Durable removal receipts make an uncertain repeated delete safe. Late generation commits find no source story/setup and cannot recreate it.

Content-addressed original picture files remain on disk because imported copies may share them; Dev Media can report unreferenced files. This is library removal, not secure erasure. Developer diagnostics and terminal job history retain their normal separate retention. Export the matching story/setup ZIP before removing a library entry if you want a portable copy.

## API and verification

- `PATCH /api/stories/:id`: `record-save` with a typed edit, `record-remove` with kind/ID, or `story-title`.
- `PATCH /api/stories/:id`: `item-split` with source item ID, moved quantity and destination `ownerId`, under the normal revision/request receipt.
- `DELETE /api/stories/:id` and `DELETE /api/setups/:id`: strict `{expectedRevision, requestId}` bodies.

`tests/record-editing.test.ts` verifies atomic corrections, assigned IDs, replay, invalid containment/ownership/equipment, dependency checks, historical pictures, stale edits, deletion durability, shared originals, late-result rejection and scoped job blocking.

`node --import tsx scripts/records-smoke.mjs` checks the actual forms, unsaved navigation, conflict/reload/retry, restart, 320px editors/library, rename/delete/discard, independent imported copies and the empty-library state. All data/configuration/cache are temporary; normal play saves and keys are untouched.

`node --import tsx scripts/draft-cleanup-smoke.mjs` additionally checks notebook world/thread drafts, title focus, recap save/reset/failure recovery and navigation/unload protection across reader, Settings, scene and Gallery forms.

October 19 inventory/setup expansion: all 200 automated tests and Svelte checks with zero errors/warnings pass. The isolated inventory and setup-archive browser walkthroughs pass nested storage, safe destinations, quantity-conserving splits, draft/conflict protection, independent saved imports, bottom-panel failures, restart/archive persistence and 320px layout. See [Inventory](INVENTORY.md) and [Unfinished setup portability](SETUP_ARCHIVES.md) for exact coverage. Production ZIP packaging is on demand; this checkpoint does not claim a new archive was produced.
