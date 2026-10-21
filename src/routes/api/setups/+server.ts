import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { getRepository } from '#lib/server/repository';
import { setupInputSchema } from '#lib/setup';
import { readJson, failure } from '#lib/server/http';
export function GET() { try { return json(getRepository().listSetups()); } catch (e) { return failure(e); } }
export async function POST({ request }: { request: Request }) {
  try { const input = z.object({ requestId: z.string().uuid(), input: setupInputSchema }).parse(await readJson(request)); return json(getRepository().createSetup(input.input, input.requestId), { status: 201 }); } catch (e) { return failure(e); }
}
