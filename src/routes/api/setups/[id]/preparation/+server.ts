import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { scenePreparationRequestSchema } from '#lib/scene-preparation';
import { getRepository } from '#lib/server/repository';
import { runScenePreparation } from '#lib/server/scene-preparation-service';
import { failure, readJson } from '#lib/server/http';

export const GET: RequestHandler = ({ params }) => {
  try { return json({ results: getRepository().listScenePreparations('setup', params.id) }); } catch (error) { return failure(error); }
};
export const POST: RequestHandler = async ({ params, request }) => {
  try { return json(await runScenePreparation('setup', params.id, scenePreparationRequestSchema.parse(await readJson(request)), request.signal)); } catch (error) { return failure(error); }
};
