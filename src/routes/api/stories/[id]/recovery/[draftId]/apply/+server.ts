import type { RequestHandler } from './$types';
import { recoveryEndpoint } from '#lib/server/passage-recovery-http';
export const POST:RequestHandler=({params,request})=>recoveryEndpoint('story','apply',params.id,params.draftId,request);
