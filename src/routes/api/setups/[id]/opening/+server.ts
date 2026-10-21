import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { generationRequestSchema } from '#lib/setup';
import { getRepository } from '#lib/server/repository';
import { readPrivateConnections } from '#lib/server/connections';
import { generateRetainedPassage } from '#lib/server/passage-recovery';
import { runStoryJob, getJobs, jobFingerprint } from '#lib/server/jobs';
import { readJson, failure } from '#lib/server/http';
import { StoryError } from '#lib/errors';
import { maintainMemoryAfterPassage } from '#lib/server/memory-compaction';
export const POST: RequestHandler = async ({ params, request }) => {
  try {
    const input = generationRequestSchema.parse(await readJson(request)), r = getRepository(), fingerprint = jobFingerprint(input);
    const replay = () => r.openingResult(params.id, input.requestId, fingerprint) || (() => { throw new StoryError('No opening commit is available. Reload the setup or library.', 409); })();
    const saved = await runStoryJob({ kind: 'story-opening', storyId: params.id, requestId: input.requestId, expectedRevision: input.expectedRevision, lockKey: `setup:${params.id}`, input }, request.signal, async job => {
      const prior = r.openingResult(params.id, input.requestId, fingerprint); if (prior) { job.stage('validating'); job.stage('committing'); return prior; }
      const draft = r.readSetup(params.id);
      if (draft.storyId || draft.revision !== input.expectedRevision) throw new StoryError('This setup was changed or already written. Reload it before writing chapter one.', 409);
      return generateRetainedPassage({repository:r,kind:'setup',id:params.id,requestId:input.requestId,fingerprint},{ setup: draft }, readPrivateConnections(), job.signal, draft => getJobs().transition(job.id, 'generating', { details: { draft } }),proposal=>{
        job.stage('validating', { proposal }); job.stage('committing');
        return r.commitOpening(params.id, input.expectedRevision, input.requestId, fingerprint, proposal);
      });
    }, replay);
    return json(await maintainMemoryAfterPassage(saved, request.signal, input.requestId));
  } catch (e) { return failure(e); }
};
