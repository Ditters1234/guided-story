import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSample } from '../src/lib/server/fixture';
import { buildStoryContext } from '../src/lib/server/context-builder';
import { buildLoreAudit, captureLoreEditBaseline, prepareLoreContextMutation } from '../src/lib/lore-audit';
import { buildLoreAudit as serverAudit } from '../src/lib/server/lore-audit';

function fixture() {
  const story = createSample();
  story.canon.items.push(
    { id: 'treat-bag', name: 'Treat bag', description: 'A canvas bag.', quantity: 1, ownerId: 'elias', equipped: false, isContainer: true },
    { id: 'sugar-tin', name: 'Sugar tin', description: 'A small tin.', quantity: 1, ownerId: 'treat-bag', equipped: false, isContainer: true },
    { id: 'sugar', name: 'Sugar Cubes', description: 'Individual cubes.', quantity: 8, ownerId: 'sugar-tin', equipped: false },
    { id: 'tea', name: 'Tea supply', description: 'Everyday loose tea.', quantity: 1, ownerId: 'hold', equipped: false, unlimited: true }
  );
  story.context.lore = [
    { id: 'custom', title: 'Dockside custom', text: 'Crews may exchange greetings before discussing a delivery.', keywords: ['custom', 'greetings'], relatedIds: ['elias', 'sugar', 'tea'], visibility: 'relevant' },
    { id: 'private', title: 'A private note', text: 'The old portmaster recognizes the seal.', keywords: ['seal'], relatedIds: ['halcyon'], visibility: 'hidden' },
    { id: 'world', title: 'World foundations', text: 'Independent stations trade with travelling crews.', keywords: [], relatedIds: [], visibility: 'always' }
  ];
  return story;
}

test('lore audit deterministically inspects hidden entries and current nested holders without mutation', () => {
  const story = fixture(), original = structuredClone(story), audit = buildLoreAudit(story);
  assert.equal(serverAudit, buildLoreAudit);
  assert.deepEqual(buildLoreAudit(story), audit);
  assert.deepEqual(story, original);
  assert.deepEqual(audit.entries.map(entry => entry.id), ['custom', 'private', 'world']);
  assert.equal(audit.entries[1].visibility, 'hidden');
  assert.equal(audit.entries[1].text, story.context.lore[1].text);
  assert.deepEqual(audit.summary, { total: 3, always: 1, relevant: 1, hidden: 1, missingReferences: 0, entriesWithIssues: 0, included: 0, excluded: 0 });
  const cube = audit.entries[0].links.find(link => link.id === 'sugar')!;
  assert.equal(cube.pathLabel, 'Halcyon Station › The Wayward › Bridge › Elias Voss › Treat bag › Sugar tin › Sugar Cubes');
  assert.equal(cube.holderId, 'sugar-tin'); assert.equal(cube.holderName, 'Sugar tin'); assert.equal(cube.rootHolderId, 'elias');
  assert.equal(cube.quantity, 8); assert.equal(cube.unlimited, false); assert.equal(cube.pathValid, true);
  const tea = audit.entries[0].links.find(link => link.id === 'tea')!;
  assert.equal(tea.unlimited, true); assert.equal(tea.quantity, 1); assert.equal(tea.holderId, 'hold');
  assert.equal(tea.pathLabel, 'Halcyon Station › The Wayward › Cargo hold › Tea supply');
});

test('missing links and cyclic current paths are explicit record checks', () => {
  const story = fixture();
  story.context.lore[0].relatedIds.push('missing-item');
  story.canon.items.find(item => item.id === 'treat-bag')!.ownerId = 'sugar-tin';
  const audit = buildLoreAudit(story), entry = audit.entries[0];
  assert.equal(audit.summary.missingReferences, 1);
  assert.equal(entry.links.find(link => link.id === 'missing-item')!.exists, false);
  assert.equal(entry.links.find(link => link.id === 'sugar')!.pathValid, false);
  assert.ok(entry.issues.some(issue => issue.code === 'missing-reference' && issue.relatedIds.includes('missing-item') && !issue.heuristic));
  assert.ok(entry.issues.some(issue => issue.code === 'invalid-path' && issue.relatedIds.includes('sugar') && !issue.heuristic));
});

test('normalized duplicate titles and text include hidden entries but ignore empty text', () => {
  const story = fixture();
  story.context.lore[0].title = 'Dock-side Custom!';
  story.context.lore[1].title = '  DOCK side custom  ';
  story.context.lore[1].text = story.context.lore[0].text.toUpperCase().replace('.', '!');
  story.context.lore.push({ id: 'blank-a', title: 'Blank A', text: '', keywords: [], relatedIds: [], visibility: 'relevant' }, { id: 'blank-b', title: 'Blank B', text: ' ', keywords: [], relatedIds: [], visibility: 'hidden' });
  const audit = buildLoreAudit(story);
  assert.deepEqual(audit.duplicates, [{ kind: 'title', entryIds: ['custom', 'private'] }, { kind: 'text', entryIds: ['custom', 'private'] }]);
  assert.deepEqual(audit.entries[0].issues.filter(issue => issue.code.startsWith('duplicate')).map(issue => issue.relatedIds), [['private'], ['private']]);
  assert.equal(audit.entries.find(entry => entry.id === 'blank-a')!.issues.some(issue => issue.code === 'duplicate-text'), false);
});

test('stock, placement and temporary-condition language is labeled heuristic and never changes canon', () => {
  const story = fixture(), originalCanon = structuredClone(story.canon);
  story.context.lore[0].text = 'Sugar Cubes quantity 2 are in Sugar tin, which is currently full.';
  const audit = buildLoreAudit(story), entry = audit.entries[0];
  assert.deepEqual(entry.issues.map(issue => issue.code), ['stock-language', 'placement-language', 'condition-language']);
  for (const issue of entry.issues) { assert.equal(issue.heuristic, true); assert.match(issue.message, /[Hh]euristic/); }
  assert.equal(entry.links.find(link => link.id === 'sugar')!.quantity, 8);
  assert.deepEqual(story.canon, originalCanon);
});

test('selection reasons come from the actual matching preview rather than inferred relevance', () => {
  const story = fixture(), report = buildStoryContext(story, 'Discuss the custom.', 65536, 4096);
  const source = report.sources.find(source => source.kind === 'lore' && source.id === 'custom')!;
  source.included = false; source.reason = 'An actual measured budget exclusion.';
  const audit = buildLoreAudit(story, report);
  assert.equal(audit.preview.status, 'current');
  assert.deepEqual(audit.entries[0].selection, { status: 'excluded', reason: source.reason, tokens: source.tokens, bytes: source.bytes, required: source.required });
  const hiddenSource = report.sources.find(source => source.kind === 'lore' && source.id === 'private')!;
  assert.equal(audit.entries[1].selection.reason, hiddenSource.reason);
  assert.equal(audit.entries[1].selection.status, 'excluded');
  report.sources = report.sources.filter(source => source.id !== 'custom');
  assert.equal(buildLoreAudit(story, report).entries[0].selection.status, 'unreported');
});

test('missing, wrong-story and stale previews do not claim measured inclusion', () => {
  const story = fixture(), report = buildStoryContext(story, '', 65536, 4096);
  assert.equal(buildLoreAudit(story).entries[0].selection.status, 'no-preview');
  for (const stale of [{ ...report, revision: report.revision + 1 }, { ...report, storyId: 'other-story' }]) {
    const audit = buildLoreAudit(story, stale);
    assert.equal(audit.preview.status, 'stale'); assert.equal(audit.summary.included, 0); assert.equal(audit.summary.excluded, 0);
    assert.equal(audit.entries[0].selection.status, 'stale-preview'); assert.equal(audit.entries[0].selection.tokens, undefined);
  }
});

test('explicit lore save preserves scene brief, knowledge, memories and compaction exactly', () => {
  const story = fixture(), baseline = captureLoreEditBaseline(story), original = structuredClone(story), lore = structuredClone(story.context.lore);
  lore[0].text = 'Crews may share tea before discussing a delivery.'; lore[1].visibility = 'relevant'; lore.splice(2, 1);
  const action = prepareLoreContextMutation(story, baseline, lore);
  assert.equal(action.type, 'context'); assert.deepEqual(action.context, { ...original.context, lore });
  assert.deepEqual(story, original);
  action.context.lore[0].text = 'Changed only in the returned save action.';
  assert.notEqual(action.context.lore[0].text, lore[0].text);
});

test('stale lore saves reject changed revisions, stories or externally edited context while retaining drafts', () => {
  const story = fixture(), baseline = captureLoreEditBaseline(story), lore = structuredClone(story.context.lore); lore[0].text = 'Unsaved authored background.';
  const originalLore = structuredClone(lore);
  for (const changed of [{ ...story, revision: story.revision + 1 }, { ...story, id: 'another-story' }, { ...story, context: { ...story.context, sceneBrief: { ...story.context.sceneBrief, purpose: 'A newer scene plan.' } } }]) {
    assert.throws(() => prepareLoreContextMutation(changed, baseline, lore), /saved story changed/);
    assert.deepEqual(lore, originalLore);
  }
});

test('invalid lore links, blank titles, duplicate IDs and oversized edits cannot be submitted', () => {
  const story = fixture(), baseline = captureLoreEditBaseline(story), original = structuredClone(story);
  const edits = [
    (lore: typeof story.context.lore) => { lore[0].relatedIds.push('missing-item'); },
    (lore: typeof story.context.lore) => { lore[0].title = ' '; },
    (lore: typeof story.context.lore) => { lore[1].id = lore[0].id; },
    (lore: typeof story.context.lore) => { lore[0].keywords = Array(31).fill('keyword'); }
  ];
  for (const edit of edits) { const lore = structuredClone(story.context.lore); edit(lore); assert.throws(() => prepareLoreContextMutation(story, baseline, lore)); assert.deepEqual(story, original); }
});
