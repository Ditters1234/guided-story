import type { RequestHandler } from './$types';
import { recoveryEndpoint } from '#lib/server/passage-recovery-http';
export const POST:RequestHandler=({params,request})=>recoveryEndpoint('story','discard',params.id,params.draftId,request);
