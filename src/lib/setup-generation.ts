import { z } from 'zod';
import { generationRequestSchema, type SetupPlan } from './setup';

export const setupDesignKindSchema = z.enum(['place', 'item', 'relationship', 'thread', 'lore', 'world', 'opening']);
export const setupDesignModeSchema = z.enum(['revise', 'full', 'name', 'create']);
export type SetupDesignKind = z.infer<typeof setupDesignKindSchema>;
export type SetupDesignMode = z.infer<typeof setupDesignModeSchema>;
const fields = z.object({
  kind: setupDesignKindSchema,
  mode: setupDesignModeSchema.default('revise'),
  targetId: z.string().min(1).max(100).optional(),
  direction: z.string().trim().max(2000).default('')
});
function validateDesign(input: z.infer<typeof fields>, context: z.RefinementCtx) {
  const record = !['world', 'opening'].includes(input.kind);
  if (input.mode === 'name' && !['place', 'item', 'thread', 'lore'].includes(input.kind)) context.addIssue({ code: 'custom', path: ['mode'], message: 'Only places, possessions, threads and background entries have name/title rerolls.' });
  if (input.mode === 'create' && !record) context.addIssue({ code: 'custom', path: ['mode'], message: 'World foundations and the opening already belong to this setup; revise them instead.' });
  if (record && input.mode !== 'create' && !input.targetId) context.addIssue({ code: 'custom', path: ['targetId'], message: 'Select a setup record to redesign.' });
  if ((!record || input.mode === 'create') && input.targetId) context.addIssue({ code: 'custom', path: ['targetId'], message: 'A new record or whole setup section cannot target another record.' });
}
export const setupDesignInputSchema = fields.strict().superRefine(validateDesign);
export const setupDesignRequestSchema = generationRequestSchema.extend(fields.shape).strict().superRefine(validateDesign);
export type SetupDesignInput = z.infer<typeof setupDesignInputSchema>;

/** The visible world editor and generation target must resolve the same entry. */
export function worldFoundationEntry(plan: SetupPlan) {
  return plan.context.lore.find(entry => entry.visibility !== 'hidden' && entry.title.trim().toLocaleLowerCase() === 'world foundations');
}
