import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { generationRequestSchema } from '#lib/setup';
import { getRepository } from '#lib/server/repository';
import { readPrivateConnections } from '#lib/server/connections';
import { generateRetainedPassage } from '#lib/server/passage-recovery';
import { runStoryJob, getJobs, jobFingerprint } from '#lib/server/jobs';
import { readJson, failure } from '#lib/server/http';
import { StoryError } from '#lib/errors';
import { chapterEndingSchema } from '#lib/settings';
import { maintainMemoryAfterPassage } from '#lib/server/memory-compaction';
const schema = generationRequestSchema.extend({ mode: z.enum(['continue','replace']), direction: z.string().max(10000), chapterEnding: chapterEndingSchema.default('auto') });
export const POST: RequestHandler = async ({ params, request }) => {
  try {
    const input = schema.parse(await readJson(request)), r = getRepository(), fingerprint = jobFingerprint(input);
    const replay = () => r.generatedPassageResult(params.id, input.requestId, fingerprint) || (() => { throw new StoryError('No committed passage result is available. Reload the story.', 409); })();
    const saved = await runStoryJob({ kind: input.mode === 'replace' ? 'story-replacement' : 'story-narration', storyId: params.id, requestId: input.requestId, expectedRevision: input.expectedRevision, lockKey: `story:${params.id}`, input }, request.signal, async job => {
      const prior = r.generatedPassageResult(params.id, input.requestId, fingerprint); if (prior) { job.stage('validating'); job.stage('committing'); return prior; }
      const story = r.read(params.id);
      if (story.revision !== input.expectedRevision) throw new StoryError('The story changed. Reload before generating the next passage.', 409);
      return generateRetainedPassage({repository:r,kind:'story',id:params.id,requestId:input.requestId,fingerprint},{ story, mode: input.mode, direction: input.direction, chapterEnding: input.chapterEnding }, readPrivateConnections(), job.signal, draft => getJobs().transition(job.id, 'generating', { details: { draft } }),proposal=>{
        job.stage('validating', { proposal }); job.stage('committing');
        return r.commitGeneratedPassage(params.id, { expectedRevision: input.expectedRevision, requestId: input.requestId, proposal }, fingerprint);
      });
    }, replay);
    return json(await maintainMemoryAfterPassage(saved, request.signal, input.requestId));
  } catch (e) { return failure(e); }
};
