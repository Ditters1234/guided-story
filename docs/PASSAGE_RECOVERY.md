# Recoverable passage checks

October 21, 2026. This explicit follow-up addresses generation failures that previously discarded usable prose and forced a full generation restart. The previous UI checkpoint is [the overall UI pass](UI_IMPROVEMENTS.md).

The subsequent [second-pass review](PASSAGE_RECOVERY_REVIEW.md) records the guidance/reload/concurrent-window fixes and current 366-test verification. The implementation checkpoint below is preserved as history.

## Behavior

Completed, length-checked prose is saved to a separate SQLite recovery record **before** the first world-update extraction request. A failed extraction, invalid effect, exhausted bounded repair, consistency disagreement, cancellation after narration, or failure at final commit keeps that prose outside the accepted story. A server stop during extraction also leaves the complete text available. Normal successful generation still commits automatically as before and marks the recovery record saved in the same transaction.

The setup editor and reader show **Recover a generated passage** with:

- Exact retained prose, copy and explicit discard controls.
- Reported problems, with technical details where relevant.
- A snapshot of affected saved characters, places and possessions, including count/supply mode and physical storage paths, plus links to their normal editors.
- Attempted updates with readable operation/field labels and their original source quotes.
- Optional rechecking guidance and **Retry world updates**, which extracts against current saved facts while keeping the prose unchanged.
- A successful complete proposal, including passage memory, for review before **Save recovered passage**.

Save or reset other form edits before retrying or accepting. Guidance is local typing until submitted, participates in navigation/unload guards, and is separate from canonical record corrections. Retained drafts reappear when the setup/story is reopened; the app does not automatically resubmit interrupted checks. While an unaccepted draft exists, recover or discard it before generating different prose.

## Persistence and validation

`retained_passages` stores authoritative recovery content separately from scrubbed diagnostic jobs. `retained_passage_actions` and ordinary setup/story operation reservations provide durable, source-scoped retry/apply/discard receipts. Duplicate retry requests do not make another provider call. Accepting a recovery record uses only its server-stored proposal; the action API rejects client-supplied prose/effects. Record versions, saved-source revisions/hashes and written-history hashes prevent stale acceptance. A changed input cannot reuse a receipt.

Retry reuses the existing task-specific extraction and inventory review, including at most one automatic repair per explicit attempt. Complete canon remains authoritative; pins, evidence, references, quantities, memory and atomic commit checks are unchanged. A latest-passage rewrite restores its original pre-event canon for extraction while enforcing current author pins. Invalidated rewrite recovery points and changed written history prevent reuse. Current record/setup corrections are allowed when written history is unchanged, followed by fresh extraction and review.

Accept commits the entire passage, effects, memory, recovery baseline and generation receipts together. Failed attempts never apply a subset of effects. Existing optional chapter-memory maintenance still runs after successful acceptance and cannot turn an already saved passage into a failed request. Library removal cleans up associated recovery metadata. Story/setup ZIPs remain canonical exports and exclude retained drafts; copy any unaccepted text that needs a separate backup.

## Verification

- **363 automated tests pass**, including nine new recovery regressions for failures, exact prose, current quantities, cancellation, malformed extraction, successful normal commits, original request receipts, repeat actions, scope/collision checks, stale previews, pins, replacement baselines, library removal and server interruption with long Unicode prose.
- `npm run check`: zero errors and warnings. `npm run build`: passes, retaining the existing non-blocking single-page bundle-size advisory (about 543 kB minified).
- **Five isolated production browser suites pass:** `passage-recovery-smoke.mjs`, `story-smoke.mjs`, `reader-actions-smoke.mjs`, `ui-coverage-smoke.mjs`, and `scene-preparation-smoke.mjs`. The existing story fixture now exercises the retained retry/accept flow after malformed extraction.
- The new recovery browser suite reproduces a one-cube/two-cube failure, verifies no publication, restarts the server, corrects saved stock, cancels a held retry, checks effects-only recovery, rejects forged/stale accepts, and explicitly saves the recovered opening. It also recovers a rewrite from quantity three when current stock is one, retains/discards a failed continuation, checks focus and 320/390px layout, and reports no browser exceptions. Three narration calls, ten extraction calls and three reviews were observed; the retries made zero narration calls.

These are deterministic/mocked-provider results. No real-model quality evaluation, ordinary library/settings modification, or release ZIP rebuild was performed.

## Boundaries

A real contradiction can still block acceptance; the retained prose stays readable/copyable while the author decides how to resolve it. This slice does not add unchecked force-save, partial-effect commits, raw JSON editing or automatic canon/supply changes. Changed written history is conservatively rejected even for wording/title edits. An old rewrite whose recovery point was invalidated cannot be accepted through this path. Failures before valid complete prose exists use the existing generation controls. Earlier failed requests are not reconstructed from potentially truncated/redacted diagnostics. Recovery metadata remains local and is not a portable draft archive.
