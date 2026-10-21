import { z } from 'zod';
import { passageContentSchema, passageProposalSchema } from './passage-proposal';

export const recoveryIssueSchema = z.object({ category: z.enum(['consistency', 'validation', 'request', 'interrupted', 'stale']), message: z.string().max(6000), detail: z.string().max(10000).optional() });
export const retainedPassageSchema = z.object({
  id: z.string().uuid(), sourceKind: z.enum(['setup', 'story']), sourceId: z.string().min(1).max(100),
  requestId: z.string().uuid(), fingerprint: z.string(), sourceRevision: z.number().int().min(0), sourceHash: z.string(), historyHash: z.string(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(), version: z.number().int().min(0),
  status: z.enum(['checking', 'blocked', 'ready', 'saved', 'discarded']), content: passageContentSchema,
  issues: z.array(recoveryIssueSchema).max(16), rawEffects: z.array(z.unknown()).max(100),
  facts: z.array(z.object({ id: z.string(), kind: z.enum(['character', 'place', 'item']), name: z.string(), detail: z.string() })).max(60),
  attempts: z.number().int().min(0), activeRequestId: z.string().uuid().nullable(),
  checkedRevision: z.number().int().min(0).nullable(), checkedHash: z.string().nullable(), proposal: passageProposalSchema.nullable(),
  savedRevision: z.number().int().min(0).nullable()
});
export const recoveryActionSchema = z.strictObject({ requestId: z.string().uuid(), expectedVersion: z.number().int().min(0), expectedRevision: z.number().int().min(0), notes: z.string().trim().max(4000).default('') });
export type RetainedPassage = z.infer<typeof retainedPassageSchema>;
export type RecoveryIssue = z.infer<typeof recoveryIssueSchema>;
export type RecoveryAction = z.infer<typeof recoveryActionSchema>;
