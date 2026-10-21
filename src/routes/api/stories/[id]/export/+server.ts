import type { RequestHandler } from './$types';
import { getRepository } from '#lib/server/repository';
import { failure } from '#lib/server/http';

export const GET: RequestHandler = ({ params }) => {
  try {
    const bytes = getRepository().export(params.id);
    return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="guided-story.zip"' } });
  } catch (e) { return failure(e); }
};
