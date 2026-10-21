# Targeted setup generation

Every section of New story has editable AI options using the saved Text LLM connection. These controls develop an unwritten setup; they do not advance a novel or call ComfyUI.

| Section | AI options |
| --- | --- |
| Cast | Directed redesign, full profile redesign, name reroll |
| World foundations | Directed revision or full regeneration of visible foundations text |
| Places | Revise, full redesign, name reroll, generate one new place |
| Possessions | Revise, full redesign, name reroll, generate one new possession |
| Relationships | Revise, full redesign, generate one new connection |
| Story threads | Revise, full redesign, title reroll, generate one new open thread |
| Opening | Revise or regenerate the scene brief: viewpoint, location, cast, purpose, tension and stopping point |

Write an optional direction to keep or change specific details. Revise preserves the concept and unrelated facts; full redesign asks for a fresh descriptive concept within that direction. Name/title rerolls can change only that one field. Structural links, owner, quantity and equipment state are kept in the model instructions unless explicitly changed; proposed values still require valid existing references. Shared funds and cargo notes remain manually editable. Generate-new controls add one record; existing manual Add controls still create blank editable records.

Current edits are saved before each call. The result is validated and saved into the setup, and remains editable. Place generation opens the newly added place. Cancel and failure messages use the normal setup flow and bottom Errors panel. Full redesign asks before replacing an existing design; targeted revisions and additions do not regenerate the rest of the setup.

## Storage and model contract

`POST /api/setups/:id/design` accepts `expectedRevision`, `requestId`, `kind` (`place`, `item`, `relationship`, `thread`, `world`, `opening`), `mode` (`revise`, `full`, `name`, `create`), optional `targetId`, and an optional direction of up to 2,000 characters. Existing record operations require a target; creation and whole-section operations reject one. Name mode is limited to places, possessions and threads. World/opening support revision and full regeneration.

Each operation has a durable job, setup lock, fingerprint, revision check and commit receipt. Replays do not call the provider or add another record. A stale setup, aborted call, invalid model result or invalid graph cannot overwrite the previous saved draft. Model output contains one strict record, not an entire replacement plan or model-assigned IDs. The app preserves selected IDs or assigns a UUID for a new record, and validates the resulting setup before commit. Canonical references, containment, quantity/equipment rules and two distinct relationship participants are checked. Threads generate open; an existing manually set status is preserved. Opening cast must include its viewpoint, use known IDs and contain no duplicates.

World foundations use a nonhidden entry titled World foundations, falling back to the first always-visible lore entry. If neither exists, the app creates one. Other lore, metadata and hidden entries are kept. Hidden lore and knowledge are excluded from the design request. Opening generation changes only the planning brief, preserving its clear-after-passage setting; prose is written only by Begin chapter one.

The model receives current records, visible world foundations and relevant cast information. Possession design includes visual/wardrobe facts; relationship design includes persona. Required inputs and the output reserve must fit the configured context budget; no records are silently clipped. Response JSON schema metadata is omitted from the prompt contract to reduce schema copying, while strict result validation remains active.

## Verification

- `tests/setup-generation.test.ts`: eight tests for scoped changes, IDs, names, graphs, hidden lore, opening planning, provider failures, cancellation and budgets.
- `node scripts/setup-design-smoke.mjs`: isolated browser/provider walkthrough across all sections, creation/revision/redesign/rerolls, receipts, stale saves, failure recovery, bottom errors, cancellation and mobile layouts.
- `node --import tsx scripts/setup-design-live-smoke.mjs`: real saved local Text LLM with isolated temporary setup and diagnostics; all six noncast sections, saved results and unaffected records.
