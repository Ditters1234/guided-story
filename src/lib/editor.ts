import { z } from 'zod';
const id = z.string().min(1).max(100);
const paragraphs = z.array(z.string().trim().min(1).max(40000)).min(1).max(100);
const base = { id: z.string().uuid(), storyId: id, sourceRevision: z.number().int().min(0), passageId: id, createdAt: z.string().datetime() };
export const answerSchema = z.strictObject({ answer: z.string().trim().min(1).max(12000), uncertain: z.boolean(), sources: z.array(z.strictObject({ passageId: id, quote: z.string().trim().min(8).max(700) })).max(8) });
export const indexedAnswerSchema=z.strictObject({answer:answerSchema.shape.answer,uncertain:answerSchema.shape.uncertain,citationIds:z.array(z.string().regex(/^quote-\d+-\d+$/)).max(8)});
export const answerWireSchema=z.union([indexedAnswerSchema,answerSchema]);
export const askResultSchema = z.object({ ...base, kind: z.literal('ask'), question: z.string().trim().min(1).max(3000), ...answerSchema.shape,
  coverage: z.object({ totalPassages: z.number().int(), representedPassages: z.number().int(), sourcePassageIds: z.array(id).max(20), warnings: z.array(z.string()) }) });
export const polishDraftSchema = z.strictObject({ paragraphs });
export const wordingReviewSchema = z.strictObject({ equivalent: z.boolean(), issues: z.array(z.string().min(1).max(1000)).max(12) });
export const polishResultSchema = z.object({ ...base, kind: z.literal('polish'), instructions: z.string().max(2000), sourceHash: z.string().regex(/^[a-f0-9]{64}$/), original: z.array(z.string().min(1).max(40000)).min(1).max(100), paragraphs,
  review: wordingReviewSchema, acceptedAt: z.string().datetime().nullable(), acceptedRevision: z.number().int().nullable() });
export const editorResultSchema = z.discriminatedUnion('kind', [askResultSchema, polishResultSchema]);
export const editorRequestSchema = z.strictObject({ expectedRevision: z.number().int().min(0), requestId: z.string().uuid(), passageId: id,
  kind: z.enum(['ask','polish']), text: z.string().trim().max(3000) }).superRefine((v, ctx) => {
    if (v.kind === 'ask' && !v.text) ctx.addIssue({ code: 'custom', path: ['text'], message: 'Enter a question.' });
    if (v.kind === 'polish' && v.text.length > 2000) ctx.addIssue({ code: 'custom', path: ['text'], message: 'Use at most 2,000 characters of polish instructions.' });
  });
export type EditorRequest = z.infer<typeof editorRequestSchema>;
export type EditorResult = z.infer<typeof editorResultSchema>;
export type AskResult = z.infer<typeof askResultSchema>;
export type PolishResult = z.infer<typeof polishResultSchema>;
