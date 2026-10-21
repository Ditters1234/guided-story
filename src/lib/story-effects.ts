import { canonSchema, type Canon } from './story';
import { validateCanonicalState } from './story';
import { StoryError } from './errors';
import { visualIdentitySchema,identityFields } from './visual-identity';
import { normalizeCharacterProfile, personaSchema,wardrobeSchema } from './character-profile';

import { effectsSchema } from './effect-types';
export { effectsSchema, storyEffectSchema } from './effect-types';
export type { StoryEffect } from './effect-types';
const normalizedName = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
const normalizedQuote = (value: string) => value.replace(/\s+/g, ' ').trim();

export function applyStoryEffects(base: Canon, proposed: unknown, prose: string, allocateId: () => string = () => crypto.randomUUID()) {
  const effects = effectsSchema.parse(proposed), canon = structuredClone(base), assigned: Record<string, string> = {};
  const allIds = new Set([...canon.characters, ...canon.places, ...canon.items, ...canon.relationships, ...canon.threads].map(x => x.id));
  const source = normalizedQuote(prose);
  for (const effect of effects) {
    if (!source.includes(normalizedQuote(effect.evidence))) throw new StoryError(`The ${effect.type} evidence is not present in the proposed passage. No changes were applied.`);
    if ('ref' in effect) {
      if (assigned[effect.ref] || allIds.has(effect.ref)) throw new StoryError('A proposed entity reference was used twice or collides with an existing ID.');
      const allocated = allocateId(); if (!allocated || allocated.length > 100 || allIds.has(allocated)) throw new StoryError('Entity ID allocation collided with an existing record.');
      assigned[effect.ref] = allocated; allIds.add(allocated);
    }
  }
  const ref = (value: string) => assigned[value] || (allIds.has(value) || !value.startsWith('new-') ? value : (() => { throw new StoryError(`Unresolved new entity reference: ${value}`); })());
  const requireRecord = <T extends { id: string }>(records: T[], value: string, kind: string) => records.find(r => r.id === ref(value)) || (() => { throw new StoryError(`Unknown ${kind} reference: ${value}`); })();
  // Allocate and materialize additions first so cross-references do not depend on model ordering.
  for (const e of effects) {
    if (e.type === 'character.create') {
      if (canon.characters.some(c => normalizedName(c.name) === normalizedName(e.name))) throw new StoryError(`A cast member named ${e.name} already exists. Update that character instead.`);
      canon.characters.push(normalizeCharacterProfile({ id: assigned[e.ref], name: e.name, role: e.role, notes: e.notes, appearance: e.appearance || '', visual:e.visual,persona:e.persona,currentState:e.currentState,wardrobe:e.wardrobe,injuries:e.injuries,appearanceNotes:e.appearanceNotes, outfit: e.outfit || '',outfitNotes:e.outfitNotes, locationId: ref(e.locationId), noNsfw: true, pinnedAppearance: false }));
    } else if (e.type === 'place.create') canon.places.push({ id: assigned[e.ref], name: e.name, description: e.description, ...(e.visualDescription !== undefined ? {visualDescription:e.visualDescription} : {}), parentId: e.parentId ? ref(e.parentId) : null });
    else if (e.type === 'item.create') canon.items.push({ id: assigned[e.ref], name: e.name, description: e.description, ...(e.visualDescription !== undefined ? {visualDescription:e.visualDescription} : {}), quantity: e.quantity, ownerId: ref(e.ownerId), equipped: e.equipped, ...(e.isContainer !== undefined ? { isContainer: e.isContainer } : {}) });
    else if (e.type === 'relationship.create') canon.relationships.push({ id: assigned[e.ref], fromId: ref(e.fromId), toId: ref(e.toId), notes: e.notes });
    else if (e.type === 'thread.create') canon.threads.push({ id: assigned[e.ref], title: e.title, notes: e.notes, status: 'open' });
  }
  for (const e of effects) {
    if (e.type === 'character.update') {
      const c = requireRecord(canon.characters, e.characterId, 'character');
      const current=normalizeCharacterProfile(c);
      if (c.pinnedAppearance && ((e.appearance !== undefined && e.appearance !== c.appearance) || (e.outfit !== undefined && e.outfit !== c.outfit) || (e.visual&&identityFields.some(f=>e.visual![f]!==undefined&&e.visual![f]!==current.visual[f])) || (e.wardrobe&&Object.entries(e.wardrobe).some(([key,value])=>value!==current.wardrobe[key as keyof typeof current.wardrobe])) || (e.injuries!==undefined&&e.injuries!==current.injuries) || (e.appearanceNotes!==undefined&&e.appearanceNotes!==current.appearanceNotes) || (e.outfitNotes!==undefined&&e.outfitNotes!==current.outfitNotes))) throw new StoryError(`Pinned appearance/outfit for ${c.name} cannot be changed by generation.`);
      if (e.name && canon.characters.some(other => other.id !== c.id && normalizedName(other.name) === normalizedName(e.name!))) throw new StoryError('A character rename would duplicate an existing cast member.');
      for (const key of ['name','role','notes','currentState','injuries','appearanceNotes','outfitNotes'] as const) if (e[key] !== undefined) c[key] = e[key]!;
      if(e.visual)c.visual=visualIdentitySchema.parse({...c.visual,...e.visual});
      if(e.persona)c.persona=personaSchema.parse({...c.persona,...e.persona});
      if(e.wardrobe)c.wardrobe=wardrobeSchema.parse({...c.wardrobe,...e.wardrobe});
      if(e.appearance!==undefined&&e.appearanceNotes===undefined)c.appearanceNotes=e.appearance;
      if(e.outfit!==undefined&&e.outfitNotes===undefined)c.outfitNotes=e.outfit;
      Object.assign(c,normalizeCharacterProfile(c));
    } else if (e.type === 'character.move') requireRecord(canon.characters, e.characterId, 'character').locationId = ref(e.locationId);
    else if (e.type === 'place.update') { const p = requireRecord(canon.places, e.placeId, 'place'); if (e.description !== undefined) p.description = e.description; if (e.visualDescription !== undefined) p.visualDescription = e.visualDescription; if (e.parentId !== undefined) p.parentId = e.parentId ? ref(e.parentId) : null; }
    else if (e.type === 'item.update') { const item = requireRecord(canon.items, e.itemId, 'item'); if (e.name !== undefined) item.name = e.name; if (e.description !== undefined) item.description = e.description; if (e.visualDescription !== undefined) item.visualDescription = e.visualDescription; if (e.isContainer !== undefined) item.isContainer = e.isContainer; }
    else if (e.type === 'item.transfer') {
      const item = requireRecord(canon.items, e.itemId, 'item'); if (item.ownerId !== ref(e.fromOwnerId)) throw new StoryError('An item transfer disagrees with its current owner.');
      item.ownerId = ref(e.toOwnerId); item.equipped = false;
    } else if (e.type === 'item.split') {
      const item = requireRecord(canon.items, e.itemId, 'item');
      if (item.unlimited) throw new StoryError('Unlimited supplies cannot be split. Draw a counted portion instead.');
      if (item.quantity !== e.expectedQuantity) throw new StoryError('An item quantity changed since the proposal was made.');
      if (item.isContainer) throw new StoryError('Containers cannot be split.');
      if (e.quantity >= item.quantity) throw new StoryError('A split must leave at least one item in the original stack.');
      item.quantity -= e.quantity;
      canon.items.push({ id: assigned[e.ref], name: item.name, description: item.description, ...(item.visualDescription !== undefined ? {visualDescription:item.visualDescription} : {}), quantity: e.quantity, ownerId: ref(e.ownerId), equipped: false, isContainer: false });
    } else if (e.type === 'item.draw') {
      const item = requireRecord(canon.items, e.itemId, 'item');
      if (!item.unlimited) throw new StoryError('A counted portion can only be drawn from an unlimited supply. Split a counted stack instead.');
      canon.items.push({ id: assigned[e.ref], name: item.name, description: item.description, ...(item.visualDescription !== undefined ? {visualDescription:item.visualDescription} : {}), quantity: e.quantity, ownerId: ref(e.ownerId), equipped: false, isContainer: false });
    } else if (e.type === 'item.quantity') {
      const item = requireRecord(canon.items, e.itemId, 'item'); if (item.unlimited) throw new StoryError('Unlimited supplies do not have a remaining count and cannot be depleted by quantity changes.'); if (item.quantity !== e.expectedQuantity) throw new StoryError('An item quantity changed since the proposal was made.');
      if (!e.quantity) canon.items = canon.items.filter(i => i.id !== item.id); else item.quantity = e.quantity;
    } else if (e.type === 'item.equip') { const item = requireRecord(canon.items, e.itemId, 'item'); if (item.unlimited && e.equipped) throw new StoryError('An unlimited supply cannot be equipped. Draw a counted portion instead.'); item.equipped = e.equipped; }
    else if (e.type === 'relationship.update') requireRecord(canon.relationships, e.relationshipId, 'relationship').notes = e.notes;
    else if (e.type === 'thread.update') { const t = requireRecord(canon.threads, e.threadId, 'thread'); t.notes = e.notes; t.status = e.status; }
    else if (e.type === 'funds.change') { if (canon.funds !== e.expectedBalance) throw new StoryError('The funds balance changed since the proposal was made.'); canon.funds = e.balance; }
  }
  const valid = canonSchema.parse(canon);
  try { validateCanonicalState(valid); } catch { throw new StoryError('Proposed changes contain invalid entity references, ownership, or place/item containment. No changes were applied.'); }
  return { canon: valid, assigned, effects };
}
