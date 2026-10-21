import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { textSettingsSchema } from '#lib/settings';
import { readPrivateConnections } from '#lib/server/connections';
import { completeText } from '#lib/server/llm';
import { failure, readJson } from '#lib/server/http';
import { StoryError } from '#lib/server/repository';
import { randomUUID } from 'node:crypto';
import { getJobs, runStoryJob } from '#lib/server/jobs';
const schema = z.object({ text: textSettingsSchema, prompt: z.string().trim().min(1).max(10000), system: z.string().max(10000), requestId: z.string().uuid().optional() });
export const POST: RequestHandler = async ({ request }) => {
  try {
    const input = schema.parse(await readJson(request)); if (!input.text.model.trim()) throw new StoryError('Select a text model before running a test prompt.');
    const settings = { ...input.text, apiKey: input.text.apiKey ?? readPrivateConnections().text.apiKey };
    if (Buffer.byteLength(input.prompt + input.system, 'utf8') > settings.contextTokens - settings.maxTokens - 1024) throw new StoryError('The test prompt and output reserve exceed the context budget.');
    const requestId = input.requestId || randomUUID(), started = Date.now();
    const jobInput = { kind: 'text-test', requestId, lockKey: 'text-tests', input: { ...input, requestId: undefined } };
    return json(await runStoryJob(jobInput, AbortSignal.any([request.signal, AbortSignal.timeout(settings.timeoutSeconds * 1000)]), async job => {
      const content = await completeText(settings, [{ role: 'system', content: input.system }, { role: 'user', content: input.prompt }], { outputTokens: settings.maxTokens, temperature: settings.temperature, signal: job.signal, kind: 'text-test', stage: 'Settings test prompt' });
      const result = { content, durationMs: Date.now() - started }; job.stage('validating'); job.stage('committing', { result }); return result;
    }, () => getJobs().find(jobInput)!.details.result));
  } catch (e) { return failure(e); }
};
