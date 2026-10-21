import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { getRepository } from '#lib/server/repository';
import { failure, readJson } from '#lib/server/http';

export function GET() { try { return json(getRepository().list()); } catch (e) { return failure(e); } }
export async function POST({ request }: { request: Request }) {
  try { const input = z.object({ title: z.string().max(200).optional() }).parse(await readJson(request)); return json(getRepository().create(input.title), { status: 201 }); } catch (e) { return failure(e); }
}
