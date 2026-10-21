# Context strategy for story generation

Status: selective context assembly, a flexible scene brief, lore visibility, knowledge/reveal records, and source-linked passage memories are implemented. Live narration uses this context, and every generated passage saves a continuity memory automatically; Dev also supports manual extraction. The reader recap remains separate. Higher-level chapter/book compaction, exact event receipts and Dev coverage are implemented; see [Memory compaction](MEMORY_COMPACTION.md). Optional reader continuity review is implemented; automatic semantic review before passage commits remains future work. Wording polish has a separate meaning-review gate. Ask uses a task-specific context without the scene brief or hidden plans, with ranked source passages and validated excerpts; see [Director/editor tools](DIRECTOR_EDITOR.md). See [Developer tools](DEVELOPER_TOOLS.md) and [Next development slices](NEXT_STEPS.md) for the implemented behavior and remaining work; the research below informs the fuller target.

## Current priority and known gaps

Context scoping and token efficiency are now the user's main development priority. The [first fixes](SCOPING_FIXES.md) separate participants from compact absent references, resolve viewpoints by exact/unique names or IDs, constrain item/container expansion and scope extraction with a complete reference directory. A targeted possession check and one bounded repair now address reproduced semantic omissions. Opening still receives the complete approved setup, and current-record correction, indirect references and knowledge relevance need further evaluation. See [Context scoping](CONTEXT_SCOPING.md) for the original baseline and continued work.

Distinguish active participants from compact references to absent people; distinguish containment ancestors and necessary storage paths from permission to include every possession. Optimize each task independently while retaining full server-side canon, constraints, evidence checks and atomic commits. Current knowledge/open-thread candidates also need relevance review. Favor deterministic scope selection and priorities before adding model calls or retrieval infrastructure.

## Keep reader recaps separate from generation memory

The editable Story so far recap is for the reader. It must not become the sole authoritative memory or a way to change canon through summary edits. Generation needs current facts plus source-linked event details that a pleasant recap may omit.

Recommended context for one passage:

1. Stable story premise, style, viewpoint, and relevant user constraints.
2. Required current pinned field values and world rules, plus relevant current character/place/item records and each character's content preference.
3. A compact record of earlier events and relevant chapter/passage summaries.
4. Current unresolved threads and knowledge/reveal information.
5. The recent passage ending verbatim, within a reserved budget, to maintain action and dialogue continuity.
6. The reader's new direction and a short, mutable scene brief.

This is a proposed assembly order and budget, to evaluate on the chosen model rather than assume universally optimal.

## Techniques worth adding

### Scene-relevant story bible

Select the cast, location, relevant possessions, and directly linked lore needed for the next scene. Begin with explicit IDs and links, names/aliases, and text search. Do not send every world entry on every turn. Allow entries to be always included, selected when relevant, or hidden from prose generation.

Saved [field pins and world rules](FACT_PINS.md) are an exception to ordinary relevance selection: every constraint is a required context source for narration and Ask, including fields on distant or otherwise unselected records. The `fact-pins` source resolves current canonical values and is visible in Dev context reports with its size and inclusion reason. If required constraints cannot fit, generation fails clearly; no pin/rule is silently dropped to make room. Extraction and in-story corrections also require all constraints. This protects the structured contract, while prose adherence to a freeform rule remains model-dependent.

Sudowrite documents task-relevant context selection in its [Saliency Engine](https://docs.sudowrite.com/using-sudowrite/1ow1qkGqof9rtcyGnrWUBS/saliency-engine/4KL8gFeLZNvk8CEeXpfwB2); Novelcrafter documents selectable context behavior in [Codex entries](https://www.novelcrafter.com/help/docs/codex/anatomy-codex-entry). This supports selective assembly, not a requirement to reproduce either proprietary implementation.

### Layered memories and factual event records

Retain source passages; create short source-linked event records and summaries, then more compact older-story summaries as needed. Keep recent prose available rather than repeatedly reducing everything into one summary. Do not promote a generated summary into canon just because it was generated recently.

[Novelcrafter's summaries and beats guide](https://www.novelcrafter.com/help/faq/plan/where-do-i-put-my-scene-chapter-act-book-summary-what-about-my-beats) distinguishes past scene summaries from instructions for what should happen next. Reader recap caching remains a separate presentation pipeline.

### Knowledge and reveal ledger

Track at least world truth, which characters know or believe it, and whether it has been revealed to the reader. Example: Ren knows the officer; Elias has only seen the recognition; the reason is not yet disclosed. This lightweight ledger is implemented; it is not a claim that every cited tool implements the same ledger.

Make hidden planning notes separately visible to a planning task when needed, rather than placing a future twist in every prose prompt. Sudowrite's [visibility controls](https://docs.sudowrite.com/using-sudowrite/1ow1qkGqof9rtcyGnrWUBS/visibility-settings/4KL8gFeLZP6ep8keUhKVGp) illustrate the practical problem of prematurely revealing information.

### Flexible scene brief and unresolved threads

Maintain current tension, character motives, unresolved promises/clues, scene purpose, and a likely stopping point. Plan only far enough ahead to give the story direction; the reader's next instruction can change future possibilities. Do not prewrite a fixed ending or expose future plans through the recap.

The [Re3](https://arxiv.org/abs/2210.06774) and [DOC](https://arxiv.org/abs/2212.10077) papers support evaluating planning, contextual reminders, and revision for long-form story coherence. Their results concern particular models and experimental setups, not guaranteed performance for our model.

### Continuity review before commit

Check a draft against relevant facts and the scene brief before committing its text and state changes. Use code for reference/ownership invariants and, when useful, an LLM review for contradictory prose, premature reveals, or repetitive plot beats. This remains a story-quality pass, not an exhaustive scenario rules engine.

### Inspectable context

Offer a development view of the assembled context with inclusion reasons, source passages, and estimated budget. This lets the reader/developer diagnose an omitted fact or an overlong profile without guessing. Never expose API keys in this view.

## Priority and scope

Implemented first: scene-relevant entity selection, recent prose, source-linked event memory, the knowledge ledger, and scene brief. Live storytelling uses this inspectable context. Passage/chapter/book memory and source-checked exact event retrieval are implemented. Next, improve and measure [entity/task scoping](CONTEXT_SCOPING.md), including the extraction request, and evaluate sustained narrative quality. Additional model-based review remains deferred until evidence justifies its calls.

A vector database, embedding every paragraph, separate autonomous agents, and a full immutable novel outline are not initial requirements. Consider semantic retrieval only if explicit links and text search miss relevant older details often enough to justify it.
