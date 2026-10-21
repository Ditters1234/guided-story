import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cancelJob, getJobs } from '#lib/server/jobs';
import { scrub } from '#lib/server/diagnostics';
import { failure } from '#lib/server/http';
export const GET: RequestHandler = ({ params }) => { try { return json(scrub(getJobs().read(params.id))); } catch (e) { return failure(e); } };
export const DELETE: RequestHandler = ({ params }) => { try { return json(scrub(cancelJob(params.id))); } catch (e) { return failure(e); } };
