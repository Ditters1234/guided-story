import type { RequestHandler } from './$types';
import { recoveryEndpoint } from '#lib/server/passage-recovery-http';
export const POST:RequestHandler=({params,request})=>recoveryEndpoint('setup','retry',params.id,params.draftId,request);
