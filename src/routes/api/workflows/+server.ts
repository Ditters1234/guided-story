import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { describeWorkflow, importWorkflow, listWorkflows, loadWorkflow } from '#lib/server/workflows';
import { failure, readJson } from '#lib/server/http';
export const GET: RequestHandler = ({ url }) => { try { const path = url.searchParams.get('path'); return json(path ? describeWorkflow(loadWorkflow(path)) : listWorkflows()); } catch (e) { return failure(e); } };
export const POST: RequestHandler = async ({ request }) => { try { const input = z.object({ name: z.string().max(200), workflow: z.unknown() }).parse(await readJson(request)); return json(importWorkflow(input.name, input.workflow)); } catch (e) { return failure(e); } };
