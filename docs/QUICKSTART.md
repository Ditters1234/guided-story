# Storyweaver 1.0 — quick start

## Install and launch

The clean `storyweaver-1.0.0-production.zip` uses a standalone launcher and starts with an empty library. Its batch file installs locked runtime dependencies on first launch and does not rebuild source. Follow the [production bundle guide](../scripts/production/README.md) for that archive. The instructions below cover the full source/development distribution.

On Windows, install Node.js 24 or newer. Extract the release ZIP, open a terminal in its `storyweaver` folder and run `npm ci` once. Double-click **Start Guided Story.bat**. The launcher checks the production build, rebuilds when application source changed, and opens http://127.0.0.1:5175/. Keep its window open; Ctrl+C stops it. Double-clicking again reuses an existing Storyweaver instance on that port.

Existing users keep `data/play` and `config/connections.play.local.json` in their current checkout. This release does not reset those files. Export story ZIP backups before replacing application folders or experimenting with development saves. Release packages never contain personal saves or connection keys.

From the source checkout, **Build Production ZIP.bat** creates a clean production distribution when needed. Routine development changes do not rebuild that archive automatically.

`npm run dev` runs the development server on port 5173 with `data/dev`. `npm run play:dev` runs the play library with development reloads when needed. The normal batch launcher and `npm run play` use the production build. A running production instance needs a restart to pick up application changes. Port 5174 is unused by Storyweaver.

## Connect your services

1. Settings → Text LLM: enter the OpenAI-compatible API address and any required key. Connect/refresh models, select a model, save, then run a test prompt.
2. Settings → ComfyUI: enter the server address, choose/import an API workflow, check its input/output bindings, save, then run a test picture. Custom workflows need their corresponding models and custom nodes installed in ComfyUI.
3. Start a New story, or explore the short included space-trader sample. Manual setup and record editing work without a model. Pictures are optional while reading.

The supplied working workflow is `AI/Comfy Workflow/portrait.comfy-desktop.api.json`; the original is preserved. Text defaults target local Unsloth at port 8888; ComfyUI defaults to port 8188. Change both through Settings. Storyweaver does not install/start those services or bundle their models.

## Create and guide a story

Enter a premise, generate the ensemble/world and edit the proposed setup. Begin chapter one when ready. The opening is one installment; Continue adds another passage to the chapter. Defaults are approximately 800 words per passage and 3,000 per chapter, adjustable in Story settings. Directions can select a focus, change the pace or introduce a complication. An empty direction lets the narrator continue naturally.

Save setup draft keeps your current preparation in Library. Leaving New story with unsaved edits asks before discarding them; reload/close uses the browser's normal unsaved-work warning. The welcome and Help connection shortcuts open Text LLM directly, while the main Settings button remembers your last section.

Use setup's **Pins & rules** section to keep selected facts during targeted AI redesign and chapter-one generation. Pins follow saved manual values and survive setup ZIPs/publication. Full cast/world regeneration requires removing field pins first; reader-visible world rules remain. In a written story, manage the same controls through **Pins**.

To move unfinished preparation, use **Save & export setup ZIP** in New story, or **Export setup ZIP** in Library for its last saved version. **Import a setup ZIP** opens an independent editable copy, even for a premise-only draft. It keeps the cast/world plan and preferences without keys or generation history and does not begin chapter one.

Scene direction saves an optional viewpoint, location, cast focus and stopping point. One-shot briefs clear only after successful generation. Contents and the bottom reader buttons navigate written history; the continuation point stays at the latest passage.

The ordinary **Optional story direction** and chapter-ending choice also keep a separate draft for each story in this browser. Reloading, switching stories or a failed generation preserves them. A confirmed continuation clears them; replacing the latest passage keeps the future direction. **Clear direction draft** resets both. These device drafts are separate from saved scene briefs and ZIP backups; if browser storage is unavailable, the page warns before closing with an unpreserved draft.

The fixed API requests strip shows ongoing calls and job phases. Expand it to inspect a redacted request and its completed response or error without leaving the current screen. It is available during generation; text output is shown after completion. The viewer also checks pending ComfyUI jobs, keeping ready previews separate from accepted story images.

Records edits current facts and possessions. Save explicitly. A real canon correction pauses event-changing replacement until you continue. Change what happens replaces only the latest passage and its effects. Polish wording offers a comparison and meaning review before acceptance. Ask and Review continuity discuss saved material without advancing events; inspect their excerpts, uncertainty and coverage. Review is advisory, not a proof that the story is consistent.

Records → Items groups possessions by holder, including nested bags/crates. Create a quantity-one item with **Container** checked, then choose it under another item's **Owner / storage**. Moving the container carries its contents; empty it before removal. Only items directly held by cast members can be equipped. To move part of a saved stack, save/discard other drafts, choose **Split this stack**, enter the quantity and destination, then **Split and save**. The remaining and moved counts keep the original total; the new stack starts unequipped. Setup possessions offer the same container controls. See [Inventory](INVENTORY.md).

## Pictures and backups

Illustrate a passage or create a portrait from a cast photobook. Review granular shot fields, framing and resolved prompts; generate and keep the result. One group picture appears in every tagged subject's photobook. Replacing a portrait preserves its history. Current generation uses text prompts; stored identity-reference selections do not yet condition workflows.

Use Refresh prompt from story beside the preview to update scene/cast details from the selected passage. Generate refreshes unprepared/stale details first when a text model is configured and automatic refresh is enabled. Manual scene/cast edits and complete overrides are preserved; the freshness note explains which mode is active. A failed/cancelled refresh does not queue an image.

Library → Export ZIP backs up the full accepted story, canon, memory and pictures. Import adds a separate copy. Export novel downloads written chapters as Markdown; hidden notes, current records and developer diagnostics are excluded. Delete/discard actions are permanent library removals; shared original image files are retained for other copies.

Use the separate setup ZIP controls before chapter one; use ordinary story ZIP controls after publication. Import never overwrites an existing library entry. See [Unfinished setup portability](SETUP_ARCHIVES.md) for exact limits.

## Troubleshooting

- No models / authentication error: check the API address/key, connect, select a model and save. The API address normally ends with `/v1` for OpenAI-compatible servers.
- Cut-off or short response: increase output tokens or lower passage length. Context budget must also leave room for current facts and source prose.
- Workflow/node/model error: inspect the graph and bindings against the running ComfyUI installation. Do not assume every imported graph has the supplied graph's node IDs.
- An uncertain save or interrupted request: reload to see the last committed result, then inspect Dev → Jobs / Requests. Retry explicitly. Text tokens are not resumed after restart; retained ComfyUI prompt IDs can be reconciled against their original server.
- Missing long-story detail: inspect Dev → Context / Memory coverage, rebuild stale summaries or correct records. Compression and lexical retrieval are bounded aids, not exhaustive recall.
- Port already occupied: the launcher identifies an existing Storyweaver instance; it refuses to replace another program. `STORY_PORT` can select another local port for advanced use.

Story-level adult content is off by default and each new character starts with No NSFW checked. Preferences are passed to the configured models; they are not output guarantees. Changing art/narrator style affects future generation and preserves accepted history.
