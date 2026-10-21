import { createHash } from 'node:crypto';
import { memoryConfidence } from '../narrative-quality';
import type { Story } from '../story';
import type { ContextMemory, CompactMemory } from '../context-types';
export function memorySourceHash(story: Pick<Story, 'passages'>, passageIds: string[]) {
  return createHash('sha256').update(JSON.stringify(passageIds.map(id => {
    const p = story.passages.find(p => p.id === id);
    return p ? { id: p.id, paragraphs: p.paragraphs } : { missing: id };
  }))).digest('hex');
}
export function memoryCurrent(story: Story, memory: ContextMemory) { return memory.sourceHash === memorySourceHash(story, memory.passageIds); }

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function completedChapters(story: Story) {
  const endings = new Map(story.passages.map(p => [p.chapter, p.endOfChapter]));
  return [...endings].filter(([chapter, ended]) => ended || chapter < story.passages.at(-1)!.chapter).map(([chapter]) => chapter);
}
// Advancing canon does not expire historical summaries. Explicit user corrections do.
// Reader recaps, style preferences, media and planning notes never enter these hashes.
export function chapterMemoryHash(story: Story, chapter: number) {
  const passages = story.passages.filter(p => p.chapter === chapter);
  const ids = new Set(passages.map(p => p.id));
  return hash({ version: 2, confidenceContract:memoryConfidence, epoch: story.context.compaction.epoch, chapter,
    passages: passages.map(p => ({ id: p.id, paragraphs: p.paragraphs, endOfChapter: p.endOfChapter, effects: p.generation?.effects, assignedIds: p.generation?.assignedIds })),
    memories: story.context.memories.filter(m => m.passageIds.every(id => ids.has(id)) && memoryCurrent(story, m)).map(m => ({ id: m.id, summary: m.summary, facts: m.facts, openQuestions: m.openQuestions, passageIds: m.passageIds, characterIds: m.characterIds, locationIds: m.locationIds })) });
}
export function chapterMemoryCurrent(story: Story, memory: CompactMemory) {
  const chapter = memory.chapter;
  const passages = story.passages.filter(p => p.chapter === chapter);
  const complete = !!passages.length && (passages.at(-1)!.endOfChapter || chapter! < story.passages.at(-1)!.chapter);
  return memory.level === 'chapter' && chapter !== null && complete &&
    JSON.stringify(memory.chapterNumbers) === JSON.stringify([chapter]) &&
    JSON.stringify(memory.passageIds) === JSON.stringify(passages.map(p => p.id)) && memory.sourceHash === chapterMemoryHash(story, chapter);
}
export function bookMemoryHash(story: Story, chapterNumbers: number[]) {
  return hash({ version: 1, epoch: story.context.compaction.epoch, chapters: chapterNumbers.map(chapter => {
    const m = story.context.compaction.chapters.find(m => m.chapter === chapter);
    return { chapter, current: !!m && chapterMemoryCurrent(story, m), memory: m ? { sourceHash: m.sourceHash, summary: m.summary, facts: m.facts, openQuestions: m.openQuestions, passageIds: m.passageIds } : null };
  }) });
}
export function bookMemoryCurrent(story: Story, memory = story.context.compaction.book) {
  if (!memory || memory.level !== 'book' || memory.chapter !== null) return false;
  const prefix = completedChapters(story).slice(0, memory.chapterNumbers.length);
  return JSON.stringify(prefix) === JSON.stringify(memory.chapterNumbers) &&
    JSON.stringify(memory.passageIds) === JSON.stringify(story.passages.filter(p => prefix.includes(p.chapter)).map(p => p.id)) &&
    prefix.every(n => story.context.compaction.chapters.some(m => m.chapter === n && chapterMemoryCurrent(story, m))) && memory.sourceHash === bookMemoryHash(story, prefix);
}
export function compactionPlan(story: Story, recentChapters = 2) {
  const complete = completedChapters(story);
  const chapters = [...new Set(story.passages.map(p => p.chapter))].map(chapter => {
    const m = story.context.compaction.chapters.find(m => m.chapter === chapter);
    return { chapter, title: story.passages.find(p => p.chapter === chapter)!.chapterTitle, passageIds: story.passages.filter(p => p.chapter === chapter).map(p => p.id),
      status: !complete.includes(chapter) ? 'open' as const : !m ? 'missing' as const : chapterMemoryCurrent(story, m) ? 'current' as const : 'stale' as const };
  });
  const older = complete.slice(0, Math.max(0, complete.length - recentChapters));
  // Wait until there are at least two older chapters to justify another compression layer.
  const targetBookChapters = older.length >= 2 ? older : [];
  const book = story.context.compaction.book;
  const bookCurrent = bookMemoryCurrent(story);
  const bookNeedsUpdate = targetBookChapters.length > 0 && (!bookCurrent || JSON.stringify(book!.chapterNumbers) !== JSON.stringify(targetBookChapters));
  return { epoch: story.context.compaction.epoch, chapters, targetBookChapters,
    book: { status: !book ? 'missing' as const : bookCurrent ? 'current' as const : 'stale' as const, chapterNumbers: book?.chapterNumbers || [], needsUpdate: bookNeedsUpdate },
    pending: chapters.filter(c => c.status === 'missing' || c.status === 'stale').length + Number(bookNeedsUpdate) };
}
