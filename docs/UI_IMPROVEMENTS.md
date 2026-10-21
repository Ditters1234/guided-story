# Overall UI and coverage pass

October 21, 2026. This pass improves the existing authoring/reading interface and checks both missing user-facing entry points and gaps in browser coverage. Canonical schemas, model context selection, provider contracts and ordinary saved libraries/settings are unchanged. The prior checkpoint is [the scene-preparation review](SCENE_PREPARATION_REVIEW.md).

## Implemented improvements

- **Navigation and collections:** separate Story and Workspace navigation groups; a normal Background entry point; guarded logo navigation; focus moves to the new screen heading. Library and Contents have search, counts and explicit no-match recovery. Library imports are grouped by setup/story backup. Unsaved title rows stay visible through search, navigation asks before discarding, and concurrent changes block stale renames.
- **Written-story background:** the normal Background view exposes every saved title/text/keyword/link/visibility field, including hidden entries in this author view. It uses the same strict save/revision handling as Dev Lore. Diagnostic heuristics, internal IDs and measured-preview details remain in Dev. An edited open entry stays visible when its title/text/visibility stops matching filters. Add/remove and individual link removal restore useful keyboard focus.
- **Large setups and Records:** search and counts across cast, places, possessions, background, relationships and threads; explicit clear/no-match controls; existing local edits survive filtering. Setup removal resolves actual IDs instead of filtered positions. Creating a one-person self-relationship is disabled with an explanation. Normal setup reload/reset is available, with a discard guard.
- **AI instruction drafts:** setup design instructions participate in unsaved navigation/unload checks separately from saved setup fields. The UI explains that Save setup does not persist unused AI instructions. Clear controls are available; a successful targeted operation clears only the instructions it consumed, while failures keep them.
- **Notebook and inventory:** quick search for people, places, possessions and threads; selected profiles and dirty thread drafts stay visible. World storage controls initially show twelve possessions, with explicit expansion or targeted search. Inventory search includes matching nested items and necessary container ancestors, without expanding unrelated siblings; holder expand/collapse controls work after manual toggles.
- **Pictures and studio:** gallery search covers captions, subjects and source titles, with counts and clear/no-match actions. Filtering retains an open metadata draft. A shared searchable subject picker keeps selected subjects visible and restores checkbox focus after selection changes. Completed-preview loading, empty results and service errors are distinct and retryable. Studio generation history has status/search filters and a clear state; prompt-refresh cancellation stays reachable after switching studio tabs.
- **Settings and planning:** named operation feedback replaces unexplained disabled controls; reading changes acknowledge browser saves; storage usage distinguishes loading, failure and real totals. Text-test cancellation remains available after switching tabs. Preparation shows selected target names with individual remove/clear controls, local size guidance, explicit empty-addition explanations and preview-heading focus. Pins restore focus when adding/removing world rules; Dev sections expose their selected state.

## UI coverage map

| Area | Ordinary entry point and coverage | Browser evidence |
| --- | --- | --- |
| Story/setup library | Find/resume/import/export, rename/delete/discard, dirty/stale title handling, loading and no-match states | `ui-navigation-smoke`, `ui-media-settings-smoke`, `records-smoke`, `setup-archive-smoke` |
| Reading and Contents | Chapter/passage search, historical reading, action inputs, separate continuation/rewrite drafts, heading/return focus | `ui-navigation-smoke`, `reader-actions-smoke`, `story-smoke`, `director-smoke` |
| Setup authoring | Complete schema fields, targeted AI sections, large-fixture filtering, add/remove, pending instructions, reload and guards | `setup-records-ui-smoke`, `setup-design-smoke`, `setup-archive-smoke`, `story-smoke` |
| Current canon and inventory | Cast/place/item/relationship/thread/world editing, nested holders, supply/count controls, split/save/reload | `setup-records-ui-smoke`, `records-smoke`, `inventory-smoke`, `draft-cleanup-smoke` |
| Background/lore | Normal author editing plus separate Dev diagnostics, hidden entries, filters, links, stale saves and draft retention | `ui-coverage-smoke`, `lore-dev-smoke`, `setup-archive-smoke` |
| Scene preparation/direction | Request, optional selections, retained previews, review/apply, resource hints, cancellation and stale refusal | `ui-coverage-smoke`, `scene-preparation-smoke`, `director-smoke`, `draft-cleanup-smoke` |
| Pins and rules | Selection/save/reset, explicit manual changes, stale handling, Add/Remove focus, protected generation | `ui-coverage-smoke`, `fact-pins-smoke` |
| Gallery and pictures | Upload, captions/subjects, filters, portrait/reference selection, variants, source/history, previews and restart | `ui-media-settings-smoke`, `media-smoke`, `draft-cleanup-smoke` |
| Illustration studio | Subject/shot selection, prompt refresh, queues/history, acceptance, source freshness, orientation and cancellation | `ui-media-settings-smoke`, `illustration-smoke` |
| Settings, Help and diagnostics | Save/reset/loading/error feedback, keyboard tabs, browser preferences, request drawer and error recovery | `ui-media-settings-smoke`, `usability-smoke`, `draft-cleanup-smoke`, `ui-navigation-smoke` |

The four new browser suites are [navigation](../scripts/ui-navigation-smoke.mjs), [authoring and keyboard coverage](../scripts/ui-coverage-smoke.mjs), [large setup/records](../scripts/setup-records-ui-smoke.mjs) and [media/settings](../scripts/ui-media-settings-smoke.mjs). They exercise real application routes and temporary SQLite/media data. Service failures, loading gates, preparation and image-history responses are controlled test fixtures where specified. They do not call the installed text/image providers.

## Verification

All **354 automated tests pass**, Svelte check reports **zero errors/warnings**, and the production build succeeds. **18 isolated production browser suites pass**: the four new suites above plus `story-smoke`, `setup-design-smoke`, `media-smoke`, `illustration-smoke`, `records-smoke`, `setup-archive-smoke`, `director-smoke`, `usability-smoke`, `draft-cleanup-smoke`, `inventory-smoke`, `reader-actions-smoke`, `scene-preparation-smoke`, `lore-dev-smoke` and `fact-pins-smoke`.

Checks cover 320px and 390px widths, including a 568px-tall viewport; keyboard activation/focus; ten routes with coarse-pointer touch emulation and 16px touch inputs; large Brasswater inventories; filtered editors; read-only preview behavior; failed/stale saves; cancellation; restart; and source/archive preservation. New screenshots are retained locally under `test-results/ui-*` and `test-results/setup-records-ui-mobile.png` and have been visually inspected. Existing test selectors were narrowed to Setup sections where the new normal Background navigation introduced a legitimate second label. The searchable subject picker explicitly retains the entity name as its accessible label.

Normal libraries/settings and historical fixtures were untouched. No live-model or image-quality comparison was part of this pass. The workspace production build is refreshed; release ZIPs remain unchanged.

## Remaining boundaries and gaps

- Advanced viewpoint knowledge and source-linked memory curation remain in Dev → Memory. They are not ordinary background records and were not moved into the author Background editor.
- Written-story Background provides complete manual editing; targeted AI lore revise/title actions remain available in setup. Prepare scene can propose missing background for written stories. This pass does not add another model operation.
- Native multiselects remain for linked records and preparation targets. Explicit selected-name/remove/clear controls improve keyboard/touch use, but device-native touch behavior has not been tested on a physical phone.
- Browser checks use headless Microsoft Edge with responsive viewports. They are not pixel-diff baselines or a Safari/Firefox/high-contrast/screen-reader certification.
- The production build reports a non-blocking size advisory for the single-page UI bundle (about 529 kB minified, 161 kB gzip). Route-level loading remains a performance follow-up; the threshold was not raised to hide it.
- Browser success does not establish semantic necessity of proposed world additions, accurate lore interpretation or sustained narrative quality. Those remain separate from this UI pass and the existing context-scoping priority.
