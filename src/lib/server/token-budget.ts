/**
 * Conservative local estimate for mixed prose and JSON, not a model tokenizer.
 * ASCII words use short subword pieces; numbers, punctuation and non-ASCII text
 * receive larger allowances. Keep the configured overhead reserve as headroom.
 */
export function estimateTokens(text: string): number {
  let tokens = 0;
  for (const match of text.matchAll(/[A-Z]?[a-z]+|[A-Z]+(?![a-z])|[0-9]+|[ \t]+|\r\n|[^]/gu)) {
    const part = match[0];
    if (/^[A-Za-z]+$/.test(part)) tokens += Math.ceil(part.length / (/^[A-Z]{2,}$/.test(part) ? 2 : 3));
    else if (/^[0-9]+$/.test(part)) tokens += Math.ceil(part.length / 2);
    else if (/^[ \t]+$/.test(part)) tokens += Math.ceil(part.length / 4);
    else tokens += Buffer.byteLength(part, 'utf8');
  }
  return tokens;
}

export const estimateWireTextTokens = (text: string) => estimateTokens(JSON.stringify(text));

export function estimateInputTokens(messages: ReadonlyArray<{role:string;content:string}>, schema?: Record<string,unknown>): number {
  return estimateTokens(JSON.stringify(messages)) + (schema ? estimateTokens(JSON.stringify(schema)) : 0);
}

export function splitTextByTokens(text: string, budget: number): string[] {
  if (budget < 8) throw new Error('The text token budget is too small.');
  const characters = [...text], result: string[] = [];
  let start = 0;
  while (start < characters.length) {
    let low = start + 1, high = characters.length, end = start;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      if (estimateWireTextTokens(characters.slice(start, middle).join('')) <= budget) { end = middle; low = middle + 1; }
      else high = middle - 1;
    }
    if (end === start) throw new Error('A source character exceeds the text token budget.');
    result.push(characters.slice(start, end).join(''));
    start = end;
  }
  return result;
}

export function packTextsByTokens(texts: string[], budget: number): string[] {
  const result: string[] = [];
  let group = '';
  for (const text of texts) for (const piece of splitTextByTokens(text, budget)) {
    const combined = group ? group + '\n\n' + piece : piece;
    if (group && estimateWireTextTokens(combined) > budget) { result.push(group); group = piece; }
    else group = combined;
  }
  if (group) result.push(group);
  return result;
}

export function tailWithinTokens(text: string, budget: number): string {
  if (estimateWireTextTokens(text) <= budget) return text;
  const characters = [...text];
  let low = 0, high = characters.length, start = characters.length;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (estimateWireTextTokens(characters.slice(middle).join('')) <= budget) { start = middle; high = middle - 1; }
    else low = middle + 1;
  }
  return characters.slice(start).join('');
}
