import { json } from '@sveltejs/kit';
import { getRepository } from '#lib/server/repository';
import { failure, readBytes } from '#lib/server/http';

export async function POST({ request }: { request: Request }) {
  try { return json(await getRepository().import(await readBytes(request, 128_000_000)), { status: 201 }); } catch (e) { return failure(e); }
}
