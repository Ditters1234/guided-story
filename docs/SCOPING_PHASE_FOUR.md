# Fourth scoping pass: ordinary tasks and occupied vehicles

October 20, 2026. Follow-up to [phase three](SCOPING_PHASE_THREE.md), prompted by the rancher's feed → tractor → field → trough example. The implementation uses existing records and effects. No new model stage, vehicle schema, retrieval service or save migration was added.

## What the investigation reproduced

The state model already handled splitting feed, moving its container, unloading, consumption and character travel when given correct effects. Five of seven initial ranch tests failed because context selection did not follow existing routine references, and loading/transport/consumption wording could bypass verification when extraction returned no item effects. Initial failures are retained in `test-results/ranch-scoping-before.log`.

Live checks then exposed two additional weaknesses: a missing tractor move could pass while the driver and feed changes were correct, and an extractor assigned ten portions to prose saying only “several.” The first verifier miss and original vague-count generation are preserved in `test-results/ranch-live-review-before.json` and `test-results/ranch-live-generation-before.json`. A park-and-walk-away regression also failed before its trigger fix (`test-results/ranch-parking-before.log`). These are observed limitations, not hypothetical accuracy claims.

## Goal-related context

The narrator now follows explicit references from a small set of relevant existing sources:

- Descriptions of items and places already selected by ordinary scene scope. This is one hop; newly found records do not recursively expand into more records or container contents.
- Nonhidden background with matching keywords/title/text and existing linked IDs or names.
- Reader-revealed, established knowledge known to the current viewpoint, with valid source hashes when applicable.
- Matching fact sentences in valid memories whose source passages share the current viewpoint. Summaries and open questions do not establish dependencies.

Matching is deterministic, using conservative English word forms and explicit references. There are no farming-specific recipes. At most 24 candidate documents are inspected for references, four sources retained and sixteen referenced records selected; necessary holder/location ancestors can add supporting records. Clipping is reported. Required rules/pins remain mandatory; optional expanded records still obey the context budget. Referenced people stay compact references rather than becoming physically present participants.

This supplies the current quantity, holder, condition and location of an existing tractor/feed/trough. A routine or old memory does not override a newly recorded flat tyre or a changed storage location. It does not prove the farmer knows every supplied fact or automatically execute a plan. With no relevant existing references, the app still cannot reliably infer every tool or prerequisite for an arbitrary activity.

## Vehicles: places people can occupy

The user's cab-in-a-field example revealed that the first tractor fixture used the wrong representation for occupancy. An item/container can hold feed, but characters can only be located in places. The existing moving-place mechanism already used for ships supports the tractor too:

| Record | Type | State after driving into the field |
| --- | --- | --- |
| Loader Tractor | Place | `parentId = pasture` |
| Tractor Cab | Child place | `parentId = tractor` |
| Farmer | Character | `locationId = tractor-cab` |
| Tractor Feed Bin | Container item | `ownerId = tractor` |
| Loaded feed | Item stack | `ownerId = feed-bin` |

One `place.update` changes the tractor's parent. The farmer, cab and cargo retain their immediate room/holder IDs while their surrounding location changes. The next scene can occur inside the cab with the field in its containment hierarchy. Exiting/walking home changes the farmer's location and leaves the parked tractor in the field. No duplicate tractor item is needed.

Setup guidance now prefers a place for vehicles people can occupy, with cab/room child places as needed. Narration/extraction distinguish moving the vehicle parent from boarding/exiting. Extraction includes explicitly referenced place records. Existing item vehicles are not silently converted; old item-based setups require deliberate restructuring if their vehicle must become an occupiable location.

The old `ownerId` field on items is an immediate holder/storage pointer, not a separate legal-ownership record. In the original live item-based example, the tractor stayed assigned to Alex and followed his physical location. Parking it required placing it at the pasture before Alex walked away. Separating title ownership from possession/location remains an explicit structural gap; this pass does not invent or migrate legal owners.

## State verification

Loading, unloading, pouring, filling, transport, consumption and parking are now candidates for the existing consistency check. A parent-changing `place.update` also triggers it; explicit movement involving a referenced place can trigger it even with no item effects. Triggers are conservative English heuristics and may add checks for incidental wording. They never choose an owner, quantity or destination.

The verifier receives compact place names, actor locations, and before/after containment paths for relevant people, places and containers. It can distinguish a stationary room inside a moving vehicle from an occupant incorrectly placed outside, or a parked vehicle that incorrectly follows its former holder. It is prompted to reject unsupported exact quantities from “some/several/full” with unknown capacity. Narration guidance asks for exact whole-unit counts when tracked stock changes and clear parking when a person leaves a vehicle.

One bounded extraction repair/recheck remains the limit. Unresolved disagreement or an over-budget check prevents saving the generated proposal. No existing saved drift is automatically repaired. Verification remains model-based and fallible.

## Measured costs and results

`exports/ranch-scope-test/audit.json` records synthetic request construction, commit checks and in-memory ZIP imports. For the fixed ten-portions/four-consumed prose, the final state is 90 in the shed, six in the trough and four consumed. It also verifies the cab/vehicle representation and a three-passage loading/travel/unloading sequence through regression tests.

| Mock ranch request | Estimated input tokens |
| --- | ---: |
| Narration with routine references | 5,165 |
| Extraction | 8,725 |
| Consistency review with correct effects | 6,994 |
| Extraction repair after deliberately omitted effects | 9,045 |

The normal changing-inventory fixture uses narration + extraction + the existing conditional review; deliberately omitted effects add repair + recheck. Quiet Brasswater prose still uses two calls. Its narration is now 10,103 estimated input tokens (previously 9,852), extraction 23,907 (previously 23,736), retaining three full cast/five full item records plus the complete compact directory at 32k. Added instructions account for those increases. Opening is 7,885 / extraction 22,481; correction costs are unchanged. These are conservative app estimates, not provider tokenizer measurements. Historical snapshots are preserved; current comparisons are `request-phase-four-continuation.json` and `request-phase-four-authoring.json`.

- **279 automated tests pass**, including thirteen ranch and five occupied-vehicle cases. Type check: zero errors/warnings. Production build passes. Story, director and inventory production browser checks pass using isolated data.
- The final short real Schattenblume ranch generation used three calls in about 51 seconds. It explicitly narrated twelve portions and recorded 88 remaining in the shed, twelve in the trough, and the farmer/tractor in the pasture. It did not narrate a quantified consumption event, so no amount eaten was invented. This was the item-based fixture; the farmer did not exit the tractor.
- Four focused item-vehicle checks after the first verifier adjustment accepted the correct chain and rejected omitted all/driver/tractor movement. Three follow-up checks rejected a tractor following a walker, accepted correct parking, and rejected the earlier unsupported ten-from-several result.
- Three occupied-vehicle checks accepted a stable cab ID inside a moving tractor and rejected missing vehicle travel or a driver incorrectly placed outside. A separate real extraction + review on fixed short prose produced exactly `place.update tractor.parentId = pasture`, retaining the farmer in `tractor-cab` and the feed bin at `tractor`. It used two real calls in about 30 seconds. The vehicle scene's prose was fixed for this probe; it is not a live setup/narrative-quality benchmark.
- The production ZIP is refreshed and build/checksum matched. Normal user libraries/settings are untouched; a fresh extracted dependency installation is not repeated.

Live artifacts are `test-results/ranch-live-generation.json`, `ranch-live-review.json`, `ranch-live-followup.json`, `ranch-live-vehicle-review.json` and `ranch-live-vehicle-extraction.json`. Prompt revisions between probes are described above; small successful probes do not establish universal accuracy or latency.

## Reproduce and continue

Use [the ranch fixtures](../exports/ranch-scope-test/README.md). The occupied-vehicle ZIP is the recommended cab/field example; the item-based ZIP preserves the storage/ownership comparison. Importing is optional and creates an isolated new story only when the reader chooses to import it.

```powershell
node --import tsx --test tests/ranch-scoping.test.ts tests/moving-vehicle.test.ts
node --import tsx exports/ranch-scope-test/audit.ts
node --import tsx exports/scoping-stress-test/request-audit.ts --after --phase-four
node --import tsx scripts/scoping-authoring-audit.mjs --phase-four
```

Optional saved-provider probes: `scripts/ranch-live-smoke.mjs` with `--generate`, `--followup`, `--vehicle` or `--vehicle-generate`. `--followup` reads the preserved initial vague-count generation artifact. All use isolated diagnostics.

Next priorities are ownership versus physical placement, broader viewpoint-knowledge enforcement and thread relevance, aliases/synonyms, multilingual triggers, larger directories and sustained chapters. Ordinary recent prose, global revealed knowledge and arbitrary description text still need a broader knowledge/privacy review; this change filters dependency sources rather than claiming a universal information boundary. Unit conversion, vehicle capacity, fuel and autonomous offscreen routines are not simulated.
