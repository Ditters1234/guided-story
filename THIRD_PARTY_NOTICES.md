# Third-party code and references

## PhotoSwipe 5.4.4

Source: https://github.com/dimsemenov/PhotoSwipe. Unmodified runtime dependency, MIT license. Copyright (c) 2014-2022 Dmitry Semenov. Full license: [licenses/PhotoSwipe.txt](licenses/PhotoSwipe.txt).

## Sharp 0.35.5

Source: https://github.com/lovell/sharp. Unmodified runtime dependency, Apache License 2.0. Full license: [licenses/Sharp.txt](licenses/Sharp.txt). Native dependency licenses remain supplied with their respective packages; preserve them when redistributing those binaries.

## Corvus Story Core

Source: https://github.com/JustLateNightAI/Corvus-Story-Core

Audited revision: `8e5e7345eb349581febfd9d73bd45d4edea59717`.

`src/lib/server/model-output.ts` adapts the reasoning-tag families and finalized-output filtering from `server/services/thinkStripper.ts`, with stricter nested/malformed-tag handling and no reasoning-as-answer fallback. Its JSON object isolation follows the intent of `server/services/gameMaster.ts` but rejects malformed/ambiguous output rather than substituting empty state changes.

`src/lib/server/atomic-files.ts` adapts the unique temporary file, fsync, and rename pattern in `server/services/fileManager.ts`. The ensemble effects/commit boundary and per-story generation coordination are new implementations informed by `stateManager.ts`, `orchestrator.ts`, and `fileManager.ts`. React UI, mandatory player-avatar rules, name-based item mutation, fixed image graphs, and history branching/deletion were not imported. See `docs/REFERENCE_ADOPTION.md` for the audit and adaptation decisions.

MIT License

Copyright (c) 2026 Sebastian

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
