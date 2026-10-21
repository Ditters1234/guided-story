import { z } from 'zod';
import { workflowDefinitionSchema, workflowSourceSchema } from './story-workflow/contracts';
import { textSettingsSchema } from './settings';
import type { PresetContent } from './story-workflow/presets';

export const checkpointHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const checkpointWorkflowSchema = z.strictObject({
  definition: workflowDefinitionSchema,
  runId: z.string().uuid(), source: workflowSourceSchema,
  configurationFingerprint: checkpointHashSchema,
  // Deliberate allowlist: no address, credentials, raw requests or provider responses.
  model: z.strictObject(textSettingsSchema.omit({ baseUrl: true, apiKey: true }).shape).optional()
});
export const passageWorkflowMetadataSchema = z.strictObject({
  generation: checkpointWorkflowSchema.nullable(), acceptance: checkpointWorkflowSchema
});
export type PassageWorkflowMetadata = z.infer<typeof passageWorkflowMetadataSchema>;
export const forkPassageSchema = z.strictObject({
  requestId: z.string().uuid(), expectedRevision: z.number().int().min(0),
  checkpoint: checkpointHashSchema, title: z.string().trim().min(1).max(200)
});
export type PassageCheckpointInfo = {
  checkpoint: string; passageId: string; title: string; capturedAt: string;
  passageCount: number; differsFromCurrent: boolean; workflow: PassageWorkflowMetadata | null;
};
/** Explicit author draft for the new source; historical provenance is never rebound in place. */
export function continuationPresetFromCheckpoint(info:PassageCheckpointInfo,sourceId:string):PresetContent {
  if(!info.workflow)throw new Error('No recorded workflow is available.');
  const definition=structuredClone(info.workflow.acceptance.definition);definition.mode='continue';
  definition.bindings=definition.bindings.map(binding=>binding.kind==='source'?{...binding,sourceKind:'story',sourceId}:binding);
  return {name:`${info.title.slice(0,125)} continuation`,description:'Adapted from a saved passage checkpoint. Review and save before selecting it for a new passage. Current configured model settings apply.',definition};
}
