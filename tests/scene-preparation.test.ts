import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createSample } from '../src/lib/server/fixture';
import { connectionSchema } from '../src/lib/server/connections';
import { scenePreparationRequestSchema, scenePreparationProposalSchema, type ScenePreparationRequest } from '../src/lib/scene-preparation';
import { scenePreparationDraftSchema, prepareScenePreparation, applyScenePreparation, generateScenePreparation, scenePreparationContext, scenePreparationSourceHash } from '../src/lib/server/scene-preparation';
import { blankSetupPlan, setupInputSchema, setupStoryBase, validateSetupPlan } from '../src/lib/setup';
import { validateStory, type Story } from '../src/lib/story';
import { estimateInputTokens } from '../src/lib/server/token-budget';
import { buildStoryContext } from '../src/lib/server/context-builder';
import { openingContext } from '../src/lib/server/scene-scope';
import { generatePassage } from '../src/lib/server/story-generation';
import { preparePassageCommit } from '../src/lib/server/passage-commit';

const settings = () => connectionSchema.parse({ ...JSON.parse(readFileSync('config/connections.example.json', 'utf8')), text: { baseUrl: 'http://localhost:9999/v1', model: 'test-model', maxTokens: 4096, contextTokens: 32000, temperature: 0.2, structuredOutput: 'schema' } });
const request = (story: Story, extra: Partial<ScenePreparationRequest> = {}): ScenePreparationRequest => ({ requestId: randomUUID(), expectedRevision: story.revision, direction: 'Prepare a feeding scene with Mira using the existing cargo hold. Add a missing feeding bay and tools if needed.', characterIds: ['mira'], placeIds: ['hold'], itemIds: [], ...extra });
const completion = (value: unknown, finish = 'stop') => new Response(JSON.stringify({ choices: [{ message: { content: typeof value === 'string' ? value : JSON.stringify(value) }, finish_reason: finish }] }));
const draft = () => ({
  explanation: 'Reuse Mira and the cargo hold. Add a small feeding bay, a storage bin and scoop, an optional future task and its routine. No feeding has happened.',
  reusedIds: ['mira', 'hold', 'fob'],
  places: [{ ref: 'new-feeding-bay', name: 'Feeding bay', description: 'A quiet corner for preparing animal meals.', parentId: 'hold' }],
  items: [
    { ref: 'new-feed-bin', name: 'Feed storage bin', description: 'An empty lidded metal storage bin.', quantity: 1, ownerId: 'new-feeding-bay', isContainer: true },
    { ref: 'new-feed-scoop', name: 'Feed scoop', description: 'A small scoop for measured portions.', quantity: 1, ownerId: 'new-feed-bin', isContainer: false }
  ],
  tasks: [{ ref: 'new-feeding-task', title: 'Prepare the next feeding', notes: 'Optional future task: Mira may inspect the feeding bay and obtain suitable feed before using the scoop.' }],
  lore: [{ ref: 'new-feeding-custom', title: 'A quiet feeding routine', text: 'Preparing meals in the feeding bay can be an opportunity for a quiet conversation. It is an optional routine, not a required checklist.', keywords: ['feeding', 'quiet'], relatedIds: ['mira', 'new-feeding-bay', 'new-feed-scoop'] }],
  sceneBrief: { purpose: 'Mira may reach the feeding bay, inspect the tools and decide what feed to obtain.', tension: 'A quiet practical task offers space for conversation.', stopAt: 'The next practical decision.', viewpointId: 'mira', locationId: 'new-feeding-bay', castIds: ['mira'] }
});

test('scene preparation contracts reject blank directions, extra instructions and unsupported changes', () => {
  const story = createSample(), input = request(story);
  assert.equal(scenePreparationRequestSchema.safeParse({ requestId: input.requestId, expectedRevision: 0, direction: 'Prepare a meal.' }).success, true);
  for (const extra of [{ direction: ' ' }, { direction: 'x'.repeat(4001) }, { unlimited: true }, { paragraphs: ['Invented prose.'] }, { expectedRevision: -1 }]) assert.equal(scenePreparationRequestSchema.safeParse({ ...input, ...extra }).success, false);
  for (const extra of [{ characters: [] }, { effects: [] }, { world: { funds: 0 } }, { lore: [{ ...draft().lore[0], visibility: 'always' }] }, { tasks: [{ ...draft().tasks[0], status: 'resolved' }] }, { items: [{ ...draft().items[0], unlimited: true }] }, { items: [{ ...draft().items[0], equipped: true }] }]) assert.equal(scenePreparationDraftSchema.safeParse({ ...draft(), ...extra }).success, false);
});

test('nested new places, storage, tasks and relevant lore become app IDs while all existing records remain unchanged', () => {
  const story = createSample(), before = structuredClone(story), proposal = prepareScenePreparation(story, request(story), draft());
  assert.equal(scenePreparationProposalSchema.safeParse(proposal).success, true);
  assert.deepEqual(story, before);
  assert.match(proposal.sourceHash, /^[a-f0-9]{64}$/);
  const place = proposal.additions.places[0], [bin, scoop] = proposal.additions.items;
  for (const row of [place, bin, scoop, ...proposal.additions.threads, ...proposal.additions.lore]) assert.match(row.id, /^[a-f0-9-]{36}$/);
  assert.equal(place.parentId, 'hold'); assert.equal(bin.ownerId, place.id); assert.equal(scoop.ownerId, bin.id);
  assert.equal(bin.quantity, 1); assert.equal(bin.isContainer, true); assert.equal(scoop.equipped, false); assert.equal(scoop.unlimited, undefined);
  assert.equal(proposal.additions.threads[0].status, 'open'); assert.equal(proposal.additions.lore[0].visibility, 'relevant');
  assert.deepEqual(proposal.additions.lore[0].relatedIds, ['mira', place.id, scoop.id]);
  assert.equal(proposal.sceneBrief.locationId, place.id); assert.equal(proposal.sceneBrief.scope, 'next-passage'); assert.equal(proposal.sceneBrief.clearAfterPassage, true);
  const staged = applyScenePreparation(story, proposal);
  for (const key of ['characters', 'relationships'] as const) assert.deepEqual(staged.canon[key], before.canon[key]);
  for (const key of ['places', 'items', 'threads'] as const) assert.deepEqual(staged.canon[key].slice(0, before.canon[key].length), before.canon[key]);
  for (const key of ['passages', 'factPins', 'preferences', 'media'] as const) assert.deepEqual(staged[key], before[key]);
  assert.deepEqual(staged.context.knowledge, before.context.knowledge); assert.deepEqual(staged.context.memories, before.context.memories); assert.deepEqual(staged.context.compaction, before.context.compaction);
  assert.equal(staged.canon.characters.find(row => row.id === 'mira')!.locationId, 'bridge');
  assert.equal(staged.canon.items.find(row => row.id === 'fob')!.ownerId, 'elias');
  assert.equal(staged.recovery!.valid, false); assert.equal(staged.revision, story.revision);
});

test('existing records can provide the whole scene without new entities, stock or recovery invalidation', () => {
  const story = createSample(); story.canon.items.push({ id: 'sugar', name: 'Sugar Cubes', description: 'Small sugar cubes as pony treats in tin.', quantity: 1, ownerId: 'mira', equipped: false });
  const raw = { ...draft(), places: [], items: [], tasks: [], lore: [], reusedIds: ['mira', 'bridge', 'sugar'], explanation: 'Reuse the saved tin. Its count of one does not establish how many cubes it contains; adjust supply mode manually if desired.', sceneBrief: { ...draft().sceneBrief, locationId: 'bridge' } };
  const proposal = prepareScenePreparation(story, request(story), raw), staged = applyScenePreparation(story, proposal);
  assert.deepEqual(staged.canon, story.canon); assert.deepEqual(staged.recovery, story.recovery);
  assert.equal(staged.canon.items.find(row => row.id === 'sugar')!.quantity, 1);
  story.canon.items.find(row => row.id === 'sugar')!.unlimited = true;
  const available = applyScenePreparation(story, prepareScenePreparation(story, request(story), raw));
  assert.equal(available.canon.items.find(row => row.id === 'sugar')!.unlimited, true); assert.equal(available.canon.items.find(row => row.id === 'sugar')!.quantity, 1);
});

test('proposed cast contains the viewpoint exactly once without promoting reused records into viewpoint knowledge', () => {
  const story = createSample(), raw = draft(); raw.sceneBrief.castIds = ['elias', 'elias']; raw.reusedIds.push('ren');
  const proposal = prepareScenePreparation(story, request(story), raw), staged = applyScenePreparation(story, proposal);
  assert.deepEqual(proposal.sceneBrief.castIds, ['mira', 'elias']);
  assert.ok(proposal.reusedIds.includes('ren')); assert.equal(proposal.sceneBrief.castIds.includes('ren'), false);
  assert.deepEqual(staged.context.knowledge, story.context.knowledge); assert.deepEqual(staged.canon.characters, story.canon.characters);
  assert.throws(() => applyScenePreparation(story, { ...proposal, sceneBrief: { ...proposal.sceneBrief, castIds: ['elias'] } }), /viewpoint exactly once/i);
  assert.throws(() => applyScenePreparation(story, { ...proposal, sceneBrief: { ...proposal.sceneBrief, castIds: ['mira', 'mira'] } }), /viewpoint exactly once/i);
});

test('duplicate names, existing-ID overwrites, missing refs and invalid new containment reject the whole proposal', () => {
  const story = createSample(), before = structuredClone(story), value = draft();
  const badDrafts = [
    { ...value, items: [{ ...value.items[0], name: '  ACCESS-fob ' }] },
    { ...value, places: [{ ...value.places[0], name: 'Cargo hold' }] },
    { ...value, tasks: [{ ...value.tasks[0], title: story.canon.threads[0].title }] },
    { ...value, items: [{ ...value.items[0], ownerId: 'missing-place' }] },
    { ...value, places: [{ ...value.places[0], parentId: 'new-feeding-bay' }] },
    { ...value, items: [{ ...value.items[0], quantity: 2 }] },
    { ...value, items: [{ ...value.items[0], ownerId: 'new-feeding-task' }] },
    { ...value, places: [{ ...value.places[0], ref: 'hold' }] },
    { ...value, tasks: [{ ...value.tasks[0], ref: value.items[0].ref }] },
    { ...value, reusedIds: ['invented-id'] },
    { ...value, sceneBrief: { ...value.sceneBrief, viewpointId: 'new-feed-bin' } },
    { ...value, lore: [{ ...value.lore[0], relatedIds: ['new-feeding-task'] }] }
  ];
  for (const raw of badDrafts) assert.throws(() => prepareScenePreparation(story, request(story), raw));
  const proposal = prepareScenePreparation(story, request(story), value);
  assert.throws(() => applyScenePreparation(story, { ...proposal, additions: { ...proposal.additions, items: [{ ...proposal.additions.items[0], id: story.canon.items[0].id }] } }));
  assert.throws(() => applyScenePreparation(story, { ...proposal, additions: { ...proposal.additions, items: [{ ...proposal.additions.items[0], unlimited: true }] } } as any));
  assert.throws(() => applyScenePreparation(story, { ...proposal, sceneBrief: { ...proposal.sceneBrief, scope: 'ongoing', clearAfterPassage: false } }));
  story.context.lore.push({ id: 'routine', title: 'A quiet feeding routine', text: 'An existing routine.', keywords: [], relatedIds: [], visibility: 'hidden' });
  assert.throws(() => prepareScenePreparation(story, request(story), value), /duplicate.*background/i);
  story.context.lore.pop(); assert.deepEqual(story, before);
});

test('stable source hashes, revisions, selected IDs and application state prevent stale or cross-story proposals', () => {
  const story = createSample(), input = request(story), proposal = prepareScenePreparation(story, input, draft()), hash = scenePreparationSourceHash(story);
  const timestampOnly = { ...story, updatedAt: '2030-01-01T00:00:00.000Z', createdAt: '2030-01-01T00:00:00.000Z' }; assert.equal(scenePreparationSourceHash(timestampOnly), hash);
  for (const mutate of [(s: Story) => { s.premise += ' Changed'; }, (s: Story) => { s.canon.items[0].quantity++; }, (s: Story) => { s.context.sceneBrief.purpose += ' Changed'; }, (s: Story) => { s.factPins.rules.push({ id: 'rule', text: 'A new rule.' }); }, (s: Story) => { s.preferences.contentNotes = 'Changed'; }]) {
    const changed = structuredClone(story); mutate(changed); assert.throws(() => applyScenePreparation(changed, proposal), /changed after/i);
  }
  assert.throws(() => applyScenePreparation({ ...story, id: randomUUID() }, proposal), /changed after/i);
  assert.throws(() => applyScenePreparation(story, { ...proposal, appliedAt: story.updatedAt, appliedRevision: story.revision + 1 }), /already been applied/i);
  assert.throws(() => prepareScenePreparation(story, { ...input, expectedRevision: 4 }, draft()), /story changed/i);
  for (const extra of [{ characterIds: ['missing'] }, { placeIds: ['hold', 'hold'] }, { itemIds: ['missing'] }]) assert.throws(() => prepareScenePreparation(story, { ...input, ...extra }, draft()), /selected.*missing|duplicated/i);
});

test('unwritten setup preparation keeps histories empty and validates the complete setup graph', () => {
  const now = new Date().toISOString(), plan = blankSetupPlan();
  const setup = { id: randomUUID(), revision: 9, createdAt: now, updatedAt: now, storyId: null, input: setupInputSchema.parse({ premise: 'An animal sanctuary.' }), plan };
  const story = { ...setupStoryBase(setup), revision: setup.revision }, person = story.canon.characters[0].id, place = story.canon.places[0].id;
  const raw = draft(); raw.reusedIds = [person, place]; raw.places[0].parentId = place; raw.lore[0].relatedIds = [person, 'new-feeding-bay']; raw.sceneBrief.viewpointId = person; raw.sceneBrief.castIds = [person];
  const proposal = prepareScenePreparation(story, request(story, { characterIds: [person], placeIds: [place] }), raw), staged = applyScenePreparation(story, proposal);
  assert.equal(staged.passages.length, 0); assert.equal(staged.recovery, null); assert.deepEqual(staged.context.knowledge, []); assert.deepEqual(staged.context.memories, []);
  assert.equal(staged.revision, 9); assert.equal(proposal.sourceRevision, 9);
  assert.doesNotThrow(() => validateSetupPlan({ ...plan, canon: staged.canon, context: staged.context }));
});

test('scoping retains requested records, physical storage paths and linked routine without unrelated contents or hidden text', () => {
  const story = createSample();
  story.canon.items.push(
    { id: 'bag', name: 'Supply bag', description: 'A lidded bag.', quantity: 1, ownerId: 'hold', equipped: false, isContainer: true },
    { id: 'sugar', name: 'Sugar Cubes', description: 'Small sugar cubes as pony treats in tin.', quantity: 1, ownerId: 'bag', equipped: false },
    { id: 'sibling', name: 'Unrelated receipt', description: 'Never needed for feeding.', quantity: 1, ownerId: 'bag', equipped: false }
  );
  story.context.lore.push(
    { id: 'feed-routine', title: 'Feeding routine', text: 'Feeding can include the Sugar Cubes tin.', keywords: ['feeding'], relatedIds: ['sugar'], visibility: 'relevant' },
    { id: 'secret', title: 'Hidden feeding plan', text: 'PRIVATE SECRET TEXT', keywords: ['feeding'], relatedIds: ['sugar'], visibility: 'hidden' }
  );
  const scoped = scenePreparationContext(story, request(story, { direction: 'Prepare a feeding scene.', itemIds: ['sugar'] }));
  assert.ok(scoped.items.some(row => row.id === 'bag')); assert.ok(scoped.items.some(row => row.id === 'sugar')); assert.equal(scoped.items.some(row => row.id === 'sibling'), false);
  assert.ok(scoped.places.some(row => row.id === 'hold')); assert.ok(scoped.places.some(row => row.id === 'wayward')); assert.ok(scoped.places.some(row => row.id === 'halcyon'));
  assert.equal(scoped.lore.length, 1); assert.equal(scoped.lore[0].id, 'feed-routine'); assert.equal(JSON.stringify(scoped).includes('PRIVATE SECRET TEXT'), false);
});

test('task scope recognizes selected place and item names when saved IDs are UUIDs', () => {
  const story = createSample(), barnId = randomUUID(), sugarId = randomUUID(), itemTaskId = randomUUID(), placeTaskId = randomUUID(), unrelatedId = randomUUID(), resolvedId = randomUUID();
  story.canon.places.push({ id: barnId, name: 'Feeding barn', description: 'A sheltered place for feeding.', parentId: 'wayward' });
  story.canon.items.push({ id: sugarId, name: 'Sugar Cubes', description: 'Individual sugar cubes for treats.', quantity: 10, ownerId: barnId, equipped: false });
  story.canon.threads.push(
    { id: itemTaskId, title: 'Check afternoon stock', notes: 'Consider the Sugar Cubes before making plans.', status: 'open' },
    { id: placeTaskId, title: 'A sheltered pause', notes: 'A possible quiet visit to Feeding barn.', status: 'open' },
    { id: unrelatedId, title: 'A distant ambition', notes: 'Travel someday to a remote mountain valley.', status: 'open' },
    { id: resolvedId, title: 'Earlier preparations', notes: 'A visit to Feeding barn is no longer pending.', status: 'resolved' }
  );
  const before = structuredClone(story), scoped = scenePreparationContext(story, request(story, { direction: 'Prepare a feeding scene.', characterIds: ['mira'], placeIds: [barnId], itemIds: [sugarId] }));
  assert.ok(scoped.threads.some(row => row.id === itemTaskId && row.notes.includes('Sugar Cubes')));
  assert.ok(scoped.threads.some(row => row.id === placeTaskId && row.notes.includes('Feeding barn')));
  assert.equal(scoped.threads.some(row => row.id === unrelatedId || row.id === resolvedId), false);
  assert.deepEqual(story, before);
});

test('one budgeted model call includes full constraints, compact directories and supply guidance without changing saved canon', async () => {
  const story = createSample(), before = structuredClone(story); story.factPins.rules.push({ id: 'rule', text: 'No food appears from nowhere.' }); story.factPins.fields.push({ kind: 'item', recordId: 'fob', field: 'ownerId' });
  let calls = 0, sent: any;
  const result = await generateScenePreparation(story, request(story), settings(), new AbortController().signal, async (_url, init) => { calls++; sent = JSON.parse(String(init!.body)); return completion(draft()); });
  assert.equal(calls, 1); assert.equal(result.appliedAt, null); assert.equal(sent.response_format.type, 'json_schema');
  const supplied = JSON.parse(sent.messages[1].content);
  assert.deepEqual(supplied.factPins.rules, story.factPins.rules); assert.equal(supplied.factPins.fields[0].value, 'elias');
  assert.equal(supplied.directory.items.length, story.canon.items.length); assert.equal(supplied.directory.characters.length, story.canon.characters.length);
  assert.equal(supplied.latestEnding, story.passages.at(-1)!.paragraphs.at(-1));
  assert.match(sent.messages[0].content, /No events have happened/); assert.match(sent.messages[0].content, /mentioning storage in a tin does not change that unit/); assert.match(sent.messages[0].content, /Only the reader can enable Always available/);
  story.factPins.rules = []; story.factPins.fields = []; assert.deepEqual(story, before);
});

test('model-facing prep excludes hidden lore metadata and bounds the actual previous ending while retaining the source guard', async () => {
  const story = createSample(), raw = draft();
  const hidden = { id: 'private-hidden-lore-id', title: 'SECRET-TITLE-947', text: 'SECRET-BODY-947', keywords: ['SECRET-KEYWORD-947'], relatedIds: ['mira'], visibility: 'hidden' as const };
  story.context.lore.push(hidden);
  story.passages.at(-1)!.paragraphs = ['OMITTED-PARAGRAPH-PREFIX-947 ' + 'a very long previous paragraph '.repeat(1200) + ' THE ACTUAL ENDING 947'];
  const before = structuredClone(story), hash = scenePreparationSourceHash(story); let sent: any;
  const proposal = await generateScenePreparation(story, request(story), settings(), new AbortController().signal, async (_url, init) => { sent = JSON.parse(String(init!.body)); return completion(raw); });
  const messages = JSON.stringify(sent.messages), supplied = JSON.parse(sent.messages[1].content);
  for (const secret of [hidden.id, hidden.title, hidden.text, ...hidden.keywords]) assert.equal(messages.includes(secret), false, secret);
  assert.equal(supplied.directory.lore.length, 0); assert.equal(supplied.currentRecords.lore.length, 0);
  assert.equal(supplied.latestEnding.length, 2000); assert.equal(supplied.latestEnding, story.passages.at(-1)!.paragraphs.at(-1)!.slice(-2000));
  assert.equal(messages.includes('OMITTED-PARAGRAPH-PREFIX-947'), false); assert.ok(supplied.latestEnding.endsWith('THE ACTUAL ENDING 947'));
  assert.equal(proposal.sourceHash, hash); assert.equal(scenePreparationSourceHash(story), hash); assert.deepEqual(story, before);
  story.context.lore[0].text = 'The hidden saved source changed.';
  assert.throws(() => applyScenePreparation(story, proposal), /changed after/i);
});

test('failures, invalid model output, preflight overflow and cancellation never make a second model call or modify the story', async () => {
  const story = createSample(), before = structuredClone(story), input = request(story), c = settings();
  for (const fetcher of [async () => completion('{broken'), async () => completion(draft(), 'length'), async () => completion({ ...draft(), events: ['Feeding finished.'] }), async () => new Response('{}', { status: 401 }), async () => completion({ ...draft(), items: [{ ...draft().items[0], name: 'Access fob' }] })]) {
    let calls = 0; await assert.rejects(() => generateScenePreparation(story, input, c, new AbortController().signal, async () => { calls++; return fetcher(); })); assert.equal(calls, 1);
  }
  let calls = 0; const fetcher: typeof fetch = async () => { calls++; return completion(draft()); };
  const tiny = settings(); tiny.text.contextTokens = 1024;
  await assert.rejects(() => generateScenePreparation(story, input, tiny, new AbortController().signal, fetcher), /context budget/i); assert.equal(calls, 0);
  const cancelled = new AbortController(); cancelled.abort(); await assert.rejects(() => generateScenePreparation(story, input, c, cancelled.signal, fetcher), /cancel/i); assert.equal(calls, 0);
  await assert.rejects(() => generateScenePreparation(story, { ...input, expectedRevision: 99 }, c, new AbortController().signal, fetcher), /changed/i); assert.equal(calls, 0);
  const late = new AbortController(); await assert.rejects(() => generateScenePreparation(story, input, c, late.signal, async () => { calls++; late.abort(); return completion(draft()); }), /cancel/i); assert.equal(calls, 1);
  assert.deepEqual(story, before);
});

test('large Brasswater preparation fits the existing 32k budget with compact complete lookup and selected full records', async () => {
  const story = validateStory(JSON.parse(readFileSync('exports/scoping-stress-test/story.json', 'utf8'))), before = structuredClone(story), c = settings();
  const input = request(story, { direction: 'Prepare an optional chart review scene with Iris, Tamsin and Ren. Reuse the chartroom and its existing materials.', characterIds: ['iris', 'tamsin', 'ren'], placeIds: ['chartroom'] });
  let calls = 0, sent: any;
  const raw = { ...draft(), explanation: 'The current chart room and cast provide this quiet scene. No additions are necessary.', reusedIds: ['iris', 'tamsin', 'ren', 'chartroom'], places: [], items: [], tasks: [], lore: [], sceneBrief: { purpose: 'Review the current chart together.', tension: 'They may disagree over the next route.', stopAt: 'A meaningful route decision.', viewpointId: 'iris', locationId: 'chartroom', castIds: ['iris', 'tamsin', 'ren'] } };
  await generateScenePreparation(story, input, c, new AbortController().signal, async (_url, init) => { calls++; sent = JSON.parse(String(init!.body)); return completion(raw); });
  const context = JSON.parse(sent.messages[1].content), tokens = estimateInputTokens(sent.messages, sent.response_format.json_schema.schema);
  assert.equal(calls, 1); assert.equal(context.directory.characters.length, 24); assert.equal(context.directory.items.length, 170);
  assert.ok(context.currentRecords.characters.length < 24); assert.ok(context.currentRecords.items.length < 170);
  assert.ok(tokens + sent.max_tokens + c.context.overheadTokens <= 32000); assert.deepEqual(story, before);
});

test('reviewed resources retain selections, reuse and additions through scoped narration without activating absent people', () => {
  const story = createSample();
  story.canon.characters.push({ ...story.canon.characters[0], id: 'distant', name: 'Distant keeper', locationId: 'glass', notes: 'ABSENT-PERSON-PRIVATE-PROFILE' });
  story.canon.items.push(
    { id: 'treat-bag', name: 'Treat bag', description: 'A portable bag.', quantity: 1, ownerId: 'mira', equipped: false, isContainer: true },
    { id: 'treat-stock', name: 'Sugar cube supply', description: 'White sugar cubes for occasional rewards.', quantity: 1, ownerId: 'treat-bag', equipped: false, unlimited: true },
    { id: 'receipt', name: 'Shop receipt', description: 'An unrelated receipt.', quantity: 1, ownerId: 'treat-bag', equipped: false },
    { id: 'ladle', name: 'Wooden ladle', description: 'A clean ladle.', quantity: 1, ownerId: 'hold', equipped: false }
  );
  story.context.lore.push({ id: 'old-custom', title: 'Local custom', text: 'An optional quiet custom.', keywords: [], relatedIds: [], visibility: 'relevant' });
  const raw = { ...draft(), reusedIds: ['old-custom'], places: [], items: [], lore: [], tasks: [{ ref: 'new-quiet-task', title: 'Consider a practical detail', notes: 'The Wooden ladle may be useful; this is only a future possibility.' }], sceneBrief: { ...draft().sceneBrief, purpose: 'Share a quiet practical moment.', tension: '', stopAt: 'A pause.', locationId: 'bridge' } };
  const proposal = prepareScenePreparation(story, request(story, { direction: 'Prepare a quiet moment.', characterIds: ['mira', 'distant'], placeIds: ['glass'], itemIds: ['treat-stock'] }), raw);
  for (const id of ['mira', 'distant', 'glass', 'treat-stock', 'old-custom', proposal.additions.threads[0].id]) assert.ok(proposal.sceneBrief.resourceIds!.includes(id), id);
  const staged = applyScenePreparation(story, proposal), report = buildStoryContext(staged, '', 32000, 4096);
  for (const id of ['treat-stock', 'treat-bag', 'ladle', 'old-custom', proposal.additions.threads[0].id, 'glass']) assert.ok(report.sources.find(source => source.id === id)?.included, id);
  assert.equal(report.sources.find(source => source.id === 'receipt')?.included, false);
  assert.ok(report.sources.find(source => source.id === 'treat-stock')!.required);
  assert.ok(report.sources.find(source => source.id === 'distant:reference')?.included);
  assert.equal(report.selectedCharacterIds.includes('distant'), false);
  assert.equal(JSON.stringify(report.messages).includes('ABSENT-PERSON-PRIVATE-PROFILE'), false);
  assert.deepEqual(staged.context.knowledge, story.context.knowledge);
  const opening = openingContext(staged, staged.context.sceneBrief.purpose);
  for (const id of ['treat-stock', 'treat-bag', 'ladle']) assert.ok(opening.scope.selectedItems.some(item => item.id === id), id);
  assert.ok(opening.lore.some(row => row.id === 'old-custom'));
  assert.equal(opening.scope.castIds.has('distant'), false);
  const legacy = structuredClone(proposal); delete legacy.sceneBrief.resourceIds;
  const restored = applyScenePreparation(story, legacy);
  assert.ok(restored.context.sceneBrief.resourceIds!.includes('old-custom'));
  assert.ok(restored.context.sceneBrief.resourceIds!.includes(proposal.additions.threads[0].id));
});

test('scene resource links reject missing, hidden and duplicated references and bound task dependencies', () => {
  const story = createSample();
  assert.equal(Object.hasOwn(story.context.sceneBrief, 'resourceIds'), false);
  story.context.lore.push({ id: 'secret-resource', title: 'Secret routine', text: 'SECRET RESOURCE TEXT', keywords: [], relatedIds: [], visibility: 'hidden' });
  for (const resourceIds of [['missing'], ['secret-resource'], ['fob', 'fob']]) assert.throws(() => validateStory({ ...story, context: { ...story.context, sceneBrief: { ...story.context.sceneBrief, resourceIds } } }), /resource|Duplicate record/i);
  for (const reusedIds of [['secret-resource'], ['missing']]) assert.throws(() => prepareScenePreparation(story, request(story), { ...draft(), reusedIds }), /missing|hidden/i);
  const ids = Array.from({ length: 24 }, (_, i) => 'dependency-' + i);
  story.canon.items.push(...ids.map((id, i) => ({ id, name: 'Prepared resource ' + i, description: '', quantity: 1, ownerId: 'glass', equipped: false })));
  story.canon.threads.push({ id: 'dependency-task', title: 'A bounded plan', notes: ids.join(', '), status: 'open' });
  story.context.sceneBrief.resourceIds = ['dependency-task'];
  const report = buildStoryContext(story, '', 32000, 4096);
  assert.equal(report.sources.filter(source => ids.includes(source.id) && source.included).length, 16);
  assert.ok(report.warnings.some(warning => /Reviewed scene resources.*bounded dependency/.test(warning)));
});

for (const mode of ['opening', 'continuation'] as const) test(`reviewed item selection reaches the actual ${mode} request despite generic brief and model-omitted reuse`, async () => {
  const story = createSample(); story.preferences.passageWords = 100;
  story.canon.items.push({ id: 'selected-stock', name: 'Prepared sugar supply', description: 'A supply of white sugar cubes.', quantity: 1, ownerId: 'mira', equipped: false, unlimited: true });
  const raw = { ...draft(), reusedIds: [], places: [], items: [], tasks: [], lore: [], sceneBrief: { ...draft().sceneBrief, purpose: 'Share a quiet moment.', tension: '', stopAt: 'A pause.', locationId: 'bridge' } };
  const staged = applyScenePreparation(story, prepareScenePreparation(story, request(story, { itemIds: ['selected-stock'] }), raw));
  const now = new Date().toISOString(), setup = { id: staged.id, revision: staged.revision, createdAt: now, updatedAt: now, storyId: null, input: setupInputSchema.parse({ premise: story.premise, preferences: { passageWords: 100 } }), plan: { title: staged.title, chapterTitle: 'A quiet beginning', canon: staged.canon, context: { ...staged.context, knowledge: [], memories: [], compaction: { epoch: 0, chapters: [], book: null } }, factPins: staged.factPins } };
  const quiet = 'Mira listened to the rain against the high window. The morning seemed unusually still, and she was content to enjoy it for a little while. In the distance a bell sounded through the damp air. She thought about the conversation ahead, wondering where it might lead and how much there was still to discover. For now the room was quiet, with time enough for patient thoughts and an unhurried beginning.';
  let narrations = 0, extractions = 0;
  await generatePassage(mode === 'opening' ? { setup } : { story: staged, mode: 'continue', direction: '' }, settings(), new AbortController().signal, () => {}, async (_url, init) => {
    const body = JSON.parse(String(init!.body)), system = body.messages[0].content;
    if (system.startsWith('Return {effects:')) { extractions++; return completion({ effects: [], memory: { summary: 'Mira enjoyed a quiet morning.', facts: [], openQuestions: [], characterIds: ['mira'], locationIds: ['bridge'] } }); }
    narrations++;
    if (mode === 'opening') assert.ok(JSON.parse(body.messages[1].content).canon.items.some((item: any) => item.id === 'selected-stock' && item.unlimited === true));
    else assert.ok(body.messages.some((message: any) => message.content.includes('"id":"selected-stock"') && message.content.includes('"unlimited":true')));
    return completion({ title: 'A quiet moment', chapterTitle: mode === 'opening' ? setup.plan.chapterTitle : story.passages.at(-1)!.chapterTitle, viewpointId: 'mira', endOfChapter: false, paragraphs: [quiet] });
  });
  assert.equal(narrations, 1); assert.equal(extractions, 1);
  assert.equal(staged.canon.items.find(item => item.id === 'selected-stock')!.quantity, 1);
});

test('replacement consumption prunes obsolete resource pointers while preserving the unconsumed future brief', () => {
  const story = createSample();
  story.canon.items.push({ id: 'finite-treat', name: 'Single treat', description: 'One treat.', quantity: 1, ownerId: 'mira', equipped: false });
  story.recovery!.canon = structuredClone(story.canon);
  story.context.sceneBrief = { ...story.context.sceneBrief, scope: 'next-passage', clearAfterPassage: true, purpose: 'A future quiet scene.', resourceIds: ['finite-treat', 'mira'] };
  const quote = 'Mira ate the single treat.';
  const replacement = { mode: 'replace', passageId: story.passages.at(-1)!.id, direction: '', draft: { title: 'A small pause', chapterTitle: story.passages.at(-1)!.chapterTitle, startsChapter: false, endOfChapter: false, viewpointId: 'mira', paragraphs: [quote] }, effects: [{ type: 'item.quantity', itemId: 'finite-treat', expectedQuantity: 1, quantity: 0, evidence: quote }] };
  const saved = preparePassageCommit(story, replacement).story;
  assert.deepEqual(saved.context.sceneBrief.resourceIds, ['mira']);
  assert.equal(saved.context.sceneBrief.purpose, 'A future quiet scene.');
  assert.equal(saved.context.sceneBrief.scope, 'next-passage');
  assert.deepEqual(story.context.sceneBrief.resourceIds, ['finite-treat', 'mira']);
});

test('replacement narration drops reviewed resources created only in the discarded passage without changing saved plans', async () => {
  const story = createSample(); story.preferences.passageWords = 100;
  story.canon.items.push({ id: 'discarded-resource-947', name: 'Discarded scene object', description: 'Created only by the current latest passage.', quantity: 1, ownerId: 'mira', equipped: false });
  story.context.sceneBrief = { ...story.context.sceneBrief, viewpointId: 'mira', scope: 'next-passage', clearAfterPassage: true, purpose: 'A future quiet conversation.', resourceIds: ['discarded-resource-947', 'mira'] };
  const before = structuredClone(story), quiet = 'Mira listened to the rain against the high window. The morning seemed unusually still, and she was content to enjoy it for a little while. In the distance a bell sounded through the damp air. She thought about the conversation ahead, wondering where it might lead and how much there was still to discover. For now the room was quiet, with time enough for patient thoughts and an unhurried beginning.';
  let narrations = 0;
  await generatePassage({ story, mode: 'replace', direction: '' }, settings(), new AbortController().signal, () => {}, async (_url, init) => {
    const body = JSON.parse(String(init!.body));
    assert.equal(JSON.stringify(body.messages).includes('discarded-resource-947'), false);
    if (body.messages[0].content.startsWith('Return {effects:')) return completion({ effects: [], memory: { summary: 'Mira enjoyed the quiet.', facts: [], openQuestions: [], characterIds: ['mira'], locationIds: ['bridge'] } });
    narrations++;
    return completion({ title: 'Another quiet moment', chapterTitle: story.passages.at(-1)!.chapterTitle, viewpointId: 'mira', endOfChapter: false, paragraphs: [quiet] });
  });
  assert.equal(narrations, 1);
  assert.deepEqual(story, before);
});
