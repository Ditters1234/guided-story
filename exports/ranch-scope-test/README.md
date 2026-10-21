# Ranch task and moving-vehicle fixtures

Synthetic stories for [the fourth scoping pass](../../docs/SCOPING_PHASE_FOUR.md). They do not change the normal library or settings until you choose to import a ZIP.

For the fuller **unfinished ranch setup** with a farmhouse, riding horses, daily-life activities and a property diagram, use [Red Willow Ranch](../red-willow-ranch/README.md). The smaller written stories below remain focused regression fixtures.

## Recommended: occupied tractor

Import **ranch-vehicle-story.zip** through Library's story import. Alex starts inside the Tractor Cab in the Equipment Yard. The tractor is one moving place; its cab is a child place and its feed bin is a container item. Feed starts in the shed; cows and the trough are in North Pasture.

Try:

1. “Feed the cows.” Existing public background explains the routine; you should not need to name every resource in this fixture.
2. “Stay inside the cab and consider the weather.” Check that Alex remains in the cab and its enclosing location is correct.
3. “Park beside the trough, climb down and walk home.” The tractor should remain in the field while Alex moves home. Parking does not require transferring a tractor item to a person.

The routine is background, not a completed event. Check actual narrated actions, quantities and current records. Short prose can pause before a whole task is complete; don't expect a full simulated daily schedule. A model may still miss or invent a detail, and an uncertain verification should preserve the previous save.

## Comparison: vehicle as an item

**ranch-story.zip** preserves the initial item/container representation. It supports moving feed through a tractor bin, but characters cannot be located inside that item. A person-held tractor follows the person's location unless explicitly parked at a place. Use this to inspect the immediate-holder versus legal-ownership limitation, not as the recommended occupied-vehicle structure.

Readable copies: `vehicle-story.json` and `story.json`. `audit.json` contains current deterministic scope/request/commit results. Neither fixture automatically changes existing vehicle records or invents a legal-owner field.

Regenerate and validate ZIP imports in an in-memory library:

```powershell
node --import tsx exports/ranch-scope-test/audit.ts
```

These tests retain current quantities, holder paths, a remote ranch hand and unrelated supplies. A flat-tyre variant verifies that current condition enters the prompt; that is not a live guarantee that every model respects it. General task selection still needs relevant references in descriptions/background/known facts or valid memory; it cannot infer every dependency from nothing.
