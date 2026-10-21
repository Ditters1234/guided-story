# Node workflows phase 4 — location-first world map

October 21, 2026. Phase 4 connects the saved world to the existing editors. It adds no provider stage, world migration or context-selection policy. Editable workflow definitions and presets remain phase 5.

## Author behavior

Written stories have **World map** in Story navigation. Saved setups with a plan have **Explore setup map** above their section tabs. Both begin with collapsed root locations; browser-saved expansion/layout can be resumed on later visits. Search reveals matching physical paths without expanding unrelated inventory. Focus current scene follows the saved brief location, or its viewpoint's current location, and opens only that path and its immediate neighborhood. Diagram and List expose the same bounded physical projection, with explicit load-more controls.

Physical links retain their existing meanings:

| Link | Saved source | Meaning |
| --- | --- | --- |
| Location containment | `parentId` | A sublocation is inside its parent; no inferred road, door or distance. |
| Current presence | `locationId` | A character is at this place. Mentioning someone does not place them here. |
| Immediate storage | `ownerId` | An item is held directly by a character or stored directly at a place/container; no legal title is inferred. |
| Related references | Lore `relatedIds`, directional relationship endpoints | These open the same saved record through multiple references; they are separate from physical children. |
| Future tasks / scene resources | Threads / brief `resourceIds` | Intentions and explicit context hints; no completed event or physical placement is inferred. |

Occupied vehicles remain places containing cabs/rooms. Moving their parent through the existing editor carries the containment path; descendants and possessions are not rewritten or duplicated. Item tags distinguish finite quantities, containers and explicitly saved Always available supplies. Existing finite supplies are not converted.

Hidden lore is excluded from map search/references by default. Show hidden author background exposes an author badge and its existing editor; Add to scene references is disabled for it. Map visibility establishes no viewpoint knowledge. Advanced knowledge/memory editing stays in its existing interface.

## Editors, saves and layout

The written-story map embeds `RecordEditor` and the author `LoreDevPanel`. Selection changes ask before discarding unsaved fields, split drafts or AI instructions. Search, expansion, focus, layout and background visibility leave the active editor mounted. Global navigation/unload guards include map drafts. Reloading the saved world keeps unsaved fields, including a selected record removed in another window. Record baseline revisions now block saving/removing/splitting stale fields until explicit Reload saved record; lore keeps its existing context baseline guard. A clean deleted selection closes instead of becoming a duplicate record.

The setup map filters the existing `NewStory` forms to the selected saved ID. All setup fields and unused AI directions remain in the shared draft when selecting another node or returning to normal tabs. The diagram reads the saved plan; the draft/saved distinction is labeled. Save setup draft retains the existing expected-revision check and whole-plan validation. A hidden or removed draft resource is refused when adding a scene hint. No setup mutation endpoint was added.

Story record saves retain server validation, reference/pin rules, atomic commits, memory invalidation and latest-passage recovery invalidation. There is no drag-to-transfer or drag-to-reparent operation. Move handles support pointer dragging and keyboard arrow movement; expansion/selection/buttons also work from the keyboard. The scrollable diagram and List fit narrow screens. Moving a card writes only validated version-1 layout state in `localStorage`, keyed by source type and ID. Layout stores expansion, mode and positions separately from canon; archives, workflows and model context receive none of it. Invalid/unknown layout fields/IDs are rejected or filtered; storage failure leaves the map usable.

**Add to scene references** is explicit. In a story it saves the existing `scene-brief` action; in a setup it edits the draft until Save setup draft. It deduplicates and observes the existing 250-reference limit. Inspecting a record, searching or changing layout never adds a context hint. Hints remain removable through the existing scene/opening brief controls. No selected record is automatically supplied to a future editable workflow; that binding interface belongs to phase 5.

## Verification

**458 automated tests pass** (nine new map checks), with zero Svelte errors/warnings and a successful production build. The existing non-blocking bundle-size advisory remains.

Deterministic map tests read historical Brasswater and Red Willow Ranch fixtures without rewriting them. They cover collapsed roots, nested storage/presence/containment, focused search without unrelated stock, scene focus, hidden lore, related/future references, bounded/cycle-safe traversal, validated separate layout, bounded/deduplicated hints, unchanged authoritative records and exact equality of scoped narration context before/after author-map inspection. Existing server tests continue to cover manual mutation/recovery, pin/ownership/reference rules, setup revisions and atomic saves.

Seven isolated production browser suites pass:

- `world-map-smoke`: Brasswater/ranch maps; pointer and keyboard layout with persisted positions and unchanged source; List/Diagram; dirty filtering/navigation/selection; failed source reload and retry; another-window revisions/deletions with retained fields, stale-save refusal and explicit reload; existing record/background saves; explicit scene hints and hidden-lore refusal; setup draft preservation across selection, saved edits and moving tractor containment; 320/390px overflow. Its providers are unavailable and no jobs/model calls occur.
- `records-smoke`: existing record, ownership/equipment, character-profile, stale-save/reload, source deletion and narrow-screen checks.
- `setup-records-ui-smoke`: existing large setup/Records searches, holder controls, filtered drafts and 320px access.
- `ui-navigation-smoke`: library/notebook draft guards, keyboard navigation, narrow-screen routes and coarse-pointer behavior.
- `story-smoke`: controlled-provider setup/opening/continuation/replacement, atomic updates, cancellation/restart and setup tabs.
- `passage-recovery-smoke`: controlled effects-only recovery, unused-guidance/source guards, concurrent publication and narrow screens.
- `workflow-inspection-smoke`: existing typed stage inspector, retained-artifact recovery, current-source checks and history lifecycle.

Desktop diagram/list and narrow story/setup screenshots were visually inspected. Browser checks use temporary data/configuration outside the Windows sandbox. No real-provider generations, normal library/settings changes, historical fixture rewrites or release ZIP rebuilds were performed. This is deterministic/browser evidence, not a new live-model quality assessment.

## Next phase

Start phase 5: editable supported built-in workflows, typed connections, explicit source/model bindings and reusable versioned presets. Keep default call/context budgets, source freshness, mandatory final validation and atomic recovery. Arbitrary scripts/plugins and unrelated expansion remain deferred.
