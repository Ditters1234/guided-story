import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRepository } from '#lib/server/repository';
import { failure,readJson } from '#lib/server/http';
import { z } from 'zod';
export const GET:RequestHandler=({params,url})=>{try{const store=getRepository().workflowPresets,revision=url.searchParams.get('revision');return json(revision?store.readVersion(params.id,z.coerce.number().int().positive().parse(revision)):store.read(params.id));}catch(error){return failure(error);}};
export const PATCH:RequestHandler=async({params,request})=>{try{return json(getRepository().workflowPresets.save(params.id,await readJson(request)));}catch(error){return failure(error);}};
export const POST:RequestHandler=async({params,request})=>{try{return json(getRepository().workflowPresets.lifecycle(params.id,await readJson(request)));}catch(error){return failure(error);}};
