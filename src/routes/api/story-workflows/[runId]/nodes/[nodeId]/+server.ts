import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRepository } from '#lib/server/repository';
import { inspectWorkflowNode } from '#lib/server/story-workflow/inspection';
import { failure } from '#lib/server/http';
export const GET:RequestHandler=({params,url})=>{try{return json(inspectWorkflowNode(getRepository(),params.runId,params.nodeId,url.searchParams.get('attempt')??undefined));}catch(error){return failure(error);}};
