# Story and picture controls

These controls organize existing story facts and user direction for local text models and text-only image workflows. They do not add model calls or reference-image requirements.

## Writing

New story → Premise & storytelling preferences and Settings → Story have a separate **Writing guide**. Use a short paragraph about pacing, dialogue, description and habits to avoid. Narrator style remains the broad voice; Content notes & boundaries remains a separate preference. The writing guide reaches opening and continuation requests and wording polish. Continuation treats it as required context, so it cannot silently disappear to fit a smaller budget. Ask does not use it.

## Character identity and current state

Setup, the cast notebook and Records → Cast expose **Current state**, a short note about current feelings and immediate intentions. Personality, voice, long-term motives and history remain enduring profile fields. Current outfit and injuries retain their existing fields. Current state is not a completed event or an instruction to perform an action. Evidence-backed generation can update it when prose explicitly establishes a change; sparse updates preserve all other profile fields.

## Scene direction

The reader's Scene direction has three scopes:

| Scope | Lifetime |
| --- | --- |
| Next passage | Clears after the next accepted continuation. Failed generation, latest-passage replacement, Ask and wording polish do not consume it. |
| Current scene | Remains until the reader chooses **End scene**. This clears saved direction without changing prose or canon; the app does not guess scene boundaries. |
| Ongoing | Remains until changed or cleared. |

The collapsed summary shows the active saved scope. Save or reload edits before clearing a brief. Chapter endings do not automatically end a scene. The separate opening plan applies to the opening passage and is cleared when chapter one begins. Old saves with only `clearAfterPassage` retain their prior one-shot or persistent behavior.

## Picture composition

Illustrations → Compose gives each depicted character **Image position**, **Depth** and **Gaze** controls. Gaze can target another depicted cast member. These choices become ordinary prompt sentences and stay intact during story refresh and missing-detail suggestions.

Each character also has five detail switches: face/hair/eyes, build, clothing, accessories, and distinctive details/condition. Switching a group off omits its structured details without erasing saved values. New portraits start with build details off; portrait cropping still omits lower-body clothing and footwear. The switches work in natural-language and custom-template modes. Free-text scene, pose and template text stays author-controlled; review it if it repeats a disabled detail. Complete prompt overrides remain authoritative.

## Reusable setting and object design

Places and items have **Visual description for pictures** in setup and Records. Use visible materials, colors, shapes, layout or size. A selected entity's picture prompt uses this field when nonempty, otherwise its ordinary description. These image design notes stay separate from narrator/extraction context. The image-preparation assistant receives them for the selected subjects. Item stack splits retain their shared visual design.

## Saving

Story and setup ZIPs carry the new saved fields. Shot controls are retained in device drafts, captured generations and accepted image compositions, so reuse and variations preserve them. Older saves and images remain readable with compatible defaults. Changing shot controls never changes the character's canonical identity, clothing or current state.
