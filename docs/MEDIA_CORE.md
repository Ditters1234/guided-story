# Shared media core

Implemented October 17, 2026. PhotoSwipe 5.4.4 provides viewing and Sharp 0.35.5 handles decoding/thumbnails. The Svelte gallery, associations, history, and SQLite commits are Storyweaver code; Corvus's gallery interactions and metadata model informed the design. Cropper.js, Uppy, and richer editors remain optional follow-ups.

## Using it

- Generate directly from the reader, cast photobooks, Gallery or Illustrations. Compose/edit the prompt, choose a workflow, generate and accept. See [Story-linked illustrations](ILLUSTRATIONS.md); associations, portraits and source/version handling use this shared core.

- Gallery → Add a picture: upload PNG/JPEG/WebP, enter a caption, identify depicted characters/places/items, and optionally choose a source passage or parent picture.
- Settings → ComfyUI: generate a preview with the configured workflow/prompts. In Gallery → Add a picture, refresh the completed preview and save it into the story. This copies the file and available provenance; clearing Settings previews does not remove story pictures.
- Select a gallery tile to edit its caption, category, subject associations, and canonical/experimental status. View & zoom opens PhotoSwipe; the original is downloadable. Source links return to the passage; a link is disabled if that passage version is no longer in the current story.
- A character's Photobook tab shows all pictures depicting them. One crew picture can appear in several photobooks while sharing one original file.
- Set as portrait changes the notebook avatar without removing older pictures. Identity reference is a separate saved selection, reserved for future reference-image workflows; current text-to-image generation does not consume it.
- Add a variant retains an explicit parent-image link. This upload action imports another picture. Gallery Generate a variation can also create a new text-to-image result with a parent link; img2img/inpainting is not implemented.
- Canonical passage-linked illustrations appear in the reader when artwork is enabled. The newest canonical illustration for that passage is displayed; all others remain in the gallery.
- Remove picture from story clears that record and any portrait/reference selections pointing at it. A parent with variants cannot be removed until its variants are removed. Other imported stories and original files are retained.
- Dev → Media exposes current-story metadata and an explicit file/checksum audit across all stories in this instance.

Picture details are explicit drafts with saved/unsaved status and **Reset to saved**; the add form offers **Reset picture draft**. Selecting another picture, starting an addition/variant, closing the editor or leaving Gallery asks before discarding changed details. Browser reload/close also warns. Failed saves retain the draft. If saved metadata changes while a local draft is dirty, saving is blocked until reset to the saved details. Filtering the gallery keeps the current draft; refreshing completed previews does not silently replace its selected output. Nothing is autosaved by typing.

## Persistence and invariants

Metadata lives in each story's `media` section inside the SQLite payload, so its associations and portrait selections share the story revision/transaction boundary. The same metadata travels in story exports. Model effects cannot change it through the canonical character schema.

Originals live at `data/<instance>/media/<sha256>.original`. A derived `<sha256>.thumb.webp` is capped at 480×480 without upscaling. Files are content-addressed across stories in one instance; imported copies may share an original. Client-supplied filenames never determine storage paths. Serving requires a valid story/asset association.

Uploads are decoded, restricted to single-frame PNG/JPEG/WebP, capped at 20 MB and 40 megapixels, and checked before persistence. Files are staged/fsynced/renamed before the short SQLite transaction; a final revision check rejects intervening edits. Request IDs plus content/input fingerprints deduplicate uncertain retries. Original-file reads/export check size and SHA-256. Missing thumbnail caches rebuild on demand.

A failed metadata commit or crash can leave an unreferenced complete file. Explicit record removal can also leave a retained original. Dev's audit reports these and interrupted staging files without deleting shared assets. Garbage collection is deliberately not automated yet.

Each image stores caption/category/status, depicted IDs, appearance/outfit snapshots, creation time, source passage ID/content hash/title/chapter/story revision, parent-image ID, and available prompt/workflow/template/variable/seed/settings provenance. Generation snapshots are sanitized through the diagnostics redactor before persistence. Old previews created before provenance capture may only have a seed and source kind; missing details are not reconstructed from current settings.

Appearance/outfit snapshots are captured when a subject is first associated with a story asset. For imported pictures and Settings previews, this is association time, not a claim about historical canon at generation time. Actual generation variables are retained separately when available. Editing an association or current character does not rewrite existing snapshots. Adding/removing subjects does not mutate canonical outfits/inventory.

Story illustration jobs capture these facts when queued and retain them at acceptance, even if the story changes while ComfyUI runs. They also preserve the original source hash; a delayed result for a revised passage becomes an earlier version instead of being relabeled as current.

The newest-passage replacement transaction marks images with a different source content hash as superseded. Originals, original source labels, and snapshots survive. Removing a newly generated character on replacement preserves their historical image association/snapshot and clears invalid current portrait/reference choices. Superseded status cannot be relabeled canonical through the picture editor.

## Portable archive

Exports include story/manifest JSON and one original per referenced checksum. Keys, connection files, jobs, Settings test previews, and thumbnail caches are excluded. Imports create a separate story, validate paths, manifest membership, references, checksums, decoded formats, and dimensions before saving. A corrupt archive never inserts a partial library entry.

Current limits: 128 MB archive/expanded input, 110 MB unique media per export, 10 MB story JSON, 2,000 image records. These bounds keep the current in-memory ZIP implementation reasonable. Large collections will need streaming archives. The 1.0 production launcher sets `BODY_SIZE_LIMIT=128M` and supplies the correct local HTTP protocol for adapter-node. Development uses Vite; custom production deployments must provide equivalent limits and origin handling.

## Verification

`tests/media.test.ts` covers shared associations, independent selections, immutable historical facts, thumbnail regeneration, disk reopen, isolated-library ZIP round trips, invalid images/references/archives, source replacement, uncertain retries, and concurrent revision checks.

`node scripts/media-smoke.mjs` uses a separate temporary app/data/config/cache and local mock ComfyUI, exercising the actual upload forms, viewer, photobooks, portraits/references, variants, preview promotion/clearing, reading links, replacement, ZIP import, restart, checksum audit, and 320px layout. Screenshots are written under ignored `test-results/`. It does not change normal dev/play saves or connections.

`node --import tsx scripts/draft-cleanup-smoke.mjs` verifies picture selection/add/leave guards, kind-only add drafts, reset, failed-save recovery and 320px forms in a separate temporary production instance.
