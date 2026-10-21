import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { startImageTest, testImageStorage } from '#lib/server/image-tests';
import { failure, readJson } from '#lib/server/http';
export const POST: RequestHandler = async ({ request }) => { try { return json(await startImageTest(await readJson(request))); } catch (e) { return failure(e); } };
export const GET: RequestHandler = () => { try { return json(testImageStorage()); } catch (e) { return failure(e); } };
export const DELETE: RequestHandler = () => { try { return json(testImageStorage(true)); } catch (e) { return failure(e); } };
