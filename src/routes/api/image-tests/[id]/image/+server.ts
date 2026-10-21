import type { RequestHandler } from './$types';
import { imageTestFile } from '#lib/server/image-tests';
import { failure } from '#lib/server/http';
export const GET: RequestHandler = ({ params, url }) => { try { const f = imageTestFile(params.id, Number(url.searchParams.get('index') || 0)); return new Response(new Uint8Array(f.bytes), { headers: { 'Content-Type': f.type } }); } catch (e) { return failure(e); } };
