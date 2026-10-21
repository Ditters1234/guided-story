import { json } from '@sveltejs/kit';
import { getRepository } from '#lib/server/repository';
import { MAX_SETUP_ARCHIVE_BYTES } from '#lib/server/setup-archive';
import { failure, readBytes } from '#lib/server/http';

export async function POST({ request }: { request: Request }) {
  try { return json(getRepository().importSetup(await readBytes(request, MAX_SETUP_ARCHIVE_BYTES)), { status: 201 }); }
  catch (error) { return failure(error); }
}
