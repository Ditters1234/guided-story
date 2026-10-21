import type { Passage } from './story';

// Approximate prose counts; paragraph breaks and standalone punctuation aren't words.
export function countWords(paragraphs: readonly string[]): number {
  return paragraphs.reduce((sum, text) => sum + (text.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu)?.length ?? 0), 0);
}

export function chapterStats(passages: readonly Passage[], chapter: number) {
  const rows = passages.filter(p => p.chapter === chapter);
  return { words: rows.reduce((sum, p) => sum + countWords(p.paragraphs), 0), passages: rows.length, complete: rows.at(-1)?.endOfChapter ?? false };
}
