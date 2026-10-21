# Settings

Illustration studio inherits ComfyUI defaults, portrait/full-body templates and the Story scene/group template from these settings. Edit the group template with `{{subjects}}` and preview it in the studio; the existing single-subject test preview continues using its own selected template. See [Illustrations](ILLUSTRATIONS.md).

Settings has seven tabs. Reading preferences save automatically in this browser. Story preferences save to the selected story. Text LLM, ComfyUI, Prompts, and Context have independent Save buttons and persist in the instance's ignored local configuration. Drafts survive switching Settings tabs; a dot and unsaved status identify changed sections. **Reset to saved** discards only that section's edits.

Editable connection drafts remain separate from saved defaults. Tests and model discovery use the form's current values without saving or changing a story. Saving one section keeps pending changes in the others; failed saves keep entered fields. Leaving Settings asks before discarding unsaved changes, and browser reload/close uses the normal unsaved-page warning. Save each changed section to keep it; there is no general draft autosave. Entered API keys stay in component memory until submitted and are never stored in browser storage.

## Reading

Text size, reading width, serif/sans font, line spacing, light/dark/device appearance, and story artwork visibility. Browser preferences are separate on ports 5173 and 5175.

## Story

Title, premise, narrator style, a dedicated writing guide, tense, narrative perspective, target passage/chapter lengths, art direction, adult-content preference, and free-text content boundaries. The writing guide is a compact, story-level field (up to 3,000 characters) for pacing, dialogue balance, description density, narrative distance and habits to avoid. It is separate from scene plans and boundaries, saves with ordinary story preferences, travels with setup/story archives and is required narration context rather than optional background. It adds no model calls. Existing stories default to an empty guide.

New stories default to 800 words per passage and approximately 3,000 per chapter. The reader can also keep a chapter open or request an earlier ending. Adult content starts off, and enabling it never clears individual character No NSFW selections. These preferences guide live narration. Changing them does not rewrite earlier passages or expand the deliberately short sample. Scene direction has next-passage, current-scene and ongoing scopes; see [Director/editor tools](DIRECTOR_EDITOR.md).

## Text LLM

Configurable OpenAI-compatible address, server-only API key, model discovery/dropdown or manual ID, temperature, top P, output/context budgets, structured-output mode, and request timeout. A blank key uses/retains the stored key; explicit removal sends no key.

Test connection lists models. Run text test sends editable system instructions and a user prompt to chat completions, displays the generated prose and elapsed time, and records the request in Dev. Cancel aborts this request. It does not save the form or change a story. Text tests use the selected sampling settings. Recap and manual passage-memory extraction use temperature 0.2; chapter/book compaction and live effects extraction use 0.1; top P and per-request timeout apply. Recaps retain an overall three-minute/32-call cap and memory extraction a two-minute cap. Auto requests JSON-object output whenever a task supplies a structured schema (setup, narration, effects, questions, polish and memory). JSON schema additionally requests guided schema output; Prompt only sends the instruction contract without a response format. Prose tests and reader recaps remain ordinary text. Unsupported provider formats report an error rather than silently switching modes.

## ComfyUI

Service address, selectable/importable API workflow, explicit node/input bindings, output node, width/height, steps, CFG, seed (-1 random), and image timeout. Import API-format JSON under 900 KB; imports are stored in ignored `config/workflows`. The supplied original workflow remains unchanged. A separate copy corrects its model subfolder paths for this development installation.

Inspect workflow suggests bindings for standard CLIPTextEncode/KSampler/EmptyLatentImage nodes and a save/preview output. It does not know the semantics of every custom graph: inspect the nodes and correct mappings before use. Empty bindings leave those graph inputs unchanged. A populated negative prompt requires a negative binding; the supplied graph uses zeroed conditioning instead. There is no automatic custom-node installation or Python/script execution in the importer.

Test connection reads system stats. Generate test image validates the workflow's node availability, enum choices, and bound scalar inputs, then queues a real ComfyUI job. The UI polls history and displays PNG/JPEG/WebP outputs, limited to four previews and 20 MB each. Test output prefixes are separated from story output prefixes. Job details and resolved graph appear in Dev.

One image test may run per app instance. Stop watching stops polling, not the shared ComfyUI server. Provider prompt IDs, original endpoints, output bindings, timings, and preview-file metadata now persist in `jobs.sqlite`. Return to Settings after restart to reconcile the existing job without re-queuing it; changing the active connection does not redirect that lookup. An interrupted submission without a saved prompt ID requires inspecting ComfyUI before starting another. Completed previews stay readable across restarts. Clear them from Storage & Dev; ComfyUI retains its own output files. These experiments do not enter story galleries/photobooks or mutate inventories/outfits. Text tests are also tracked as durable jobs; interrupted text requires an explicit new attempt.

## Prompts

Editable narrator craft instructions, portrait/full-body/scene templates, and negative prompt. Variables use `{{subject.face}}` syntax. Supported fields are listed with editable one-off test values and a resolved prompt preview. Unknown variables produce an error.

Face, hair, eyes, upper-body clothing, lower body, footwear, accessories, expression, and pose are separate fields. Portrait framing always omits lower-body and footwear variables. Selecting a cast member supplies their name/content preference, not an unfiltered biography or outfit description. Enter the appropriate visible details for a test. Test art direction initially comes from the selected story.

The test defaults to nonsexual, fully clothed treatment. Story-level and per-character preferences also contribute to its resolved instruction. These controls supply model instructions; they do not claim to guarantee model output or add an exhaustive content classifier. Shared granular character profiles, gallery/photobook acceptance and editable shot fields are implemented. Richer coverage/occlusion rules, reference-image execution and richer saved per-shot workflow profiles remain future work.

## Context

Recent passage count, maximum recent-prose bytes, overhead reserve, and relationship/unresolved-thread inclusion. These feed live narration and Dev's context builder. Recent prose has a 30% estimated-token budget-share cap as well as the configured byte limit. Requests, schemas and summary chunks use a shared conservative token estimate with the overhead reserve; byte counts remain separate diagnostics. Required facts, content preferences, hidden-lore omission, and stale-source exclusions remain active. Each generated passage saves a continuity memory automatically. Recap summarization uses its own bounded pipeline. Automatic chapter/book maintenance is enabled by default, with one to six recent completed chapters retained before book compaction (default two). Dev can rebuild pending summaries. See [Memory compaction](MEMORY_COMPACTION.md) for bounds, correction invalidation and post-commit failure behavior.

## Storage & Dev

Instance paths, test-preview count/size and clearing, settings export without API keys, story ZIP export, and diagnostics export. Workflow files and test images are not packaged with the settings JSON or story ZIP. Story import remains in Library. Log filters, request traces, memory editors, and state inspection remain in Dev.

Development verification on October 17, 2026: the selected Unsloth model returned a short prose sample (about 56 seconds including any model startup); the supplied corrected ComfyUI workflow produced a 512×640 portrait using four steps (about 16 seconds). These are connectivity checks, not narrative-quality benchmarks. Automated coverage includes mock text/image generation, settings save isolation, framing variables, workflow validation/import, persistence, and all Settings tabs down to 320 px.

Completed ComfyUI previews can be explicitly copied into Gallery with captions, depicted subjects, and source passage links. Saved story copies survive clearing test previews. New tests retain sanitized workflow, prompt/template/variables, seed, and settings snapshots. See [Media core](MEDIA_CORE.md).

`node --import tsx scripts/draft-cleanup-smoke.mjs` verifies independent Settings saves, draft-only tests, failed-save recovery, reset/discard/unload behavior, absence of keys in browser storage and 320px forms, alongside notebook, recap, scene and picture drafts. It runs against an isolated temporary production instance.

Text LLM also exposes Thinking mode for Unsloth. Off/On sends its documented enable_thinking flag; Provider default sends no vendor-specific thinking parameter and is appropriate for other APIs. Development connections use Off, a 4,096-token output budget and a 300-second per-call timeout. The full setup schema and cast-ID-specific narration schema are included in story prompts; schema mode additionally asks the provider for guided decoding.
