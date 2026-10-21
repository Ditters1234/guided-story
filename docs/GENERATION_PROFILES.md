# Generation profiles and editable prompts

The approved [node-workflow milestone](NODE_WORKFLOWS.md) adds a planned internal story-generation graph over this project's TypeScript engine. Existing ComfyUI image workflow/profile behavior described below remains in place; this is not a migration of the story engine into ComfyUI. Named model/API references and supported per-stage settings will be defined through that milestone's contracts. No node runner/editor is implemented yet.

The shared [character profile](CHARACTER_PROFILES.md) is implemented across story creation, narration and pictures. Actual/apparent age, identity/presentation, structured persona, regional wardrobe and current condition are distinct. Appearance/outfit prose is derived from these fields, and picture-only direction remains separate.

Story-linked illustration generation is implemented. New shots default to natural-language descriptions, with structured age/gender/species/skin/build/face/hair/eyes/features, explicit missing-detail assistance, reusable visual identity profiles and shot composition/lighting controls. [Illustration studio](ILLUSTRATIONS.md) adds granular editable subject fields, optional LLM preparation, shared scene/group templates, workflow selection/overrides, captured content/source preferences, durable jobs and photobook acceptance. Reference-image execution and richer named per-shot profiles remain follow-ups; the design below includes those future capabilities.

Status: Settings now implements selectable/importable API workflows, scalar input/output bindings, live text/image tests, editable narrator instructions and portrait/full-body/single-scene/group image templates, granular test-subject variables with portrait framing exclusions, resolved-prompt preview, and independent saves. Both local services passed real generation tests. See [Settings](SETTINGS.md) for exact supported behavior. The broader design below still includes future work: garment coverage editors, richer saved per-shot workflow profiles and reference-image workflow execution. Gallery/photobook integration and editable shot fields are implemented in the studio.

## Selectable workflows

Support named ComfyUI workflow profiles imported from API-format JSON. Bind logical inputs to explicit node/input paths and identify output nodes. Capabilities are profile-specific: positive prompt, optional negative prompt, seed, dimensions, reference images, and other exposed parameters. Unsupported controls are absent or clearly unavailable rather than assumed.

Select profiles independently for portraits, full-body pictures, and scene illustrations. Preserve the supplied workflow as an initial candidate, not a mandatory graph. Validate bindings and required inputs before queueing a job. Workflow selection must not execute arbitrary scripts or install custom nodes automatically.

## Editable templates and scopes

- Separate shared art direction, shot templates, model-specific prompt conventions, narrator style, and story preferences.
- Allow application defaults, per-story overrides, and one-generation overrides. Resolve the precedence explicitly and offer reset-to-inherited controls.
- Narrator style can change voice, pacing, perspective, descriptive detail, and literary influence. Keep domain-validation rules and machine-readable state contracts separate from editable prose style.
- Provide reusable presets and a preview/test action before applying a change broadly.
- Changes affect future generation. Old passages and images change only through an explicit revision or regeneration.

## Granular appearance and framing

Do not supply a full character biography or undifferentiated appearance/outfit paragraph to every image prompt. Preserve structured facts independently and select relevant details for the shot.

Example variable groups:

```text
character.face
character.hair
character.expression
character.build
character.appearance.upper_body
character.appearance.lower_body
outfit.headwear
outfit.upper_body
outfit.lower_body
outfit.footwear
outfit.accessories.face
outfit.accessories.neck
outfit.accessories.waist
scene.action
location.description
subject.visible_appearance
subject.visible_clothing
```

Headshot, bust, waist-up, full-body, and custom framing presets select defaults; users can override included details. Model prompt presets can adapt phrasing without changing shot selection or canonical character facts. In particular, do not include shoes in a profile portrait simply because the character owns or wears them.

Group images use an explicit subject list, preserving each subject's appearance, outfit, pose, and visibility instead of merging everyone's attributes into one string.

Use an Insert variable picker with descriptions, examples, and missing-value warnings. Unknown variables are validation errors. Templates are data, not executable JavaScript or arbitrary expressions. Preview the fully resolved prompt and permit a one-image text override.

## Adult content and suggestive material

Account for adult romance, suggestive/lewd presentation, and nudity in prompt configuration, subject to provider restrictions. Keep configuration simple: do not build a scenario-by-scenario moderation engine, automatic content classifier, or elaborate policy/preflight system. Provider refusals remain provider responses, not a reason to switch providers automatically.

### Preferences and scope

- Provide a story-level adult-content preference and optional free-text content notes. Keep narration style and image presentation independently editable without requiring a multi-level rating matrix.
- Each character has a clearly labeled **No NSFW** checkbox (`noNsfw`). When selected, the application's assembled narration and image context explicitly excludes that character from sexualized material, and automatic prompt assembly omits their optional adult-detail fields.
- Default `noNsfw` to `true` for every new character, whether generated, manually created, or imported without an explicit preference. The user may opt adult characters in individually by clearing it. New stories also default to no adult content; enabling it at story level never clears character selections automatically.
- Keep this setting separate from appearance, outfits, personality, and relationships. The LLM may not toggle it through story-state updates.
- Include the flag for each relevant character, including group scenes/images, rather than assuming the selected protagonist's preference applies to everyone.
- Child characters' profiles should have No NSFW selected and explicitly direct nonsexual treatment. Sexualized content involving minors is outside scope. This is a profile/context requirement, not a request to implement age inference or a scenario detector.
- Use the checkbox as an instruction and prompt-assembly preference; do not claim it guarantees a model's output. Do not build an exhaustive output scanner or a general enforcement rules engine around it.
- A story-level setting does not erase individual No NSFW selections. An unchecked flag is not a request to sexualize a character or every scene.
- Optional fade-to-black notes and hiding manually marked adult thumbnails can be simple preferences; automated image classification is not required.

### Physical detail, clothing, and coverage

Optional intimate physical details may be represented as structured private appearance fields for adult characters, with field-level visibility selection. They must not be included in ordinary portraits or unrelated scenes. Do not require users to fill these fields to create a character.

Keep these concepts independent:

| Concept | Meaning |
| --- | --- |
| Canonical appearance | Stable character facts, including optional adult physical details |
| Worn outfit | Garments actually worn at this point in the story |
| Garment coverage | Which body regions a garment covers; layers and accessories matter |
| Shot visibility | Regions in frame, plus visibility affected by pose and occlusion |
| Presentation intent | Neutral, romantic, suggestive, or another explicitly selected supported treatment |
| Content preferences | Story-level notes and each character's No NSFW selection |

Resolve image detail selection from framing, visible regions, garment coverage, and the character's No NSFW selection. This is ordinary template inclusion logic, not a scene-classification system. Covered or off-frame intimate details are omitted. A headshot must not acquire lower-body anatomy tags even when adult imagery is enabled. Nudity in a nonsexual scene must not automatically add erotic action or posing tags.

Suggested additional variable families:

```text
subject.framing
subject.pose
subject.expression
subject.visible_regions
subject.visible_clothing
subject.visible_appearance
subject.visible_adult_details
image.presentation
```

`subject.visible_adult_details` is empty when outside the selected shot or when No NSFW is selected. The variable picker and automatic assembly expose appropriate selected fields, not all stored physical details. Show the flag and resolved prompt for inspection; do not add a classifier to interpret every manually written instruction. Never append blanket nude, sexual, or negative-prompt presets unrelated to the requested image.

### Story pictures versus visual experiments

Changing clothing, pose, or presentation for a one-off picture does not silently change inventories, worn equipment, relationships, consent, or story events. Label an image as a scene illustration or a noncanonical visual experiment. Scene illustrations should match the committed scene's outfits and actions; an intentional departure is an experiment unless the reader separately edits canon.

Photobooks and galleries retain depicted character IDs, source passage if any, and canonical/experimental/superseded status. An optional user-set adult-image marker can control thumbnail hiding; do not require automatic content classification. Changing a preference does not delete existing pictures or rewrite past events.

## Generation provenance

For every image, retain the resolved prompt, template/preset snapshot, explicit subjects, framing and inclusion selections, effective content settings, workflow snapshot/bindings, generation settings, seed, and source story revision. Redact credentials and unrelated server configuration. Prompt history is potentially sensitive story data and is not included in routine error logs.

For narration, retain the user-facing style settings and generation provenance separately from canonical facts. Store structured-output contracts in application code, not in user-editable narrator text.

## Acceptance examples

- A bust portrait includes face, hair, visible upper garments, and suitable accessories; it omits shoes and off-frame physical detail.
- Enabling adult imagery leaves an ordinary clothed portrait unchanged unless presentation or clothing is explicitly changed.
- A nonsexual nude adult figure study does not acquire sexual actions from a generic style preset.
- A scene picture of two adults resolves identity, visible clothing, and pose per subject without swapping attributes.
- A visual experiment using different clothes does not update the character's inventory or current outfit.
- Selecting No NSFW for one character adds their nonsexual-treatment instruction to narration and group-image context and omits their adult-detail variables; it does not change other characters' saved preferences.
- Provider refusals are shown clearly without changing providers automatically.
- Changing narrator style affects future prose, not established events or older chapters.
