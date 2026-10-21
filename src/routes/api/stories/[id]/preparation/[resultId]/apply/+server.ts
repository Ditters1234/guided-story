import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { scenePreparationApplySchema } from '#lib/scene-preparation';
import { applyScenePreparationResult } from '#lib/server/scene-preparation-service';
import { failure, readJson } from '#lib/server/http';
export const POST: RequestHandler = async ({ params, request }) => {
  try { return json(await applyScenePreparationResult('story', params.id, scenePreparationApplySchema.parse({ ...await readJson(request) as object, resultId: params.resultId }), request.signal)); } catch (error) { return failure(error); }
};
