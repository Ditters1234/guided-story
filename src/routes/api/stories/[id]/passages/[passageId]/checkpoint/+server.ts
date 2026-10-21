import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRepository } from '#lib/server/repository';
import { failure } from '#lib/server/http';

export const GET: RequestHandler = ({params}) => {
  try{const repository=getRepository();return json({checkpoint:repository.passageCheckpoints.info(repository.read(params.id),params.passageId)});}
  catch(error){return failure(error);}
};
