import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { getRepository, StoryError } from '#lib/server/repository';
import { generateRecap } from '#lib/server/recap';
import { readPrivateConnections } from '#lib/server/connections';
import { failure, readJson } from '#lib/server/http';
import { runStoryJob } from '#lib/server/jobs';

const inputSchema = z.object({ expectedRevision: z.number().int().min(0), requestId: z.string().uuid() });
export const POST: RequestHandler = async ({ request, params }) => {
  try {
    const input = inputSchema.parse(await readJson(request));
    const repository = getRepository();
    const replay = () => repository.generatedRecapResult(params.id, input.requestId) || (() => { throw new StoryError('The job completed but its story commit is unavailable. Reload before retrying.', 409); })();
    return json(await runStoryJob({ kind: 'recap', storyId: params.id, requestId: input.requestId, expectedRevision: input.expectedRevision, lockKey: `story:${params.id}`, input }, AbortSignal.any([request.signal, AbortSignal.timeout(180000)]), async job => {
      const previous = repository.generatedRecapResult(params.id, input.requestId);
      if (previous) { job.stage('validating'); job.stage('committing'); return previous; }
      const story = repository.read(params.id);
      if (story.revision !== input.expectedRevision) throw new StoryError('The story changed. Reload before generating a recap.', 409);
      const output = await generateRecap(story, readPrivateConnections().text, job.signal);
      job.stage('validating', { draft: { recap: output.recap } }); job.stage('committing');
      return repository.commitGeneratedRecap(params.id, { ...input, ...output });
    }, replay));
  } catch (e) { return failure(e); }
};
