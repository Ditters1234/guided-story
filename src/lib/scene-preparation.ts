import { z } from 'zod';
import { canonSchema } from './story';
import { contextSchema, sceneBriefSchema } from './context-types';

const id = z.string().min(1).max(100);
const ids = z.array(id).max(30).default([]);

/** An explicit authoring request. It never runs as part of narration. */
export const scenePreparationRequestSchema = z.strictObject({
  requestId: z.string().uuid(), expectedRevision: z.number().int().min(0),
  direction: z.string().trim().min(1).max(4000),
  characterIds: ids, placeIds: ids, itemIds: ids
});
export type ScenePreparationRequest = z.infer<typeof scenePreparationRequestSchema>;

const newId = z.string().uuid();
export const scenePreparationAdditionsSchema = z.strictObject({
  places: z.array(canonSchema.shape.places.element.strict().extend({ id: newId })).max(6),
  items: z.array(canonSchema.shape.items.element.strict().extend({ id: newId, equipped: z.literal(false), unlimited: z.literal(false).optional() })).max(12),
  threads: z.array(canonSchema.shape.threads.element.strict().extend({ id: newId, status: z.literal('open') })).max(6),
  lore: z.array(contextSchema.shape.lore.element.strict().extend({ id: newId, visibility: z.literal('relevant') })).max(4)
});

/** The server retains this exact reviewed proposal; applying accepts only its ID. */
export const scenePreparationProposalSchema = z.strictObject({
  id: newId, storyId: id, sourceRevision: z.number().int().min(0),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.string().datetime(), direction: z.string().trim().min(1).max(4000),
  explanation: z.string().trim().min(1).max(6000), reusedIds: z.array(id).max(100),
  additions: scenePreparationAdditionsSchema, sceneBrief: sceneBriefSchema,
  appliedAt: z.string().datetime().nullable(), appliedRevision: z.number().int().min(0).nullable()
});
export type ScenePreparationProposal = z.infer<typeof scenePreparationProposalSchema>;

export const scenePreparationApplySchema = z.strictObject({
  requestId: z.string().uuid(), expectedRevision: z.number().int().min(0), resultId: newId
});
export type ScenePreparationApply = z.infer<typeof scenePreparationApplySchema>;
