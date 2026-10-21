# Scoping review: verified findings and external-review assessment

October 20, 2026, original review checkpoint. This assesses [the external LLM review](SCOPING_REVIEW.md) against the code and reproducible fixtures before fixes. The external review is retained unchanged as a proposal, not adopted as instructions or treated as measured evidence. Application runtime code was not changed during that investigation. **Subsequent implementation:** see [first fixes](SCOPING_FIXES.md) for current behavior, regression/live verification and remaining limits. Original reproductions/counts below describe the baseline, not the patched generation path.

## Findings, in priority order

### 1. Missing item transfers can silently leave prose, memory and canon in disagreement

**Reproduced.** In the synthetic brush case, prose says Iris hands a brush to Ren and generated memory says Ren received it. If extraction supplies `effects: []`, `preparePassageCommit` accepts the proposal and the item remains held by Iris. The same proposal with a valid `item.transfer` changes the holder to Ren. A separate isolated Ren scene includes the brush only in the correctly transferred variant.

This is a completeness gap in interpreting prose, not proof that the transfer operation itself is broken. `ownerId` is the immediate current holder, including a container, not an immutable original-owner field. Prompt narrowing alone cannot repair stale state. Next context prioritizes current canon over summaries, so a missed handover can feed the old holder back to the narrator. Missing character moves, partial exchanges or equipment updates deserve analogous coverage.

Evidence: `exports/scoping-stress-test/ownership-check.ts` and `ownership-baseline.json`; `src/lib/server/passage-commit.ts` applies the supplied effects and attaches memory separately; `src/lib/story-effects.ts` implements transfers and current-holder checks. The 26 existing passage/inventory/integration tests passed and establish supplied-operation behavior, not complete semantic extraction.

### 2. Exact evidence anchors do not establish that an effect follows from the quote

**Reproduced.** A source excerpt explicitly says Iris puts the brush back in her own satchel while Ren keeps his hands at his sides. An `item.transfer` to Ren anchored to that actual excerpt still passes source resolution and structural commit validation. Quote presence, valid IDs and a consistent inventory graph do not prove semantic entailment.

The duplicate variant also passes: extraction creates a new brush for Ren rather than transferring the tracked brush, leaving two records. Equal item names can legitimately describe separate objects, so globally banning duplicate names would be an unsafe fix. Diagnose identity resolution and completed-event interpretation rather than weakening evidence or guessing ownership from verbs with a general regex.

Evidence: the same ownership reproduction, including `resolveEffectEvidence`, and `src/lib/server/evidence-sources.ts` / `src/lib/story-effects.ts`. These synthetic inputs demonstrate accepted failure modes, not the output of the user's actual brush passage.

### 3. Narration can run successfully before extraction is discovered to be over budget

**Reproduced with real request construction and mocked completions.** At 32,000 tokens, the Brasswater narrator request is estimated at 22,510 input tokens for the audit direction. After mock prose is returned, the generation path rejects extraction before submission. A diagnostic run with an enlarged application budget exposes the exact extraction payload: **24 characters, 34 places, 170 items and 52,855 estimated input tokens** for that mock passage, plus output/overhead reservations.

This explains why a runnable narration context report is not an end-to-end readiness check. In ordinary use the first model call could consume time before the extraction budget failure; the atomic commit keeps the previous saved story intact. The enlarged 262,144-token probe is not a recommendation to increase model context. Prioritize scoped extraction and a useful preflight for obviously impossible state-update input.

Evidence: `exports/scoping-stress-test/request-audit.ts` and `request-baseline.json`. Zero network/real model calls; isolated diagnostics were removed. Counts are the application's conservative estimates, not provider usage or a quality benchmark. The generated text is neutral repetitive filler used solely to exercise request construction.

### 4. Viewpoint fallback can select a different character and location

**Reproduced without an explicit scene viewpoint.** A saved passage viewpoint of `Mara Vale` resolves to the first shared-surname match, Iris Vale. A saved viewpoint of `Ren` fails the four-character token matcher and also falls back to Iris. The selected location then becomes Iris's chart room instead of following the saved viewpoint. Explicit scene viewpoint IDs bypass this fallback; explicit selection is not a general repair for the underlying resolver.

The narration output example also defaults to the first cast member when the brief has no viewpoint, while the context builder infers a viewpoint from the last passage. Those two conventions should share a reliable ID-based resolution policy. Historical passages currently save a viewpoint name, so exact-name and ambiguity handling still matter for existing records.

Evidence: `exports/scoping-stress-test/review-checks.ts` and `review-baseline.json`; `src/lib/server/context-builder.ts` and `narrationRequirements` in `src/lib/server/story-generation.ts`.

### 5. Overselection and underselection can happen together

**Reproduced.** Referencing a remotely held ferry ticket brings its storage path and the unrelated sibling boot receipt into a narrow Ren scene. It does not bring in Iris's full identity profile, although the storage path supplies her name. This supports a distinct compact reference tier rather than choosing between full profiles/inventory and no record at all. Explicit references must not be interpreted as permission to use or transfer somebody else's possession remotely.

The earlier baseline also confirms shared-surname cast expansion, incidental Ward/Glass matches, and broad inventories. Optional items currently outrank persona/voice notes. These are relevance and priority issues even when the prompt fits.

### 6. Other audited tasks have different scope costs

**Code-confirmed; not all benchmarked.** Current-record correction repair sends full character profiles and all current canon; targeted record edits compact the cast directory but retain the rest of canon, and item edits additionally receive cast wardrobe. Optional chapter prose is added only after required current records and selected/latest passages. Manual memory receives all character/place ID-name pairs, not full profiles. Image preparation already uses selected subjects and related places/items. Opening sends full approved narrative canon. Pins contain resolved protected values and rules; they do not automatically require each complete owning record.

These paths need separate measurements and acceptance cases. A single global entity filter or a narrator-only token improvement cannot stand in for auditing them.

## Assessment of the external review

| Proposal or claim | Assessment | Decision for this workstream |
| --- | --- | --- |
| Cheap deterministic stages before more expensive handling | Useful and consistent with current goals | Adopt as a design direction, with measured inclusion reasons |
| Active, bystander and mentioned tiers; task-specific scope | Useful | Define full profiles versus compact references explicitly; maintain one authoritative canon |
| Exact name mentions are always required context | Too broad | Resolve exact names/aliases with ambiguity handling; select task-appropriate detail, not an automatic full record/inventory |
| All pinned fields **and their records** are already required | Partly incorrect | Preserve every current mandatory constraint; complete record inclusion is not the current contract |
| Include people in location children; rank world-map distance | Not supported as written | The map is containment, not adjacency/travel distance. A child room is not proof of presence or access |
| Filters handle 60–80% of scenes without ambiguity | Unsupported percentage | No benchmark supplied; discard the number |
| A disambiguation ID is a single token; calls below 150–200 input tokens are cheap | Unsupported cost assumptions | IDs can tokenize into many tokens; instruction/context overhead and local server latency still apply |
| One classification call per ambiguous name or borderline item | Poor default for this installation | Start with deterministic resolution, bounded compact references and visible ambiguity. Consider calls only after measuring real misses |
| Cache disambiguation for a chapter | Needs stronger validity rules | A pronoun/title/surname can refer to different people as a scene changes; context/revision/scope must participate in invalidation |
| Heat/recency score with chosen weights | A hypothesis, not validated tuning | Use recency as a secondary ranking signal; never override explicit constraints, stable identity or relevant older evidence |
| Scene-type item categories, exclude everything else | Too rigid | Avoid dropping an unexpected clue, medical item or personal object because a scene was labelled conversation/combat. Tags could be secondary hints |
| Load a profile from old memory | Needs correction | Load current facts from canonical records; use source-linked historical evidence for historical questions. Summaries are not authoritative current profiles |
| Feed newly mentioned entities into the **next** continuation only | Insufficient for correctness | Current passage extraction must resolve current new/remote entities before commit. Otherwise today's invented arrival/transfer can already corrupt state |
| Extra generation call to create a new character placeholder | Redundant as an initial design | Existing extraction already supports `character.create`, application IDs and references; improve that path before adding another stage |
| Dynamically computed active set instead of a second synchronized world list | Useful | Derived scope can coexist with explicit author scene-cast IDs; do not remove those controls |
| No vector search | Reasonable starting constraint, overstated as a permanent ban | Defer infrastructure until deterministic selection demonstrably fails |
| “Did the model use this fact?” as relevance | Incomplete metric | Constraints may correctly prevent an event without appearing in prose; assess correctness and omissions as well as visible use |
| Flat token cost as world cast grows | Useful bounded goal, not an absolute | Measure full profiles, compact directories, schemas and mandatory pins separately; legitimate constraints/directories can grow |

## Next review/implementation gates

1. Trace an actual reported missed handover through its saved prose, `generation.effects`, memory and current item ID/holder before diagnosing that particular story. If no transfer was extracted, distinguish that from a duplicate item, stale form, later transfer, container movement or latest-passage replacement. Do not silently repair the user's canon.
2. Add representative transfer/movement omission, unsupported-effect and partial-exchange cases to the evaluation set. Preserve structural checks; decide how to surface or resolve semantic uncertainty without assuming one more LLM call will guarantee completeness.
3. Establish reliable viewpoint/name resolution and participant/reference tiers, with collision/short-name regressions.
4. Scope and preflight extraction, retaining enough passage-derived references and full server validation to avoid missing newly mentioned/affected entities. Measure the entire generation path, not just a Context panel's green status.
5. Reduce inventory expansion and adjust priorities, then repeat tests across travel, borrowing/giving back, bags, partial stacks, repeated generic item names and remote scenes. Keep original versus changed baselines distinct.

This historical review does not claim fixes or live-model results. The subsequent [implementation checkpoint](SCOPING_FIXES.md) records both, including the measured decision to add targeted inventory verification after concrete semantic omissions were reproduced. Further review proposals should remain simple enough for the local model and should not add recurring calls without demonstrated value.
