import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { getRepository } from '#lib/server/repository';
import { recoverPassageWorkflowDraft } from '#lib/server/story-workflow/passage';
import { runIdSchema } from '#lib/server/story-workflow/inspection';
import { StoryError } from '#lib/errors';
import { readJson, failure } from '#lib/server/http';
const schema=z.strictObject({expectedVersion:z.string().regex(/^[a-f0-9]{64}$/),expectedRevision:z.number().int().min(0),requestId:z.string().uuid()});
export const POST:RequestHandler=async({params,request})=>{try{
  const id=runIdSchema.parse(params.runId),input=schema.parse(await readJson(request)),r=getRepository(),run=r.workflows.read(id);
  if(r.workflows.inspectionVersion(id)!==input.expectedVersion)throw new StoryError('This run changed. Reload before recovering its prose.',409);
  return json(await recoverPassageWorkflowDraft(r,run.source.kind,run.source.id,run.requestId,{requestId:input.requestId,expectedRevision:input.expectedRevision},request.signal));
}catch(error){return failure(error);}};
