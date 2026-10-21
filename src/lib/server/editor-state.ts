import type { Story, Passage } from '../story';
import { StoryError } from '../errors';
import { polishDraftSchema } from '../editor';
const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
function spoken(text: string) { return text.match(/“[^”]*”|"[^"]*"|‘[^’]*’/gu) || []; }
function numbers(text: string) { return text.match(/\b\d+(?:[.,]\d+)*\b/gu) || []; }
export function protectedWording(story: Story, passage: Passage) {
  const text = passage.paragraphs.join('\n\n');
  return { dialogue: spoken(text), numbers: numbers(text), evidence: [...new Set(passage.generation?.effects.map(e => e.evidence) || [])],
    names: [...new Set([...story.canon.characters,...story.canon.places,...story.canon.items].map(e => e.name).filter(name => text.includes(name)))] };
}
export function validateWording(story: Story, passage: Passage, value: unknown) {
  const result = polishDraftSchema.parse(value), before = passage.paragraphs.join('\n\n'), after = result.paragraphs.join('\n\n'), protectedText = protectedWording(story,passage);
  if (after.length > 40000) throw new StoryError('The polished passage is too large. Nothing was applied.',502);
  if (JSON.stringify(spoken(before)) !== JSON.stringify(spoken(after))) throw new StoryError('Polish changed quoted dialogue. Wording polish keeps spoken lines verbatim; use latest-passage revision for event or dialogue changes.',502);
  if (JSON.stringify(numbers(before)) !== JSON.stringify(numbers(after))) throw new StoryError('Polish changed a written number. Nothing was applied.',502);
  if (protectedText.evidence.some(quote => !normalize(after).includes(normalize(quote)))) throw new StoryError('Polish changed a source quote supporting an established event. Nothing was applied.',502);
  if (protectedText.names.some(name => !after.includes(name))) throw new StoryError('Polish removed an established entity name. Nothing was applied.',502);
  return result;
}
