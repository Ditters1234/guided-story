import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { generationRequestSchema, characterRedesignModeSchema } from '#lib/setup';
import { getRepository } from '#lib/server/repository';
import { readPrivateConnections } from '#lib/server/connections';
import { generateSetupCharacter } from '#lib/server/story-generation';
import { runStoryJob, jobFingerprint } from '#lib/server/jobs';
import { readJson, failure } from '#lib/server/http';
import { StoryError } from '#lib/errors';
const schema = generationRequestSchema.extend({ characterId:z.string().min(1).max(100),direction:z.string().max(2000),allowAppearanceChanges:z.boolean().default(false),mode:characterRedesignModeSchema.default('revise') });
export const POST: RequestHandler = async ({ params,request }) => {
  try {
    const input = schema.parse(await readJson(request)),r = getRepository(),fingerprint = jobFingerprint(input);
    const replay = () => r.generatedSetupResult(params.id,input.requestId,fingerprint) || (() => { throw new StoryError('No saved character design is available. Reload the setup.',409); })();
    return json(await runStoryJob({ kind:'setup-character',storyId:params.id,requestId:input.requestId,expectedRevision:input.expectedRevision,targetId:input.characterId,lockKey:`setup:${params.id}`,input },request.signal,async job => {
      const prior = r.generatedSetupResult(params.id,input.requestId,fingerprint);if(prior){job.stage('validating');job.stage('committing');return prior;}
      const draft = r.readSetup(params.id);if(draft.storyId || draft.revision !== input.expectedRevision)throw new StoryError('The setup changed. Reload it before redesigning a cast member.',409);
      const plan = await generateSetupCharacter(draft,input.characterId,input.direction,readPrivateConnections(),job.signal,fetch,{allowAppearanceChanges:input.allowAppearanceChanges,mode:input.mode});
      job.stage('validating',{plan});job.stage('committing');return r.commitGeneratedSetup(params.id,input.expectedRevision,input.requestId,fingerprint,plan);
    },replay));
  } catch(e){return failure(e);}
};
