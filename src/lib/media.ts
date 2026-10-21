import { z } from 'zod';

const id = z.string().min(1).max(100);
export const imageProvenanceSchema = z.object({
  kind: z.enum(['upload', 'comfy']), prompt: z.string().max(16000).default(''), negative: z.string().max(10000).default(''),
  seed: z.number().finite().nullable().default(null), workflow: z.string().max(1000).default(''),
  // Explicit snapshots only: never persist connection credentials in a story.
  graph: z.record(z.string(), z.unknown()).nullable().default(null), settings: z.record(z.string(), z.unknown()).default({}),
  template: z.string().max(16000).default(''), variables: z.record(z.string(), z.string().max(40000)).default({}),
  generationId: z.string().uuid().optional(), outputIndex: z.number().int().min(0).max(3).optional(), composition: z.record(z.string(), z.unknown()).default({})
});
export const mediaAssetSchema = z.object({
  id: z.string().uuid(), hash: z.string().regex(/^[a-f0-9]{64}$/), mime: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  width: z.number().int().min(1).max(16384), height: z.number().int().min(1).max(16384), bytes: z.number().int().min(1).max(20_000_000),
  createdAt: z.string().datetime(), caption: z.string().max(4000), category: z.enum(['portrait','scene','place','item','other']),
  subjectIds: z.array(id).max(200), snapshots: z.array(z.object({ id, name: z.string().max(200), appearance: z.string().max(40000), outfit: z.string().max(40000) })).max(200),
  source: z.object({ passageId: id, revision: z.number().int().min(0), hash: z.string().regex(/^[a-f0-9]{64}$/), chapter: z.number().int().min(1), title: z.string().max(200) }).nullable(),
  status: z.enum(['canonical','experimental','superseded']), parentId: z.string().uuid().nullable(), provenance: imageProvenanceSchema
});
export const mediaSchema = z.object({ assets: z.array(mediaAssetSchema).max(2000), portraits: z.record(id, z.string().uuid()), references: z.record(id, z.string().uuid()) });
export const emptyMedia = () => ({ assets: [], portraits: {}, references: {} });
export type MediaAsset = z.infer<typeof mediaAssetSchema>;
export type ImageProvenance = z.infer<typeof imageProvenanceSchema>;
export const mediaEditSchema = z.object({ caption: z.string().max(4000), category: mediaAssetSchema.shape.category, subjectIds: mediaAssetSchema.shape.subjectIds, status: z.enum(['canonical','experimental']) });
export function mediaUrl(storyId: string, assetId: string, thumbnail = false) { return `/api/stories/${encodeURIComponent(storyId)}/media/${assetId}${thumbnail ? '?size=thumb' : ''}`; }
