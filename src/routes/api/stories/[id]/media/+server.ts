import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { getRepository, mediaInputSchema } from '#lib/server/repository';
import { readBytes, readJson, failure } from '#lib/server/http';
import { completedImageForStory } from '#lib/server/image-tests';
import { StoryError } from '#lib/errors';

export const POST: RequestHandler = async ({ params, request }) => {
  try {
    const repository = getRepository();
    if (request.headers.get('content-type')?.startsWith('application/json')) {
      const value = z.object({ metadata: mediaInputSchema, jobId: z.string().uuid(), index: z.number().int().min(0).max(3) }).parse(await readJson(request));
      const image = completedImageForStory(value.jobId, value.index);
      return json(await repository.addMedia(params.id, image.bytes, value.metadata, image.provenance), { status: 201 });
    }
    if (!request.headers.get('content-type')?.startsWith('multipart/form-data;')) throw new StoryError('Expected an image upload.', 415);
    const bytes = await readBytes(request, 21_000_000);
    const form = await new Response(new Uint8Array(bytes), { headers: { 'Content-Type': request.headers.get('content-type')! } }).formData();
    const file = form.get('image'), metadata = form.get('metadata');
    if (!(file instanceof File) || typeof metadata !== 'string') throw new StoryError('Choose an image and its story details.');
    return json(await repository.addMedia(params.id, new Uint8Array(await file.arrayBuffer()), mediaInputSchema.parse(JSON.parse(metadata))), { status: 201 });
  } catch (e) { return failure(e); }
};
