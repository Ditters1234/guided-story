import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getJobs } from '#lib/server/jobs';
import { scrub } from '#lib/server/diagnostics';
import { failure } from '#lib/server/http';
export const GET: RequestHandler = ({ url }) => { try { const download = url.searchParams.has('download'); return json({ jobs: getJobs().list().map(j => download ? scrub(j) : { ...scrub(j) as typeof j, details: undefined }) }, download ? { headers: { 'Content-Disposition': 'attachment; filename="storyweaver-jobs.json"' } } : undefined); } catch (e) { return failure(e); } };
