# Local narrative walkthrough

October 17, 2026. This is a small development acceptance case, not a long-novel benchmark. Normal play saves, API keys and saved connection preferences were not changed.

## Case

The local Unsloth connection generated a new story from an approved manual ensemble/world setup based on the space-trader fixture. Test targets were 350 words per passage and 1,100 per chapter; ordinary application defaults remain 800 and 3,000. The test used JSON-object output in temporary settings. Auto now requests the same format for structured tasks.

| Passage | Viewpoint | Words | Outcome |
| --- | --- | --- | --- |
| The Wayward's Burden | Elias | 355 | Docked at Halcyon; the crew decides to inspect the container externally |
| The Weight of Secrets | Mira | 346 | Elias hands her the access fob; she reaches the hold and observes the container drawing rhythmic power |
| The Pulsing Vault | Ren | 378 | Mira reports her observation; the crew decides to depart, without recording departure as already completed |
| Paper Trails | Mira | 349 | Chapter two: the ship reaches the Glass Belt; Mira returns to the bridge with the fob and finds a new manifest lead |

Chapter one developed over three passages to 1,079 words before its requested close. Chapter two remained open. Inventory ownership, internal character locations and ship containment changed through evidenced operations. The sealed container stayed in the hold with its contents unknown in canon. A hidden later-reveal note was not supplied to narration, memory or questions.

## What worked

- Viewpoint metadata followed each explicit reader selection, with prose largely limited to that person's observations.
- Mira's discovery caused the later discussion and departure decision; the next chapter followed through on that decision.
- Elias's defensive humor, Mira's practical focus and Ren's deflections gave the dialogue distinguishable voices.
- The fob remained with Mira across the chapter boundary. Ship travel updated its parent place and description; crew moving between ship rooms retained meaningful internal locations.
- The completed-chapter memory retained the fob transfer and separated preparation to leave from actual departure.
- Ask retrieved both the earlier handover and current possession, with valid excerpts from each passage and all four passages represented. Asking left the novel unchanged.
- A separate wording draft and meaning review approved a one-sentence copyedit of the opening. Explicit acceptance preserved canon/recovery, and an exported/imported copy retained the accepted prose.

## Remaining quality work

There are useful limits visible even in this short case. The model repeated amber lighting, death imagery and idle-hand character beats. Mira's multitool handling could be clearer between holding it and drawing it from her belt. The chapter summary's opening sentence described the cargo as definitely not agricultural machinery more confidently than the first chapter established; its detailed facts and current canonical description still kept the contents unknown.

These are reasons to evaluate a general continuity/repetition review and better handling of observations versus deductions. A source fingerprint or exact quoted receipt establishes provenance; it does not prove every narrative inference. Current canon remains authoritative over summaries, and the reader can correct memory/world records. The bounded case does not establish reliable recall across a whole novel.

## Engineering findings

The walkthrough exposed four integration weaknesses that were addressed:

- The model abbreviated long effect quotes. Extraction now selects numbered source anchors and the app binds actual verbatim text; unknown or malformed anchors still fail.
- Unconstrained output omitted a closing JSON array. Auto now requests JSON-object output for structured tasks, while Prompt only remains available for incompatible APIs. Schema/field validation remains required.
- Optional history could fill the input budget before narrator output/pacing instructions were added. Those instructions now participate in required context selection, with service-formatting reserve and JSON escaping included. Dev previews the same default continuation contract.
- Ask initially supplied the latest possession but omitted the earlier handover. Question matches now outweigh the focused-passage bonus, short terms count, and an obligatory duplicate recent ending no longer consumes the question budget. The repeated live check cited the actual handover as well as the latest possession; a regression case covers this selection failure.

Ship movement examples now explicitly distinguish creating a destination from moving an existing ship's parent location, and creation aliases must retain the `new-` prefix. The first rejected attempt was kept out of canon; valid operations were never silently invented to make the test pass.

See [Director/editor tools](DIRECTOR_EDITOR.md) for Ask/polish behavior and [Project status](PROJECT_STATUS.md) for the remaining work. Ignored local artifacts under `test-results/director-live*` hold the generated prose, checkpoint, responses and diagnostics for this development case. `--resume` imports the last accepted checkpoint into another temporary library; it is a developer test aid, not automatic product recovery of interrupted tokens.
