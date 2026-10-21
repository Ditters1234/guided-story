import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { type Story, passageSchema, validateStory, pruneSceneBriefResources } from '../story';
import { applyStoryEffects, effectsSchema } from '../story-effects';
import { StoryError } from '../errors';
import { passageImageHash } from './media-store';
import { memorySourceHash } from './context-state';
import { emptyContext, sceneBriefSchema } from '../context-types';
import { assertFactPinsUnchanged } from '../fact-pins';
import { rememberPassageViewpoints } from '../entity-scope';
import { pruneRemovedLoreItemLinks, restoreLoreItemLinks } from './lore-references';
import { passageMemorySchema, passageProposalSchema } from '../passage-proposal';
export { passageMemorySchema, passageProposalSchema } from '../passage-proposal';
export function attachPassageMemory(story: Story, passageId: string, memory: z.infer<typeof passageMemorySchema> | undefined, assigned: Record<string,string>) {
  if (!memory) return;
  const hash = memorySourceHash(story, [passageId]), resolveId = (id: string) => assigned[id] || id;
  story.context.memories = story.context.memories.filter(m => !(m.source === 'generated' && m.passageIds.includes(passageId)));
  story.context.memories.push({ ...memory, characterIds: [...new Set(memory.characterIds.map(resolveId))], locationIds: [...new Set(memory.locationIds.map(resolveId))], id: `auto-${passageId}-${hash.slice(0,12)}`.slice(0,100), passageIds: [passageId], sourceHash: hash, source: 'generated', createdAt: new Date().toISOString() });
}
export const passageCommitSchema = z.strictObject({ expectedRevision: z.number().int().min(0), requestId: z.string().uuid(), proposal: passageProposalSchema });
export type PassageCommit = z.infer<typeof passageCommitSchema>;
export function preparePassageCommit(current: Story, value: unknown, allocateId: () => string = randomUUID, requestId?: string) {
  const proposal = passageProposalSchema.parse(value), story = structuredClone(current), latest = story.passages.at(-1)!;
  if(proposal.effects.some(e=>e.type==='character.update'&&e.name!==undefined&&story.canon.characters.find(c=>c.id===e.characterId)?.name!==e.name))rememberPassageViewpoints(story);
  const replacing = proposal.mode === 'replace';
  if (replacing && proposal.passageId !== latest.id) throw new StoryError('Only the latest passage can change its events.', 409);
  if (!replacing && proposal.passageId) throw new StoryError('A continuation cannot target an older passage.');
  if (replacing && !story.recovery?.valid) throw new StoryError('The recovery baseline was changed by a manual world edit. Continue forward instead.', 409);
  if (!replacing && proposal.draft.startsChapter !== latest.endOfChapter) throw new StoryError(latest.endOfChapter ? 'The next passage must begin a new chapter.' : 'Finish the current chapter before beginning another.');
  const chapter = replacing ? latest.chapter : latest.chapter + Number(proposal.draft.startsChapter);
  const chapterTitle = !replacing && proposal.draft.startsChapter ? proposal.draft.chapterTitle : latest.chapterTitle;
  if (!chapterTitle) throw new StoryError('A new chapter needs a title.');
  if ((replacing || !proposal.draft.startsChapter) && proposal.draft.chapterTitle && proposal.draft.chapterTitle !== latest.chapterTitle) throw new StoryError('Generation cannot rename an earlier chapter. Use the title editor.');
  const baseline = structuredClone(replacing ? story.recovery!.canon : story.canon);
  if (replacing) restoreLoreItemLinks(story.context.lore, story.recovery!.loreLinks, baseline);
  const applied = applyStoryEffects(baseline, proposal.effects, proposal.draft.paragraphs.join('\n\n'), allocateId);
  // Pins belong to the author's current notebook, not the recovery snapshot.
  // A latest-passage replacement must satisfy today's constraints as a whole.
  assertFactPinsUnchanged(current, applied.canon);
  const viewpointId = applied.assigned[proposal.draft.viewpointId] || proposal.draft.viewpointId;
  const viewpoint = applied.canon.characters.find(c => c.id === viewpointId);
  if (!viewpoint) throw new StoryError('The proposed viewpoint does not identify a cast member.');
  const id = replacing ? latest.id : allocateId();
  if (!replacing && story.passages.some(p => p.id === id)) throw new StoryError('The new passage ID collided with written history.');
  const passage = passageSchema.parse({ id, title: proposal.draft.title, chapter, chapterTitle, viewpoint: viewpoint.name, viewpointId:viewpoint.id, direction: proposal.direction, endOfChapter: proposal.draft.endOfChapter, paragraphs: proposal.draft.paragraphs, createdAt: replacing ? latest.createdAt : new Date().toISOString(), generation: { sourceRevision: current.revision, requestId, effects: applied.effects, assignedIds: applied.assigned } });
  const loreLinks = pruneRemovedLoreItemLinks(story.context.lore, [baseline, current.canon], applied.canon);
  story.canon = applied.canon; story.recovery = { passageId: id, canon: baseline, valid: true, ...(loreLinks.length ? { loreLinks } : {}) };
  if (replacing) {
    story.passages[story.passages.length - 1] = passage;
    for (const a of story.media.assets) if (a.source?.passageId === latest.id && a.source.hash !== passageImageHash(passage)) a.status = 'superseded';
    for (const selections of [story.media.portraits, story.media.references]) for (const person of Object.keys(selections)) if (!story.canon.characters.some(c => c.id === person)) delete selections[person];
  } else story.passages.push(passage);
  attachPassageMemory(story, passage.id, proposal.memory, applied.assigned);
  // A one-passage plan describes the next accepted continuation. Rewriting an
  // existing passage does not consume it; failed proposals never reach storage.
  if (!replacing && sceneBriefSchema.parse(story.context.sceneBrief).scope === 'next-passage') story.context.sceneBrief = emptyContext().sceneBrief;
  else pruneSceneBriefResources(story);
  try { validateStory(story); } catch { throw new StoryError('The proposal would leave invalid story or context references. Correct the proposal/context or continue forward; nothing was committed.'); }
  return { story, passage, assigned: applied.assigned, effects: applied.effects };
}
