import { scenePreparationRequestSchema, scenePreparationApplySchema, type ScenePreparationRequest, type ScenePreparationApply } from '../scene-preparation';
import { StoryError } from '../errors';
import { getRepository } from './repository';
import { readPrivateConnections } from './connections';
import { generateScenePreparation } from './scene-preparation';
import { jobFingerprint, runStoryJob } from './jobs';

type Target = 'story' | 'setup';
export async function runScenePreparation(kind: Target, id: string, value: ScenePreparationRequest, signal: AbortSignal) {
  const input = scenePreparationRequestSchema.parse(value), repository = getRepository(), fingerprint = jobFingerprint(input);
  const replay = () => repository.scenePreparationResult(kind, id, input.requestId, fingerprint) ?? (() => { throw new StoryError('This scene preparation preview is unavailable. Request a new preview.', 409); })();
  return runStoryJob({ kind: `${kind}-scene-preparation`, storyId: id, requestId: input.requestId, expectedRevision: input.expectedRevision, lockKey: `${kind}:${id}`, input }, signal, async job => {
    const prior = repository.scenePreparationResult(kind, id, input.requestId, fingerprint);
    if (prior) { job.stage('validating'); job.stage('committing'); return prior; }
    const source = repository.readPreparationSource(kind, id);
    if (source.revision !== input.expectedRevision) throw new StoryError('The saved source changed. Reload it before preparing a scene.', 409);
    const proposal = await generateScenePreparation(source, input, readPrivateConnections(), job.signal);
    job.stage('validating'); job.stage('committing');
    return repository.saveScenePreparation(kind, id, input.expectedRevision, input.requestId, fingerprint, proposal);
  }, replay);
}

export async function applyScenePreparationResult(kind: Target, id: string, value: ScenePreparationApply, signal: AbortSignal) {
  const input = scenePreparationApplySchema.parse(value), repository = getRepository();
  const apply = () => repository.applyScenePreparation(kind, id, input);
  return runStoryJob({ kind: `${kind}-scene-preparation-apply`, storyId: id, requestId: input.requestId, expectedRevision: input.expectedRevision, targetId: input.resultId, lockKey: `${kind}:${id}`, input }, signal, async job => {
    job.stage('validating'); job.stage('committing'); return apply();
  }, apply);
}
