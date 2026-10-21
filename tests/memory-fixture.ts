import { createSample } from '../src/lib/server/fixture';
import { emptyContext } from '../src/lib/context-types';
import { memorySourceHash } from '../src/lib/server/context-state';
import { validateStory } from '../src/lib/story';
export function longStory(chapters = 5, repeat = 25) {
  const story = createSample(), base = story.passages[0]; story.context = emptyContext();
  story.passages = [];
  story.canon.items.find(i => i.id === 'fob')!.ownerId = 'mira';
  for (let chapter = 1; chapter <= chapters; chapter++) for (let n = 1; n <= 2; n++) {
    const first = chapter === 1 && n === 1;
    const event = 'Elias handed the access fob to Mira beside the cobalt ledger.';
    const p = { ...structuredClone(base), id: `p-${chapter}-${n}`, chapter, chapterTitle: `Chapter ${chapter}`, title: `Stop ${chapter}.${n}`,
      direction: 'UNWRITTEN FUTURE: the captain will betray the crew.',
      paragraphs: [first ? event : `Elias and Mira examined the navigation readings during stop ${chapter}.${n}.`, ('The bridge hummed as they checked the instrument readings and compared the recorded course with the route ahead. ').repeat(repeat)],
      endOfChapter: n === 2 && chapter < chapters,
      generation: { sourceRevision: 0, assignedIds: {}, effects: first ? [{ type: 'item.transfer' as const, itemId: 'fob', fromOwnerId: 'elias', toOwnerId: 'mira', evidence: event }] : [] } };
    story.passages.push(p);
    story.context.memories.push({ id: `memory-${p.id}`, passageIds: [p.id], summary: `The crew completed stop ${chapter}.${n}.`, facts: first ? [event] : [], openQuestions: first ? ['What does the cobalt ledger unlock?'] : [],
      characterIds: ['elias','mira'], locationIds: ['bridge'], sourceHash: memorySourceHash(story,[p.id]), source: 'generated', createdAt: p.createdAt });
  }
  story.recovery = { passageId: story.passages.at(-1)!.id, canon: structuredClone(story.canon), valid: true };
  story.context.lore.push({ id: 'secret', title: 'Private plan', text: 'HIDDEN REVEAL: the station is a dragon.', keywords: [], relatedIds: [], visibility: 'hidden' });
  story.context.knowledge.push({ id: 'secret-knowledge', fact: 'SECRET KNOWLEDGE: Ren will betray everyone.', truth: 'possibility', knownBy: ['ren'], readerRevealed: false, sourcePassageId: null, sourceHash: null });
  return validateStory(story);
}
