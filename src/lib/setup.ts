import { z } from 'zod';
export const characterRedesignModeSchema = z.enum(['revise','full','name']);
export type CharacterRedesignMode = z.infer<typeof characterRedesignModeSchema>;
import { canonSchema, validateCanonicalState, validateStory, type Story } from './story';
import { contextSchema, emptyContext } from './context-types';
import { emptyMedia } from './media';
import { storyPreferencesSchema } from './settings';
import { normalizeCharacterProfile } from './character-profile';
import { emptyFactPins, factPinsSchema } from './fact-pins';

export const setupInputSchema = z.object({
  title: z.string().trim().max(200).default(''), premise: z.string().trim().min(1).max(8000),
  castSize: z.number().int().min(1).max(8).default(3), narrationStyle: z.string().max(4000).default('Character-driven, vivid prose with distinct voices.'),
  artStyle: z.string().max(4000).default('Painterly illustration, cinematic lighting.'), adultContent: z.boolean().default(false), preferences: storyPreferencesSchema.prefault({})
});
export const setupPlanSchema = z.object({ title: z.string().trim().min(1).max(200), chapterTitle: z.string().trim().min(1).max(200), canon: canonSchema, context: contextSchema, factPins: factPinsSchema.prefault({}) });
export const setupDraftSchema = z.object({ id: z.string().uuid(), revision: z.number().int().min(0), createdAt: z.string().datetime(), updatedAt: z.string().datetime(), input: setupInputSchema, plan: setupPlanSchema.nullable(), storyId: z.string().uuid().nullable() });
export const setupSaveSchema = z.object({ expectedRevision: z.number().int().min(0), requestId: z.string().uuid(), input: setupInputSchema, plan: setupPlanSchema.nullable() });
export const generationRequestSchema = z.object({ expectedRevision: z.number().int().min(0), requestId: z.string().uuid() });
export type SetupInput = z.infer<typeof setupInputSchema>;
export type SetupPlan = z.infer<typeof setupPlanSchema>;
export type SetupDraft = z.infer<typeof setupDraftSchema>;

export function setupStoryBase(draft: SetupDraft): Story {
  const plan = setupPlanSchema.parse(draft.plan);
  return { origin: 'generated', id: draft.id, title: plan.title, premise: draft.input.premise, revision: 0, createdAt: draft.createdAt, updatedAt: new Date().toISOString(),
    canon: structuredClone(plan.canon), passages: [], recovery: null, narrationStyle: draft.input.narrationStyle, artStyle: draft.input.artStyle, adultContent: draft.input.adultContent,
    preferences: structuredClone(draft.input.preferences), recap: null, summaryCache: [], context: structuredClone(plan.context), media: emptyMedia(), factPins: structuredClone(plan.factPins) };
}
export function validateSetupPlan(value: unknown): SetupPlan {
  const plan = setupPlanSchema.parse(value);
  if (!plan.canon.characters.length || !plan.canon.places.length) throw new Error('The setup needs at least one cast member and one place.');
  const names = plan.canon.characters.map(c => c.name.trim().toLocaleLowerCase());
  if (names.some(n => !n) || plan.canon.places.some(p => !p.name.trim()) || plan.canon.items.some(i => !i.name.trim()) || plan.canon.threads.some(t => !t.title.trim())) throw new Error('Cast, places, possessions and threads need names/titles.');
  if (new Set(names).size !== names.length) throw new Error('Cast members need distinct names.');
  validateCanonicalState(plan.canon);
  if (!plan.context.sceneBrief.viewpointId || !plan.context.sceneBrief.locationId) throw new Error('Choose an opening viewpoint and location.');
  const { memories, knowledge, compaction } = plan.context;
  if (memories.length || knowledge.some(k => k.sourcePassageId || k.sourceHash) || compaction.epoch !== 0 || compaction.chapters.length || compaction.book) {
    throw new Error('An unwritten story cannot reference earlier passages or contain memory history.');
  }
  // Reuse the complete reference validator without ever persisting a dummy passage.
  const base = setupStoryBase({ id: '00000000-0000-4000-8000-000000000000', revision: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), input: setupInputSchema.parse({ premise: 'Validation' }), plan, storyId: null });
  base.passages = [{ id: 'validation-only', title: 'Validation', chapter: 1, chapterTitle: plan.chapterTitle, viewpoint: plan.canon.characters[0].name, paragraphs: ['Validation only.'], direction: '', endOfChapter: false, createdAt: base.createdAt }];
  validateStory(base); return plan;
}
export function blankSetupPlan(allocate: () => string = () => crypto.randomUUID()): SetupPlan {
  const place = allocate(), person = allocate(), context = emptyContext();
  context.sceneBrief = { scope: 'next-passage', clearAfterPassage: true, purpose: 'Introduce the cast and an immediate complication.', tension: '', stopAt: 'A natural decision point.', viewpointId: person, locationId: place, castIds: [person] };
  return { title: 'Untitled story', chapterTitle: 'A beginning', canon: { characters: [normalizeCharacterProfile({ id: person, name: 'Main cast member', role: '', notes: '', appearance: '', outfit: '', locationId: place, noNsfw: true, pinnedAppearance: false })], places: [{ id: place, name: 'Starting place', description: '', parentId: null }], items: [], relationships: [], threads: [], funds: 0, cargoNotes: '' }, context, factPins: emptyFactPins() };
}
