import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { z } from 'zod';
import { registerSecrets } from './diagnostics';
import { textSettingsSchema, imageSettingsSchema, contextSettingsSchema, promptSettingsSchema } from '../settings';
import { atomicWriteFile } from './atomic-files';

export const connectionSchema = z.object({
  text: textSettingsSchema, images: imageSettingsSchema,
  context: contextSettingsSchema.prefault({}), prompts: promptSettingsSchema.prefault({})
});
export const connectionPatchSchema = z.object({ text: textSettingsSchema.optional(), images: imageSettingsSchema.optional(), context: contextSettingsSchema.optional(), prompts: promptSettingsSchema.optional() }).refine(value => Object.keys(value).length > 0, 'Choose connection settings to save.');
export function mergeConnectionSettings(previous: z.input<typeof connectionSchema>, value: unknown) {
  const patch = connectionPatchSchema.parse(value);
  const next = { ...connectionSchema.parse(previous), ...patch };
  if (next.text.apiKey === undefined) next.text = { ...next.text, apiKey: previous.text.apiKey };
  return connectionSchema.parse(next);
}
const configDirectory = () => resolve(process.env.STORY_CONFIG_DIR || 'config');
export function connectionPath() { return resolve(configDirectory(), `connections.${process.env.STORY_INSTANCE === 'play' ? 'play' : 'dev'}.local.json`); }
export function readPrivateConnections() {
  const path = connectionPath(); const common = resolve(configDirectory(), 'connections.local.json');
  const value = JSON.parse(readFileSync(existsSync(path) ? path : existsSync(common) ? common : resolve('config/connections.example.json'), 'utf8'));
  const parsed = connectionSchema.parse(value); registerSecrets(parsed.text.apiKey); return parsed;
}
export function publicConnections() {
  const c = readPrivateConnections(); const { apiKey, ...text } = c.text;
  return { text: { ...text, hasApiKey: Boolean(apiKey) }, images: c.images, context: c.context, prompts: c.prompts };
}
export function saveConnections(value: unknown) {
  const parsed = mergeConnectionSettings(readPrivateConnections(), value);
  registerSecrets(parsed.text.apiKey);
  const path = connectionPath(); mkdirSync(dirname(path), { recursive: true });
  atomicWriteFile(path, JSON.stringify(parsed, null, 2));
  return publicConnections();
}
