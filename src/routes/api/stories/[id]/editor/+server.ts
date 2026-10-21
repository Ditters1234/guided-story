import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { editorRequestSchema } from '#lib/editor';
import { getRepository } from '#lib/server/repository';
import { runEditor } from '#lib/server/story-editor';
import { readJson, failure } from '#lib/server/http';
export const GET: RequestHandler = ({params}) => {
  try { return json({results:getRepository().listEditorResults(params.id)}); } catch(e) { return failure(e); }
};
export const POST: RequestHandler = async ({params,request}) => {
  try { return json(await runEditor(params.id,editorRequestSchema.parse(await readJson(request)),request.signal)); } catch(e) { return failure(e); }
};
