import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { setupDesignRequestSchema } from '#lib/setup-generation';
import { getRepository } from '#lib/server/repository';
import { readPrivateConnections } from '#lib/server/connections';
import { generateSetupRecord } from '#lib/server/setup-generation';
import { runStoryJob, jobFingerprint } from '#lib/server/jobs';
import { readJson, failure } from '#lib/server/http';
import { StoryError } from '#lib/errors';

export const POST: RequestHandler = async ({ params, request }) => {
  try {
    const input = setupDesignRequestSchema.parse(await readJson(request)), repository = getRepository(), fingerprint = jobFingerprint(input);
    const replay = () => repository.generatedSetupResult(params.id, input.requestId, fingerprint) ?? (() => { throw new StoryError('No saved setup design is available. Reload the setup.', 409); })();
    return json(await runStoryJob({ kind: `setup-${input.kind}`, storyId: params.id, requestId: input.requestId, expectedRevision: input.expectedRevision, targetId: input.targetId, lockKey: `setup:${params.id}`, input }, request.signal, async job => {
      const prior = repository.generatedSetupResult(params.id, input.requestId, fingerprint);
      if (prior) { job.stage('validating'); job.stage('committing'); return prior; }
      const draft = repository.readSetup(params.id);
      if (draft.storyId || draft.revision !== input.expectedRevision) throw new StoryError('The setup changed or was already written. Reload it before designing its records.', 409);
      const { expectedRevision: _expectedRevision, requestId: _requestId, ...design } = input;
      const plan = await generateSetupRecord(draft, design, readPrivateConnections(), job.signal);
      job.stage('validating', { plan }); job.stage('committing');
      return repository.commitGeneratedSetup(params.id, input.expectedRevision, input.requestId, fingerprint, plan);
    }, replay));
  } catch (error) { return failure(error); }
};
