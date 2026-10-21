import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRepository } from '#lib/server/repository';
import { listWorkflowRuns } from '#lib/server/story-workflow/inspection';
import { failure } from '#lib/server/http';
export const GET:RequestHandler=({url})=>{try{return json(listWorkflowRuns(getRepository(),Object.fromEntries(url.searchParams)));}catch(error){return failure(error);}};
