# Lore, counted stock and always available supplies

October 20, 2026. This checkpoint addresses the reported chapter-one sugar-cube failure and the interaction between background routines and mutable inventory. **313 automated tests pass**, Svelte check has zero errors/warnings, and the production build passes. Four isolated production browser checks pass: story generation/recovery, setup archives, inventory and targeted setup design. Model responses were deterministic test doubles; no live local-model quality claim or release ZIP refresh is implied.

## Observed failure and interpretation

The reported setup saved **Sugar Cubes**, quantity **1**, with description **“Small sugar cubes as pony treats in tin.”** The supplied extraction tried to consume that record with `item.quantity expectedQuantity:1 quantity:0`, then split two cubes from it with `item.split expectedQuantity:1 quantity:2`. The split schema requires an expected quantity of at least two. Removing the first record and then splitting it would also be invalid even if that schema check were relaxed. The rejected batch saved neither prose nor world changes.

The saved name suggests individual cubes, while the description mentions storage. That does not establish whether the author intended one cube, one stocked tin, or an unspecified supply, and it supplies no exact number of cubes in a tin. The application cannot safely invent stock, reinterpret the unit, or enable unlimited mode from that text. Existing/imported records keep their saved meaning until the reader edits them.

For finite inventory, name the counted unit clearly: **Sugar Cubes × 20** means twenty cubes; **Tin of Sugar Cubes × 1** means one tin whose internal count may be unspecified. A separately tracked tin is a quantity-one container; counted cubes can belong to it. There is no automatic conversion between tins, cubes, handfuls, capacity or weight. Narration, extraction and verification now explicitly distinguish consumption from a retained handover and prohibit creating a recipient stack for already consumed pieces.

## Implemented supply behavior

Both setup Possessions and written-story Records → Items expose **Always available (unlimited supply)**. Only the reader chooses this policy. The optional saved `unlimited` flag defaults effectively to false when absent; old items remain counted.

- An unlimited source has internal quantity one, is not a container and cannot be equipped. That one identifies the supply record; it is not one remaining piece. Enabling the option sets quantity one and clears equipment.
- Ordinary direct consumption leaves the source unchanged. Eating two treats records the event in passage memory without subtracting from or splitting the source.
- A retained portion uses evidenced `item.draw`: it creates an ordinary counted stack with the supplied amount and destination, copying the source name, description and reusable visual design. The source remains unchanged. The portion can subsequently move, split or be consumed under the existing counted rules. Immediate consumption needs no drawn stack.
- Whole-source transfers and storage paths still apply. A supply in Alex’s tin follows that tin; a distant supply does not become available everywhere. Model verification checks source and destination paths.
- Quantity changes, stack splitting and equipping cannot deplete or transform an unlimited source. Ordinary generation effects cannot create or change the policy. Setup/story AI edits preserve the saved flag; only manual item editing can switch modes.

The mode survives normal saves, setup/story ZIPs, latest-passage recovery and item editing. **Always available supply** is also a supported field pin. A source can retain its pinned count/holder/policy while producing an evidenced finite portion. New portions do not inherit the unlimited policy or the source’s pins.

Implementation: [canonical item schema](../src/lib/story.ts), [inventory rules](../src/lib/inventory.ts), [effect schemas](../src/lib/effect-types.ts), [effect application](../src/lib/story-effects.ts), [setup editor](../src/lib/NewStory.svelte), [record editor](../src/lib/RecordEditor.svelte), [pins](../src/lib/fact-pins.ts), [correction validation](../src/lib/server/record-editing.ts).

## Lore audit and authoring changes

Background entries are static authored context. A routine saying where food is kept or how someone usually feeds a pony can become stale after consumption, movement or other events. It must not refill stock, override current holders/locations, establish completed actions, or grant the viewpoint knowledge. Generation instructions now state those distinctions. Initial setup background generation favors concise durable setting facts and optional routines over changing inventory totals and compulsory checklists.

Setup → Background now supports targeted AI **create, revise, full redesign and title reroll** in addition to manual editing. Revision preserves the selected entry’s ID and visibility, including a deliberately selected hidden entry. New generated entries start relevant. Other hidden entries are omitted. Requests use the selected entry, linked or explicitly named current records and a compact entity directory; they do not send an unrelated full world dump. Links validate against authoritative saved records.

The separate World foundations operation now looks for a visible entry actually titled **World foundations**, ignoring case and surrounding whitespace. It no longer falls back to overwriting an unrelated visible background entry when that title is absent.

Consuming the final counted unit can remove an item record. Automatic commits now detach its dangling lore links while preserving the lore text. Latest-passage recovery retains a bounded link receipt and restores automatically detached links when the item returns. Restoration checks that the current link list still matches the automatic result so it does not overwrite a later author edit.

Implementation: [setup design contract and foundation lookup](../src/lib/setup-generation.ts), [scoped background generation](../src/lib/server/setup-generation.ts), [lore link maintenance](../src/lib/server/lore-references.ts), [atomic passage commits](../src/lib/server/passage-commit.ts).

## Invalid-effect recovery and evidence

Effect fields, evidence anchors and canonical preconditions are now checked before semantic inventory review. A structural failure enters the same **single bounded extraction repair** used for semantic disagreement. The repair receives the original prose, complete previous extraction and specific issues; it must preserve valid changes and fix effects/memory without regenerating prose. Validation and any required inventory review run again. Persistent failure or cancellation saves nothing; structural and semantic failures do not each receive a separate repair allowance.

Deterministic tests cover counted compatibility, invalid supply combinations, protected source counts, finite draw identity/ownership, invalid quantities/references/evidence, atomic failures and policy protection. Mocked integration tests pass setup/story archive and recovery checks, pins, a chapter-one direct-consumption flow with no item effects, retained draws with source/portion/storage verification, and setup/story AI editing. Additional mocked tests exercise malformed fields, stale quantity preconditions, invalid evidence, persistent disagreement and cancelled repairs; lore tests cover editing scope and link removal/recovery.

Evidence: [supply domain tests](../tests/unlimited-supply.test.ts), [supply integration tests](../tests/unlimited-supply-integration.test.ts), [effect repair tests](../tests/effect-repair.test.ts), [lore link tests](../tests/lore-references.test.ts), [setup generation tests](../tests/setup-generation.test.ts), [generation and repair](../src/lib/server/story-generation.ts), [inventory verification](../src/lib/server/inventory-review.ts).

These are deterministic or mocked results, not live-model quality findings. No live calls, installed-save changes or production ZIP refresh were performed for this checkpoint. Prose/lore interpretation and semantic verification remain fallible. Unlimited mode is an authoring policy rather than a simulation of physical infinity; older authored prose and background text are not automatically rewritten.
