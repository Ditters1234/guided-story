# Scene preparation and lore follow-through review

October 21, 2026. This pass reviews the implementation in [Scene preparation](SCENE_PREPARATION.md), including its interaction with narration, lore, supplies, author drafts and persistence. Earlier checkpoints remain historical.

## Reproduced defects and fixes

**Reviewed resources were discarded before narration.** A valid preview could reuse a nested, unequipped supply, but applying copied only its brief and additions. A generic brief then omitted that supply from both opening and continuation context. Optional author selections could also disappear if the model omitted them from its reuse list.

Prepared briefs now retain a bounded optional `resourceIds` list containing explicit selections, reviewed reused records and additions. Openings and continuations use those IDs, including necessary storage/location paths. Task, relationship and nonhidden background references follow one bounded layer of explicit dependencies; containers do not expand into unrelated contents. Character resources remain references unless selected in the cast. These hints establish neither physical presence nor viewpoint knowledge. Required reviewed records cannot silently disappear under budget pressure: an oversized required prompt refuses generation.

The hint list is visible and removable in brief editors. It clears with the one-shot brief after an accepted opening/continuation. Replacement and ordinary author edits retain the future plan while detaching references to removed records; hiding/removing lore detaches its former hint. New missing, hidden or duplicate references still fail validation. Old briefs remain unchanged when the optional field is absent. Archives and database restart retain prepared hints.

**Setup actions bypassed the preparation draft warning.** Direct links to pins, Begin chapter one and whole-setup regeneration could discard local preparation input or an unapplied preview without the ordinary tab guard. These paths now include the preparation draft in their confirmation. Successful whole-setup regeneration also clears obsolete selections by returning to Cast.

**Scene preparation contradicted the quantity contract.** Its prompt suggested that a count of one with tin/bag wording always meant a package. That could reinterpret the reported Sugar Cubes record. The prompt now agrees with narration/extraction: storage alone does not define a package unit, unclear stock remains uncertain, and only a reader-saved Always available flag permits undepleted supply use.

**Measured-selection filters interrupted lore editing.** Editing an Included/Excluded result correctly invalidated the context preview, but also removed the focused editor from the filtered list. The first unsaved edit now resets that selection filter to All. Inclusion labels still report that the draft has no current measurement; stale preview results are not presented as current.

**Existing task notes were missed with real UUIDs.** Preparation matched selected character names and exact IDs in task notes, but missed selected item/place names. UUID-backed records exposed this while convenient slug fixtures concealed it. Task selection now recognizes those exact names too, retaining relevant open notes and excluding unrelated/resolved tasks.

## Persistence and lore review

Independent review and isolated tests found no additional material defect in source-kind separation, revision/hash checks, retained-only apply, transactional source/marker/receipt updates, replay protection, cancellation, supply policy preservation or lore-link recovery. Preparation does not modify saved counts/holders, written history, knowledge or memory. These checks do not prove semantic necessity of every proposed addition or correctness of authored lore.

## Live-model observation

One synthetic stable preparation request used the saved **Nimbz/Schattenblume-31B-GGUF** connection with the existing **32,000-token context budget**, a 60-second timeout and a 3,072-token output ceiling. It completed in about **40 seconds**, using one provider call. It reused both characters, both places, the treat tin, unlimited sugar source, counted hay, scoop and existing feeding lore. It added no duplicate places/items/lore and proposed one open feeding task. All existing inventory and the source object remained unchanged; selected supplies reached the subsequent opening scope.

The proposed task still requires author review for usefulness and wording. This is one preparation result, not a narration, extraction, sustained-story or literary-quality evaluation. The reproducible probe uses isolated diagnostics and no library/settings writes: [script](../scripts/scene-preparation-live-smoke.mjs), [saved observation](../test-results/scene-preparation-live.json).

## Verification

All **354 tests pass** (11 added regressions), Svelte check reports zero errors/warnings, and the production build passes. Four isolated production browser checks pass: scene preparation, Dev Lore, story creation/continuation/replacement and setup archives. Browser checks include dismissed draft warnings, selected-resource retention and manual hint editing, setup task removal/lore hiding, filtered lore editing, stale refusal, replay, cancellation, provider failure, restart and 320px layouts. Deterministic browser providers are separate from the single real-model observation above.

Normal installed saves/settings and historical fixtures are preserved. The workspace production build is refreshed; release ZIP creation remains on demand.

- [Engine and narration regressions](../tests/scene-preparation.test.ts)
- [Removal, visibility, archives and restart regressions](../tests/scene-preparation-followthrough.test.ts)
- [Scene preparation browser checks](../scripts/scene-preparation-smoke.mjs)
- [Lore browser checks](../scripts/lore-dev-smoke.mjs)
