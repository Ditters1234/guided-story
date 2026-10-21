# Local model defaults

Updated October 20, 2026. The play configuration selects Schattenblume-31B-GGUF. The image workflow selects SICK_OLLIE_Krea2_BF16. These are a practical starting point for this installation, not universal optimum settings.

| Setting | Default |
| --- | --- |
| Context budget | 32,000 tokens; match the capacity configured in the text server |
| Output allowance | 4,096 tokens |
| Prose temperature / top-p | 0.8 / 1.0 |
| Thinking | Off |
| Structured output | Auto |
| Passage / chapter targets | 800 / 3,000 words |
| Image dimensions | 896 × 1152; landscape swaps these |
| Image sampler / scheduler | Euler / beta, set in the workflow |
| Steps / CFG | 9 / 1 |
| Seed | Random (-1); use a fixed seed for comparisons |
| Negative prompt | Blank; the supplied graph uses zeroed conditioning |

Fact extraction and memory keep temperature 0.1; image preparation keeps 0.2. Saved custom prompts and unrelated connection settings remain intact. The known old factory narrator text is updated in this checkout's saved configurations, and its dimensions/8-step settings are aligned with the new baseline. A freshly installed package uses the new defaults; an existing installation's local settings are independent.

## Prompt guidance

The global narrator instructions remain short: consistent viewpoint, distinct voices, cause and effect, action/dialogue, varied description, and the requested stopping point. Each story's Writing guide carries its detailed style preferences.

Image preparation produces one visible moment in natural language, keeps character identities separate, honors framing and fixed staging, and leaves art direction to its dedicated field. The output JSON schema and preservation rules remain enforced. The shorter prompt adds no model calls.

[Krea's official guide](https://github.com/krea-ai/krea-2/blob/main/docs/prompting.md) recommends natural-language prompts and useful visual detail. The [Sickollie generation node](https://github.com/sickollie/SickOllie/blob/main/generation_core.py) uses 9-step Euler/beta/CFG 1 defaults. Its additional model-shift control is not copied into the app workflow.

## Context budgeting

All text request paths use the same conservative local estimator for message content and schema overhead. ASCII prose is estimated in short subword pieces; numeric/punctuation/JSON content has its own allowances, and non-ASCII content retains a conservative byte allowance. Output tokens and the configured overhead reserve stay in token units. The model's exact tokenizer is not bundled, so Dev labels counts **estimated tokens** and retains separate byte diagnostics.

Recap and memory sources are packed by the same estimate without breaking Unicode characters or dropping source text. Recent prose also retains its existing byte cap. Required facts and pins still block requests that exceed the estimated budget; provider failures preserve saved state.

## Sampling comparison

Two local Sickollie renders used the same neutral two-traveler scene, seed 24601, dimensions 896 × 1152, CFG 1 and unchanged model/LoRA graph. Eight steps/Euler/simple took 48.7 seconds; nine steps/Euler/beta took 48.7 seconds. Both preserved the principal characters and staging. The beta result had a simpler single ticket and clearer hand arrangement, so it was selected as the baseline. Both contained incidental lettering despite the prompt exclusion. One comparison does not establish a general quality advantage.

Local evidence is in ignored `test-results/sickollie-settings/`. Re-run with `node scripts/sickollie-settings-compare.mjs` only when the local ComfyUI queue is idle; the script refuses to interrupt existing work. This is an opt-in live render check.
