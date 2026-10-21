import { z } from 'zod';
const id = z.string().min(1).max(100);
export const contextMemorySchema = z.object({
  id, passageIds: z.array(id).min(1).max(100), summary: z.string().min(1).max(6000),
  facts: z.array(z.string().max(1000)).max(30), openQuestions: z.array(z.string().max(1000)).max(20),
  characterIds: z.array(id).max(30), locationIds: z.array(id).max(30),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/), createdAt: z.string().datetime(), source: z.enum(['manual', 'generated'])
});
export const compactMemorySchema = z.object({
  id, level: z.enum(['chapter', 'book']), chapter: z.number().int().min(1).nullable(),
  chapterNumbers: z.array(z.number().int().min(1)).min(1).max(10000),
  passageIds: z.array(id).min(1).max(10000),
  summary: z.string().min(1).max(6000), facts: z.array(z.string().min(1).max(1000)).max(30),
  openQuestions: z.array(z.string().min(1).max(1000)).max(20),
  characterIds: z.array(id).max(200), locationIds: z.array(id).max(500),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/), createdAt: z.string().datetime()
});
export const memoryCompactionSchema = z.object({
  epoch: z.number().int().min(0).default(0),
  chapters: z.array(compactMemorySchema).max(10000).default([]),
  book: compactMemorySchema.nullable().default(null)
});
export const sceneBriefScopeSchema = z.enum(['next-passage', 'current-scene', 'ongoing']);
export type SceneBriefScope = z.infer<typeof sceneBriefScopeSchema>;
export const sceneBriefScopeLabels: Record<SceneBriefScope, string> = { 'next-passage': 'Next passage', 'current-scene': 'Current scene', ongoing: 'Ongoing' };
export const sceneBriefSchema = z.object({
    purpose: z.string().max(3000), tension: z.string().max(3000), stopAt: z.string().max(2000),
    viewpointId: id.nullable(), locationId: id.nullable(), castIds: z.array(id).max(30),
    // Reviewed scene resources are context references, never cast/presence or knowledge.
    // Keep this optional so older stories retain their serialized brief unchanged.
    resourceIds: z.array(id).max(250).optional(),
    scope: sceneBriefScopeSchema.optional(), clearAfterPassage: z.boolean().default(false)
  }).transform(brief => {
    // Older story/setup archives only store the one-shot flag. An explicit scope
    // wins; keep the old flag as a compatible, synchronized serialization field.
    const scope = brief.scope ?? (brief.clearAfterPassage ? 'next-passage' : 'ongoing');
    return { ...brief, scope, clearAfterPassage: scope === 'next-passage' };
  });
export const contextSchema = z.object({
  sceneBrief: sceneBriefSchema,
  lore: z.array(z.object({ id, title: z.string().min(1).max(200), text: z.string().max(10000), keywords: z.array(z.string().max(100)).max(30), relatedIds: z.array(id).max(30), visibility: z.enum(['always', 'relevant', 'hidden']) })).max(300),
  knowledge: z.array(z.object({
    id, fact: z.string().min(1).max(4000), truth: z.enum(['established', 'belief', 'possibility']),
    knownBy: z.array(id).max(200), readerRevealed: z.boolean(), sourcePassageId: id.nullable(), sourceHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null)
  })).max(500),
  memories: z.array(contextMemorySchema).max(10000),
  compaction: memoryCompactionSchema.prefault({})
});
export type ContextData = z.infer<typeof contextSchema>;
export type ContextMemory = z.infer<typeof contextMemorySchema>;
export type CompactMemory = z.infer<typeof compactMemorySchema>;
export type MemoryCompaction = z.infer<typeof memoryCompactionSchema>;
export function emptyContext(): ContextData { return contextSchema.parse({ sceneBrief: { purpose: '', tension: '', stopAt: '', viewpointId: null, locationId: null, castIds: [], scope: 'current-scene' }, lore: [], knowledge: [], memories: [] }); }
export type ContextSource = { id: string; kind: string; title: string; included: boolean; reason: string; bytes: number; tokens: number; required: boolean; clipped?: boolean };
export type ContextReport = {
  storyId: string; revision: number; runnable: boolean; inputBytes: number; inputTokens: number; inputBudget: number; contextTokens: number; reservedOutput: number; overheadTokens: number;
  sources: ContextSource[]; warnings: string[]; messages: { role: 'system' | 'user'; content: string }[];
  selectedCharacterIds: string[]; selectedPlaceIds: string[];
  memoryCoverage: { totalPassages: number; representedPassages: number; missingPassageIds: string[]; chapterSummaries: number; bookOverview: boolean; preciseRecords: number };
  answerSourceIds: string[];
  taskReserveTokens: number; budgetMethod: 'conservative-estimate';
};
