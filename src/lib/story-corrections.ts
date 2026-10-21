import { z } from 'zod';
import { recordEditSchema, recordKinds } from './record-editing';

const id = z.string().min(1).max(100);
export const correctionRequestSchema = z.strictObject({
  expectedRevision: z.number().int().min(0), requestId: z.string().uuid(), passageId: id,
  kind: z.enum(['repair', 'record']), direction: z.string().trim().max(3000),
  recordKind: z.enum(recordKinds).optional(), mode: z.enum(['revise', 'full', 'name', 'create']).optional(), targetId: id.optional()
}).superRefine((input, ctx) => {
  if (input.kind === 'repair') {
    if (!input.direction) ctx.addIssue({code:'custom', path:['direction'], message:'Describe what needs correction.'});
    if (input.recordKind || input.mode || input.targetId) ctx.addIssue({code:'custom', message:'A story correction cannot also target a single record.'});
  } else {
    if (!input.recordKind) ctx.addIssue({code:'custom', path:['recordKind'], message:'Choose a record type.'});
    if (input.mode === 'create' ? Boolean(input.targetId) : !input.targetId) ctx.addIssue({code:'custom', path:['targetId'], message:'Select an existing record, or choose Create without a target.'});
    if (input.mode === 'name' && input.recordKind === 'relationship') ctx.addIssue({code:'custom', path:['mode'], message:'Relationships do not have a name to reroll.'});
  }
});
export const correctionOperationSchema = z.discriminatedUnion('type', [
  z.strictObject({type:z.literal('record'), create:z.boolean(), edit:recordEditSchema}).refine(op => Boolean(op.edit.value.id), {message:'A stored correction needs an application-assigned record ID.'}),
  z.strictObject({type:z.literal('world'), funds:z.number().finite().min(0), cargoNotes:z.string().max(40000)})
]);
export const correctionFieldChangeSchema = z.strictObject({
  kind:z.enum([...recordKinds, 'world']), recordId:id.nullable(), label:z.string().min(1).max(250),
  field:z.string().min(1).max(150), before:z.string().max(40000), after:z.string().max(40000)
});
export const correctionResultSchema = z.strictObject({
  id:z.string().uuid(), storyId:id, sourceRevision:z.number().int().min(0), passageId:id,
  sourceHash:z.string().regex(/^[a-f0-9]{64}$/), createdAt:z.string().datetime(),
  kind:z.enum(['repair','record']), direction:z.string().max(3000), explanation:z.string().trim().min(1).max(6000),
  operations:z.array(correctionOperationSchema).min(1).max(30), changes:z.array(correctionFieldChangeSchema).min(1).max(1000),
  coverage:z.strictObject({includedPassageIds:z.array(id).min(1).max(10000),totalChapterPassages:z.number().int().min(1),warnings:z.array(z.string().max(1000)).max(10)}).optional(),
  appliedAt:z.string().datetime().nullable(), appliedRevision:z.number().int().min(0).nullable()
});
export const correctionApplySchema = z.strictObject({expectedRevision:z.number().int().min(0),requestId:z.string().uuid(),resultId:z.string().uuid()});
export type CorrectionRequest = z.infer<typeof correctionRequestSchema>;
export type CorrectionOperation = z.infer<typeof correctionOperationSchema>;
export type CorrectionFieldChange = z.infer<typeof correctionFieldChangeSchema>;
export type CorrectionResult = z.infer<typeof correctionResultSchema>;
