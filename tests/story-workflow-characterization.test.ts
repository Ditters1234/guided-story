// Characterize the existing engine only. The workflow descriptors do not execute yet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { blankSetupPlan } from '../src/lib/setup';
import { StoryRepository } from '../src/lib/server/repository';
import { connectionSchema } from '../src/lib/server/connections';
import { generateRetainedPassage } from '../src/lib/server/passage-recovery';
import { generatePassage } from '../src/lib/server/story-generation';
import { defaultStoryWorkflow, builtInStoryNodes } from '../src/lib/story-workflow/default-graph';
import { validateWorkflow } from '../src/lib/story-workflow/validate';

const settings = () => connectionSchema.parse({ ...JSON.parse(readFileSync('config/connections.example.json', 'utf8')), text: { model: 'workflow-fixture', baseUrl: 'http://localhost:9999/v1', contextTokens: 32000, maxTokens: 4096, temperature: 0.8, structuredOutput: 'prompt' } });
const paragraphs = [Array(12).fill('Alex listened to the rain and considered the quiet morning ahead.').join(' ')];
const narration = (short = false) => ({ title: 'Rain', chapterTitle: 'Morning', viewpointId: 'alex', endOfChapter: false, paragraphs: short ? ['Alex listened to the rain.'] : paragraphs });
const updates = { effects: [], memory: { summary: 'Alex listened to the rain.', facts: [], openQuestions: [], characterIds: ['alex'], locationIds: ['stable'] } };
const response = (value: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: typeof value === 'string' ? value : JSON.stringify(value) }, finish_reason: 'stop' }] }));
function fixture(repository: StoryRepository) {
  const draft = repository.createSetup({ premise: 'A quiet morning.', castSize: 1, preferences: { passageWords: 100 } }, randomUUID());
  const plan = blankSetupPlan(); plan.title = 'Workflow fixture'; plan.chapterTitle = 'Morning';
  plan.canon.places = [{ id: 'stable', name: 'Stable', description: 'A quiet stable.', parentId: null }];
  Object.assign(plan.canon.characters[0], { id: 'alex', name: 'Alex', locationId: 'stable' });
  plan.context.sceneBrief = { ...plan.context.sceneBrief, viewpointId: 'alex', locationId: 'stable', castIds: ['alex'], purpose: 'Listen to the rain.' };
  return repository.saveSetup(draft.id, { expectedRevision: draft.revision, requestId: randomUUID(), input: draft.input, plan });
}

for (const mode of ['opening', 'continue', 'replace'] as const) test(`existing ${mode} trace retains complete prose before extraction and commits one replay-safe result`, async () => {
  const repository = new StoryRepository(':memory:');
  try {
    const setup = fixture(repository), opening = { mode: 'continue' as const, direction: '', draft: { ...narration(), startsChapter: true }, ...updates };
    const initial = mode === 'opening' ? undefined : repository.commitOpening(setup.id, setup.revision, randomUUID(), 'seed', opening);
    const source = initial ? { story: initial, mode: mode as 'continue' | 'replace', direction: 'Listen to the rain.' } : { setup };
    const kind = initial ? 'story' as const : 'setup' as const, id = initial?.id ?? setup.id;
    const requestId = randomUUID(), fingerprint = `characterization-${mode}`, trace: string[] = [];
    let generated: Awaited<ReturnType<typeof generatePassage>>;
    const commit = (proposal: Awaited<ReturnType<typeof generatePassage>>) => {
      generated = proposal;
      trace.push('commit');
      return initial ? repository.commitGeneratedPassage(id, { expectedRevision: initial.revision, requestId, proposal }, fingerprint) : repository.commitOpening(id, setup.revision, requestId, fingerprint, proposal);
    };
    const provider: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init!.body)), extracting = body.messages[0].content.startsWith('Return {effects:');
      if (extracting) {
        const retained = repository.listRetained(kind, id);
        assert.equal(retained.length, 1); assert.deepEqual(retained[0].content.draft.paragraphs, paragraphs);
        trace.push('extract'); return response(updates);
      }
      assert.equal(trace.length, 0, 'a quiet scene needs no review, expansion or hidden planning request');
      trace.push('narrate'); return response(narration());
    };
    const saved = await generateRetainedPassage({ repository, kind, id, requestId, fingerprint }, source, settings(), new AbortController().signal, event => {
      if (event && typeof event === 'object' && 'stage' in event && event.stage === 'retained-content') trace.push('retain');
    }, commit, provider);
    assert.deepEqual(trace, ['narrate', 'retain', 'extract', 'commit']);
    assert.equal(saved.passages.length, mode === 'continue' ? 2 : 1);
    if (mode === 'replace') assert.equal(saved.passages[0].id, initial!.passages[0].id);
    const replay = initial ? repository.generatedPassageResult(id, requestId, fingerprint) : repository.openingResult(id, requestId, fingerprint);
    assert.deepEqual(replay, saved); assert.deepEqual(commit(generated!), saved);
    const graph = defaultStoryWorkflow(mode); assert.equal(validateWorkflow(graph, builtInStoryNodes).valid, true);
    const edge = (from: string, to: string) => graph.edges.some(e => e.from.node === from && e.to.node === to);
    assert.ok(edge('narrate', 'length') && edge('content', 'retain') && edge('retain', 'extraction-preflight') && edge('acceptance', 'commit'));
  } finally { repository.close(); }
});

test('existing short-passage branch expands once before retaining final prose', async () => {
  const repository = new StoryRepository(':memory:');
  try {
    const setup = fixture(repository), trace: string[] = [];
    const provider: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init!.body));
      if (body.messages[0].content.startsWith('Return {effects:')) { trace.push('extract'); return response(updates); }
      if (body.messages.some((m: { content: string }) => m.content.startsWith('The draft is only'))) { trace.push('expand'); return response(narration()); }
      trace.push('narrate'); return response(narration(true));
    };
    const proposal = await generatePassage({ setup }, settings(), new AbortController().signal, event => {
      if (event && typeof event === 'object' && 'stage' in event && event.stage === 'retained-content') trace.push('retain');
    }, provider);
    assert.deepEqual(trace, ['narrate', 'expand', 'retain', 'extract']); assert.deepEqual(proposal.draft.paragraphs, paragraphs);
    assert.equal(defaultStoryWorkflow('opening').nodes.filter(n => n.type === 'expand').length, 1);
  } finally { repository.close(); }
});

test('existing extraction failure leaves complete prose outside canon without a narration retry', async () => {
  const repository = new StoryRepository(':memory:');
  try {
    const setup = fixture(repository), requestId = randomUUID(); let calls = 0, commits = 0;
    const before = repository.readSetup(setup.id);
    await assert.rejects(generateRetainedPassage({ repository, kind: 'setup', id: setup.id, requestId, fingerprint: 'failure' }, { setup }, settings(), new AbortController().signal, () => {}, () => { commits++; throw new Error('unexpected commit'); }, async () => {
      calls++; return calls === 1 ? response(narration()) : response('{broken');
    }), /retained/);
    assert.equal(calls, 2); assert.equal(commits, 0); assert.deepEqual(repository.readSetup(setup.id), before);
    const retained = repository.listRetained('setup', setup.id); assert.equal(retained[0].status, 'blocked');
    assert.deepEqual(retained[0].content.draft.paragraphs, paragraphs); assert.equal(repository.list().length, 0);
  } finally { repository.close(); }
});

test('existing extraction preflight rejects overflow before making any provider request', async () => {
  const repository = new StoryRepository(':memory:');
  try {
    const setup = fixture(repository), connections = settings(); connections.text.contextTokens = 2048;
    let calls = 0;
    await assert.rejects(generatePassage({ setup }, connections, new AbortController().signal, () => {}, async () => { calls++; throw new Error('unexpected request'); }), /budget|fit/);
    assert.equal(calls, 0);
  } finally { repository.close(); }
});

test('existing full conditional branch expands once, reviews, repairs once and blocks after the recheck', async () => {
  const repository = new StoryRepository(':memory:');
  try {
    const setup = fixture(repository);
    setup.plan!.canon.items = [{ id: 'sugar', name: 'Sugar Cubes', description: 'Counted treats.', ownerId: 'alex', quantity: 3, equipped: false }];
    const full = { ...narration(), paragraphs: ['Alex takes one of the Sugar Cubes. ' + paragraphs[0]] };
    const trace: string[] = [];
    const provider: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init!.body)), system = body.messages[0].content;
      if (system.startsWith('Review inventory consistency.')) { trace.push('review'); return response({ consistent: false, issues: ['The narrated sugar handling is not fully represented.'] }); }
      if (system.startsWith('Return {effects:')) {
        const repair = body.messages.some((m: { content: string }) => m.content.includes('Correct the extracted effects and memory'));
        trace.push(repair ? 'repair' : 'extract'); return response(updates);
      }
      const expanding = body.messages.some((m: { content: string }) => m.content.startsWith('The draft is only'));
      trace.push(expanding ? 'expand' : 'narrate'); return response(expanding ? full : narration(true));
    };
    await assert.rejects(generatePassage({ setup }, settings(), new AbortController().signal, () => {}, provider), /after a repair attempt/);
    assert.deepEqual(trace, ['narrate', 'expand', 'extract', 'review', 'repair', 'review']);
    assert.equal(repository.list().length, 0);
  } finally { repository.close(); }
});
