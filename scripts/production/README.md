# Storyweaver 1.0

A local illustrated-novel app. Start with a premise, edit the cast and world, then guide the story as it develops.

## Start on Windows

1. Install Node.js 24 or newer, including npm.
2. Extract this ZIP into a writable folder. Do not run inside the ZIP.
3. Double-click **Start Guided Story.bat**. On first launch it installs the locked npm dependencies; internet access is required for that installation. Later launches reuse them.
4. Open **http://127.0.0.1:5175/**. Keep the launcher window open; Ctrl+C stops the app.

For terminal startup, run `npm ci --omit=dev` once, then `npm start`. A different port can be selected with the `STORY_PORT` environment variable.

This bundle contains the compiled production application, its launcher, dependency manifests, clean default configuration, one example ComfyUI workflow and required license notices. It does not include application source, tests, development documentation/tools, reference checkouts, source maps, saved stories, images, API keys or personal connection settings. The library starts empty. A sample is available only if you explicitly create one in Library.

## Connect and create

Settings → Text LLM: enter an OpenAI-compatible API address and any required key, connect to list models, select one, save and run a test prompt. Settings → ComfyUI: enter its address, check the workflow/bindings, save and generate a test image. These services and their models must be installed and running separately; this ZIP does not bundle them.

Defaults point to local text at `http://127.0.0.1:8888/v1` and ComfyUI at `http://127.0.0.1:8188`, with no key or selected text model. The included workflow is `AI/Comfy Workflow/portrait.comfy-desktop.api.json`. It selects `Krea 2\nsfw\SICK_OLLIE_Krea2_BF16.safetensors` (Sickollie). Its models/custom nodes must match your ComfyUI installation; import another API workflow through Settings if needed.

New installations start with a 32,000-token text context budget, 4,096 output allowance, temperature 0.8 and Thinking off. Match the context budget to your text server. Images default to 896 × 1152, 9 steps, CFG 1 and a random seed; the workflow uses Euler/beta. Existing local settings are retained. Context displays use conservative token estimates rather than treating each text byte as a token.

Choose New story, describe your idea, generate/review the ensemble and world, and begin chapter one. Continue adds passages to the current chapter. Use the in-app Help for editing, illustrations, memory and recovery. Character setup, story narration and pictures share one profile: actual/apparent age, identity/presentation, personality/voice/motives/history, clothing by body region, and current injuries. Edit it in setup, Records or the reader notebook; appearance/outfit summaries update automatically. Personality redesign preserves physical facts unless explicitly allowed, and pins stay respected.

Before chapter one, **Save & export setup ZIP** saves and downloads current preparation. Library's **Export setup ZIP** downloads the last saved version, and **Import a setup ZIP** opens an independent editable copy. A premise-only draft also works. These controls preserve story preferences and cast/world links without keys or generation history; importing does not call a model or start the novel.

Adult content is off by default; new cast members start with No NSFW checked.

Open **Pins** to protect individual saved cast/place/item/relationship/thread/world fields or add established world rules. Choose the record and field, then **Pin selected field**; use **Save pins & rules** to apply or **Reset changes** to discard the draft. All saved constraints are required model context, so an oversized set stops generation rather than dropping rules. AI cannot change pinned saved fields; explicit manual edits remain allowed and become the new protected values. Pinning a location, quantity or owner also prevents narrated travel/trades from changing it until unpinned. General setup pins are not included, and world-rule prose adherence still needs review.

For stored items, **Owner / storage** protects the immediate bag/place/person link. **Ultimate owner / location** protects the eventual cast member or place, including when an ancestor bag moves. **Container** protects storage status; **Quantity** protects the existing count. Add Quantity as well as an ownership pin to prevent a partial handoff from splitting units into another record. Manual edits remain allowed.

The API requests strip at the bottom shows live call/job status. Expand it for elapsed time, prompts/workflows, completed responses and errors; credentials are redacted. It remains available during generation and across screens. Text results appear when the call finishes. Existing ComfyUI jobs are checked in the background while the browser is visible; ready previews still need explicit acceptance.

The Errors button collects failed saves, invalid form fields, browser/server errors and generation failures without opening over your work. Errors can be copied, dismissed or cleared. Clearing this browser-session list keeps the full Dev logs and your story. On phones, the reader offers shortcuts to its notebook and story controls.

Settings tabs mark unsaved changes. Save each changed section or use Reset to saved; testing a draft connection does not save it, and saving one section keeps drafts in the others. Notebook notes, recaps, titles, scene direction and picture details also show unsaved state and offer reset/reload controls. Failed saves keep entered fields, and leaving or reloading warns before discarding unsaved work. These forms need explicit Save. API keys are saved only on the server, never in browser storage.

In a new story's Cast section, Redesign this cast member follows your direction, Full redesign rebuilds every profile section and name, and Reroll name changes only the name. Appearance/outfit changes are allowed by default; turn the option off or pin the profile to keep physical details. Content preferences and linked IDs are kept. After a major redesign, review separate possessions, relationship descriptions and opening notes for old names or outfit/history references.

Other setup sections also have AI options: revise/redesign existing places, possessions, relationships and threads, reroll names/titles, or generate one new record. World foundations and the opening plan can be revised or regenerated separately. Give an optional direction; manual edits save first, and generated results remain editable. The opening plan creates no prose until Begin chapter one.

Reader actions open an instruction field before any model request. Ask uses your question; Polish wording accepts style instructions or a blank general copyedit. Change what happens opens What should happen instead? for the latest passage; enter a direction, choose Rewrite latest passage and confirm. Its instructions and chapter ending are separate from the next-passage direction. Cancel rewrite keeps its local draft without sending anything.

For a missed fact, choose **I noticed something needs correction** below a passage, fill **What needs correction?**, then **Preview corrections**. Review the original request and every Before/After before **Apply corrections**. For example, a jacket-for-fob trade can correct both owners, add a garment missing from inventory and adjust worn clothing. Check the result: clothes described in wardrobe and inventory items are separate, and the model may need clearer guidance. This fixes current records even from an older passage; it does not rewrite history or branch the story. Context is bounded, with omissions shown. Applied canon fixes pause latest-event replacement until you continue and mark derived memories/recap stale.

**Records** has AI revise/full redesign/name-or-title reroll and new-record options. Save manual fields first or reload the saved record, describe the change and **Preview AI changes**. Only the selected record changes; use the reader report for related fixes across records. Pins and content preferences remain protected, and AI cannot delete records. Failed requests keep your direction; changed source/revision or instructions require a fresh preview or restoration of the original request. Applied records are backed up in story ZIPs; recent proposal history stays in this local installation.

**Records → Items** includes an Inventory browser showing cast/place possessions and nested storage. Create a quantity-one item with **Container** checked, then choose it under another item's **Owner / storage**. Moving a bag carries its contents; empty it before removal or turning off Container. Only directly cast-held items can be equipped. For a saved stack of at least two, save/discard other drafts, choose **Split this stack**, set quantity and destination, then **Split and save**. The two counts preserve the total, and the new stack starts unequipped. Stacks do not merge automatically. New-story possessions also support containers.

In Illustration studio, new shots use natural-language prompts for Krea/Z-Image-style workflows. Edit age/apparent age, gender/presentation, eyes, hair and other visible features. Fill missing details proposes blank features while preserving entered values; Remember visual identity saves reviewed features for future pictures. Camera/composition and lighting/palette are editable. Framing is medium-neutral; only your explicit Art direction or custom prompt chooses an illustrated, photographic or other treatment. Refresh older generated scene text if it repeats a previous style. Custom templates and complete overrides remain available. No NSFW is independent of age/gender.

**Nonsexual, fully clothed image** is checked and disabled while the story's Allow adult content setting is off; its help explains why. When the story allows adult content, the image checkbox becomes optional. Depicted characters with No NSFW still keep their individual restrictions, with their names shown beside the control. With the story and intended depicted profiles opted in and the image checkbox off, no automatic nonsexual/fully clothed instruction is added. Existing clothing and explicit content notes still apply.

Use **Landscape orientation** at the top of Illustration studio to swap width and height for that image. The canvas size is shown beside the toggle. Turn it off to return to portrait; saved ComfyUI dimensions stay unchanged. Both width/height workflow bindings are required, and square dimensions remain square.

For an image based on a passage, **Which part of the scene? (optional)** lets you name a moment or paste a short excerpt. **Use this moment** beside a source paragraph copies it into that field; paragraphs over 2,000 characters need a shorter pasted excerpt. **Clear selected moment** clears only that choice. Selecting or clearing a moment makes no model call: Refresh prompt from story or Generate prepares it. Leave it blank for automatic selection. Changing the passage or moment stays pending through unrelated trait/background edits, Fill missing details and Remember visual identity. Refresh explicitly or intentionally edit Visible scene / action to accept the new source. The choice stays with drafts and saved pictures. A complete prompt override takes priority and disables moment controls.

**Copy resolved prompt** copies the current positive prompt exactly. **Copy captured prompt** copies the prompt sent for a selected generation, including older generations. Success appears beside the button, and failures also appear in the bottom Errors panel. Copying and moment selection do not change Settings or historical images.

Refresh prompt from story beside the resolved preview updates scene/cast details using the selected passage and saved facts. Generate refreshes unprepared/stale story details first when a text model is available, unless automatic refresh is off. Manual scene/cast edits and complete prompt overrides are preserved. Watch the freshness note; failed/cancelled refreshes do not queue an image.

## Saves and updates

Stories and accepted images are created under `data/play`. Saved connection preferences/keys live in `config/connections.play.local.json`; imported workflows use `config/workflows`. These files are created when used and are not shipped in this release.

Use Library → Export ZIP for story backups. Import adds a separate copy. Keep backups before deleting stories or replacing an application folder. Stop the server before moving its files. This development release does not promise save migrations. Model-generated narration, memory and continuity reviews may need correction; check sources and editable records.

Use the separate setup ZIP controls for unfinished preparation. After chapter one, export the written story instead; its inventory, nested contents and pictures travel together. Neither import overwrites an existing library entry.

If another Storyweaver instance already occupies port 5175, stop it before starting this extracted release or select a different `STORY_PORT`. This launcher does not build application source or replace another running instance.
