import { json } from '@sveltejs/kit';
import { getRepository } from '#lib/server/repository';
import { failure } from '#lib/server/http';
export function GET() {
  try { const r = getRepository(); return json(r.mediaStore.audit(r.list().flatMap(s => r.read(s.id).media.assets))); }
  catch (e) { return failure(e); }
}
