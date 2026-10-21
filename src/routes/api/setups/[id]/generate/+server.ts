import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { generationRequestSchema } from '#lib/setup';
import { getRepository } from '#lib/server/repository';
import { readPrivateConnections } from '#lib/server/connections';
import { generateSetup } from '#lib/server/story-generation';
import { runStoryJob, jobFingerprint } from '#lib/server/jobs';
import { readJson, failure } from '#lib/server/http';
import { StoryError } from '#lib/errors';
export const POST: RequestHandler = async ({ params, request }) => {
  try {
    const input = generationRequestSchema.parse(await readJson(request)), r = getRepository(), fingerprint = jobFingerprint(input);
    const replay = () => r.generatedSetupResult(params.id, input.requestId, fingerprint) || (() => { throw new StoryError('No committed setup result is available. Reload the draft.', 409); })();
    return json(await runStoryJob({ kind: 'story-setup', storyId: params.id, requestId: input.requestId, expectedRevision: input.expectedRevision, lockKey: `setup:${params.id}`, input }, request.signal, async job => {
      const prior = r.generatedSetupResult(params.id, input.requestId, fingerprint); if (prior) { job.stage('validating'); job.stage('committing'); return prior; }
      const draft = r.readSetup(params.id);
      if (draft.storyId || draft.revision !== input.expectedRevision) throw new StoryError('This setup was changed or already written. Reload it before generating.', 409);
      const plan = await generateSetup(draft, readPrivateConnections(), job.signal);
      job.stage('validating', { plan }); job.stage('committing');
      return r.commitGeneratedSetup(params.id, input.expectedRevision, input.requestId, fingerprint, plan);
    }, replay));
  } catch (e) { return failure(e); }
};
