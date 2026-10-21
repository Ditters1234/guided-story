# Photobook and reusable component research

Reviewed October 17, 2026. PhotoSwipe and Sharp have since been adopted in the [media core](MEDIA_CORE.md). Other entries remain candidates; the table records their original evaluation.

## Recommended components

| Candidate | Use in Storyweaver | Fit and limits | Priority |
| --- | --- | --- | --- |
| [PhotoSwipe](https://photoswipe.com/) ([source/license](https://github.com/dimsemenov/PhotoSwipe)) | Zoomable image viewer with touch and keyboard navigation, shared by the gallery and cast photobooks. | Framework independent, MIT. Mount in the browser through a small Svelte component and destroy on unmount. We still own the thumbnail grid, chapter grouping, image associations, and actions. Captions require our own accessible markup/custom UI or a plugin; see [caption guidance](https://photoswipe.com/caption/). Evaluate the stable release when implementing; upstream is discussing v6. | First gallery slice |
| [Sharp](https://sharp.pixelplumbing.com/) ([installation](https://sharp.pixelplumbing.com/install/), [license](https://github.com/lovell/sharp/blob/main/LICENSE)) | Server-side thumbnails, display derivatives, dimensions, and portrait crop rendering. | Apache-2.0; Windows x64 prebuilt binaries are available. Fits our Node server without a UI framework dependency. Keep originals immutable and make derivatives reproducible. Native dependency installation needs verification on our actual Node version. | First media storage slice |
| [Cropper.js](https://fengyuanchen.github.io/cropperjs/guide.html) ([source/license](https://github.com/fengyuanchen/cropperjs)) | Let the user select a face/portrait crop from a wider illustration. | MIT; v2 uses web components. Browser-only initialization needs a Svelte integration check. Save crop coordinates and a derivative, retaining the original picture. Cropping is not inpainting. | After basic photobooks |
| [Uppy](https://uppy.io/docs/svelte/) ([SvelteKit guide](https://uppy.io/docs/sveltekit/), [license](https://github.com/transloadit/uppy/blob/main/LICENSE)) | Multi-image upload queue, drag/drop, progress, and per-file errors for reference art and existing pictures. | MIT; official Svelte 5 headless components/hooks fit our stack. Local uploads can target our own route. Cloud imports/Companion are unnecessary for the initial local app. A plain file input is sufficient until upload management earns this dependency. | Optional |

PhotoSwipe 5.4.4 and Sharp 0.35.5 are integrated and tested; other candidate entries are source/documentation assessments. Pin and test selected versions, retain notices, and audit transitive dependencies when adopting them.

## Corvus gallery: behaviors worth adapting

Inspected the existing checkout at commit `8e5e7345eb349581febfd9d73bd45d4edea59717`:

- `client/src/components/image/ImageGallery.tsx`: category filtering, chronological sorting, thumbnail selection.
- `client/src/components/image/ImageLightbox.tsx`: image navigation, prompt/negative prompt/settings inspection, download, set as NPC portrait, and send to img2img/inpaint.
- `server/types/index.ts`: `ImageMetadata` retains a parent image, source mode, prompt, seed, and settings.

Its single `linkedNpc` field is insufficient for ensemble scenes. Adapt the interactions into Svelte and retain the existing MIT notice if copying code. Future img2img/inpaint actions depend on corresponding workflow support; do not expose working-looking controls before that support exists.

## Story-specific media foundation

Use one shared asset record and many subject associations. A crew picture belongs to each depicted character's photobook without duplicating the file. The story gallery and photobooks are filtered views of the same library.

The implemented media core preserves:

- Immutable original, checksum, MIME type, dimensions, and derived thumbnail/crop records.
- Editable caption and depicted cast/place/item links. Presence in a source scene alone does not imply depiction.
- Source passage ID and revision, story order separate from file creation time, and appearance/outfit snapshots at generation time.
- Prompt/template/workflow snapshots, resolved subject/framing inputs, seed/settings, and parent-image links for variants.
- Canonical, experimental, or superseded status. Replacing the latest passage retains its old illustrations with clear provenance.
- A separate current portrait selection. Choosing a new portrait preserves all older pictures.
- Separate use-as-generation-reference selection: the latest scene illustration is not automatically the best identity reference.
- Portable originals/metadata in story export/import, with validated paths/references. Thumbnail caches can be regenerated.

Photobooks use a chronological grid grouped by chapter, with an image details view offering caption editing, subject association, jump to passage, and set as portrait. Historical outfit details must not be reconstructed from the character's current state. Settings test previews remain separate unless explicitly imported into a story.

Storage/associations/export, thumbnails/viewer, portrait/reference selection and explicit story illustration generation are implemented. Multi-character association, restart/export, portrait history and superseded sources have automated coverage. Interactive portrait cropping and reference-image execution remain pending.

## Other useful references

- [SillyTavern World Info](https://docs.sillytavern.app/usage/core-concepts/worldinfo/): useful design reference for keyword-triggered lore, activation priority, recursion limits, and token budgets. Our selective context already covers part of this. An eventual lorebook importer should show a mapping preview and explain unsupported activation rules; do not silently claim full compatibility. This is a behavior/format reference, not a proposal to copy its application code.
- [CodeMirror](https://github.com/codemirror/view): candidate for workflow JSON and advanced prompt editing. Its MIT core is independent of Svelte; our integration would supply template-variable completion and schema diagnostics. The GitHub repository has moved to the upstream forge linked in its README, so use that source when selecting a version. Evaluate when advanced editor work starts, rather than expanding the first photobook slice.

The immediate recommendation is PhotoSwipe plus Sharp and Storyweaver's own media associations/provenance. Upload dashboards, crop tooling, and richer editors can follow independently.
