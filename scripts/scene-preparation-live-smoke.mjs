// One bounded real-provider preparation probe; synthetic data, no library/settings writes.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const root = resolve('test-results'); mkdirSync(root, { recursive: true });
const scratch = mkdtempSync(join(root, 'scene-preparation-live-'));
process.env.STORY_DATA_DIR = scratch;
const { blankSetupPlan, setupDraftSchema, setupInputSchema, setupStoryBase } = await import('../src/lib/setup.ts');
const { normalizeCharacterProfile } = await import('../src/lib/character-profile.ts');
const { connectionSchema } = await import('../src/lib/server/connections.ts');
const { generateScenePreparation, applyScenePreparation } = await import('../src/lib/server/scene-preparation.ts');
const { openingContext } = await import('../src/lib/server/scene-scope.ts');
const { getDiagnostics } = await import('../src/lib/server/diagnostics.ts');
const connection = connectionSchema.parse(JSON.parse(readFileSync('config/connections.play.local.json', 'utf8')));
connection.text.timeoutSeconds = 60; connection.text.maxTokens = 3072; connection.text.contextTokens = 32000;
const plan = blankSetupPlan(randomUUID), base = plan.canon.characters[0];
plan.title = 'A quiet stable morning';
plan.canon.places = [
  { id: 'stable', name: 'Stable Aisle', description: 'A quiet stable with a grooming post.', parentId: null },
  { id: 'stall', name: 'Erin Stall', description: 'Erin has a hay rack and a filled water bucket.', parentId: 'stable' }
];
plan.canon.characters = [
  normalizeCharacterProfile({ ...base, id: 'alex', name: 'Alex', locationId: 'stable', notes: 'Alex cares for Erin each morning.' }),
  normalizeCharacterProfile({ ...base, id: 'erin', name: 'Erin', locationId: 'stall', visual: { ...base.visual, species: 'horse' }, notes: 'A calm pony.' })
];
plan.canon.items = [
  { id: 'tin', name: 'Treat Tin', description: 'A small portable storage tin.', ownerId: 'alex', quantity: 1, equipped: false, isContainer: true },
  { id: 'sugar', name: 'Sugar Cubes', description: 'White cubes offered as occasional pony treats.', ownerId: 'tin', quantity: 1, equipped: false, unlimited: true },
  { id: 'hay', name: 'Hay Flakes', description: 'Counted whole hay flakes.', ownerId: 'stable', quantity: 60, equipped: false },
  { id: 'scoop', name: 'Feed Scoop', description: 'A clean feed scoop.', ownerId: 'stable', quantity: 1, equipped: false }
];
plan.canon.relationships = []; plan.canon.threads = [];
plan.context.lore = [{ id: 'feeding-custom', title: 'Quiet feeding', text: 'Alex may speak softly to Erin while preparing her feed. Treats are occasional rewards, not compulsory steps.', keywords: ['feeding', 'treats'], relatedIds: ['alex', 'erin', 'hay', 'sugar'], visibility: 'relevant' }];
plan.context.sceneBrief = { ...plan.context.sceneBrief, viewpointId: 'alex', locationId: 'stable', castIds: ['alex'], purpose: 'A quiet stable morning.' };
const now = new Date().toISOString();
const source = setupStoryBase(setupDraftSchema.parse({ id: randomUUID(), revision: 0, createdAt: now, updatedAt: now, storyId: null, input: setupInputSchema.parse({ premise: 'A calm morning caring for a pony.', castSize: 2 }), plan }));
const original = structuredClone(source), started = Date.now();
let calls = 0;
try {
  const proposal = await generateScenePreparation(source, {
    requestId: randomUUID(), expectedRevision: source.revision,
    direction: 'Prepare a quiet feeding scene for Alex and Erin at Erin Stall. Reuse the current feed, equipment and always available sugar cubes in Treat Tin. Add only missing details or optional planning tasks. Stop before feeding is completed.',
    characterIds: ['alex', 'erin'], placeIds: ['stall'], itemIds: ['hay', 'sugar', 'scoop']
  }, connection, new AbortController().signal, async (...args) => { calls++; return fetch(...args); });
  assert.equal(calls, 1); assert.deepEqual(source, original);
  const staged = applyScenePreparation(source, proposal);
  for (const item of source.canon.items) assert.deepEqual(staged.canon.items.find(row => row.id === item.id), item);
  const scoped = openingContext(staged, staged.context.sceneBrief.purpose);
  for (const id of ['sugar', 'hay', 'scoop']) assert.ok(scoped.scope.selectedItems.some(row => row.id === id), `${id} must reach opening context`);
  const result = {
    model: connection.text.model, realCalls: calls, elapsedMs: Date.now() - started,
    sourceUnchanged: true, existingInventoryUnchanged: true,
    selectedResourcesReachOpening: true, proposal,
    limitations: 'One isolated synthetic local-model preparation request. No narration or sustained-story evaluation. No library/settings writes.'
  };
  writeFileSync(join(root, 'scene-preparation-live.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ ...result, proposal: { explanation: proposal.explanation, reusedIds: proposal.reusedIds, additions: Object.fromEntries(Object.entries(proposal.additions).map(([key, rows]) => [key, rows.length])), sceneBrief: proposal.sceneBrief } }));
} finally {
  getDiagnostics().close();
  assert.ok(scratch.startsWith(root + sep + 'scene-preparation-live-'));
  rmSync(scratch, { recursive: true, force: true });
}
