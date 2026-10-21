# Pinned facts and world rules

Implemented October 19–20, 2026. Pins extend existing appearance/outfit protection to selected fields and established reader-visible world rules, both during setup and in the written story. [Project status](PROJECT_STATUS.md) records current verification; production ZIP creation remains on demand.

## What a pin means

A field pin protects the current saved value of one supported field on a cast member, place, item, relationship, thread or world record. It points to the field rather than copying its value. A manual edit remains allowed: saving a new value changes what the pin protects. Unpin a field before asking AI to change it.

A blank-field pin means “keep this unspecified”; it prevents AI from filling that field. Pinning a location, owner, quantity, equipped state or shared funds deliberately prevents those values changing through narrated travel, trades, purchases or other effects until the pin is removed. Choose narrow pins when an entire record should remain free to develop.

| Record | Supported fields |
| --- | --- |
| Cast | Name, role, location, supplemental notes; each actual/apparent age, gender/presentation, species, skin/build/face/hair/eyes/features field; each personality/voice/motives/history field; each regional wardrobe field; injuries and supplemental appearance/outfit notes |
| Places | Name, description, containing place |
| Items | Name, description, quantity, immediate owner/storage, derived ultimate owner/location, equipped/worn state, container flag |
| Relationships | From/to cast member, relationship notes |
| Threads | Title, notes, status |
| World | Shared funds, cargo notes |

For stored items, **Owner / storage** pins the immediate holder. **Ultimate owner / location** pins the eventual character/place, including changes caused by moving an ancestor bag. Ownership pins protect the existing record; pin **Quantity** too if AI should not split units into a new stack. The optional Container flag resolves to false for ordinary items. See [Inventory](INVENTORY.md).

World rules are short, explicit constraints such as “Ordinary ships cannot travel faster than light.” Use them for established reader-visible facts. Directions for the next passage, desired future outcomes, hidden plans and unrevealed secrets belong in their existing controls instead. Rules are instructions to the model; the application does not prove that prose obeys them semantically.

Existing appearance/outfit pins and each cast member's No NSFW setting remain independent.

## Before chapter one

Open **Pins & rules** in the setup sections. It uses the same record/field picker, current-value previews and world-rule editor as the written story. **Save setup draft** saves these controls with the reviewed plan; AI options save edits first. Write or remove empty rules before saving, exporting or generating. All normal setup draft navigation, cancellation and revision checks apply.

Targeted character/place/item/relationship/thread redesigns and name rerolls receive every saved pin and rule within the checked request budget. A conflicting result is rejected atomically, including an indirect ownership change caused by moving a bag. Explicit manual field edits establish a new value for the pin to protect. To remove a pinned setup record, unpin its fields first; the disabled removal control explains this dependency.

Full **Regenerate cast & world** replaces record identities and therefore requires removing field pins first; the interface links to Pins & rules and the server refuses before calling the model. Rules alone do not prevent full regeneration: they remain saved and guide the new setup. Use targeted redesign to change unpinned details while preserving selected facts.

Setup ZIPs retain pins and rules. **Begin chapter one** includes them in narration/extraction and validates the final opening state before publishing. Successful publication carries the same constraints into the written story and its normal ZIP. Pinning a location, owner or quantity can deliberately prevent an opening event; unpin it when the story should change that fact.

## Editing and saving

Open **Pins** in the main navigation. Choose **Record type**, **Record** and **Field**, then **Pin selected field**. The field's current saved value appears in the list; **Unpin** removes its protection. **Add world rule** creates a rule to write, and **Remove rule** removes it. **Save pins & rules** applies the configuration explicitly; **Reset changes** restores saved values. Empty rules must be written or removed before saving.

Unsaved pin changes participate in navigation and browser-close protection. Saved pins travel with the story in its normal local save and story ZIP. The configuration allows up to 200 field pins and 50 world rules of up to 2,000 characters each; these storage limits do not guarantee they will fit a particular model's context budget.

Removing a record through its normal editor also removes field pins targeting it. It does not remove unrelated pins or world rules. Field pins cannot target missing records or unsupported paths.

## Generation and corrections

Narration, non-advancing Ask, effect extraction and in-story AI correction context include every saved field pin with its current value and every world rule. These are required context: if they cannot fit the available input budget, the operation reports the budget constraint instead of silently dropping them. Pinned records therefore remain represented even when ordinary relevance selection would omit them.

Structured changes from continuation, latest-passage replacement and AI correction cannot alter or remove a pinned field. The server validates the complete proposed result before committing, so one violation rejects the whole transaction. No partial inventory, character or prose update is accepted. Review the error, change the request or explicitly edit/unpin the fact before retrying.

Latest-passage recovery preserves the current pin configuration; it must not restore an older configuration with the fictional state. Pins are user controls, not narrated events. Existing source, revision, job and recovery checks continue to apply.

If the latest passage created a record, pinning one of its fields can prevent replacing that passage when the replacement would remove the record or recreate it with a different application ID. Unpin it explicitly before that rewrite, then pin the intended surviving record afterward. Pins do not automatically retarget another record with the same name.

A save that changes only pin configuration keeps the existing latest-passage recovery baseline. An actual manual canon edit still invalidates that baseline under the normal correction rules. Latest replacement compares its complete proposed final canon with the current pinned values, including when its restored starting state differs from current canon.

Image preparation receives relevant selected identities and world constraints. Shot-only visual experiments remain possible; they do not change pinned canonical values. Saving visual identity is a separate explicit manual edit.

The guarantee is about structured saved fields. A field pin does not make generated prose infallible, resolve contradictory author instructions or validate the meaning of a freeform world rule. Use the existing review/correction tools when prose conflicts with established facts.

## Storage contract

`Story.factPins` contains `fields` and `rules`. A field entry identifies its `kind`, `recordId` (null for world fields) and allowlisted `field` path. A rule contains an application-assigned `id` and `text`. The value of a field is resolved from current canon whenever context or validation needs it; a stale value is not stored alongside the pointer.

The story mutation operation is `fact-pins` through `PATCH /api/stories/:id`, using the normal expected revision and request ID. This saves configuration rather than changing fictional canon.

`SetupPlan.factPins` uses the same schema and pointer semantics. Missing configuration defaults to empty. Generated setup commits cannot change pin configuration, and opening publication validates pinned canonical fields independently of prompt compliance. Arbitrary JSON paths and a semantic prose constraint engine remain outside scope. Save migrations remain excluded during development.

## Verification

The October 20 completion checkpoint passes all **212 tests**, clean Svelte checks and the production build. `tests/setup-pins.test.ts` adds defaults/reference checks, manual-current-value semantics, independent AI commit guards, replay, no-call regeneration refusal, rules-only preservation, all targeted generation paths, mandatory-budget refusal, opening rollback and setup/story ZIP inheritance. `node --import tsx scripts/setup-pins-smoke.mjs` passes the isolated setup UI walkthrough: blank rules, unsaved protection, manual value previews, conflicting name/indirect-holder changes, removal guidance, portability, opening, restart and a visually inspected 320px layout. The existing written-story Pins walkthrough also passes after sharing its controls with setup. ZIP packaging remains a separate on-demand action.

`tests/fact-pins.test.ts` covers supported targets/fields, invalid configurations, resolved current values, atomic protection, transactional/replayed saves, manual edits, record deletion, mandatory context and budget refusal. Existing suites also exercise passage/correction/archive boundaries. Browser and package acceptance are separate checks; passing the unit suite is not a claim of semantic prose adherence.

`node --import tsx scripts/fact-pins-smoke.mjs` passes the isolated production UI walkthrough with temporary saves/mock services. It covers all six field categories, saved-value changes, rule creation/removal and empty-rule refusal, save/reopen/reset, discard/unload warnings, concurrent-save conflict with retained drafts/reload, an atomically refused pinned-item trade followed by successful unpin/retry, current-pin latest-replacement refusal and restart persistence. No browser exceptions were observed; the 320px screenshot was inspected. Existing Records and corrections browser walkthroughs also pass. The exact production ZIP also passes a fresh extracted install, including atomic pin refusal, rule/pin archive persistence and restart. These checks do not prove semantic prose adherence.
