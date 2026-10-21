# Inventory stacks and containers

Updated October 20, 2026. Records → Items has a grouped **Inventory browser**, explicit stack splitting and nested item containers. The combined automated suite, Svelte checks with zero errors/warnings, and isolated inventory/setup-archive browser walkthroughs pass. Current counts, build and distribution status are tracked in [Project status](PROJECT_STATUS.md); production ZIP creation remains on demand.

## Organize possessions

An item's `ownerId` is its immediate holder: a cast member, a place, or another item marked **Container**. A pack can hold a pouch, and that pouch can hold a stack of cartridges. Paths such as `Elias Voss › Canvas pack › Drawstring pouch` show where an item is stored. The inventory browser groups all items under their eventual cast/place holder and lets you open any nested record.

To create storage, add an item with quantity 1, check **Container** and save. Open another item and choose the new container under **Owner / storage**. The same container fields and holder choices are available in new-story possessions. A moving item and its descendants are excluded from its destination options; server validation independently rejects missing holders, self-containment and cycles.

Containers always have quantity 1. Moving a bag or crate changes that container's holder; its contents keep their immediate links and travel with it. No duplicate items or individual content transfers are needed. A container must be empty before removal, conversion into an ordinary item, or an evidenced quantity reduction to zero. Move its contents elsewhere first.

Only an item held directly by a cast member can be equipped. Items inside bags and items stored at places are unequipped. Changing ownership clears equipment; take an item out of storage before equipping it. Container status does not automatically synchronize character wardrobe descriptions.

## Split a stack

Select a saved ordinary item with quantity at least 2, save or discard manual fields and AI drafts, then choose **Split this stack**. Enter **Quantity to split**, choose a **Destination**, review the remaining count and select **Split and save**. The operation leaves at least one unit in the original stack. A destination may be the same holder, another cast member, a place or a nested container.

The new stack receives an application-assigned ID and the exact original name and description. It starts unequipped and is not a container. The source retains its ID and remaining quantity. Both quantities commit together, preserving the total. Containers cannot be split, and stacks do not merge automatically. The result selects the new stack and reports both saved counts. A pending split participates in navigation/unload protection and can be discarded without changing inventory.

Manual splits use the story revision and request receipt. Failed, stale or duplicate requests cannot create a second handoff. An explicit manual split can change a pinned source quantity, just like another manual correction; the source's existing pins remain attached to its original record and protect its newly saved values. Pins are not copied onto the new stack.

## Generated changes and pins

**Handover consistency, October 20:** generation now uses scoped extraction plus a targeted check of potential possession/clothing actions and item effects. The check compares prose, before/after records, effects and memory; missing transfers, unsupported transfers, duplicates or partial exchanges can trigger one extraction repair and recheck without regenerating prose. Persistent uncertainty, failure or cancellation prevents saving. See [first fixes and evidence](SCOPING_FIXES.md). Structural validation alone still proves neither semantic completeness nor entailment, and the model-based check is fallible. Existing old ownership drift is not automatically rewritten.

Narration effects can create/update container status, move whole stacks, change quantities or split a partial handoff. `item.split` supplies a new local reference, existing item ID, expected current quantity, moved quantity, destination holder and source evidence. The application assigns the new ID and conserves quantity. Follow-up effects that reference the new stack must appear after its split; extraction instructions state this ordering. Quantity updates remain for consumption, acquisition or loss rather than a second subtraction of the same split units. The complete generated effect batch validates its final graph before prose or world changes commit.

Current-record AI edits and coordinated correction previews use the same container/equipment rules. A correction involving partial quantities can propose a source reduction and a new recipient stack for explicit review. Read the Before/After values; model interpretation and evidence remain review concerns.

The item's **Owner / storage** pin protects its immediate holder. It does not prevent that holder's bag from moving. **Ultimate owner / location** protects the eventual character/place at the end of the item ownership chain, including indirect changes caused by moving an ancestor container. Pin **Container** to protect container status, or **Quantity** to protect a stack count. An ownership pin protects the existing record; a partial split can still move units into a new record unless Quantity is also pinned. Structured AI commits reject the entire conflicting proposal; explicit manual edits remain possible. See [Pinned facts](FACT_PINS.md).

Narrator context selects equipped items, direct-scene objects, explicit references and pinned items, retaining necessary storage ancestors without expanding unrelated siblings/contents or ancestor-location freight. Mentioned absent characters do not automatically bring personal inventories. Each included item names its immediate holder, root holder and storage path. Exact historical events about participant possessions remain eligible independently. Full server-side canon still validates committed changes; prompt omission is not deletion.

## Persistence and limits

Container links and stack quantities are canonical records, so normal saves, story archives and latest-passage recovery retain them. A manual split/move/correction invalidates the latest event-replacement baseline and derived memory in the same way as existing manual inventory edits. A later continuation establishes a new replacement baseline. Historical prose and pictures are not rewritten by an inventory correction.

There is no automatic stacking, capacity/weight simulation, numerical equipment system, unique-property model or multi-account currency ledger in this slice. Place/ship containment remains separate: an item can be stored in a room, and moving the room's parent ship retains that room link.

## Verification

October 20 follow-up adds **Always available (unlimited supply)** to setup Possessions and written-story Records → Items. Choose it explicitly for everyday supplies that should not run out, such as a character's pony treats. Ordinary use leaves the source available; portions taken away are counted items. Holder/storage paths still apply. Leave it off for exact stock counts, naming the counted unit clearly. “Sugar Cubes” quantity 1 is one cube; mentioning a tin in its description does not establish its capacity.

Unlimited supply records are noncontainers and unequipped; a tracked tin can instead contain the supply record. The source's saved quantity 1 identifies that source rather than one remaining piece. AI edits preserve the mode, and archives/pins/recovery retain it. The follow-up also repairs malformed extraction once and safely detaches/restores lore links when the last counted unit is consumed. See [lore and supplies](LORE_AND_SUPPLIES.md) for semantics, evidence and limitations. The combined follow-up has 313 passing tests, clean type/build checks and four isolated production browser checks, including source editing, restart and ZIP preservation.

The combined foundation passes its automated suite and Svelte checks with zero errors/warnings. `tests/inventory.test.ts` covers legacy and nested holders, safe container moves, split conservation and failure atomicity, ID/reference allocation, evidence/quantity preconditions, cycles, equipped contents and final-batch validation. `tests/inventory-integration.test.ts` covers repository CAS/replay, archive round trips, recovery, generated splits, ultimate-holder pins, effective container defaults, context paths and preserving omitted AI fields.

`node --import tsx scripts/inventory-smoke.mjs` passed isolated production/browser acceptance: nested browsing, eligible destinations, full-container/equipment rules, save/AI draft guards, split confirmation, conflict/reload with retained values, navigation/unload protection, moving full containers, creating quantity-one containers, 320px layout, story ZIPs and restart. The setup-archive walkthrough also passes independently. These checks use temporary libraries and leave normal saves/settings untouched. No new production ZIP is implied by browser acceptance; run **Build Production ZIP.bat** when a distribution is needed.


## Occupied vehicles and parked equipment

Use a moving place for a vehicle that people can occupy, with cab/room child places where needed. Move the vehicle through its parent place; occupants retain their cab/room ID until they enter or exit. Cargo can belong to the vehicle place or a container item such as its feed bin. Do not create a second item for the same vehicle. See [the ranch/vehicle pass](SCOPING_PHASE_FOUR.md) and [importable fixtures](../exports/ranch-scope-test/README.md).

An existing item vehicle remains an item until deliberately restructured. Its ownerId is the immediate holder/storage pointer. If a person-held vehicle is parked and the person walks away, its holder must become the parked place so it stops following that person. This does not establish a separate legal owner; title ownership is not yet independently modeled.
