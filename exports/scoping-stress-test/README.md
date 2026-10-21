# The Ninth Bell of Brasswater

Fictional scoping stress test: 24 characters, 34 places, 170 items (40 containers), 20 directional relationships and 8 open threads. All characters are adults.

## Import

- Import **brasswater-story.zip** from Library for a ready-to-continue story with one written scene.
- Import **brasswater-setup.zip** through the unfinished-setup import flow to inspect/edit the complete plan before generating an opening. The input cast-size control is capped at eight; the existing approved plan contains all 24 characters. Regenerating the whole setup may replace it with a smaller cast.
- JSON files are readable copies. MAP.md shows nested places. These files do not change your current library until you import a ZIP.

## Tests

### local-conversation

Direction: Continue the conversation at the chart table. Ren explains where he received the letter. Keep the seal intact and stop before anybody leaves.

Intended active cast: iris, tamsin, ren. Mara is mentioned in recent prose but remains off-scene; her possessions should not be treated as available aboard.

### nested-item

Direction: Iris takes her unused ferry ticket from her document wallet, shows its date, then puts it back. Nobody boards a ferry.

Intended active cast: iris, tamsin, ren. The ticket needs the satchel/wallet path; the irrelevant boot receipt and all other stored items should not receive equal attention.

### short-name

Direction: Jo waits at the market message board and asks about a missing parcel.

Intended active cast: jo. Short names should work without bringing the ship crew or their equipment to the market.

### remote-pharmacy

Direction: Bex counts the amber glass vial in the pharmacy. Ada enters from the ward to ask for a stock total.

Intended active cast: bex, ada. A remote scene should keep ship cargo and tide-governor speculation out unless actually relevant. Ada’s arrival must be evidenced before her location changes.

### shared-surname

Direction: Iris recalls a polite conversation with Soren Vale at the tea house. Continue the chart-room scene without introducing any arrivals.

Intended active cast: iris, tamsin, ren. Soren and Mara are different people. A shared surname and recollection do not make either one physically present.

## Baseline evidence

baseline.json and context-*.json retain original selection estimates; baseline-after.json and context-after-*.json record regenerated current results, generated without an LLM call. They are observations, not assertions that the current selection is ideal. Remote scenarios replace the recent prose and scene brief in memory; no travel is assumed. Their intended-active lists describe narrative participants, not a strict ban on compact references to absent people.

Known traps: shared surnames, Ren/Jo short names, a mentioned but absent registrar, city/ship ancestor ownership, nested sibling inventory, unrelated cargo and pharmacy supplies, and hidden lore. The governor's canonical location is deliberately different from viewpoint knowledge. Search model output for unsupported knowledge, arrivals, transfers or unrelated props.

Pinned facts/world rules are intentionally small. Image-only visual descriptions should be absent from narration context. Extraction and targeted inventory verification are separate costs; these narration reports do not measure them. See ../../docs/SCOPING_FIXES.md and request-after.json for complete request-construction and local-model evidence.

Regenerate from the project root with: node --import tsx exports/scoping-stress-test/generate.ts

## First fixes and current checks

The original mocked request audit failed full-world extraction at 32k. The first fixes now complete the mocked continuation flow within that budget. The [third pass](../../docs/SCOPING_PHASE_THREE.md) now scopes opening and correction requests too. Run `node --import tsx scripts/scoping-authoring-audit.mjs` from the project root for `request-phase-three.json`; `request-audit.ts --after --phase-three` writes the separate unchanged continuation snapshot. Knowledge/thread relevance, sustained chapters and directory growth remain separate stress cases. Do not increase saved context solely to hide selection problems.

See [first fixes](../../docs/SCOPING_FIXES.md) and [historical review](../../docs/SCOPING_REVIEW_ASSESSMENT.md). Run ownership-check.ts --after, review-checks.ts --after and request-audit.ts --after with node --import tsx from the project root for current reports. The ownership helper deliberately bypasses guarded generation to characterize structural dry runs; tests/scoping-regressions.test.ts exercises actual verification/repair. Original baseline JSON files remain intact. These fixture checks need no network or real model calls.
