# First scoping and inventory fixes

October 20, 2026. This implements the immediate problems identified in [the verified review](SCOPING_REVIEW_ASSESSMENT.md). The original reports remain historical baselines. Broader context-quality evaluation remains the primary workstream.

This document preserves the first implementation checkpoint. See [the second scoping pass](SCOPING_PHASE_TWO.md) for subsequent stable viewpoint IDs, split/ref verification, exact item selection, prior-reference context and trigger corrections, plus the latest validation and measurements.

## Behavior now implemented

- **Reliable viewpoint resolution.** Explicit scene IDs take precedence; otherwise exact saved names/IDs and unique short names resolve before any fallback. Shared surnames no longer select the first matching person. An unresolved or ambiguous existing viewpoint produces an actionable error rather than choosing somebody else. Narrator examples and context assembly use the same resolver.
- **Participants and references are separate.** Scene participants receive profiles. People merely mentioned receive compact identity/location/content-preference references, labelled as not established present, without their full biographies or inventory. Ask can still request full current records for named people. Author-selected participants remain explicit controls.
- **Focused inventory.** Narration includes equipped items, items directly at the scene location, explicit references and pinned items. It includes storage ancestors without automatically expanding descendants or siblings. Location ancestors no longer make their whole inventories eligible. Persona and voice rank above ordinary inventory. Exact historical event receipts about participant-owned possessions remain eligible even when ordinary descriptions are omitted.
- **Scoped extraction.** Full records follow the actual generated passage, scene references and equipped items. A compact directory retains all existing IDs, names and essential link/quantity/equipment fields so the model can identify remote objects without recreating them. Sparse changes still apply to the complete server-side world; omitted records are never replaced/deleted. Image-only fields stay out.
- **State-update preflight.** Directory, required constraints, schema/contract, an estimated prose allowance and a minimum extraction response must fit before narration starts. Actual generated prose and references are checked again before extraction. This prevents obvious late failures; unusually large output or newly involved records can still exceed the second check, which preserves the prior save.
- **Targeted inventory verification and one repair.** Item effects or potential possession/clothing actions involving tracked references trigger an independent consistency check against actual prose, before/after item state, affected wardrobes, proposed effects and memory. Recent prose helps resolve references but is not evidence for new events. A mismatch allows one extraction/memory repair using the same prose, followed by another check. Prose is not regenerated. Persistent uncertainty, malformed output, budget/provider failures or cancellation prevent the proposal from reaching commit.

The consistency checker is model-based and fallible. Code still enforces evidence presence, IDs, current-holder/quantity preconditions, content preferences, pins, final inventory references and atomic commits. The new check reduces semantic omissions/contradictions; it is not a formal proof of every event. Triggering is conservative and can request a check for an ultimately unchanged possession. It is not an automatic repair of old saved stories, and low-level developer dry-run validation remains structural.

## Request cost and measured fixture results

Normal passages without a triggered inventory check still use narration plus extraction. A checked passage adds one small review; a detected mismatch can add one repair and one recheck, bounded to that attempt. Other existing stages such as short-prose expansion and post-commit memory maintenance retain their own limits.

Same Brasswater audit direction and mocked prose, application conservative estimates:

| Stage | Original | Current |
| --- | ---: | ---: |
| Narration input | 22,510 | 9,852 |
| Extraction input | 52,855 (refused at 32k) | 23,605 |
| Full extraction character records | 24 | 3 |
| Full extraction item records | 170 | 5 |
| Compact directory | No separate directory | All 24 characters / 170 items retained |
| Triggered inventory review | None | 6,904 input / 768 output allowance |

The original audit failed after narration; the current full mocked flow completes at 32,000 tokens. These are input estimates, not measured provider tokens or a fair end-to-end latency comparison against a previously failing flow. Original data: `exports/scoping-stress-test/request-baseline.json`; current data: `request-after.json` in the same directory. Preserve the original files when evaluating later changes.

The regenerated chart-room scenario also selects the intended three participants and six items (9,958 estimated narration tokens), compared with the original five profiles and 54 items (22,746). Current scenario results are in `baseline-after.json` and `context-after-*.json`; original reports remain intact. The audit direction above is slightly different, so its narration count is reported separately.

Run the current audit from the root:

```powershell
node --import tsx exports/scoping-stress-test/request-audit.ts --after
```

## Verification

- **245 automated tests pass**; Svelte check reports zero errors/warnings and the production build passes. Windows tests use a workspace temporary directory to avoid sandbox TEMP rename restrictions.
- Regression coverage includes shared/full/short names, compact absent references, container siblings, ancestor-owned freight, remote directories, preflight before any provider call, missed/unsupported/duplicate/partial-exchange repairs, persistent disagreement, provider failure and cancellation.
- Existing pin/replacement tests retain both today's pinned values and the restored fictional before-state. Event memory alias retrieval still works after inventory pruning. No pin or source check was weakened to make the new tests pass.
- The isolated production story/browser test deliberately omits a key transfer on its first extraction. The app detects and repairs it, commits the correct holder, then passes replacement/restart, failure/retry, cancellation, chapter controls and mobile checks. The director walkthrough passes at its existing 16,384 budget.
- Five real Schattenblume-31B review probes rejected a missing transfer, unsupported transfer and duplicate-instead-of-transfer, and accepted a correct transfer and a genuine second object. The first probe took about 35 seconds including startup; subsequent probes took about 2–6 seconds. These small cases do not establish a universal latency or accuracy guarantee.
- A real local-model repair walkthrough used three actual calls: reject a deliberately omitted brush transfer, repair effects/memory, and recheck. The synthetic narrative stayed fixed. The resulting proposal committed one brush to Ren in memory, retaining the original input story; about 27 seconds total. Normal libraries, saved connections and normal diagnostics were untouched. Evidence is in `test-results/scoping-live-review.json` and `scoping-live-repair.json`.

Production code requires restarting an already running play server. The production ZIP was refreshed for this bug-fix delivery; archive contents/checksum were verified, while a full fresh dependency installation was not repeated. An installed copy in another directory needs the updated application files, retaining its own `config/` and `data/`. These changes do not retroactively move items in existing stories. A specific old brush incident still needs its saved item ID, prose, effects and later history examined before an explicit correction.

## Remaining work

Evaluate indirect references and aliases, multilingual triggers, unusually large inventories/directories, old ownership drift, current-versus-historical knowledge, and the cost of verification across sustained chapters. Opening generation and current-record correction still have broader contexts than ordinary narration/extraction. Do not treat the original external review's unmeasured percentages or per-entity model-call proposals as accepted design requirements.
