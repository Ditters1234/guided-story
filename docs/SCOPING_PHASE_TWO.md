# Second scoping pass

October 20, 2026. Follow-up to [the first fixes](SCOPING_FIXES.md), using the same constraints: roughly 30B local text model, deterministic scoping where practical, bounded verification, complete server-side canon and isolated test data.

## Phase 1: audit and reproductions

Five new regression cases initially failed:

1. A saved passage retained only a viewpoint name. Renaming the character after scene direction was cleared broke continuation, despite a stable cast ID existing.
2. Exact references such as `Reserve fitting 7` selected every same-noun member of a numbered series.
3. Inventory verification included a split source stack but omitted its newly allocated recipient stack and local-reference mapping.
4. Extraction lacked prior referent prose for a new sentence such as “He gave it to Mira.” It could expand full records from future author direction instead.
5. A correct partial handoff was sent through unnecessary repair/recheck and could be refused because the verifier never saw the recipient stack.

The audit also found a false verification trigger: the noun “places” in an otherwise unchanged scene. Initial failures are recorded in `test-results/scoping-phase-two-before.log`; executable cases are in `tests/scoping-phase-two.test.ts`.

## Phase 2: implemented changes

- **Stable viewpoints:** new openings and passages save an optional `viewpointId` alongside the historical display name. Continuation prefers the ID after explicit scene direction. Before an authorized manual/reviewed/generated rename, identifiable legacy viewpoints retain their IDs without changing their names or prose. Already ambiguous legacy history is not guessed. A removed stored identity produces an actionable generation error; read-only Ask does not require a resolvable narrative viewpoint.
- **Precise item references:** exact name spans are resolved before generic noun matching. `Reserve fitting 7` selects that item; an additional phrase such as “the other fittings” retains generic candidates. Identical names can still represent distinct real objects. This is reference selection, not semantic ownership inference.
- **Complete split review:** verification includes new `item.split` stacks, resolves local item references through `assignedIds`, supplies that mapping to the verifier, and includes needed before/after container paths. Newly created cast references can supply their affected wardrobe too. The prompt explicitly distinguishes conserved splits from duplicate creation and explains container movement.
- **Bounded prior context:** extraction can supply up to 2,000 characters of the prior ending for pronouns/demonstratives. It does so only when the new prose needs referent context, or during conservative preflight. Earlier prose is explicitly not evidence of a new effect or memory fact. Its mentions do not automatically become full character profiles; actual new prose, the viewpoint and author-selected participants determine those profiles.
- **Planning remains separate:** future reader direction helps preflight anticipate required records but no longer expands the actual extraction's full records when the event is absent from the new passage. Existing directory references and all mandatory constraints remain available.
- **Targeted trigger correction:** the noun “places” no longer triggers an inventory request. Actual `placed`, `laid`, `slid`, and `set/place the …` actions remain candidates. Item effects still trigger verification regardless of wording. Detection remains conservative and English-oriented; no regex is used to decide an owner.

These changes add no new generation stage and no automatic correction of old saved ownership. Targeted verification and its one repair/recheck limit remain as in the first pass.

## Phase 3: validation and cost

- **253 automated tests pass**, including eight new second-pass cases. Svelte check reports zero errors/warnings and the production build passes.
- Production browser story checks pass setup/opening, omitted-transfer repair, continuation/replacement, archive/restart, failure/cancellation and mobile controls. Director checks pass at the original 16k budget. Inventory checks pass partial stacks, containers, stale-save preservation, archive/restart and mobile forms.
- Three actual Schattenblume checks accept a conserved partial handoff, reject a wrong moved quantity, and accept a partial handoff into a newly introduced container. They took roughly 3, 7 and 2 seconds respectively on the available local server. These are small synthetic probes, not universal accuracy or latency guarantees. Normal libraries/settings and diagnostics were untouched.
- The same Brasswater mocked request audit still completes at 32k, with all 24 characters/170 items available through the compact directory and only 3 full characters/5 full items for extraction. The quiet prose now uses only narration plus extraction; the false inventory-review call is gone.

| Audit measure | First fixes | Second pass |
| --- | ---: | ---: |
| Narration estimated input tokens | 9,852 | 9,852 |
| Extraction estimated input tokens | 23,605 | 23,736 |
| Requests for the quiet audit prose | 3 | 2 |
| Full extraction characters / items | 3 / 5 | 3 / 5 |

The 131-token increase includes the new reference/evidence instructions; input estimates are not exact provider usage. The small increase is retained for correctness. Direct verification payloads also carry reference mappings and clearer split/container instructions when a check is needed. Original data and first-pass results are preserved: `request-baseline.json`, `request-after.json`, and the new `request-phase-two.json` in `exports/scoping-stress-test/`. Live results are in `test-results/scoping-phase-two-live.json`.

Reproduce from the project root:

```powershell
node --import tsx --test tests/scoping-phase-two.test.ts
node --import tsx exports/scoping-stress-test/request-audit.ts --after --phase-two
```

The optional live probe uses the saved local provider, with isolated synthetic data:

```powershell
node --import tsx scripts/scoping-review-live-smoke.mjs --split
```

The production ZIP is refreshed for this delivery and checked against the current build/checksum. A full fresh dependency installation is not repeated; dependencies are unchanged. Installed copies require updated application files and a restart, preserving their own `config/` and `data/` folders.

## Next bounded priorities

Opening and correction work below is now implemented in [phase three](SCOPING_PHASE_THREE.md); the remaining priorities continue there. This document retains the second-pass checkpoint.

Opening and current-record correction still send broader context than continuation. Knowledge/thread relevance and viewpoint knowledge need a separate measured pass, as do alias ambiguity, multilingual action triggers, very large directories and sustained chapter behavior. Prior-ending context is bounded, so distant implicit references can still be uncertain. Structural checks and model verification cannot prove every event; uncertainty must continue to preserve prior state rather than silently guessing.
