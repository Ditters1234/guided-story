import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRepository } from '#lib/server/repository';
import { readPrivateConnections } from '#lib/server/connections';
import { inspectWorkflowRun, removeWorkflowDetails } from '#lib/server/story-workflow/inspection';
import { readJson, failure } from '#lib/server/http';
export const GET:RequestHandler=({params})=>{try{let configuration=null;try{configuration=readPrivateConnections();}catch{/* History remains readable if settings need repair. */}return json(inspectWorkflowRun(getRepository(),params.runId,configuration));}catch(error){return failure(error);}};
export const DELETE:RequestHandler=async({params,request})=>{try{return json(removeWorkflowDetails(getRepository(),params.runId,await readJson(request)));}catch(error){return failure(error);}};
