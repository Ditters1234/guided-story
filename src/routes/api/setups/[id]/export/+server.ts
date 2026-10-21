import type { RequestHandler } from './$types';
import { getRepository } from '#lib/server/repository';
import { failure } from '#lib/server/http';
import { StoryError } from '#lib/errors';

export const GET: RequestHandler = ({ params, url }) => {
  try {
    const revisions = url.searchParams.getAll('expectedRevision');
    const rawRevision = revisions[0];
    if (revisions.length > 1 || (rawRevision !== undefined && (!/^(0|[1-9]\d*)$/.test(rawRevision) || !Number.isSafeInteger(Number(rawRevision))))) throw new StoryError('Expected revision must be one nonnegative integer.');
    const bytes = getRepository().exportSetup(params.id, rawRevision === undefined ? undefined : Number(rawRevision));
    return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="storyweaver-setup.zip"', 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error); }
};
