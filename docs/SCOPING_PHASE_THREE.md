# Third scoping pass: openings and notebook corrections

October 20, 2026. This pass follows [phase two](SCOPING_PHASE_TWO.md), retaining the roughly 30B local-model target and complete authoritative server canon. No new model stage, retrieval service or schema expansion was needed.

## Reproduced problems

The Brasswater fixture has 24 characters, 34 places and 170 items. Three new request-construction tests initially failed before a provider call: an opening and a reported-record repair exceeded 32k, and a single-item name reroll exceeded 16k. Opening still sent the complete approved canon; corrections sent every item/place and broad cast data regardless of the target. Initial failures are retained in `test-results/scoping-phase-three-before.log`.

A later local-provider probe reproduced another preflight failure: an exact notebook target followed by replacement wording containing “notebook” expanded every notebook into full records. That failure occurred before the repair's provider call; the preceding name probe succeeded. Separating correction instructions from source prose fixed the expansion. General ambiguous requests can still select many candidates or require a more specific target.

## Implemented behavior

- **Openings share scene selection with continuation.** Explicit participants/viewpoint, the starting place and ancestors, referenced/equipped/direct-scene/pinned items, and necessary storage holders enter the narrative projection. Absent named people remain compact references. Relevant/always lore enters; hidden and unrelated lore stays out. Selected profiles retain personality, speaking voice, wardrobe, condition and current intentions. Existing open-thread behavior is unchanged and remains a separate priority.
- **Corrections receive scoped full current records and a complete compact directory.** Reported names/IDs, selected and latest source prose, selected editor targets, relevant relationships, and holder/location ancestors determine full records. No container-content expansion occurs. Single-record editors bind generic “this notebook” wording to the selected record. Exact reported repair targets do not expand through repeated nouns in replacement text; source prose remains a separate reference source.
- **Directory-only records cannot be rewritten by a generated repair.** Their IDs remain valid link targets, but the server refuses full-record edits whose current details were omitted. This prevents invented values from overwriting unseen fields. The reader can name the missing target and request a new preview. Full strict schemas, whole-world graph checks, pin protection and explicit Apply remain in place.
- **Name rerolls use a short task contract.** They receive the selected record, existing names of that kind, prose context and all author constraints. The app reconstructs every unchanged field from the original record; the model returns only a new name and explanation.
- **No context omission deletes saved records.** Opening commits and correction validation continue to use the complete server world. No user stories/settings were replaced. Required constraints and required selected/latest prose still fail clearly if they cannot fit; they are not silently clipped. Extra chapter prose remains optional and enters as whole passages with coverage reporting.

## Measured requests

`scripts/scoping-authoring-audit.mjs` exercises the actual generation/correction functions with a mock provider and default fixture passage length. Results are retained in `exports/scoping-stress-test/request-phase-three.json`.

| Task | Estimated input tokens | Full characters / places / items | Context budget |
| --- | ---: | --- | ---: |
| Opening narration | 7,634 | 3 / 4 / 5 | 32,000 |
| Opening extraction | 22,310 | 3 / 4 / 4 | 32,000 |
| Item name reroll | 7,775 | Selected record only; same-kind name directory | 16,384 |
| Single-item revision | 16,509 | 1 / 4 / 2 | 32,000 |
| Reported notebook repair | 20,507 | 4 / 9 / 9 | 32,000 |

Extraction and revise/repair retain a compact directory of all 24 characters, 34 places and 170 items. Narration deliberately receives no full-world directory. Estimates include request formatting/schema treatment and are conservative app estimates, not measured provider tokenizer usage. These are distinct synthetic tasks, not a before/after literary-quality comparison.

The separate continuation audit is unchanged from phase two: 9,852 narration / 23,736 extraction estimated input tokens, two calls for the quiet prose. `request-phase-three-continuation.json` retains that comparison. Original baseline and earlier snapshots remain intact.

## Verification

- **261 automated tests pass**, including eight new third-pass cases. Svelte check: zero errors/warnings. Production build passes.
- Four isolated production browser checks pass: story generation, director/editor, dedicated notebook corrections and setup pins. Checks cover reciprocal trades, unchanged unrelated records, preview/Apply, stale edits, archive/restart, cancellation and 320px controls. The older correction smoke's full-world payload assertion now checks the scoped projection/directory instead. The pin smoke's prose now consistently leaves the ledger inside its saved bag and reports failed opening responses directly.
- Two short actual Schattenblume-31B probes pass against the large fixture: one item name reroll in about 9 seconds and one exact one-record description repair in about 23 seconds. Each uses one provider call, proposes only its intended field and leaves source data untouched. Results: `test-results/scoping-phase-three-live.json`. These are synthetic probes, not sustained narrative-quality evidence; no actual opening prose was generated for this pass.
- The production ZIP is refreshed and checked against the build and adjacent checksum, with no private config or saved data. Dependencies are unchanged; a fresh extracted dependency installation was not repeated.

Reproduce deterministic checks:

```powershell
node --import tsx --test tests/scoping-phase-three.test.ts
node --import tsx scripts/scoping-authoring-audit.mjs
node --import tsx exports/scoping-stress-test/request-audit.ts --after --phase-three
```

Optional bounded live probes use the saved local provider and isolated diagnostics:

```powershell
node --import tsx scripts/scoping-authoring-live-smoke.mjs
```

## Next bounded priorities

See the subsequent [fourth pass](SCOPING_PHASE_FOUR.md) for task dependencies, transport/parking checks and occupied vehicles. This document retains the third-pass checkpoint.

Measure knowledge/thread relevance and viewpoint knowledge before changing them. Exercise sustained chapter transitions, distant pronouns and ambiguous aliases, multilingual inventory-action detection, and directory growth. Corrections with vague targets or references present only in optional chapter prose can require a more specific report; directory presence is not permission to invent current details. Existing saved ownership drift still requires reviewed correction. Current model verification is fallible and does not prove complete semantic consistency.
