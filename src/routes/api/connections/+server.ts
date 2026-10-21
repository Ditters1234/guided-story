import { json } from '@sveltejs/kit';
import { publicConnections, saveConnections } from '#lib/server/connections';
import { readJson, failure } from '#lib/server/http';

export function GET() { try { return json(publicConnections()); } catch (e) { return failure(e); } }
export async function PUT({ request }: { request: Request }) { try { return json(saveConnections(await readJson(request))); } catch (e) { return failure(e); } }
export const PATCH = PUT;
