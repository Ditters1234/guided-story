// Adapted from Corvus Story Core's thinkStripper.ts (MIT, Sebastian 2026).
// See THIRD_PARTY_NOTICES.md. Unlike upstream, never recover reasoning as an answer.
import { z } from 'zod';
import { StoryError } from '../errors';

export function stripReasoningTags(text: string): string {
  const tags = /<(\/?)\s*(think|reasoning|thought)\b[^>]*>/gi;
  const stack: string[] = []; let result = '', offset = 0;
  for (const match of text.matchAll(tags)) {
    if (!stack.length) result += text.slice(offset, match.index);
    const name = match[2].toLowerCase();
    if (!match[1]) stack.push(name);
    else if (stack.length) {
      if (stack.at(-1) !== name) throw new StoryError('The model returned malformed reasoning tags. No result was accepted.', 502);
      stack.pop();
    }
    offset = match.index! + match[0].length;
  }
  if (!stack.length) result += text.slice(offset);
  // An opening tag with an unfinished attribute list is not visible answer text.
  result = result.replace(/<(?:think|reasoning|thought)\b[^>]*$/i, '');
  return result.trim();
}

export function parseModelObject<T>(raw: string, schema: z.ZodType<T>, label: string): T {
  const text = stripReasoningTags(raw).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  if (!text || text.length > 120000) throw new StoryError(`The model returned no usable ${label}. Nothing was saved.`, 502);
  let start = -1, end = -1, depth = 0, inString = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') inString = false; continue; }
    if (depth && c === '"') { inString = true; continue; }
    if (c === '{') { if (!depth) { if (end !== -1) throw new StoryError(`The model returned multiple ${label} objects. Nothing was saved.`, 502); start = i; } depth++; }
    if (c === '}') { if (!depth) throw new StoryError(`The model returned malformed ${label} JSON. Nothing was saved.`, 502); if (--depth === 0) end = i; }
  }
  if (start < 0 || end < start || depth || inString) throw new StoryError(`The model returned incomplete ${label} JSON. Nothing was saved.`, 502);
  // Do not silently unwrap arrays of objects or accept two answers in one response.
  if (/[[\]]/.test(text.slice(0, start) + text.slice(end + 1))) throw new StoryError(`The model returned an ambiguous ${label} response. Nothing was saved.`, 502);
  try { return schema.parse(JSON.parse(text.slice(start, end + 1))); }
  catch (e) { if (e instanceof StoryError) throw e; const fields = e instanceof z.ZodError ? ' (' + e.issues.slice(0,3).map(i => `${i.path.join('.') || 'result'}: ${i.message}`).join('; ') + ')' : ''; throw new StoryError(`The model returned invalid ${label}${fields}. Nothing was saved; inspect Dev → Requests.`, 502); }
}
