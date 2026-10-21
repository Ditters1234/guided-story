import { z } from 'zod';
import { StoryError } from './repository';
import { readBytes } from './http';
import { beginTrace, endTrace, logEvent } from './diagnostics';

const statsSchema = z.object({ system: z.object({ comfyui_version: z.string().optional() }), devices: z.array(z.object({ name: z.string() })).optional() });
export async function testComfyConnection(baseUrl: string, signal: AbortSignal, fetcher: typeof fetch = fetch) {
  const endpoint = baseUrl.replace(/\/+$/, '') + '/system_stats';
  const trace = beginTrace('connection-comfy', { endpoint });
  try {
    const response = await fetcher(endpoint, { redirect: 'error', signal });
    if (!response.ok) throw new StoryError(`ComfyUI returned HTTP ${response.status}. Check the address and server.`, 502);
    let stats;
    try { stats = statsSchema.parse(JSON.parse(new TextDecoder().decode(await readBytes(response, 500_000)))); }
    catch { throw new StoryError('This address did not return valid ComfyUI system information.', 502); }
    const result = { baseUrl, version: stats.system.comfyui_version || null, devices: stats.devices?.map(d => d.name) || [] };
    endTrace(trace, result); logEvent('info', 'connections', 'ComfyUI connection successful', result); return result;
  } catch (e) {
    const error = e instanceof StoryError ? e : new StoryError(signal.aborted ? 'ComfyUI connection test timed out or was cancelled.' : 'Could not reach ComfyUI. Check its address and that the server is running.', 502);
    endTrace(trace, undefined, error.message); logEvent('error', 'connections', error.message); throw error;
  }
}
