import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { emptyContext, sceneBriefSchema } from '../src/lib/context-types';
import { storyPreferencesSchema } from '../src/lib/settings';
import { createSample, sampleContinuationProposal, sampleReplacementProposal } from '../src/lib/server/fixture';
import { StoryRepository } from '../src/lib/server/repository';
import { preparePassageCommit } from '../src/lib/server/passage-commit';
import { buildStoryContext } from '../src/lib/server/context-builder';

test('legacy scene flags normalize without losing one-shot behavior, and explicit scope is authoritative', () => {
  const { scope: _scope, ...legacy } = emptyContext().sceneBrief;
  assert.equal(sceneBriefSchema.parse({ ...legacy, clearAfterPassage: true }).scope, 'next-passage');
  assert.equal(sceneBriefSchema.parse({ ...legacy, clearAfterPassage: false }).scope, 'ongoing');
  assert.equal(sceneBriefSchema.parse({ ...legacy, scope: 'current-scene', clearAfterPassage: true }).clearAfterPassage, false);
  assert.equal(sceneBriefSchema.parse({ ...legacy, scope: 'next-passage', clearAfterPassage: false }).clearAfterPassage, true);
  assert.equal(storyPreferencesSchema.parse({}).writingGuide, '');
  assert.throws(() => storyPreferencesSchema.parse({ writingGuide: 'x'.repeat(3001) }));
});

test('writing guide and scene scope survive ordinary story saves and reopening the library', () => {
  const dir = mkdtempSync(join(tmpdir(), 'guided-story-controls-')), db = join(dir, 'library.sqlite');
  let repository = new StoryRepository(db);
  try {
    let story = repository.create();
    story = repository.mutate(story.id, { expectedRevision: story.revision, requestId: randomUUID(), action: { type: 'preferences', title: story.title, premise: story.premise, narrationStyle: story.narrationStyle, artStyle: story.artStyle, adultContent: story.adultContent, preferences: { ...story.preferences, writingGuide: 'Spare prose, patient pacing and varied gestures.', contentNotes: 'Avoid graphic injury.' } } });
    story = repository.mutate(story.id, { expectedRevision: story.revision, requestId: randomUUID(), action: { type: 'scene-brief', brief: { ...story.context.sceneBrief, scope: 'current-scene', purpose: 'Finish the inspection.' } } });
    repository.close(); repository = new StoryRepository(db);
    const saved = repository.read(story.id);
    assert.equal(saved.preferences.writingGuide, 'Spare prose, patient pacing and varied gestures.');
    assert.equal(saved.preferences.contentNotes, 'Avoid graphic injury.');
    assert.equal(saved.context.sceneBrief.scope, 'current-scene');
    assert.equal(saved.context.sceneBrief.clearAfterPassage, false);
    assert.deepEqual(saved.context.sceneBrief, story.context.sceneBrief);
  } finally { repository.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('next-passage direction survives replacement and rejected proposals, and clears on accepted continuation', () => {
  const story = createSample();
  story.context.sceneBrief = sceneBriefSchema.parse({ ...story.context.sceneBrief, purpose: 'Keep this upcoming plan.', scope: 'next-passage' });
  const before = structuredClone(story.context.sceneBrief);
  const replaced = preparePassageCommit(story, sampleReplacementProposal(story, story.passages.at(-1)!.id)).story;
  assert.deepEqual(replaced.context.sceneBrief, before);
  const invalid = sampleContinuationProposal(''); invalid.draft.viewpointId = 'unknown';
  assert.throws(() => preparePassageCommit(story, invalid), /viewpoint/);
  assert.deepEqual(story.context.sceneBrief, before);
  const continued = preparePassageCommit(story, sampleContinuationProposal('')).story;
  assert.deepEqual(continued.context.sceneBrief, emptyContext().sceneBrief);
  assert.deepEqual(story.context.sceneBrief, before);
});

test('current-scene and ongoing direction span passages and chapter endings until explicitly cleared', () => {
  for (const scope of ['current-scene', 'ongoing'] as const) {
    const story = createSample();
    story.context.sceneBrief = sceneBriefSchema.parse({ ...story.context.sceneBrief, scope });
    const proposal = sampleContinuationProposal(''); proposal.draft.endOfChapter = true;
    const continued = preparePassageCommit(story, proposal).story;
    assert.deepEqual(continued.context.sceneBrief, story.context.sceneBrief);
  }
  const repository = new StoryRepository(':memory:');
  try {
    let story = repository.create();
    const canon = structuredClone(story.canon), recovery = structuredClone(story.recovery);
    story = repository.mutate(story.id, { expectedRevision: story.revision, requestId: randomUUID(), action: { type: 'scene-brief', brief: emptyContext().sceneBrief } });
    assert.deepEqual(story.context.sceneBrief, emptyContext().sceneBrief);
    assert.deepEqual(story.canon, canon); assert.deepEqual(story.recovery, recovery);
  } finally { repository.close(); }
});

test('writing guide is a distinct required source and cannot be dropped to make a context runnable', () => {
  const story = createSample(); story.preferences.writingGuide = 'Keep dialogue concise and transitions unhurried.';
  const full = buildStoryContext(story, '', 65536, 1536), text = full.messages.map(m => m.content).join('\n');
  assert.ok(full.sources.find(source => source.id === 'writing-guide')?.required);
  assert.ok(full.sources.find(source => source.id === 'writing-guide')?.included);
  assert.equal(text.split(story.preferences.writingGuide).length - 1, 1);
  const insufficient = buildStoryContext(story, '', 2048, 1536);
  assert.equal(insufficient.runnable, false);
  assert.ok(insufficient.sources.find(source => source.id === 'writing-guide')?.required);
  assert.ok(!buildStoryContext(story, 'What happened?', 65536, 1536, undefined, undefined, { purpose: 'ask' }).sources.some(source => source.id === 'writing-guide'));
});
