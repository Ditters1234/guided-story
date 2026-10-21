# Reviewed scene preparation and lore diagnostics

Latest follow-through: [October 21 thorough review](SCENE_PREPARATION_REVIEW.md), with 354 tests, clean checks/build, four isolated production browser checks and one short real-model preparation probe. It fixes retained resource selection, existing-task relevance and author draft issues. The original implementation checkpoint below remains historical.

October 21, 2026. The author can explicitly prepare a future scene using existing records and proposed missing details. This is a requested authoring tool, not an automatic planning step added to narration.

## Prepare a feeding scene

In an unfinished setup, save the current fields and open **Prepare scene**. In a written story, use the **Prepare scene** navigation entry or **Prepare missing scene details** under Scene direction. Enter a request or use **Feeding scene example**. Optional cast/place/item selections supply context; they do not move anyone.

**Preview scene preparation** makes one model request and retains a reviewable result without changing the story/setup revision or its canon. The preview shows existing records to reuse, proposed places and possessions, open tasks, relevant background, and the next-scene brief. Review it, then choose **Apply scene preparation**. Clear a local draft or return to a saved preview without regenerating it.

Tasks use existing open story threads. They describe goals or possibilities, not completed events. Preparing does not write prose, feed an animal, consume supplies, move a character or alter an existing record. Apply adds reviewed author-supplied world details and replaces the future brief. New possessions are ordinary counted items; only the reader can subsequently choose Always available in the item editor. Current quantities, holders, supply modes, pins, preferences, existing lore/knowledge and written passages remain intact.

The brief applies to the next accepted passage. Applying additions to canon invalidates latest-passage event recovery, as an ordinary manual record edit does; lore/brief-only preparation preserves it. Written-story canon additions refresh the memory correction epoch without replacing passage memories or writing memories for planned events.

## Scope and validation

The request contains a compact complete canonical directory, task-selected full current records and necessary storage/location paths, relevant nonhidden background, all pins/rules, content preferences and at most 2,000 characters of the latest ending. Hidden lore titles, keywords, links and bodies are excluded. Optional selection is context, not viewpoint knowledge or evidence that someone is physically present.

The model can propose up to six places, twelve counted possessions, six open tasks and four relevant background entries. New local references are replaced with fixed application UUIDs before the preview is retained. Existing IDs are reused; exact normalized duplicate names/titles and attempts to overwrite records are rejected. Parent/container/holder links, cycles, quantities, pins and the full final graph validate against authoritative saved state. Directory-only entities still exist. Preparation cannot enable unlimited supply mode, edit hidden knowledge, change existing stock or invent completed actions.

The explicit request is budget-checked before submission. No retrieval service, larger context window, automatic narration planner or extra repair loop was added. Structural validity and reuse checks cannot prove that every proposed addition is necessary or semantically appropriate; review remains important.

## Retained previews and applying

Preview/apply metadata is stored separately from story archives, scoped by setup/story kind and source ID. This matters because a published setup and its story share an ID. Each preview binds its source revision and a stable source hash. Late generation results, stale or forged previews, changed request-ID reuse and invalid links cannot apply.

Applying accepts a retained result ID rather than client-edited proposal records. Source updates, the applied marker and request receipts commit atomically. Retrying the same apply request replays without duplicate records; a different request cannot apply an already applied preview again. Previews survive app restart. Cancellation or provider failure preserves the source, and no implicit retry occurs. Jobs and the model's proposal request remain visible in Dev diagnostics.

## Dev lore tools

**Dev → Lore** exposes every background entry, including hidden entries in this author view. Inspect IDs, keywords, visibility, links, physical storage/location paths, current counts and Always available flags. Search and filter entries, edit titles/text/keywords/links/visibility, add or remove entries, then explicitly **Save background edits**. Other context sections are preserved.

**Preview lore selection** uses the actual next-passage context builder without a model call. Inclusion/exclusion reasons and token estimates come from a preview of the matching saved revision. The displayed preview direction is separate from the reader's direction. Edited or stale lore does not claim measured selection. Hidden entries remain excluded from prose context even though the author can inspect them here.

Duplicate titles/text and missing/cyclic links are deterministic checks. Stock, placement and changing-condition wording flags are explicitly labeled heuristics, not proof of contradictions. Current records take precedence over background routines. Seeing lore in an author tool does not establish viewpoint knowledge.

Dirty lore survives loading a newer saved story. Saving blocks until the author reviews the change and uses **Reset to latest saved lore**. Draft guards protect navigation and tab changes. **Setup → Background → Background diagnostics** offers structural checks, wording flags and linked current paths before chapter one; it does not claim an actual opening-prompt selection measurement.

## Verification

All **343 tests pass**, Svelte check has zero errors/warnings and the production build passes. Four isolated production browser checks pass: the new scene-preparation and lore tools, existing story creation/continuation/replacement and setup archives. These checks cover preview-only behavior, reviewed setup/story apply, stable IDs, reuse, stale refusal, duplicate replay, cancellation/provider failure, persisted history/restart, lore editing and selection reasons, hidden exclusion, setup diagnostics and 320px layouts.

The preserved Brasswater fixture also completes a mocked preparation request under the existing 32k budget with its full compact directory and selected full records. No fixture snapshots were overwritten. Tests use deterministic model responses; no live-model quality or sustained-story claim is made. Normal installed stories/settings were untouched. The production ZIP was not rebuilt.

Implementation and evidence:

- [Contracts](../src/lib/scene-preparation.ts), [scoped engine](../src/lib/server/scene-preparation.ts), [service/jobs](../src/lib/server/scene-preparation-service.ts), [review UI](../src/lib/ScenePreparation.svelte), [repository](../src/lib/server/repository.ts).
- [Lore diagnostics](../src/lib/lore-audit.ts), [Lore editor](../src/lib/LoreDevPanel.svelte), [Dev integration](../src/lib/DevMenu.svelte).
- [Engine tests](../tests/scene-preparation.test.ts), [repository tests](../tests/scene-preparation-repository.test.ts), [lore tests](../tests/lore-audit.test.ts).
- [Scene browser check](../scripts/scene-preparation-smoke.mjs), [Lore browser check](../scripts/lore-dev-smoke.mjs), [story browser check](../scripts/story-smoke.mjs), [setup archive check](../scripts/setup-archive-smoke.mjs).
