import { z } from 'zod';
import { contextSchema, emptyContext } from './context-types';
import { storyPreferencesSchema } from './settings';
import { effectsSchema } from './effect-types';
import { mediaSchema, emptyMedia } from './media';
import { visualIdentitySchema } from './visual-identity';
import { personaSchema, wardrobeSchema, normalizeCharacterProfile } from './character-profile';
import { factPinsSchema, emptyFactPins, validateFactPins } from './fact-pins';
import { validateInventoryState } from './inventory';
export type { MediaAsset } from './media';

const id = z.string().min(1).max(100);
const text = z.string().max(40000);
export const characterSchema = z.object({
  id, name: z.string().min(1).max(120), role: z.string().max(120),
  appearance: text.default(''), notes: text, outfit: text.default(''), locationId: id, visual: visualIdentitySchema.optional(),
  persona:personaSchema.optional(),currentState:z.string().max(4000).optional(),wardrobe:wardrobeSchema.optional(),injuries:z.string().max(4000).optional(),appearanceNotes:text.optional(),outfitNotes:text.optional(),
  noNsfw: z.boolean().default(true), pinnedAppearance: z.boolean().default(false)
}).overwrite(normalizeCharacterProfile);
export const canonSchema = z.object({
  characters: z.array(characterSchema).max(200),
  places: z.array(z.object({ id, name: z.string().min(1).max(200), description: text, visualDescription:z.string().max(4000).optional(), parentId: id.nullable() })).max(500),
  items: z.array(z.object({ id, name: z.string().min(1).max(200), description: text, visualDescription:z.string().max(4000).optional(), quantity: z.number().int().min(1).max(1000000), ownerId: id, equipped: z.boolean(), isContainer: z.boolean().optional(), unlimited:z.boolean().optional() })).max(5000),
  relationships: z.array(z.object({ id, fromId: id, toId: id, notes: text })).max(1000),
  threads: z.array(z.object({ id, title: z.string().min(1).max(200), notes: text, status: z.enum(['open', 'resolved']) })).max(500),
  funds: z.number().finite().min(0), cargoNotes: text
});
export const passageSchema = z.object({
  id, chapter: z.number().int().min(1), chapterTitle: z.string().min(1).max(200),
  title: z.string().min(1).max(200), viewpoint: z.string().max(120), viewpointId:id.optional(),
  paragraphs: z.array(z.string().min(1).max(40000)).min(1).max(100),
  direction: text, endOfChapter: z.boolean(), createdAt: z.string().datetime(),
  generation: z.object({ sourceRevision: z.number().int().min(0), requestId: z.string().uuid().optional(), effects: effectsSchema, assignedIds: z.record(z.string(), id) }).optional()
});
export const recapSchema = z.object({
  text: z.string().min(1).max(40000), sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  throughPassageId: id, passageCount: z.number().int().min(1),
  source: z.enum(['manual', 'generated']), updatedAt: z.string().datetime(), stale: z.boolean()
});
export const summaryCacheSchema = z.array(z.object({ hash: z.string().regex(/^[a-f0-9]{64}$/), text: z.string().min(1).max(12000) })).max(500);
export const storySchema = z.object({
  branchOrigin: z.strictObject({storyId:id,passageId:id,checkpoint:z.string().regex(/^[a-f0-9]{64}$/),forkedAt:z.string().datetime()}).optional(),
  origin: z.enum(['sample','generated']).default('sample'),
  id, title: z.string().min(1).max(200), premise: text,
  revision: z.number().int().min(0), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  passages: z.array(passageSchema).min(1).max(10000), canon: canonSchema,
  recovery: z.object({ passageId: id, canon: canonSchema, valid: z.boolean(), loreLinks:z.array(z.object({loreId:id,beforeIds:z.array(id).max(30),afterIds:z.array(id).max(30)})).max(300).optional() }).nullable(),
  narrationStyle: text, artStyle: text, adultContent: z.boolean().default(false),
  preferences: storyPreferencesSchema.prefault({}),
  recap: recapSchema.nullable().default(null), summaryCache: summaryCacheSchema.default([]),
  context: contextSchema.default(emptyContext), media: mediaSchema.default(emptyMedia), factPins: factPinsSchema.default(emptyFactPins)
});
export type Character = z.infer<typeof characterSchema>;
export type Canon = z.infer<typeof canonSchema>;
export type Passage = z.infer<typeof passageSchema>;
export type Story = z.infer<typeof storySchema>;
export type LibraryEntry = Pick<Story, 'id' | 'title' | 'updatedAt' | 'revision'> & { chapter: number; passageTitle: string };

function unique(values: string[]) { if (new Set(values).size !== values.length) throw new Error('Duplicate record IDs in story.'); }
/** Planning references may use canon and visible author background, never hidden lore. */
export function sceneBriefResourceIds(story: Pick<Story, 'canon' | 'context'>): Set<string> {
  return new Set([...story.canon.characters, ...story.canon.places, ...story.canon.items, ...story.canon.relationships, ...story.canon.threads, ...story.context.lore.filter(row => row.visibility !== 'hidden')].map(row => row.id));
}
/** Removing a record must not leave an otherwise valid future plan dangling. */
export function pruneSceneBriefResources(story: Pick<Story, 'canon' | 'context'>): void {
  const resources = story.context.sceneBrief.resourceIds;
  if (resources) { const valid = sceneBriefResourceIds(story); story.context.sceneBrief.resourceIds = resources.filter(id => valid.has(id)); }
}
export function validateCanonicalState(canon: Canon) {
  unique([...canon.characters, ...canon.places, ...canon.items, ...canon.relationships, ...canon.threads].map(record => record.id));
  const places = new Map(canon.places.map(p => [p.id, p]));
  const people = new Set(canon.characters.map(p => p.id));
  const holders = new Set([...places.keys(), ...people]);
  unique([...holders, ...canon.items.map(i => i.id)]);
  unique([...canon.places.map(p => p.id), ...canon.characters.map(p => p.id)]);
  unique(canon.relationships.map(r => r.id)); unique(canon.threads.map(t => t.id));
  for (const p of canon.places) {
    const seen = new Set([p.id]); let parent = p.parentId;
    while (parent) { if (seen.has(parent) || !places.has(parent)) throw new Error('Invalid place containment.'); seen.add(parent); parent = places.get(parent)!.parentId; }
  }
  for (const p of canon.characters) if (!places.has(p.locationId)) throw new Error('Character location does not exist.');
  validateInventoryState(canon);
  for (const r of canon.relationships) if (!people.has(r.fromId) || !people.has(r.toId)) throw new Error('Relationship character does not exist.');
}

export function validateStory(value: unknown): Story {
  const story = storySchema.parse(value);
  const c = story.canon;
  function unique(values: string[]) { if (new Set(values).size !== values.length) throw new Error('Duplicate record IDs in story.'); }
  validateCanonicalState(c);
  validateFactPins(story);
  unique(story.passages.map(p => p.id));
  let chapter = 1;
  const names = new Map<number, string>();
  for (const p of story.passages) {
    if (p.chapter < chapter || p.chapter > chapter + 1 || (!names.size && p.chapter !== 1)) throw new Error('Invalid chapter order.');
    chapter = p.chapter;
    if (names.has(chapter) && names.get(chapter) !== p.chapterTitle) throw new Error('Inconsistent chapter titles.');
    names.set(chapter, p.chapterTitle);
  }
  if (story.recovery) {
    if (story.recovery.passageId !== story.passages.at(-1)!.id) throw new Error('Recovery must belong to the latest passage.');
    validateCanonicalState(story.recovery.canon);
  }
  const people = new Set(c.characters.map(p => p.id)), places = new Set(c.places.map(p => p.id));
  const entities = new Set([...people, ...places, ...c.items.map(i => i.id)]), passageIds = new Set(story.passages.map(p => p.id));
  const context = story.context, brief = context.sceneBrief;
  unique(story.media.assets.map(a => a.id));
  const assets = new Map(story.media.assets.map(a => [a.id, a]));
  for (const a of assets.values()) {
    unique(a.subjectIds); unique(a.snapshots.map(s => s.id));
    if (a.subjectIds.some(id => !entities.has(id) && !a.snapshots.some(s => s.id === id))) throw new Error('Invalid image subject reference.');
    if (a.source && !passageIds.has(a.source.passageId)) throw new Error('Invalid image passage reference.');
    if (a.parentId && !assets.has(a.parentId)) throw new Error('Invalid image parent reference.');
    const seen = new Set([a.id]); let parent = a.parentId;
    while (parent) { if (seen.has(parent)) throw new Error('Cyclic image variants.'); seen.add(parent); parent = assets.get(parent)!.parentId; }
  }
  for (const selection of [story.media.portraits, story.media.references]) for (const [person, assetId] of Object.entries(selection)) {
    if (!people.has(person) || !assets.get(assetId)?.subjectIds.includes(person)) throw new Error('Invalid portrait/reference selection.');
  }
  if ((brief.viewpointId && !people.has(brief.viewpointId)) || (brief.locationId && !places.has(brief.locationId)) || brief.castIds.some(id => !people.has(id))) throw new Error('Invalid scene brief reference.');
  if (brief.resourceIds) {
    unique(brief.resourceIds);
    const resources = sceneBriefResourceIds(story);
    if (brief.resourceIds.some(id => !resources.has(id))) throw new Error('Invalid or hidden scene brief resource reference.');
  }
  unique(context.lore.map(l => l.id)); unique(context.knowledge.map(k => k.id)); unique(context.memories.map(m => m.id));
  unique(context.compaction.chapters.map(m => m.id));
  unique(context.compaction.chapters.map(m => String(m.chapter)));
  for (const m of context.compaction.chapters) {
    if (m.level !== 'chapter' || m.chapter === null || JSON.stringify(m.chapterNumbers) !== JSON.stringify([m.chapter])) throw new Error('Invalid chapter memory level.');
  }
  if (context.compaction.book && (context.compaction.book.level !== 'book' || context.compaction.book.chapter !== null)) throw new Error('Invalid book memory level.');
  for (const lore of context.lore) if (lore.relatedIds.some(id => !entities.has(id))) throw new Error('Invalid lore reference.');
  for (const k of context.knowledge) if (k.knownBy.some(id => !people.has(id)) || (k.sourcePassageId && !passageIds.has(k.sourcePassageId))) throw new Error('Invalid knowledge reference.');
  for (const m of context.memories) if (m.passageIds.some(id => !passageIds.has(id)) || m.characterIds.some(id => !people.has(id)) || m.locationIds.some(id => !places.has(id))) throw new Error('Invalid continuity memory reference.');
  return story;
}

export function transferItem(canon: Canon, itemId: string, ownerId: string): void {
  const item = canon.items.find(i => i.id === itemId);
  if (!item) throw new Error('Item does not exist.');
  validateInventoryState({ ...canon, items: canon.items.map(current => current.id === itemId ? { ...current, ownerId, equipped: false } : current) });
  item.ownerId = ownerId; item.equipped = false;
}
