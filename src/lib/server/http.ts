import { json } from '@sveltejs/kit';
import { ZodError } from 'zod';
import { StoryError } from './repository';

export async function readBytes(request: Pick<Request, 'headers' | 'body'>, limit = 8_000_000): Promise<Uint8Array> {
  if (Number(request.headers.get('content-length') || 0) > limit) throw new StoryError('Request is too large.', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new StoryError('Request body is missing.');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > limit) throw new StoryError('Request is too large.', 413); chunks.push(value); }
  } finally { await reader.cancel(); }
  const result = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}
export async function readJson(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new StoryError('Expected a JSON request.', 415);
  return JSON.parse(new TextDecoder().decode(await readBytes(request, 1_000_000)));
}
export function failure(error: unknown) {
  if (error instanceof StoryError) return json({ error: error.message }, { status: error.status });
  if (error instanceof ZodError) return json({ error: 'Check these fields: ' + error.issues.slice(0, 3).map(i => `${i.path.join('.') || 'data'}: ${i.message}`).join('; ') }, { status: 400 });
  if (error instanceof SyntaxError) return json({ error: 'Invalid JSON. Check the entered data or imported file.' }, { status: 400 });
  console.error('Local story operation failed:', error instanceof Error ? error.name : 'Unknown error');
  return json({ error: 'The local operation failed. Your last completed save has been kept. Check the server window and retry.' }, { status: 500 });
}
