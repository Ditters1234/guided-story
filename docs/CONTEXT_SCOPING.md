# Context scoping: requirements and historical baselines

Priority update, October 21, 2026: the user approved [node-based story workflows](NODE_WORKFLOWS.md) as the next delivery milestone. The selection, token-efficiency and continuity requirements in this document remain mandatory within it. A node canvas does not authorize full-world prompts, extra automatic model stages or relaxed canonical validation.

Historical priority checkpoint, October 20, 2026: the user made scoping the main development workstream. Continue improving relevance, token efficiency and continuity with large casts, nested maps and inventories within the approved node milestone and its evaluation. The [first fixes](SCOPING_FIXES.md) are implemented and verified; original observations below remain historical baselines, while the remaining sequence guides continued evaluation.

## Goal and operating constraints

The subsequent [overall UI pass](UI_IMPROVEMENTS.md) improves access to existing data through normal Background editing and searchable large collections. It does not broaden model context, alter canonical schemas or add provider calls. Browser coverage now includes draft retention, keyboard and coarse-pointer interaction; these UI checks remain separate from model relevance/quality evaluation.

The subsequent [authoring review](SCENE_PREPARATION_REVIEW.md) retains explicit preparation resource IDs in brief context for both openings and continuations. Task/lore dependencies follow one bounded layer; storage paths do not expand whole containers, and referenced people are not promoted into the cast. Reviewed resource records are required under the existing budget, with overflow refused. Manual removal/hiding safely detaches hints; one-shot completion clears them. The 354-test checkpoint and a single synthetic local-model preparation result are separate from the historical scoping measurements below.

The user subsequently requested explicit [scene preparation and Dev Lore tools](SCENE_PREPARATION.md). Those are implemented as a separate reviewed authoring action using one scoped model request and a compact complete directory, with 343 passing tests and isolated browser checks. This does not add an automatic planning stage to narration or change the context-window policy. Earlier measurements below remain historical.

Latest implementation checkpoint: [fourth scoping pass](SCOPING_PHASE_FOUR.md), with 279 passing tests, bounded task-reference selection, transport/parking/quantity checks and occupied vehicles represented as moving places. Ownership versus physical placement, broader viewpoint knowledge and sustained chapters remain priorities. Earlier reports remain historical comparison points.

Give each task enough information to preserve facts and character voice without making a roughly 30B local model search an unrelated world dump. The current local text baseline is Schattenblume-31B with a 32,000-token context budget; the design should remain suitable for similar Qwen-sized local models. Exact tokenizer counts and model quality require separate measurement. Krea 2/Sickollie image preparation should continue using selected subjects and natural-language visible details, without requiring reference images.

Prefer code-based selection, explicit IDs/links and compact data over additional planning calls, autonomous agents or a new retrieval service. More context capacity is not evidence of better relevance. Keep model prompts and requested reasoning simple.

## What the code currently does

| Task | Current scope | Main concern |
| --- | --- | --- |
| Ongoing narration | Explicit/same-location participants with profiles; named absent references as compact identities; equipped, direct-scene, referenced/pinned items and necessary storage ancestors; budgeted memory and bounded references from visible descriptions/background/known facts/current viewpoint memories | Indirect references/aliases, unusually crowded locations and knowledge/thread relevance still need evaluation |
| Opening | Shared scene selection: full participants, compact absent references, focused inventory/storage paths, relevant/always lore and all constraints | Open-thread relevance and unusually broad required scenes remain to be measured |
| Notebook corrections | Selected/reported full current records and holder paths, compact complete directory, required selected/latest prose and all constraints; directory-only rewrites refused | Vague targets and entities only in optional chapter prose can need a more specific report; directory growth still matters |
| Record name rerolls | Selected record, same-kind existing-name directory, required prose and author constraints; short output contract | Large mandatory constraints/prose still cannot be silently omitted |
| Post-passage effects extraction | Scoped full records (including explicitly named places) plus compact complete reference directory, prose/evidence anchors and required pins/rules; preflight and final input checks | Directory growth and unusually broad generated passages can still exceed the budget |
| Possession and travel consistency | Targeted before/after/prose/effects/memory plus physical containment paths; handling, consumption, parking and moving-place checks; one extraction repair/recheck | Model-based and fallible; adds latency when triggered and does not reconcile old saved drift |
| Manual passage memory | Passage plus an ID/name directory of all characters and places | Smaller than full profiles, but directory growth still needs measurement |
| Image preparation | Selected characters, selected items/places and character locations, source passage, editable shot details and relevant constraints | Already narrower; audit separately rather than adding prose biographies or whole inventories |

Primary implementation references: `src/lib/server/context-builder.ts`, `src/lib/server/story-generation.ts`, `src/lib/server/continuity.ts`, and `src/lib/server/story-illustrations.ts`. Audit Ask, corrections, setup design and memory tasks individually; do not assume one shared scope is appropriate everywhere.

Original broadening mechanisms, recorded before the first fixes:

- A name match adds a character to the narrator cast regardless of physical presence. Narration matching uses individual name words of at least four characters. Shared surnames and words such as Ward/Glass can match incidental text; Ren/Jo need explicit IDs or another selection route.
- Place selection includes ancestors. Inventory eligibility uses root ownership at selected people/places, so ancestor-owned stores can become eligible in a small local scene.
- Selecting a stored item adds parent containers; selected containers then add descendants, potentially admitting unrelated sibling contents.
- Optional items have priority 80, persona/voice notes 70, and ordinary appearance 65. Under budget pressure, incidental possessions can outrank characterization.
- All revealed, source-current knowledge and all open threads are candidates; their scene relevance is not yet tightly filtered. Hidden lore is excluded, but a world record's location can still reveal information the viewpoint does not know.
- Budgeting bounds input size, not relevance. A request can fit while containing too many distractions.

## Reproducible baseline

Use [Brasswater testing guide](../exports/scoping-stress-test/README.md), [map](../exports/scoping-stress-test/MAP.md), and [baseline data](../exports/scoping-stress-test/baseline.json). The fixture has **24 characters, 34 places, 170 items, 40 containers, 20 directional relationships and eight open threads**. Both setup and story ZIPs passed schema/roundtrip validation and real repository import in an isolated in-memory library. Normal libraries were untouched.

Regenerate from the project root:

```powershell
node --import tsx exports/scoping-stress-test/generate.ts
```

The generator writes fixtures and reports only; it makes no model calls. `brasswater-story.zip` includes a written scene for immediate continuation; `brasswater-setup.zip` exercises opening/setup scope. The fixture directory belongs to the development checkout; current release packagers do not include `exports/`.

| Scenario | Intended participants | Current selected profiles | Included items | Estimated narration input tokens |
| --- | ---: | ---: | ---: | ---: |
| Local chart-room conversation | 3 | 5 | 54 | 22,746 |
| Nested ferry ticket | 3 | 5 | 54 | 22,950 |
| Short-name market scene | 1 | 1 | 9 | 7,359 |
| Remote pharmacy | 2 | 4 | 48 | 19,930 |
| Shared-surname recollection | 3 | 5 | 57 | 23,691 |

These are the app's conservative estimates for complete assembled continuation context, not provider usage or measured quality. The current reports exclude the separate effects-extraction request. Intended participants are not a ban on a useful compact reference to somebody absent. The short-name case explicitly seeds Jo in the scene brief; it does **not** prove short-name discovery works. The pharmacy case selects Ines Ward and Tem Glass from incidental matching. Preserve these original numbers here when regenerating reports after changes; compare against them explicitly.

## Ownership finding and continued review

The [verified review assessment](SCOPING_REVIEW_ASSESSMENT.md) records completed reproductions and evaluates [the external LLM review](SCOPING_REVIEW.md). A synthetic brush handover can commit with an empty effects list while canon keeps the original holder and memory names the recipient. A correct supplied transfer works. Source anchors also verify quote presence rather than semantic entailment, and a duplicate item creation can pass structural validation. These findings directly affect later item relevance.

The same review reproduced wrong viewpoint fallback for a shared surname/short name and an extraction-budget failure after successful narration construction. Originally the mocked Brasswater extraction contained every record and estimated 52,855 input tokens. The [first fixes](SCOPING_FIXES.md) now scope that request to 23,605 estimated tokens and complete the full mocked flow at 32k. Original structural dry-run checks still cannot prove semantics; the real generation path now performs targeted verification/repair before commit. These findings do not establish what a particular old live passage returned.

Original ownership/dry-run snapshots remain in the fixture folder. Verify the current request construction without model or network access:

```powershell
node --import tsx --test tests/scoping-regressions.test.ts
node --import tsx exports/scoping-stress-test/request-audit.ts --after
```

## Implementation sequence

Before reducing input, investigate state-update completeness alongside selection: correct scoping cannot compensate for a brush that prose gives away while canon retains its previous holder. See the ownership finding above. Preserve enough actual-passage context to detect transfers and newly affected entities during extraction.

1. **Measure each request stage.** Record selected/included entity counts, inclusion reasons, per-kind estimates, schema overhead and prompt duplication. Inspect saved effects when reported prose/state changes disagree. Capture provider token usage and latency separately when running approved live comparisons. Keep the current baseline distinguishable from subsequent outputs.
2. **Define and share entity scope.** Distinguish active participants, relevant absent references and unrelated records. Use explicit scene IDs, current physical locations, direction and supported mentions. Replace loose name-token matching with better deterministic resolution and ambiguity handling; preserve explicit off-scene questions and requested arrivals.
3. **Bound inventory by relevance.** Prefer equipped, explicitly referenced and immediately actionable items. Include necessary holder/container paths without recursively including every sibling or descendant. Treat location ancestors as containment context rather than automatic access to their inventories. Preserve quantities, immediate/ultimate ownership and evidence for transfers.
4. **Reduce effects-extraction scope.** Supply complete records for entities plausibly affected by the passage, with a compact reference directory where useful. Discover new/previously off-scene references from the actual generated passage, not only the pre-generation cast. Resolve references and validate effects against full server-side canon. Measure this separately; do not claim success from narrator reductions alone.
5. **Improve priorities and task parity.** Favor voice, motives, immediate state and essential facts over incidental inventory. Review opening, knowledge, threads, memories, Ask and corrections under their own needs. Keep image-only descriptions out of narrative context.
6. **Evaluate sustained stories.** Compare original and changed behavior on identical scenes, then several linked passages with travel, inventory changes and viewpoint shifts. Add retrieval infrastructure or review calls only if observed misses justify their cost.

Implement in reviewable slices with meaningful selection and integration tests. Keep the existing application working while evaluating alternatives; do not replace the entire context system in one unmeasured rewrite.

## Acceptance criteria

- Three chart-room participants receive the necessary full profiles. Absent people mentioned in recollection do not automatically bring full profiles and personal inventories into the scene.
- A referenced nested ticket retains its exact owner/storage path. Its unrelated sibling receipt, all ship freight and distant pharmacy supplies do not get included solely through graph expansion.
- Short names and shared surnames resolve predictably; an incidental word such as glass or ward does not select an unrelated person. Explicit off-scene questions and arrivals remain possible.
- Important voice/motive/current-state information survives a crowded budget. Exclusions and compact references have inspectable reasons.
- Scoped extraction preserves evidenced transfers, stack splits, nested containers, quantities, remote/newly introduced entities and simultaneous multi-record changes. It cannot delete or overwrite omitted records.
- Exercise completed item handovers with both supplied and deliberately omitted effects. A syntactically valid empty/partial effect batch is not evidence that every prose event was captured. Report disagreement among prose, generated memory and saved item holders explicitly; do not claim semantic completeness from structural validation alone.
- Current mandatory pins/rules and content preferences remain effective. Full authoritative reference/ownership validation, atomic prose/state commits, failure/cancellation behavior and latest-passage recovery stay intact. Required-context overflow still fails visibly.
- Hidden plans and unknown world facts are not promoted into viewpoint knowledge. Scoping changes do not weaken source checks or make historical state equal to current canon.
- Report narration and extraction reductions separately against this baseline, alongside omissions, continuity/voice observations and any new calls/latency. Do not claim an arbitrary percentage target or literary improvement without evidence.

## Deferred work

Optional reference-image execution, automatic illustrations, richer route maps/capacity simulation, currency ledgers, extra planning/review calls and vector retrieval are lower priority unless the user explicitly requests them or scoping evidence demonstrates a need. Necessary bug fixes and explicit new user instructions still take precedence. This priority does not authorize unattended monitoring, scheduled work or changes to installed libraries/settings.
