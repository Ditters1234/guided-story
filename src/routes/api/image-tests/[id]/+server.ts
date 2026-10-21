import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readImageTest, removeImageTest } from '#lib/server/image-tests';
import { failure } from '#lib/server/http';
export const GET: RequestHandler = async ({ params }) => { try { return json(await readImageTest(params.id)); } catch (e) { return failure(e); } };
export const DELETE: RequestHandler = ({ params }) => { try { removeImageTest(params.id); return json({ ok: true }); } catch (e) { return failure(e); } };
