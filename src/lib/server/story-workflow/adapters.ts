import { z } from 'zod';
import { setupDraftSchema, type SetupDraft } from '../../setup';
import { storySchema, passageSchema, type Story } from '../../story';
import { passageContentSchema, passageProposalSchema, passageMemorySchema } from '../../passage-proposal';
import { retainedPassageSchema, type RetainedPassage } from '../../passage-recovery';
import { workflowCheckSchema, type WorkflowCheck } from '../../story-workflow/contracts';
import { resolvedFactPins } from '../../fact-pins';
import { countWords } from '../../story-length';
import { StoryError } from '../../errors';
import type { StoryRepository } from '../repository';
import { connectionSchema } from '../connections';
import { needsInventoryReview, reviewInventory } from '../inventory-review';
import {
  narrationSchema, extractionResponseSchema, preparePassageGeneration, prepareNarrationRequest,
  requestPassageNarration, expandPassageNarration, finalizePassageContent,
  preparePassageExtraction, requestPassageExtraction, validatePassageExtraction, preparePassageRepair, requestPassageRepair,
  PassageUpdateError, type PreparedPassage, type NarrationRequest, type Narration, type ExtractionRequest, type ExtractionRetry, type PassageSource
} from '../story-generation';
import type { JobContext } from '../jobs';
import type { NodeAdapter, NodeContext } from './runner';

export type Connections = z.infer<typeof connectionSchema>;
type Content = ReturnType<typeof finalizePassageContent>;
type Envelope = {
  text: string; response: z.infer<typeof extractionResponseSchema>; request: ExtractionRequest;
  extracted?: ReturnType<typeof validatePassageExtraction>; reviewRequired: boolean; issues: string[]; checks: WorkflowCheck[];
};
const messagesSchema = z.array(z.strictObject({ role: z.enum(['system', 'user', 'assistant']), content: z.string() }));
const requestSchema = z.object({ messages: messagesSchema, schema: z.record(z.string(), z.json()), contextReport: z.json().optional(), prepared: z.lazy(() => preparedSchema) });
const extractionRequestSchema = z.strictObject({ messages: messagesSchema, schema: z.record(z.string(), z.json()), outputTokens: z.number().int().positive(), sources: z.array(z.strictObject({ id: z.string(), paragraphIndex: z.number().int().min(0), text: z.string() })) });
// Opening and replacement of the first passage have no prior prose. Only the
// internal prepared state permits that; committed outputs still use storySchema.
const workingStorySchema = storySchema.extend({passages:z.array(passageSchema)});
const preparedSchema = z.object({
  story: workingStorySchema, opening: z.boolean(), replacing: z.boolean(), latest: passageSchema.optional(), direction: z.string(), startsChapter: z.boolean(), chapterTitle: z.string(), writtenWords: z.number(), chapterEnding: z.enum(['auto', 'close', 'keep-open']), chapterTarget: z.number(), minimumWords: z.number(),
  requirements: z.object({ schema: z.record(z.string(), z.json()), requestedViewpoint: z.string().nullable(), pacing: z.string(), instructions: z.string() }),
  factPins: z.object({ fields: z.array(z.json()), rules: z.array(z.json()) }), schema: z.record(z.string(), z.json()), requestedViewpoint: z.string().nullable(), pacing: z.string()
});
const contentSchema = z.strictObject({ content: passageContentSchema, narration: narrationSchema, length: z.object({ words: z.number(), originalWords: z.number(), expanded: z.boolean() }).passthrough() });
const envelopeSchema = z.strictObject({ text: z.string(), response: extractionResponseSchema, request: extractionRequestSchema,
  extracted: z.strictObject({ effects: passageProposalSchema.shape.effects, memory: passageMemorySchema }).optional(),
  reviewRequired: z.boolean(), issues: z.array(z.string()), checks: z.array(workflowCheckSchema) });
const blockedSchema = z.strictObject({ message: z.string(), issues: z.array(z.string()).min(1), status: z.number().int() });
const schemas: Record<string, Record<string, z.ZodType>> = {
  source: { source: z.union([storySchema, setupDraftSchema]) }, model: { model: z.strictObject({ connectionRef: z.literal('configured-text'), settings: z.json() }) },
  prepare: { prepared: preparedSchema }, preflight: { request: requestSchema }, narrate: { narration: narrationSchema },
  length: { ready: contentSchema, short: z.strictObject({ narration: narrationSchema, firstWords: z.number() }) }, expand: { ready: contentSchema }, content: { content: contentSchema },
  retain: { retained: retainedPassageSchema }, 'extraction-preflight': { request: extractionRequestSchema }, extract: { proposal: envelopeSchema },
  validate: { candidate: envelopeSchema, repair: envelopeSchema }, review: { checked: envelopeSchema, repair: envelopeSchema }, 'repair-input': { repair: envelopeSchema },
  repair: { proposal: envelopeSchema }, revalidate: { candidate: envelopeSchema, blocked: blockedSchema }, rereview: { checked: envelopeSchema, blocked: blockedSchema },
  acceptance: { approved: passageProposalSchema, review: retainedPassageSchema }, commit: { committed: storySchema }, blocked: { draft: blockedSchema }
};
export function validatePassagePayload(nodeType: string, port: string, value: unknown) {
  const schema = schemas[nodeType]?.[port];
  if (!schema) throw new StoryError('Unknown passage workflow artifact payload.');
  schema.parse(JSON.parse(JSON.stringify(value))); // Validate the exact durable JSON representation.
}
const pick = <T>(context: NodeContext, port: string): T => {
  const value = context.inputs[port];
  if (value?.length !== 1) throw new StoryError(`Missing or ambiguous ${port} input.`);
  return value[0].value as T;
};
const check = (kind: WorkflowCheck['kind'], issues: string[], required = true): WorkflowCheck => ({ kind, status: issues.length ? 'issues' : required ? 'pass' : 'not-required', issues: issues.map(message => ({ category: kind === 'model' ? 'consistency' : 'schema', message, entityIds: [] })) });

export function passageAdapters(options: {
  repository: StoryRepository; source: Story; setup?: SetupDraft; mode: 'opening'|'continue'|'replace'; input: { requestId: string; expectedRevision: number; direction: string; chapterEnding: 'auto' | 'close' | 'keep-open' };
  fingerprint: string; connections: Connections; job: JobContext; onDraft: (event: unknown) => void;
  retained?: RetainedPassage; retry?: ExtractionRetry; onReady?: (record: RetainedPassage) => void;
}) {
  const { repository: repository, source, input, connections: c, job, onDraft } = options;
  const kind = options.mode === 'opening' ? 'setup' : 'story';
  let retained = options.retained;
  let working: Story; // The pre-event state for replacement; current constraints remain on source.
  const handlers: Record<string, NodeAdapter['execute']> = {
    source: () => ({ source: options.setup ?? source }),
    model: () => { const { apiKey: _key, baseUrl: _url, ...text } = c.text; return { model: { connectionRef: 'configured-text', settings: { text, context: c.context, prompts: c.prompts } } }; },
    prepare: () => {
      const generation: PassageSource = options.setup ? {setup:options.setup} : {story:source,mode:options.mode==='replace'?'replace':'continue',direction:input.direction,chapterEnding:input.chapterEnding};
      const prepared = preparePassageGeneration(generation, c, {effectsOnly:Boolean(options.retry)});
      working = prepared.story;
      return {prepared};
    },
    preflight: context => {
      const prepared = pick<PreparedPassage>(context, 'prepared');
      return { request: { ...prepareNarrationRequest(prepared, c, onDraft), prepared } };
    },
    narrate: async context => {
      const request = pick<NarrationRequest & {prepared:PreparedPassage}>(context, 'request');
      return { narration: await requestPassageNarration(request.prepared, request, c, context.signal, context.fetcher) };
    },
    length: context => {
      const prepared = pick<PreparedPassage>(context, 'prepared'), narration = pick<Narration>(context, 'narration'), firstWords = countWords(narration.paragraphs);
      return firstWords < prepared.minimumWords ? { short: { narration, firstWords } } : { ready: finalizePassageContent(prepared, narration, firstWords, onDraft) };
    },
    expand: async context => {
      const prepared = pick<PreparedPassage>(context, 'prepared'), short = pick<{ narration: Narration; firstWords: number }>(context, 'short');
      const narration = await expandPassageNarration(prepared, pick<NarrationRequest>(context, 'request'), short.narration, c, context.signal, onDraft, context.fetcher);
      return { ready: finalizePassageContent(prepared, narration, short.firstWords, onDraft) };
    },
    content: context => ({ content: pick<Content>(context, 'candidates') }),
    retain: context => {
      const content = pick<Content>(context, 'content').content;
      retained = repository.retainPassage(kind, source.id, input.requestId, options.fingerprint, source, content);
      onDraft({ stage: 'retained-content', content }); return { retained };
    },
    'extraction-preflight': context => ({ request: preparePassageExtraction(pick<PreparedPassage>(context, 'prepared').story, pick<RetainedPassage>(context, 'retained').content, c, options.retry, resolvedFactPins(source)) }),
    extract: async context => {
      const request = pick<ExtractionRequest>(context, 'request'), raw = await requestPassageExtraction(working, request, c, context.signal, context.fetcher);
      repository.updateRetainedEffects(kind, source.id, retained!.id, input.requestId, working, raw.response.effects);
      onDraft({ stage: 'extracted-effects', effects: raw.response.effects });
      return { proposal: { ...raw, request, reviewRequired: raw.response.effects.some(effect => Boolean(effect && typeof effect === 'object' && 'type' in effect && typeof effect.type === 'string' && effect.type.startsWith('item.'))), issues: [], checks: [] } satisfies Envelope };
    },
    validate: context => {
      const proposal = structuredClone(pick<Envelope>(context, 'proposal'));
      try { proposal.extracted = validatePassageExtraction(pick<PreparedPassage>(context, 'prepared').story, pick<RetainedPassage>(context, 'retained').content, proposal.response, proposal.request.sources); }
      catch (error) { if (!(error instanceof StoryError || error instanceof z.ZodError)) throw error; proposal.issues = [error.message]; }
      proposal.checks.push(check('deterministic', proposal.issues));
      return proposal.issues.length ? { repair: proposal } : { candidate: proposal };
    },
    review: async context => {
      const candidate = structuredClone(pick<Envelope>(context, 'candidate'));
      const required = needsInventoryReview(pick<PreparedPassage>(context, 'prepared').story, retained!.content.draft.paragraphs, candidate.extracted!.effects);
      if (required) {
        candidate.reviewRequired = true; onDraft({ stage: 'inventory-review' });
        candidate.issues = await reviewInventory(working, retained!.content.draft.paragraphs, candidate.extracted!.effects, candidate.extracted!.memory, c.text, c.context.overheadTokens, context.signal, context.fetcher);
      }
      candidate.checks.push(check('model', candidate.issues, required));
      return candidate.issues.length ? { repair: candidate } : { checked: candidate };
    },
    'repair-input': context => ({ repair: pick<Envelope>(context, 'issues') }),
    repair: async context => {
      const candidate = pick<Envelope>(context, 'repair'); onDraft({ stage: 'repairing-inventory', issues: candidate.issues });
      const request = preparePassageRepair(pick<ExtractionRequest>(context, 'request'), candidate.text, candidate.issues, c);
      const result = await requestPassageRepair(working, request, c, context.signal, context.fetcher);
      repository.updateRetainedEffects(kind, source.id, retained!.id, input.requestId, working, result.response.effects);
      onDraft({ stage: 'extracted-effects', effects: result.response.effects });
      return { proposal: { ...candidate, ...result, extracted: undefined, issues: [] } };
    },
    revalidate: context => {
      const candidate = structuredClone(pick<Envelope>(context, 'proposal'));
      try { candidate.extracted = validatePassageExtraction(pick<PreparedPassage>(context, 'prepared').story, pick<RetainedPassage>(context, 'retained').content, candidate.response, candidate.request.sources); }
      catch (error) {
        if (!(error instanceof StoryError || error instanceof z.ZodError)) throw error;
        const message = 'The model returned invalid passage effects after one repair attempt. Nothing was saved. ' + error.message + ' Check the affected item quantity and unit in setup Possessions if the prose requires more stock than recorded.';
        return { blocked: { message, issues: [error.message], status: 502 } };
      }
      candidate.checks.push(check('deterministic', [])); return { candidate };
    },
    rereview: async context => {
      const candidate = structuredClone(pick<Envelope>(context, 'candidate'));
      const required = candidate.reviewRequired || needsInventoryReview(pick<PreparedPassage>(context, 'prepared').story, retained!.content.draft.paragraphs, candidate.extracted!.effects);
      candidate.issues = required ? await reviewInventory(working, retained!.content.draft.paragraphs, candidate.extracted!.effects, candidate.extracted!.memory, c.text, c.context.overheadTokens, context.signal, context.fetcher) : [];
      candidate.checks.push(check('model', candidate.issues, required));
      if (candidate.issues.length) return { blocked: { message: new PassageUpdateError(candidate.issues).message, issues: candidate.issues, status: 502 } };
      return { checked: candidate };
    },
    acceptance: context => {
      const candidate = pick<Envelope>(context, 'candidates'), proposal = passageProposalSchema.parse({ ...retained!.content, ...candidate.extracted });
      if (options.retry) {
        job.stage('validating');
        const ready = repository.readyRetained(kind, source.id, retained!.id, input.requestId, source, proposal,ready=>context.persist({review:ready}));
        options.onReady?.(ready); return { review: ready };
      }
      job.stage('validating'); return { approved: proposal };
    },
    commit: context => {
      job.stage('committing');
      if (kind === 'setup') return {committed:repository.commitOpening(source.id,input.expectedRevision,input.requestId,options.fingerprint,pick(context,'approved'),saved=>context.persist({committed:saved}))};
      return { committed: repository.commitGeneratedPassage(source.id, { expectedRevision: input.expectedRevision, requestId: input.requestId, proposal: pick(context, 'approved') }, options.fingerprint,saved=>context.persist({committed:saved})) };
    },
    blocked: context => ({ draft: pick(context, 'issues') })
  };
  return Object.fromEntries(Object.entries(handlers).map(([type, execute]) => [type, { execute, validate: (port: string, value: unknown) => validatePassagePayload(type, port, value) }])) as Record<string, NodeAdapter>;
}
