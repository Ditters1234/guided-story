import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { getRepository, StoryError } from '#lib/server/repository';
import { generateContinuityMemory } from '#lib/server/continuity';
import { readPrivateConnections } from '#lib/server/connections';
import { failure, readJson } from '#lib/server/http';
import { runStoryJob } from '#lib/server/jobs';
const schema = z.object({ expectedRevision: z.number().int().min(0), requestId: z.string().uuid(), passageId: z.string().min(1).max(100) });
export const POST: RequestHandler = async ({ params, request }) => {
  try {
    const input = schema.parse(await readJson(request)), repository = getRepository();
    const replay = () => repository.generatedMemoryResult(params.id, input.requestId) || (() => { throw new StoryError('The job completed but its story commit is unavailable. Reload before retrying.', 409); })();
    return json(await runStoryJob({ kind: 'continuity-memory', storyId: params.id, requestId: input.requestId, expectedRevision: input.expectedRevision, targetId: input.passageId, lockKey: `story:${params.id}`, input }, AbortSignal.any([request.signal, AbortSignal.timeout(120000)]), async job => {
      const previous = repository.generatedMemoryResult(params.id, input.requestId);
      if (previous) { job.stage('validating'); job.stage('committing'); return previous; }
      const story = repository.read(params.id);
      if (story.revision !== input.expectedRevision) throw new StoryError('The story changed. Reload before generating memory.', 409);
      const memory = await generateContinuityMemory(story, input.passageId, readPrivateConnections().text, job.signal);
      job.stage('validating', { draft: memory }); job.stage('committing');
      return repository.commitGeneratedMemory(story.id, input.expectedRevision, input.requestId, memory);
    }, replay));
  } catch (e) { return failure(e); }
};
