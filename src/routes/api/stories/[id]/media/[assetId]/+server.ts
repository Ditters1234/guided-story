import type { RequestHandler } from './$types';
import { getRepository } from '#lib/server/repository';
import { failure } from '#lib/server/http';
import { StoryError } from '#lib/errors';
export const GET: RequestHandler = async ({ params, url }) => {
  try {
    const repository = getRepository(), asset = repository.read(params.id).media.assets.find(a => a.id === params.assetId);
    if (!asset) throw new StoryError('Picture not found in this story.', 404);
    const result = await repository.mediaStore.file(asset, url.searchParams.get('size') === 'thumb');
    return new Response(new Uint8Array(result.bytes), { headers: { 'Content-Type': result.mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=3600', ...(url.searchParams.has('download') ? { 'Content-Disposition': `attachment; filename="story-image-${asset.id}.${asset.mime.split('/')[1]}"` } : {}) } });
  } catch (e) { return failure(e); }
};
