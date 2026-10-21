import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createSample } from '../src/lib/server/fixture';
import { validateStory, type Story } from '../src/lib/story';
import { blankSetupPlan, setupDraftSchema, setupInputSchema } from '../src/lib/setup';
import { preparePassageCommit } from '../src/lib/server/passage-commit';
import { prepareOpening } from '../src/lib/server/setup-state';
import { pruneRemovedLoreItemLinks } from '../src/lib/server/lore-references';

const prose = 'Elias ate the last sugar cube.';
const consume = { type: 'item.quantity' as const, itemId: 'last-cube', expectedQuantity: 1, quantity: 0, evidence: prose };
function fixture() {
  const story = createSample();
  story.passages.at(-1)!.endOfChapter = false;
  story.canon.items.push({ id: 'last-cube', name: 'Sugar Cube', description: 'One individual cube.', quantity: 1, ownerId: 'elias', equipped: false });
  story.context.lore.push({ id: 'treat-routine', title: 'Treat routine', text: 'A sugar cube can be offered as an optional treat.', keywords: ['treat'], relatedIds: ['elias', 'last-cube', 'hold'], visibility: 'relevant' });
  return validateStory(story);
}
function proposal(story: Story, replacing = false, effects: unknown[] = [consume]) {
  return { mode: replacing ? 'replace' : 'continue', ...(replacing ? { passageId: story.passages.at(-1)!.id } : {}), direction: '',
    draft: { title: 'A treat', chapterTitle: story.passages.at(-1)!.chapterTitle, startsChapter: false, endOfChapter: false, viewpointId: 'elias', paragraphs: [effects.length ? prose : 'Elias left the sugar cube alone.'] }, effects };
}
const links = (story: Story) => story.context.lore.find(entry => entry.id === 'treat-routine')!.relatedIds;

test('last-unit consumption detaches only exhausted item links and preserves the complete background', () => {
  const before = fixture(), original = structuredClone(before);
  const result = preparePassageCommit(before, proposal(before)).story;
  assert.equal(result.canon.items.some(item => item.id === 'last-cube'), false);
  assert.deepEqual(links(result), ['elias', 'hold']);
  const expectedLore = structuredClone(before.context.lore);
  expectedLore.find(entry => entry.id === 'treat-routine')!.relatedIds = ['elias', 'hold'];
  assert.deepEqual(result.context.lore, expectedLore);
  assert.deepEqual(result.recovery!.loreLinks, [{ loreId: 'treat-routine', beforeIds: ['elias', 'last-cube', 'hold'], afterIds: ['elias', 'hold'] }]);
  assert.deepEqual(validateStory(JSON.parse(JSON.stringify(result))).recovery!.loreLinks, result.recovery!.loreLinks);
  assert.deepEqual(before, original);
});

test('latest replacement restores exhausted links and repeated replacements retain recovery', () => {
  const original = fixture();
  const consumed = preparePassageCommit(original, proposal(original)).story;
  const consumedAgain = preparePassageCommit(consumed, proposal(consumed, true)).story;
  assert.deepEqual(links(consumedAgain), ['elias', 'hold']);
  assert.deepEqual(consumedAgain.recovery!.loreLinks, consumed.recovery!.loreLinks);
  const restored = preparePassageCommit(consumedAgain, proposal(consumedAgain, true, [])).story;
  assert.equal(restored.canon.items.find(item => item.id === 'last-cube')!.quantity, 1);
  assert.deepEqual(links(restored), links(original));
  assert.equal(restored.recovery!.loreLinks, undefined);
});

test('replacement preserves manual background edits and never recreates removed entries', () => {
  const before = fixture(), consumed = preparePassageCommit(before, proposal(before)).story;
  const editedText = structuredClone(consumed);
  editedText.context.lore.find(entry => entry.id === 'treat-routine')!.text = 'An author-edited optional custom.';
  const restoredText = preparePassageCommit(editedText, proposal(editedText, true, [])).story;
  assert.deepEqual(links(restoredText), links(before));
  assert.equal(restoredText.context.lore.find(entry => entry.id === 'treat-routine')!.text, 'An author-edited optional custom.');
  const editedLinks = structuredClone(consumed);
  editedLinks.context.lore.find(entry => entry.id === 'treat-routine')!.relatedIds = ['hold'];
  assert.deepEqual(links(preparePassageCommit(editedLinks, proposal(editedLinks, true, [])).story), ['hold']);
  const removed = structuredClone(consumed);
  removed.context.lore = removed.context.lore.filter(entry => entry.id !== 'treat-routine');
  assert.equal(preparePassageCommit(removed, proposal(removed, true, [])).story.context.lore.some(entry => entry.id === 'treat-routine'), false);
});

test('opening consumption preserves lore and its links recover when the opening is replaced', () => {
  const plan = blankSetupPlan(randomUUID), person = plan.canon.characters[0], place = plan.canon.places[0];
  plan.canon.items.push({ id: 'last-cube', name: 'Sugar Cube', description: 'One individual cube.', quantity: 1, ownerId: person.id, equipped: false });
  plan.context.lore.push({ id: 'treat-routine', title: 'Treat routine', text: 'A sugar cube can be offered as an optional treat.', keywords: ['treat'], relatedIds: ['last-cube', place.id], visibility: 'relevant' });
  const now = new Date().toISOString(), draft = setupDraftSchema.parse({ id: randomUUID(), revision: 0, createdAt: now, updatedAt: now, input: setupInputSchema.parse({ premise: 'A quiet afternoon.', castSize: 1 }), plan, storyId: null });
  const opening = prepareOpening(draft, { mode: 'continue', direction: '', draft: { title: 'A treat', startsChapter: true, endOfChapter: false, viewpointId: person.id, paragraphs: [prose] }, effects: [consume] }, randomUUID());
  assert.deepEqual(links(opening), [place.id]);
  const restored = preparePassageCommit(opening, { ...proposal(opening, true, []), draft: { ...proposal(opening, true, []).draft, viewpointId: person.id } }).story;
  assert.deepEqual(links(restored), ['last-cube', place.id]);
  assert.deepEqual(draft.plan, plan);
});

test('pruning does not conceal unrelated invalid references or change surviving stock links', () => {
  const before = fixture(), after = structuredClone(before.canon);
  const lore = structuredClone(before.context.lore);
  lore.find(entry => entry.id === 'treat-routine')!.relatedIds.push('missing-item');
  assert.deepEqual(pruneRemovedLoreItemLinks(lore, [before.canon], after), []);
  assert.deepEqual(lore.find(entry => entry.id === 'treat-routine')!.relatedIds, ['elias', 'last-cube', 'hold', 'missing-item']);
  const invalid = structuredClone(before);
  invalid.context.lore = lore;
  assert.throws(() => preparePassageCommit(invalid, proposal(invalid)), /invalid story or context references/);
});

test('replacement detaches links to items created by the discarded passage without reviving them later', () => {
  const before = fixture(), mintId = randomUUID(), allocated = [mintId, randomUUID()];
  const mintProse = 'Elias found a wrapped mint.';
  const created = preparePassageCommit(before, {
    ...proposal(before, false, []), draft: { ...proposal(before, false, []).draft, paragraphs: [mintProse] },
    effects: [{ type: 'item.create', ref: 'new-mint', name: 'Wrapped mint', description: 'A wrapped mint.', quantity: 1, ownerId: 'elias', equipped: false, evidence: mintProse }]
  }, () => allocated.shift()!).story;
  created.context.lore.find(entry => entry.id === 'treat-routine')!.relatedIds.push(mintId);
  const replaced = preparePassageCommit(created, proposal(created, true, [])).story;
  assert.deepEqual(links(replaced), links(before));
  assert.equal(replaced.canon.items.some(item => item.id === mintId), false);
  const replacedAgain = preparePassageCommit(replaced, proposal(replaced, true, [])).story;
  assert.deepEqual(links(replacedAgain), links(before));
});
