import { createHash } from 'node:crypto';
import type { Story } from '../story';

export function recapSourceHash(story: Story): string {
  return createHash('sha256').update(JSON.stringify({
    canon: story.canon,
    passages: story.passages.map(p => ({ id: p.id, chapter: p.chapter, chapterTitle: p.chapterTitle, title: p.title, paragraphs: p.paragraphs }))
  })).digest('hex');
}
export function refreshRecapStatus(story: Story): Story {
  if (story.recap) story.recap.stale = story.recap.sourceHash !== recapSourceHash(story);
  return story;
}
