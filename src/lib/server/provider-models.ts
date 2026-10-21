import { StoryError } from './repository';
import { readBytes } from './http';
import { beginTrace, endTrace, logEvent, registerSecrets } from './diagnostics';

export async function fetchProviderModels(settings: { baseUrl: string; apiKey?: string }, signal: AbortSignal, fetcher: typeof fetch = fetch) {
  registerSecrets(settings.apiKey);
  const endpoint = settings.baseUrl.replace(/\/+$/, '') + '/models';
  const trace = beginTrace('connection-models', { endpoint });
  try {
    const response = await fetcher(endpoint, { headers: settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}, redirect: 'error', signal });
    if ([401, 403].includes(response.status)) throw new StoryError('The text API rejected the saved key. Enter the API key in Settings and connect again.', 502);
    if (!response.ok) throw new StoryError(`The text API returned HTTP ${response.status} while listing models.`, 502);
    let body;
    try { body = JSON.parse(new TextDecoder().decode(await readBytes(response, 500_000))); }
    catch { throw new StoryError('The text API returned an invalid model list.', 502); }
    if (!Array.isArray(body?.data)) throw new StoryError('The text API did not return an OpenAI-compatible model list.', 502);
    const models = [...new Set<string>(body.data.filter((m: unknown): m is { id: string } => Boolean(m && typeof m === 'object' && 'id' in m && typeof m.id === 'string' && m.id.trim() && m.id.length <= 300)).map((m: { id: string }) => m.id))].sort().slice(0, 500);
    endTrace(trace, { models }); logEvent('info', 'connections', `Text API connected: ${models.length} available model(s)`, { endpoint });
    return { models, baseUrl: settings.baseUrl };
  } catch (e) {
    const error = e instanceof StoryError ? e : new StoryError(signal.aborted ? 'The connection check timed out or was cancelled.' : 'Could not reach the text API. Check its address and that Unsloth is running.', 502);
    endTrace(trace, undefined, error.message); logEvent('error', 'connections', error.message); throw error;
  }
}
