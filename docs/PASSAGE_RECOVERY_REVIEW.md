# Passage recovery review

October 21, 2026. A second pass over [recoverable passage checks](PASSAGE_RECOVERY.md), including normal operation, failed reloads, concurrent author edits and another browser window. The user's [location-first node map idea](LOCATION_NODE_MAP_IDEA.md) is recorded separately as a possible future interface.

## Findings and fixes

- **New guidance could be ignored when accepting an earlier successful check.** Reproduced in the production browser: after typing new guidance into a ready draft, Save recovered passage remained enabled. It now stays disabled until the guidance is submitted through Retry world updates or explicitly cleared. The server also rejects apply requests containing unused guidance, without consuming their request ID. Clear returns keyboard focus to the guidance field.
- **Actions could run against a list being reloaded.** Inspection showed Retry, Save and Discard remained available during reload, allowing an older list response to replace a newer action result in the UI. All three wait for reload completion. A failed list request keeps those actions disabled until a successful reload, with a visible retry control. Delayed and failing requests are exercised in the browser test.
- **Publication in another window looked like an invalid setup.** The old recovery GET used the unpublished-setup source reader, which rejects a setup once chapter one exists. Recovery polling now reports its published story ID and saved setup revision. The old editor offers Open saved story; normal unsaved-field/guidance guards apply before opening it. Unsubmitted guidance associated with a draft saved/discarded elsewhere remains visible and editable until cleared. A two-window browser check verifies this path.
- **Review and completion feedback were incomplete.** The memory preview now includes open questions and character/place references. Related-record snapshots explain that names/IDs select up to 60 diagnostic records, rather than implying the list is the exact model input. Removed records no longer link to an unrelated editor selection. First-time failed drafts receive heading focus; discard success stays visible after the last draft disappears.

The extraction contract, deterministic model scope, context window, canon, evidence/pin enforcement, one automatic repair per explicit attempt and whole-passage atomic acceptance remain unchanged. A source edit during a retry prevents readiness and preserves both the author correction and retained prose.

## Verification

- **366 automated tests pass.** Three new regressions cover publication polling/replay, rejecting unused acceptance guidance without taking the request ID, and a source correction during model checking. Earlier recovery regressions remain in place.
- Svelte check reports **zero errors and warnings**. Production build passes with the existing bundle-size advisory (about 547 kB minified).
- Four isolated production browser suites pass: `passage-recovery-smoke.mjs`, `story-smoke.mjs`, `reader-actions-smoke.mjs`, and `setup-records-ui-smoke.mjs`. The setup-record fixture now waits for its asynchronous reload confirmation before installing the next dialog handler.
- The expanded isolated recovery browser test verifies unused-guidance guards, delayed/failing list reloads, a second window publishing the opening, preservation of that window's notes, discard feedback, focus and 320/390px layouts. The existing opening/restart/quantity/cancellation/rewrite/continuation checks still pass. Retries make zero narration calls; the scenario still uses three narrations, ten extraction calls and three consistency reviews.

All provider output is deterministic mock output. Ordinary libraries/settings, historical scoping fixtures and release ZIPs are untouched. No node-map interface, new provider stage or live-model quality claim is included in this review.
