import { z } from 'zod';
import { visualIdentitySchema,visualIdentityUpdateSchema } from './visual-identity';
import { personaSchema,personaUpdateSchema,wardrobeSchema,wardrobeUpdateSchema } from './character-profile';
const id = z.string().min(1).max(100), local = z.string().regex(/^new-[a-zA-Z0-9-]{1,60}$/), note = z.string().max(10000), name = z.string().trim().min(1).max(120);
const evidence = z.string().trim().min(8).max(1000);
export const storyEffectSchema = z.discriminatedUnion('type', [
  // Legacy prose fields remain readable in historical event receipts. New model output
  // uses the shared structured profile (see the extraction wire schema).
  z.strictObject({ type: z.literal('character.create'), ref: local, name, role: z.string().max(120), notes: note, appearance: note.optional(), visual:visualIdentitySchema.optional(), persona:personaSchema.optional(), currentState:z.string().max(4000).optional(), wardrobe:wardrobeSchema.optional(), injuries:note.optional(), appearanceNotes:note.optional(), outfit: note.optional(), outfitNotes:note.optional(), locationId: id, evidence }),
  z.strictObject({ type: z.literal('character.update'), characterId: id, name: name.optional(), role: z.string().max(120).optional(), notes: note.optional(), appearance: note.optional(), visual:visualIdentityUpdateSchema.optional(), persona:personaUpdateSchema.optional(), currentState:z.string().max(4000).optional(), wardrobe:wardrobeUpdateSchema.optional(), injuries:note.optional(), appearanceNotes:note.optional(), outfit: note.optional(), outfitNotes:note.optional(), evidence }),
  z.strictObject({ type: z.literal('character.move'), characterId: id, locationId: id, evidence }),
  z.strictObject({ type: z.literal('place.create'), ref: local, name, description: note, visualDescription:z.string().max(4000).optional(), parentId: id.nullable(), evidence }),
  z.strictObject({ type: z.literal('place.update'), placeId: id, description: note.optional(), visualDescription:z.string().max(4000).optional(), parentId: id.nullable().optional(), evidence }),
  z.strictObject({ type: z.literal('item.create'), ref: local, name, description: note, visualDescription:z.string().max(4000).optional(), quantity: z.number().int().min(1).max(1000000), ownerId: id, equipped: z.boolean(), isContainer: z.boolean().optional(), evidence }),
  z.strictObject({ type: z.literal('item.update'), itemId: id, name: name.optional(), description: note.optional(), visualDescription:z.string().max(4000).optional(), isContainer: z.boolean().optional(), evidence }),
  z.strictObject({ type: z.literal('item.transfer'), itemId: id, fromOwnerId: id, toOwnerId: id, evidence }),
  z.strictObject({ type: z.literal('item.split'), ref: local, itemId: id, expectedQuantity: z.number().int().min(2).max(1000000), quantity: z.number().int().min(1).max(999999), ownerId: id, evidence }),
  z.strictObject({ type: z.literal('item.draw'), ref: local, itemId: id, quantity: z.number().int().min(1).max(1000000), ownerId: id, evidence }),
  z.strictObject({ type: z.literal('item.quantity'), itemId: id, expectedQuantity: z.number().int().min(1), quantity: z.number().int().min(0).max(1000000), evidence }),
  z.strictObject({ type: z.literal('item.equip'), itemId: id, equipped: z.boolean(), evidence }),
  z.strictObject({ type: z.literal('relationship.create'), ref: local, fromId: id, toId: id, notes: note, evidence }),
  z.strictObject({ type: z.literal('relationship.update'), relationshipId: id, notes: note, evidence }),
  z.strictObject({ type: z.literal('thread.create'), ref: local, title: name, notes: note, evidence }),
  z.strictObject({ type: z.literal('thread.update'), threadId: id, notes: note, status: z.enum(['open','resolved']), evidence }),
  z.strictObject({ type: z.literal('funds.change'), expectedBalance: z.number().finite().min(0), balance: z.number().finite().min(0), evidence })
]);
export const effectsSchema = z.array(storyEffectSchema).max(100);
export type StoryEffect = z.infer<typeof storyEffectSchema>;
