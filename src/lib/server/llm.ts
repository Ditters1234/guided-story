import { StoryError } from './repository';
import { beginTrace, endTrace, logEvent, registerSecrets } from './diagnostics';
import { readBytes } from './http';
import { stripReasoningTags } from './model-output';
export type TextSettings = { baseUrl: string; model: string; apiKey?: string; maxTokens: number; contextTokens: number; topP?: number; timeoutSeconds?: number; structuredOutput?: string; thinking?: 'provider'|'off'|'on' };
export type ModelMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export async function completeText(settings: TextSettings, messages: ModelMessage[], options: {
  outputTokens: number; signal: AbortSignal; kind: string; storyId?: string; storyRevision?: number; stage?: string; temperature?: number; jsonSchema?: Record<string, unknown>; maxCharacters?: number;
}, fetcher: typeof fetch = fetch): Promise<string> {
  registerSecrets(settings.apiKey);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
  const endpoint = `${settings.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const format = options.jsonSchema && settings.structuredOutput === 'schema' ? { type: 'json_schema', json_schema: { name: options.kind.replace(/[^a-zA-Z0-9_]/g,'_').slice(0,64), strict: false, schema: options.jsonSchema } } : options.jsonSchema && ['json','auto'].includes(settings.structuredOutput || '') ? { type: 'json_object' } : undefined;
  const payload = { model: settings.model, temperature: options.temperature ?? 0.2, top_p: settings.topP ?? 1, max_tokens: options.outputTokens, stream: false, messages, ...(format ? { response_format: format } : {}), ...(settings.thinking && settings.thinking !== 'provider' ? { enable_thinking: settings.thinking === 'on' } : {}) };
  const trace = beginTrace(options.kind, { endpoint, ...payload, stage: options.stage || 'completion' }, options.storyId, options.storyRevision);
  const requestSignal = AbortSignal.any([options.signal, AbortSignal.timeout((settings.timeoutSeconds ?? 180) * 1000)]);
  let providerResult: unknown;
  logEvent('info', 'llm', `${options.kind}: request started`, { model: settings.model, stage: options.stage, traceId: trace }, options.storyId);
  try {
    let response: Response;
    try { response = await fetcher(endpoint, { method: 'POST', headers, redirect: 'error', signal: requestSignal, body: JSON.stringify(payload) }); }
    catch {
      if (requestSignal.aborted) throw new StoryError('Text generation was cancelled or timed out. The previous saved result has been kept.', 408);
      throw new StoryError('Could not reach the text model. Check the Text API address in Settings and that the server is running.', 502);
    }
    if (!response.ok) { try { providerResult = { httpStatus: response.status, body: new TextDecoder().decode(await readBytes(response, 20000)) }; } catch { providerResult = { httpStatus: response.status }; } }
    if ([401, 403].includes(response.status)) throw new StoryError('The text provider rejected the API key. Check the connection in Settings.', 502);
    if (!response.ok) throw new StoryError(`The text provider returned HTTP ${response.status}. Your previous saved result has been kept.`, 502);
    const reader = response.body?.getReader(); if (!reader) throw new StoryError('The model returned no text.', 502);
    let size = 0; const chunks: Uint8Array[] = [];
    try {
      while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 500_000) throw new StoryError('The model response was too large.', 502); chunks.push(value); }
    } catch (e) { if (e instanceof StoryError) throw e; throw new StoryError('The model response was interrupted. The previous saved result has been kept.', 502); }
    finally { await reader.cancel().catch(() => {}); }
    let data;
    try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new StoryError('The provider did not return a valid completion response.', 502); }
    const choice = data.choices?.[0];
    providerResult = { message: choice?.message, finishReason: choice?.finish_reason, usage: data.usage };
    if (choice?.finish_reason === 'length') throw new StoryError('The model output was cut off. Increase the output-token limit in Settings and try again.', 502);
    if (choice?.message?.refusal) throw new StoryError('The provider declined this request. Your previous saved result has been kept.', 502);
    const content = choice?.message?.content;
    const text = stripReasoningTags(typeof content === 'string' ? content : Array.isArray(content) ? content.filter(p => p?.type === 'text' && typeof p.text === 'string').map(p => p.text).join('') : '');
    if (!text || text.length > (options.maxCharacters ?? 12000) || /<think>/i.test(text)) throw new StoryError('The model did not return usable text. Your previous saved result has been kept.', 502);
    endTrace(trace, { content: text, finishReason: choice.finish_reason, usage: data.usage });
    logEvent('info', 'llm', `${options.kind}: request complete`, { traceId: trace, outputCharacters: text.length, usage: data.usage }, options.storyId);
    return text;
  } catch (e) {
    const message = e instanceof StoryError ? e.message : 'Text request failed.';
    endTrace(trace, providerResult, message); logEvent('error', 'llm', message, { traceId: trace }, options.storyId); throw e;
  }
}
