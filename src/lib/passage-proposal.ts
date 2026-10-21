import { z } from 'zod';
import { passageSchema } from './story';
import { effectsSchema } from './effect-types';

export const passageMemorySchema = z.strictObject({ summary: z.string().min(1).max(6000), facts: z.array(z.string().max(1000)).max(30), openQuestions: z.array(z.string().max(1000)).max(20), characterIds: z.array(z.string().min(1).max(100)).max(30), locationIds: z.array(z.string().min(1).max(100)).max(30) });
export const passageContentSchema = z.strictObject({
  mode: z.enum(['continue', 'replace']), passageId: z.string().min(1).max(100).optional(), direction: z.string().max(10000),
  draft: z.strictObject({ title: z.string().trim().min(1).max(200), chapterTitle: z.string().trim().min(1).max(200).optional(), startsChapter: z.boolean(), endOfChapter: z.boolean(), viewpointId: z.string().min(1).max(100), paragraphs: passageSchema.shape.paragraphs })
});
export const passageProposalSchema = passageContentSchema.extend({ effects: effectsSchema, memory: passageMemorySchema.optional() });
export type PassageContent = z.infer<typeof passageContentSchema>;
export type PassageProposal = z.infer<typeof passageProposalSchema>;
