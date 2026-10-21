import { z } from 'zod';
import { canonSchema, characterSchema } from './story';
import { normalizeCharacterProfile } from './character-profile';

export const recordKinds = ['character','place','item','relationship','thread'] as const;
export type RecordKind = typeof recordKinds[number];
export const recordCollections = { character:'characters', place:'places', item:'items', relationship:'relationships', thread:'threads' } as const;
const editableId = z.string().min(1).max(100).nullable();
export const recordEditSchema = z.discriminatedUnion('kind', [
  z.strictObject({kind:z.literal('character'), value:z.object({...characterSchema.shape,id:editableId}).overwrite(normalizeCharacterProfile)}),
  z.strictObject({kind:z.literal('place'), value:canonSchema.shape.places.element.extend({id:editableId})}),
  z.strictObject({kind:z.literal('item'), value:canonSchema.shape.items.element.extend({id:editableId})}),
  z.strictObject({kind:z.literal('relationship'), value:canonSchema.shape.relationships.element.extend({id:editableId})}),
  z.strictObject({kind:z.literal('thread'), value:canonSchema.shape.threads.element.extend({id:editableId})})
]);
export type RecordEdit = z.infer<typeof recordEditSchema>;
export const libraryRemovalSchema = z.strictObject({expectedRevision:z.number().int().min(0),requestId:z.string().uuid()});
