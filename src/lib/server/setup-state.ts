import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { setupStoryBase, validateSetupPlan, type SetupDraft } from '../setup';
import { passageSchema, validateStory } from '../story';
import { applyStoryEffects } from '../story-effects';
import { passageProposalSchema, attachPassageMemory } from './passage-commit';
import { StoryError } from '../errors';
import { assertFactPinsUnchanged } from '../fact-pins';
import { emptyContext } from '../context-types';
import { pruneRemovedLoreItemLinks } from './lore-references';

export function prepareOpening(draft: SetupDraft, value: z.infer<typeof passageProposalSchema>, requestId: string) {
  validateSetupPlan(draft.plan);
  const proposal = passageProposalSchema.parse(value);
  if (proposal.mode !== 'continue' || !proposal.draft.startsChapter || proposal.passageId) throw new StoryError('An opening must begin chapter one.');
  const story = setupStoryBase(draft), baseline = structuredClone(story.canon);
  const applied = applyStoryEffects(baseline, proposal.effects, proposal.draft.paragraphs.join('\n\n'), randomUUID);
  assertFactPinsUnchanged(story, applied.canon);
  const personId = applied.assigned[proposal.draft.viewpointId] || proposal.draft.viewpointId, person = applied.canon.characters.find(c => c.id === personId);
  if (!person) throw new StoryError('The opening viewpoint does not exist.');
  const passage = passageSchema.parse({ id: randomUUID(), title: proposal.draft.title, chapter: 1, chapterTitle: draft.plan!.chapterTitle, viewpoint: person.name, viewpointId:person.id, paragraphs: proposal.draft.paragraphs, direction: draft.plan!.context.sceneBrief.purpose, endOfChapter: proposal.draft.endOfChapter, createdAt: new Date().toISOString(), generation: { sourceRevision: draft.revision, requestId, effects: applied.effects, assignedIds: applied.assigned } });
  const loreLinks = pruneRemovedLoreItemLinks(story.context.lore, [baseline], applied.canon);
  story.passages = [passage]; story.canon = applied.canon; story.recovery = { passageId: passage.id, canon: baseline, valid: true, ...(loreLinks.length ? { loreLinks } : {}) };
  attachPassageMemory(story, passage.id, proposal.memory, applied.assigned);
  story.context.sceneBrief = emptyContext().sceneBrief;
  return validateStory(story);
}
