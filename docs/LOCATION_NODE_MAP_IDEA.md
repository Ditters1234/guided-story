# Location-first node map idea

October 21, 2026. This records the user's location-first map design alongside the recovery review. It is included in the approved [node-workflow milestone](NODE_WORKFLOWS.md). The saved-world map and existing-editor integration are now implemented in [phase 4](NODE_WORKFLOW_PHASE_FOUR.md); model context selection remains unchanged. The design discussion below records the original intent.

## User intent

Begin with a base map of location nodes. Each location connects to its related entities; expanding those entities reveals their own connections downward. The purpose is to see and edit the world without repeatedly switching between lists. Selecting a node could open its existing record editor beside the map.

An example focused view:

```text
Ranch
  Stable                         inside Ranch
    Stable aisle                 inside Stable
      Alex                       currently at Stable aisle
        Treat tin                held by Alex
          Sugar Cubes            stored in Treat tin
    Erin's stall                 inside Stable
      Erin                       currently at Erin's stall
    Feeding custom               related background
    Prepare evening feed         future task / story thread
```

This is a proposed presentation using existing record types. The locations, people, items, lore and task names above are examples, not new canon to insert into any saved story.

## Meaning of connections

| Connection | Existing meaning | Presentation boundary |
| --- | --- | --- |
| Place → subplace | `parentId` containment | A parent link does not establish a door, road, route or distance. |
| Place → character | Current `locationId` | Characters in a child room can be shown through its ancestor path; references to absent people stay separate. |
| Holder/container → possession | Immediate `ownerId` holder/storage | This does not establish legal ownership. Moving a container carries its nested contents under existing validation. |
| Record → lore | Explicit `relatedIds` | A related entry does not make its referenced items physically present. Hidden author lore needs a visible badge and does not become viewpoint knowledge. |
| Scene → resources/task | Saved preparation brief hints and existing threads | Future preparation remains an intention, not a completed event or mandatory checklist. |
| Viewpoint → established knowledge | Existing supported knowledge/memory records | Canonical truth and graph visibility do not grant knowledge to a character. |

Occupied vehicles remain moving places with cab/room children. An expanded map must not introduce a second item record for the same vehicle. Entities with multiple connections should retain a single canonical ID, with clearly marked references where useful rather than duplicated editable records.

## Planned world-map slice

1. Add an optional Map view for setup and written stories, built from current saved places and typed connections. Start collapsed with root places; search or select the current scene to focus a small neighborhood.
2. Expand sublocations, people and possessions downward. Containers can expand further. Lore/tasks use labeled related branches or a switchable overlay so they cannot be mistaken for physical contents.
3. Selecting a node opens the existing validated editor. Saving, stale-revision handling, fact pins, manual recovery invalidation and unsaved-change guards keep their current semantics.
4. Treat dragging as visual layout only. Physical moves or link edits require an explicit action with a named relationship and the existing server validation. Layout belongs to separate UI state, not fictional canon.
5. Preserve keyboard navigation, search and a list alternative. Avoid expanding a large world's entire inventory by default.

The visible author map must not become an automatic full-world model prompt. Existing deterministic selection, explicit scene preparation, compact references and context budgets remain authoritative. Selecting a graph node is inspection; adding it to a scene brief is a separate authoring action.

The approved node-workflow milestone also includes a complementary executable generation graph: narration → extracted changes → consistency check / bounded repair → existing acceptance policy and atomic save. Follow that plan for delivery order; this document specifies the world-map side. It would expose existing saved stages and permit supported retries from retained inputs. It would not add new automatic model calls or allow an incomplete branch to bypass the complete atomic passage commit.
