# Shared character profiles

Character creation, the narrator, story-state extraction, all cast editors and image preparation use one saved profile. Appearance and outfit summaries are derived from its fields whenever a character is validated, saved or loaded.

| Profile | Fields and meaning |
| --- | --- |
| Visual identity | `visual.age` is actual chronological age; `apparentAge` is visible age. `gender` is identity; `presentation` describes visible presentation. Species, complexion, build, face, hair, eyes and distinctive features are separate traits. |
| Story persona | `persona.personality`, `voice`, `motives`, `history`; `notes` holds additional story notes. Relationships and viewpoint knowledge remain in their existing linked records. |
| Current state | `currentState` is one short free-text note for current feelings, immediate wants and intentions. It stays separate from lasting personality, long-term motives and history. It is optional on older saves and reads as empty when absent. |
| Current wardrobe | `wardrobe.upper_body`, `lower_body`, `footwear`, `accessories`; `outfitNotes` adds clothing details that do not fit these fields. |
| Current condition | `injuries` describes current injuries or visible condition, separate from permanent identifying features. Location remains a linked place ID. |
| Supplemental appearance | `appearanceNotes` holds additional visible details. It should not repeat or contradict structured traits. |
| Preferences | No NSFW and appearance/outfit pins remain user-controlled. Neither preference establishes age, gender or presentation. |

## Creation and changes

New-story generation and character redesign require every nested structured profile field. Intentionally unknown values may be blank; omitted traits fail validation rather than erasing established details. The model no longer maintains separate appearance/outfit prose; the application derives readable summaries. Setup **Allow appearance / outfit changes** is on by default, permitting requested changes and dependent wardrobe/presentation/pronoun corrections. Unrelated traits and explicitly retained details stay in the model contract. Turn the option off for server-enforced preservation of physical facts, wardrobe, condition and location; appearance pins always apply. Manual edits remain available in setup, Records and the reader notebook through the same editor.

**Full redesign** refreshes the complete character concept and name within the supplied direction, appearance permission and pins. **Reroll name** uses a small name-only model contract and changes exactly one field, rejecting unchanged/duplicate names or extra model fields. IDs, No NSFW preferences, cast links and other setup records are protected. Redesign does not silently rewrite separate inventories, relationship descriptions or opening notes; the editor prompts review of those records when old wording may remain.

During narration, only explicit, evidenced changes become sparse profile updates. Updating hair does not erase eyes or age; changing a coat does not replace unrelated footwear or accessories. Pins cover visual traits, wardrobe, injuries and supplemental appearance/clothing notes. Completed story prose and all validated effects still commit atomically. Current clothing and any explicitly affected possession/equipment changes belong to that same transaction; an equipped inventory item is not automatically assumed to be a garment.

Current feelings and immediate intentions can change through an evidenced `character.update.currentState` without replacing persona or physical identity. Appearance/outfit pins leave this narrative state editable; a dedicated field pin can protect it when wanted. AI record corrections retain an omitted optional state rather than clearing it. There are no relationship meters, emotional scores, or extra generation passes.

The narrator receives a concise projection of the same facts. Actual/apparent age and identity/presentation stay distinguishable. Supplemental detail and persona remain subject to the existing context budget and Dev coverage reporting; no image art style, camera or per-picture pose is inserted into a character's narrative profile. Duplicate wire schemas are avoided in schema mode, and extraction contracts remain bounded.

## Image projection

Default image prompts use apparent age when provided, otherwise actual age; visible presentation falls back to gender only when no presentation is supplied. A 300-year-old character who appears 30 therefore receives a visible-age description of 30. Advanced custom templates can explicitly request actual identity metadata using `subject.actual_age` or `subject.gender_identity`.

Wardrobe regions map directly to shot fields. Changing framing reprojects inherited wardrobe/condition/markings while preserving per-picture overrides; switching back to full body restores saved footwear and other inherited details. Settings test subjects follow the same framing behavior without resetting edited art direction. Portraits omit lower-body clothing, footwear and clearly off-frame supplemental notes or markings. Extra visible/clothing details and injuries have editable shot fields and template variables. Canonical supplemental text is projected to the existing 2,000-character shot-field limit; the original full notes remain saved and editable in Records. The full resolved prompt remains bounded to 16,000 characters.

Pose, expression, scene, composition, lighting and art direction belong to each picture. Image proposals remain image-only until explicitly remembered. **Remember visual identity** saves reviewed visible identity traits without retconning an established actual age or gender, and a portrait cannot erase a saved marking outside its crop. It does not silently save image wardrobe, injuries or supplemental shot-note edits to current canon.

For older passages, current wardrobe/condition is not seeded as historical evidence. The preparation model receives the selected source and an explicit current-state applicability flag; current clothing/injuries are omitted from its historical reference payload. Older appearance changes without source evidence still need user review: this is not a complete reconstruction of every character's historical state. Existing accepted pictures and their captured prompts/source facts remain immutable.

Art direction is independent of identity. Framing adds no illustration/painting/render medium, and authored templates and overrides stay editable. See [Illustrations](ILLUSTRATIONS.md) for workflow/job details.

## Persistence and verification

The same normalized character schema covers setup saves, Records/notebook edits, narrated effects, recovery baselines and ZIP import/export. Legacy freeform descriptions are retained once as supplemental notes when no structured profile exists; review these notes when filling older profiles to avoid conflicting descriptions. No save folder is deleted or automatically regenerated.

Places and items also support an optional `visualDescription`, separate from narrative description/history, for reusable shape/layout, materials, colors, scale and distinctive details. These fields are editable in setup and Records and are used by selected image subjects. Old records can leave them empty. Sparse effects and AI corrections preserve omitted designs; explicit empty values clear them. Manual and narrated stack splits copy the source design. Both visual descriptions and current state survive story/setup archives through the shared canon schema.

`tests/character-alignment.test.ts` covers derived summaries, normalization/replay, distinct identity fields, supplemental image details, crop/remember behavior, memory invalidation and archive persistence. Story, context, effect and illustration tests cover wire contracts, sparse changes and pins. Production browser scripts exercise setup/redesign, Records/notebook synchronization, exact image prompts, restart and mobile behavior.

`node --import tsx scripts/character-alignment-live-smoke.mjs` uses saved local LLM/ComfyUI connections with isolated stores. It generates structured characters and an opening, resolves a visible-age photographic portrait from the same canonical profile, saves it to the photobook and verifies ZIP roundtrip. Test artifacts stay in ignored `test-results`; normal libraries/settings are untouched.
