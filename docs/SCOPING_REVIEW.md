# Third-party review: context scoping strategies

October 20, 2026. Written as an external review of the scoping workstream described in CONTEXT_SCOPING.md and related documentation. Focus: strategic alternatives for efficient entity selection with a ~30B local model.

## Summary assessment

The project has correctly identified overselection as a primary problem and established good measurement infrastructure via the Brasswater fixture. The current approach of code-based selection (deterministic inclusion/exclusion) with budget-limited context is sound, but several strategic alternatives deserve consideration before committing to implementation.

**Key insight:** Treat scoping as a multi-stage filtering pipeline rather than a single inclusion decision. Cheap filters first, expensive filters only when ambiguity remains.

## Strategy: hierarchical entity filtering

### Stage 1: Exact-match filters (zero model calls)

Programmatic, deterministic filters that eliminate obviously irrelevant entities:

- **Scene ID matching**: Entities explicitly listed in scene brief → active participants (full profiles)
- **Location containment**: Entities whose `location` matches current scene place or its immediate children → potential participants
- **Explicit reference lookup**: Items/characters referenced by exact name in direction or recent passage prose → required context
- **Pin enforcement**: All pinned fields and their records → required context (already implemented)

**Expected outcome:** Handles 60–80% of standard continuation cases with zero ambiguity and zero LLM calls.

### Stage 2: proximity-based narrowing (still deterministic)

For entities in the same location but not explicitly active:

- **Distance ranking**: Use world map distance to rank nearby entities. Include only closest N as "potential bystanders" or exclude entirely if scene is intimate.
- **Last interaction time**: If entity hasn't interacted with active participants in >X passages, downgrade from full profile to compact reference.
- **Equipment/possession relevance filter**: For each potentially included character's inventory, include only: (a) currently equipped items, (b) items mentioned by name in recent prose, (c) items that fit scene context keywords (e.g., "weapon" if combat, "food" if meal). Exclude everything else regardless of budget.

### Stage 3: short model calls for ambiguity resolution

Only when stages 1-2 leave genuine ambiguity:

**Use case A - name disambiguation**: Multiple characters match a name mention (shared surname, nickname vs. real name).

- **Prompt structure**: "Three characters named or known as 'Ward' exist in this world: [brief distinguishing traits for each]. In the context of '[prose excerpt]', which is being referred to? Answer with character ID only."
- **Expected output**: Single token/ID, not prose.
- **Model call count**: One small classification call per ambiguous name, usually <200 input tokens.
- **Caching**: Disambiguation result can be cached if same reference appears again in same chapter.

**Use case B - implicit relevance**: A passage mentions a clue or object indirectly. Should that entity's full record be included for continuity?

- **Prompt structure**: "In this passage: '[excerpt]'. Is the following entity relevant to this moment? [entity name + 2-word description]. Answer yes/no only."
- **Model call count**: One per borderline entity, usually <150 input tokens.

### Stage 4: longer model calls (fallback)

For genuinely novel situations not covered by earlier stages:

**Use case - new character/POV introduction**: A passage introduces someone previously absent from world records.

- **Prompt structure**: "This passage mentions a person not in your records: '[name]' described as '[traits]'. Create a minimal placeholder record for them. Include only information explicitly stated. Do not invent backstory, appearance details, or motivations. Return JSON matching the character creation schema."
- **Cost justification**: Called rarely; creates needed data structure rather than merely filtering.

## Specific tactical suggestions

### 1. "Entity temperature" scoring

Assign each entity a heat value based on recency and intensity of involvement:

```
heat = recent_interactions * 10 + location_proximity * 5 + explicit_mentions * 15 + time_decay_factor
```

Sort by heat; include top N where budget allows. This is deterministic, computable instantly, and requires no model calls.

### 2. inventory relevance as scene-context classification

Instead of "include all items" vs. "include equipped only," classify the **scene type** first:

- Combat/action → weapons, armor, mobility items
- Conversation/negotiation → tokens of authority, notes, small objects on table
- Meal/social → food, drink, cups, napkins
- Travel → tickets, maps, bags, currency

This could be done programmatically with scene-type keywords OR via a single cheap model classification call if the scene type is ambiguous.

### 3. "Just-in-time" entity loading from memory layers

When prose references something old that isn't in current scope but exists in chapter/book memories:

- Detect reference (keyword match against known names)
- Load ONLY that entity's profile from earlier memory layer (not everything from that chapter)
- Include as compact reference with note "[referenced from chapter X]"
- Don't include full inventory or unrelated details from that historical context

This prevents the "one old clue drags in entire old chapter" problem.

### 4. two-pass continuation with scoping feedback

First pass: Generate passage with narrowly scoped context. Capture all names/entities mentioned in output. Second pass: Identify entities mentioned but not in original scope → add them to scope for NEXT continuation, not the current one (avoid expensive retry).

This creates a self-correcting system without expensive re-tries.

## What NOT to do

Based on the project's constraints and goals:

- **Don't use vector search** for entity selection. Too much infrastructure for deterministic alternatives. Keep as absolute last resort.
- **Don't call the LLM to generate inclusion lists.** "Which characters are relevant to this scene?" is an expensive, vague task better solved with rules + cheap classification calls.
- **Don't maintain separate "active cast" and "world cast" lists** that must be manually synchronized. Compute active set dynamically from current state at generation time.
- **Don't try to make one context size work for all tasks.** Narration, Ask, extraction, and corrections each need different scopes (already recognized in documentation).

## Evaluation framework suggestions

Beyond the existing Brasswater baseline, consider testing these strategic approaches against:

1. **Omission recovery**: Introduce a fact in chapter 3 that should affect chapter 7's scene. Does scoping retain it or lose it?
2. **Noise-to-signal ratio**: For each included entity, ask: "Did the model actually use this information?" Hard to measure automatically but valuable for qualitative evaluation.
3. **Scalability curve**: Measure token usage as cast size grows from 10 to 50 characters in same location with same active participants (should be flat or near-flat).
4. **Ambiguity detection rate**: How often do stages 1-2 fail and require stage 3? Track this metric as a quality indicator for the filtering logic.

## Risk assessment for each strategy

| Strategy | Primary risk | Mitigation |
| --- | --- | --- |
| Hierarchical filtering | Over-narrow scope omits relevant detail | Two-pass feedback loop; Dev shows included/excluded entities |
| Entity temperature scoring | Decay too aggressive loses important background characters | Tune decay factor; test with long-horizon story fixture |
| Scene-type inventory classification | Misclassifies ambiguous scene type | Keyword heuristics as first pass, cheap model call only on ties |
| Just-in-time entity loading | Misses references that use non-standard names (nicknames, titles) | Maintain alias map alongside exact names |
| Short model calls for disambiguation | Call latency accumulates if many ambiguities | Cache results; limit to top-N most ambiguous cases per scene |

## Documentation structure suggestions

Regardless of strategy chosen, the documentation should explicitly include:

1. **Formal entity categories** with clear inclusion thresholds (active vs. bystander vs. mentioned)
2. **The filtering pipeline stages** as a diagram or ranked sequence
3. **Expected outcomes per scenario** in Brasswater (not just current measurements but target state)
4. **A glossary** defining terms like "compact reference," "full profile," and their operational sizes
5. **Interaction matrix** between scoping system and pins/knowledge ledger/memory layers
6. **Known ambiguities catalog** (shared surnames, nicknames, titles, location name/item name collisions)

## Final recommendation

Start with deterministic hierarchical filtering as the base layer (stages 1-2). This handles most cases cheaply and predictably. Add short model calls for disambiguation only where genuinely needed (stage 3), measured carefully against baseline. Keep longer generative calls as true fallback (stage 4).

This approach aligns with the project's existing design philosophy: prefer code-based selection, minimize model calls, keep reasoning simple, and measure everything.

The two-pass continuation with scoping feedback is particularly attractive as it creates an adaptive system that improves over time without requiring prediction of future relevance at generation time.