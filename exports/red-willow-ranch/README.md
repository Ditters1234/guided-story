# Red Willow Ranch

An editable, **unwritten story setup** for a quiet cattle ranch, a small farmhouse and two leisure riding horses. The opening is a kitchen conversation; no feeding round or other chore has already happened.

## Import

1. In Storyweaver, open **Library → Import a setup ZIP**.
2. Choose [red-willow-ranch-setup.zip](red-willow-ranch-setup.zip).
3. Review the prepared cast, world, inventory and opening brief. Begin chapter one when ready. The plan is already filled out; regenerating the setup is optional.

Import creates a separate editable setup. It uses your existing model connections and does not change the other stories in your library.

See [the property map](ranch-map.png) for a quick overview and [MAP.md](MAP.md) for the exact nesting, cast locations and starting stock. [setup.json](setup.json) is the readable source data; the ZIP is the file to import. The map is a companion diagram, not a reference image required by the story or image workflow.

## What is prepared

- **People:** Alex and Erin Morrow, part-time helper Ben Cooper and neighboring friend June Calloway. All are adults with short, distinct profiles.
- **Animals:** Clover, a chestnut mare; Pippin, a bay gelding; and a single group record representing twelve beef cows. Horses and cattle have cast location records and ordinary animal behaviour.
- **Home:** kitchen, sitting room, main bedroom, guest/sewing room, bathroom, mudroom and porch, plus a small kitchen garden.
- **Farm:** yard, feed shed, workshop, north pasture, hay meadow, stable, tack room, two stalls, paddock, schooling ring and creek trail.
- **Daily life:** feeding, grooming, riding, small repairs, breakfast, baking, gardening, laundry, reading and neighborly visits. Three gentle open threads offer possibilities without forcing a crisis.

There are **7 cast records, 29 places, 46 items, 14 item containers and 9 background entries**. Furniture and incidental supplies are mostly background rather than a complete household inventory. Important tools, feed and a few kitchen ingredients are tracked explicitly.

## Directions to try after the opening

Start with one manageable activity. The saved opening brief clears after the first accepted passage.

| Direction | What to inspect |
| --- | --- |
| “Feed the cows.” | Does the scene find the shed, feed stock, tractor bin and pasture trough? A passage can stop before the whole round is complete. |
| “Load twelve scoops of Cattle Feed into Tractor Feed Bin, then stop before driving away.” | The hopper should retain 108 scoops; the bin should hold a separate 12-scoop stack. Loading does not consume feed. |
| “Drive to North Pasture and stay inside Tractor Cab for a moment.” | The tractor's parent becomes the pasture; Alex remains in its cab and the bin remains attached. |
| “Pour the loaded feed into the trough, park, climb down and walk home.” | Feed changes containers; the parked tractor stays in the pasture after Alex leaves. Subtract feed only if the cows actually eat it. |
| “Bring Pippin into the aisle for a quiet grooming session.” | The horse travels from the paddock; tools can be taken from the grooming kit. Ben does not arrive in the kitchen merely because he is mentioned. |
| “Have Alex hand the Wooden Grooming Brush to Ben.” | If Alex actually holds it first, its holder should become Ben after the completed handover. Legal ownership is separate from this holder field. |
| “Prepare for an easy ride along Creek Loop Trail.” | Tack comes from Tack Room; horses and riders retain separate location records. |
| “Make eggs and toast, then talk about the herb bed.” | Use the kitchen stock and let the conversation stand as a scene of its own. |

These are optional test directions, not an outline the narrator must complete. Use the actual preceding passage to decide what happens next. Weather, relationships and plans can evolve; opening-state notes are not promises that everything stays unchanged.

## Model fit and checks

The setup uses 500-word passages, 2,500-word chapters, a single human viewpoint and short action-specific background records. Persistent visible traits and clothing are separated from narrative personality; image style is kept in the art-style field. No reference images or additional planning calls are needed.

[validation.json](validation.json) records schema/graph checks, ZIP roundtrip, real repository import/export in an in-memory library, vehicle/feed state checks and mocked request construction. At the example **32k** context setting, the opening estimates **8,935 narration input tokens** and **13,287 extraction input tokens**, with a 4,096-token output allowance. Six continuation scope probes fit without warnings and retain their required materials. These are conservative app estimates and mock-response checks, not live-model quality results. No live model calls were made and the normal library/settings were untouched.

To regenerate the ZIP, readable data, diagram and validation report from the project root:

```powershell
node --import tsx exports/red-willow-ranch/generate.ts
```

The generator does not rebuild the app or production package. Existing stories are not migrated. Physical holder/storage is implemented; separate legal title remains descriptive only.
