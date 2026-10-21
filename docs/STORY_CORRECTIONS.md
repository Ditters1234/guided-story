# In-story AI editing and reader corrections

Implemented October 19, 2026. These tools propose changes to current story records for review. They do not rewrite published passages, restore an earlier world state or create branches.

## Report a missed fact

Under any passage, choose **I noticed something needs correction**. The form focuses **What needs correction?**; opening it makes no model call. Describe the expected result, then choose **Preview corrections**. For example:

> Mira traded her jacket to Ren for the access fob. Ren should own the jacket, Mira should own the fob, and Mira is no longer wearing that jacket.

Review the explanation, original request and field-by-field **Before / After**, then choose **Apply corrections**. A report can propose related cast, place, item, relationship, thread and world funds/cargo-note changes together. **Discard preview** keeps the direction available; **Clear correction draft** clears it after confirmation. Failed requests keep the entered direction. Cancellation reaches the active story job and does not apply a preview. Errors also appear in the bottom Errors panel.

The tool works while reading an earlier passage, but always corrects **current** canon. Later events may have changed ownership or clothing again. The form states this scope; the selected old passage supplies context rather than an instruction to roll back history. Use **Change what happens** for an actual event rewrite of the latest passage, or **Polish wording** for a reviewed copyedit. Earlier events remain linear history.

## AI options in Records

Each saved cast/place/item/relationship/thread editor includes **AI edit type**, **Record edit direction** and **Preview AI changes**:

| Mode | Scope |
| --- | --- |
| Revise selected record | Follow the direction, keeping unrelated fields |
| Full redesign of selected record | Reconsider descriptive fields coherently; keep ownership, quantity, equipment, links and status unless explicitly directed otherwise |
| Reroll name only / Reroll title only | Change just the name or thread title; relationships have no name reroll |
| New record | Select Add/new in the picker, describe the new record, then preview its creation |

Save manual fields first, or use **Reload saved record**, before requesting AI changes. The AI reads saved records and does not silently save manual edits. AI directions and unapplied previews participate in navigation/reload warnings. Saving manual changes preserves an existing AI direction, but any older preview becomes stale. Applying a newly created record selects its assigned ID in the editor.

Single-record editing cannot change unrelated records. Use the reader correction form when several records need coordinated fixes. No AI mode deletes records; use the existing confirmed manual removal controls and dependency checks. Stable IDs, existing No NSFW/content preferences and appearance/outfit pins are protected. Supported [field pins](FACT_PINS.md) also protect each selected field; all saved pins/world rules are required context. Unpin a field or edit it manually before requesting an AI correction that would change it. A new character starts with No NSFW enabled.

## Clothing, possessions and trades

Wardrobe descriptions and inventory items are separate records. A jacket described only in a character's wardrobe may have no item ID to transfer. The correction prompt explicitly allows materializing that missing garment as an inventory item for its recipient while updating the former wearer's affected wardrobe slot and supplemental outfit notes. Existing items should transfer rather than be duplicated. A completed barter should update both objects' ownership and any actually changed worn state; transferred items are unequipped unless the recipient puts them on.

The same guidance is included in ordinary story extraction: do not remove unrelated garments, invent replacement clothing, infer nudity or treat one exchanged garment as a whole outfit. This is model guidance with validated records, not an automatic garment-to-item matching system. Review both sides of a trade and the relevant outfit fields before applying. Quantity, valid owners, character-only equipment, place containment and relationship references remain server-validated. New records receive application UUIDs; links in a proposal must refer to existing current characters/places, not another newly proposed record.

## Preview and persistence contract

Proposing leaves the story revision and canon unchanged. Required context includes current saved canon, the full selected passage and the latest passage. Other passages from the selected chapter are included whole as the configured budget permits; coverage warnings identify omissions. Contract/output overhead is reserved before adding optional chapter history. A long selected passage or large canon can require a higher supported context budget; the request fails instead of silently truncating required material. The complete selected chapter, intermediate chapters and the whole novel are not guaranteed context. The model should explain uncertainty, and its interpretation still needs review.

Apply loads the stored, validated proposal rather than accepting replacement operations from the browser. It checks the story revision and source fingerprint again and commits all changes atomically with a durable request receipt. A changed story/source requires a fresh preview. Editing the direction or AI edit type also disables Apply until the original instructions are restored or a new preview is generated.

Accepted canonical corrections invalidate the latest event-replacement recovery baseline until the next successful continuation establishes a new one. Chapter/book memory and the reader recap become stale through the normal correction rules. Written prose and historical receipts remain; current canon takes precedence when describing present facts.

The library database stores correction previews separately in `correction_results`, retaining the latest **100 per story** and exposing the latest **20**. Previews, directions and diagnostic jobs do not travel in story ZIPs. Applied canonical records do travel in the normal story payload/ZIP. Imported copies begin without proposal history. Evicted previews need a fresh request. Story deletion removes its retained correction results.

| Route | Behavior |
| --- | --- |
| `GET /api/stories/:id/corrections` | Recent retained previews |
| `POST /api/stories/:id/corrections` | Generate a repair or one-record proposal with expected revision and request ID |
| `POST /api/stories/:id/corrections/:resultId/apply` | Apply a stored preview with expected revision and durable request ID |

The `story-correction` job shares the story lock. Cancellation uses `/api/generation/cancel`; request replay reuses retained results rather than repeating a provider call. See [Record editors](RECORD_EDITORS.md) and [Director tools](DIRECTOR_EDITOR.md) for adjacent manual/prose controls. Focused coverage is in `tests/story-corrections.test.ts`; `node --import tsx scripts/corrections-smoke.mjs` exercises the production browser flow and `node --import tsx scripts/corrections-live-smoke.mjs` uses the saved local text connection on a synthetic trade and item edit. Both isolate generated data from ordinary libraries. Current integrated verification is recorded in [Project status](PROJECT_STATUS.md) and [Release evidence](RELEASE_1_0.md).
