import { z } from 'zod';
import { defaultFullBodyTemplate, normalizeStockImageTemplate } from './image-prompts';
export const endpointSchema = z.string().url().refine(value => { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password && !u.hash && !u.search; }, 'Enter an HTTP API address without embedded credentials.');
export const textSettingsSchema = z.object({
  baseUrl: endpointSchema, model: z.string().max(300), apiKey: z.string().max(4096).refine(v => !/[\r\n]/.test(v)).optional(),
  temperature: z.number().min(0).max(2), maxTokens: z.number().int().min(128).max(32768), contextTokens: z.number().int().min(1024).max(262144),
  structuredOutput: z.enum(['auto', 'schema', 'json', 'prompt']), topP: z.number().min(0.01).max(1).default(1), timeoutSeconds: z.number().int().min(15).max(600).default(180), thinking: z.enum(['provider','off','on']).default('provider')
});
const binding = z.string().max(150).regex(/^(?:[\w-]+\.[\w-]+)?$/, 'Use nodeID.inputName, or leave unsupported bindings empty.');
export const imageSettingsSchema = z.object({
  baseUrl: endpointSchema, workflow: z.string().max(500), timeoutSeconds: z.number().int().min(30).max(900).default(300),
  width: z.number().int().min(256).max(2048).multipleOf(8).default(896), height: z.number().int().min(256).max(2048).multipleOf(8).default(1152),
  steps: z.number().int().min(1).max(100).default(9), cfg: z.number().min(0).max(30).default(1), seed: z.number().int().min(-1).max(2147483647).default(-1),
  bindings: z.object({ prompt: binding.default('4.text'), negative: binding.default(''), seed: binding.default('7.seed'), width: binding.default('6.width'), height: binding.default('6.height'), steps: binding.default('7.steps'), cfg: binding.default('7.cfg'), outputNode: z.string().max(100).default('9') }).prefault({})
});
export const contextSettingsSchema = z.object({ recentPassages: z.number().int().min(1).max(10).default(2), recentProseBytes: z.number().int().min(500).max(30000).default(5000), overheadTokens: z.number().int().min(256).max(8192).default(1024), includeRelationships: z.boolean().default(true), includeThreads: z.boolean().default(true), autoCompact: z.boolean().default(true), recentChapters: z.number().int().min(1).max(6).default(2) });
export const promptSettingsSchema = z.object({
  portrait: z.string().min(1).max(10000).default('{{art.style}}. Bust portrait of {{subject.name}}, {{subject.face}}, {{subject.hair}}, {{subject.eyes}}. {{subject.upper_body}}. {{subject.expression}}. {{image.background}}.'),
  fullbody: z.string().min(1).max(10000).default(defaultFullBodyTemplate).transform(normalizeStockImageTemplate),
  scene: z.string().min(1).max(10000).default('{{art.style}}. {{image.scene}}. {{image.background}}. {{subject.name}}, {{subject.face}}, {{subject.hair}}, {{subject.upper_body}}. {{subject.pose}}.'),
  group: z.string().min(1).max(10000).default('{{art.style}}. {{image.scene}}. {{image.background}}. {{subjects}}'),
  negative: z.string().max(10000).default(''), narratorInstructions: z.string().max(6000).default('Maintain consistent viewpoint, distinct voices and clear cause and effect. Advance through action and dialogue. Avoid repetitive exposition and gestures. Respect the requested stopping point.')
});
export const chapterEndingSchema = z.enum(['auto', 'keep-open', 'close']);
export const storyPreferencesSchema = z.object({ tense: z.enum(['past', 'present']).default('past'), person: z.enum(['third-limited', 'third-omniscient', 'first']).default('third-limited'), passageWords: z.number().int().min(100).max(3000).default(800), chapterWords: z.number().int().min(500).max(15000).default(3000), writingGuide: z.string().max(3000).default(''), contentNotes: z.string().max(6000).default('') });
export type PublicConnections = { text: Omit<z.infer<typeof textSettingsSchema>, 'apiKey'> & { hasApiKey: boolean }; images: z.infer<typeof imageSettingsSchema>; context: z.infer<typeof contextSettingsSchema>; prompts: z.infer<typeof promptSettingsSchema> };
