import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { getRepository, stateChanges } from '#lib/server/repository';
import { passageProposalSchema, preparePassageCommit } from '#lib/server/passage-commit';
import { beginTrace, endTrace } from '#lib/server/diagnostics';
import { failure, readJson } from '#lib/server/http';
import { StoryError } from '#lib/errors';
const schema = z.object({ storyId: z.string().min(1).max(100), expectedRevision: z.number().int().min(0), proposal: passageProposalSchema });
export const POST: RequestHandler = async ({ request }) => {
  try {
    const input = schema.parse(await readJson(request)), story = getRepository().read(input.storyId);
    if (story.revision !== input.expectedRevision) throw new StoryError('The story changed. Reload it before validating this proposal.', 409);
    const result = preparePassageCommit(story, input.proposal);
    const preview = { dryRun: true, sourceRevision: story.revision, passage: result.passage, changes: stateChanges(story.canon, result.story.canon), assignedIds: result.assigned, effects: result.effects };
    const trace = beginTrace('passage-validation', { note: 'Dry run; no story mutation', proposal: input.proposal }, story.id, story.revision);
    endTrace(trace, preview); return json(preview);
  } catch (e) { return failure(e); }
};
