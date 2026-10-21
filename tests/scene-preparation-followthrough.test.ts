import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { StoryRepository } from '../src/lib/server/repository';
import { blankSetupPlan, type SetupDraft } from '../src/lib/setup';
import type { Story } from '../src/lib/story';
import type { RecordKind } from '../src/lib/record-editing';

const visibleId = 'delivery-custom';
const hiddenId = 'private-delivery-plan';
const resourceIds = ['fob', 'crew-trust', 'container', 'glass', visibleId];

function storyWithResources(repository: StoryRepository): Story {
  const story = repository.create(), context = structuredClone(story.context);
  context.lore = [
    { id: visibleId, title: 'Delivery custom', text: 'Crew members can check their access before a delivery.', keywords: ['delivery'], relatedIds: ['fob'], visibility: 'relevant' },
    { id: hiddenId, title: 'Private delivery plan', text: 'An unrevealed author plan.', keywords: [], relatedIds: [], visibility: 'hidden' }
  ];
  context.sceneBrief.resourceIds = [...resourceIds];
  return repository.mutate(story.id, { expectedRevision: story.revision, requestId: randomUUID(), action: { type: 'context', context } });
}

function setupWithResources(repository: StoryRepository): SetupDraft {
  const draft = repository.createSetup({ premise: 'A quiet visit to a pony stable.', castSize: 1 }, randomUUID());
  const plan = blankSetupPlan(randomUUID), person = plan.canon.characters[0];
  plan.canon.items.push({ id: 'setup-treats', name: 'Pony treats', description: 'Counted treats.', quantity: 8, ownerId: person.id, equipped: false });
  plan.canon.threads.push({ id: 'setup-feed-task', title: 'Prepare the pony feed', notes: 'An optional future feeding task.', status: 'open' });
  plan.context.lore.push({ id: 'setup-routine', title: 'Feeding custom', text: 'Move quietly during feeding.', keywords: ['feeding'], relatedIds: ['setup-treats'], visibility: 'relevant' });
  plan.context.sceneBrief.resourceIds = ['setup-treats', 'setup-feed-task', 'setup-routine'];
  return repository.saveSetup(draft.id, { expectedRevision: draft.revision, requestId: randomUUID(), input: draft.input, plan });
}

test('manual record removals detach only their reviewed resources while preserving history and other hints', () => {
  const repository = new StoryRepository(':memory:');
  try {
    for (const [kind, id] of [['item', 'fob'], ['thread', 'container'], ['relationship', 'crew-trust'], ['place', 'glass']] as [RecordKind, string][]) {
      const before = storyWithResources(repository);
      const after = repository.mutate(before.id, { expectedRevision: before.revision, requestId: randomUUID(), action: { type: 'record-remove', kind, id } });
      assert.deepEqual(after.context.sceneBrief.resourceIds, resourceIds.filter(resourceId => resourceId !== id));
      assert.deepEqual(after.passages, before.passages);
      assert.deepEqual(after.context.memories, before.context.memories);
      assert.deepEqual(after.context.knowledge, before.context.knowledge);
      assert.deepEqual(after.media, before.media);
      assert.equal(after.recovery!.valid, false);
      assert.equal(after.context.compaction.epoch, before.context.compaction.epoch + 1);
      assert.deepEqual(after.context.lore.find(entry => entry.id === visibleId)!.relatedIds, id === 'fob' ? [] : ['fob']);
    }
  } finally { repository.close(); }
});

test('hiding or removing linked lore detaches the prior hint without changing canon or latest-passage recovery', () => {
  const repository = new StoryRepository(':memory:');
  try {
    for (const operation of ['hide', 'remove'] as const) {
      const before = storyWithResources(repository), context = structuredClone(before.context);
      if (operation === 'hide') context.lore.find(entry => entry.id === visibleId)!.visibility = 'hidden';
      else context.lore = context.lore.filter(entry => entry.id !== visibleId);
      const after = repository.mutate(before.id, { expectedRevision: before.revision, requestId: randomUUID(), action: { type: 'context', context } });
      assert.deepEqual(after.context.sceneBrief.resourceIds, resourceIds.filter(id => id !== visibleId));
      assert.deepEqual(after.canon, before.canon);
      assert.deepEqual(after.passages, before.passages);
      assert.deepEqual(after.recovery, before.recovery);
      assert.deepEqual(after.context.compaction, before.context.compaction);
      assert.equal(after.context.lore.some(entry => entry.id === hiddenId && entry.visibility === 'hidden'), true);
    }
  } finally { repository.close(); }
});

test('new missing, hidden and duplicate resource hints reject atomically instead of being silently pruned', () => {
  const repository = new StoryRepository(':memory:');
  try {
    const before = storyWithResources(repository);
    for (const invalid of [['missing-resource'], [hiddenId], ['fob', 'fob']]) {
      const brief = { ...before.context.sceneBrief, resourceIds: invalid };
      assert.throws(() => repository.mutate(before.id, { expectedRevision: before.revision, requestId: randomUUID(), action: { type: 'scene-brief', brief } }), /resource|Duplicate/i);
      assert.deepEqual(repository.read(before.id), before);
      const context = structuredClone(before.context);
      context.sceneBrief = brief;
      // Removing an old, legitimate lore hint must not conceal unrelated new bad IDs.
      context.lore = context.lore.filter(entry => entry.id !== visibleId);
      assert.throws(() => repository.mutate(before.id, { expectedRevision: before.revision, requestId: randomUUID(), action: { type: 'context', context } }), /resource|Duplicate/i);
      assert.deepEqual(repository.read(before.id), before);
    }
    const draft = setupWithResources(repository), invalidPlan = structuredClone(draft.plan!);
    invalidPlan.context.sceneBrief.resourceIds!.push('missing-resource');
    assert.throws(() => repository.saveSetup(draft.id, { expectedRevision: draft.revision, requestId: randomUUID(), input: draft.input, plan: invalidPlan }), /resource/i);
    assert.deepEqual(repository.readSetup(draft.id), draft);
  } finally { repository.close(); }
});

test('reviewed resource hints survive repository restart and setup/story archive roundtrips', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'storyweaver-resource-followthrough-')), databasePath = join(directory, 'stories.sqlite');
  let repository = new StoryRepository(databasePath);
  try {
    const story = storyWithResources(repository), draft = setupWithResources(repository), older = repository.create();
    assert.equal(Object.hasOwn(older.context.sceneBrief, 'resourceIds'), false);
    repository.close(); repository = new StoryRepository(databasePath);
    assert.deepEqual(repository.read(story.id), story);
    assert.deepEqual(repository.readSetup(draft.id), draft);
    const importedStory = await repository.import(repository.export(story.id));
    assert.deepEqual(importedStory.context.sceneBrief, story.context.sceneBrief);
    assert.deepEqual(importedStory.context.lore, story.context.lore);
    const importedSetup = repository.importSetup(repository.exportSetup(draft.id));
    assert.deepEqual(importedSetup.plan, draft.plan);
    assert.equal(Object.hasOwn(repository.read(older.id).context.sceneBrief, 'resourceIds'), false);
  } finally {
    repository.close();
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    rmSync(directory, { recursive: true, force: true });
  }
});
