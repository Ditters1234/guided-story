import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { StoryRepository } from '../src/lib/server/repository';
import { blankSetupPlan, setupPlanSchema, setupStoryBase, validateSetupPlan, type SetupDraft, type SetupPlan } from '../src/lib/setup';
import { emptyFactPins, resolvedFactPins } from '../src/lib/fact-pins';
import { normalizeCharacterProfile } from '../src/lib/character-profile';
import { connectionSchema } from '../src/lib/server/connections';
import { generateSetup, generateSetupCharacter, generatePassage, normalizeSetup } from '../src/lib/server/story-generation';
import { generateSetupRecord } from '../src/lib/server/setup-generation';
import { prepareOpening } from '../src/lib/server/setup-state';
import type { SetupDesignInput } from '../src/lib/setup-generation';
import type { passageProposalSchema } from '../src/lib/server/passage-commit';
import type { z } from 'zod';

const settings = () => connectionSchema.parse({ ...JSON.parse(readFileSync('config/connections.example.json', 'utf8')), text: { baseUrl: 'http://localhost:9999/v1', model: 'setup-pins-test', maxTokens: 4096, contextTokens: 65536, temperature: 0.8, structuredOutput: 'prompt' } });
const completion = (value: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) }, finish_reason: 'stop' }] }));
function fixture(repository: StoryRepository): SetupDraft {
  const draft = repository.createSetup({ premise: 'Two traders investigate an abandoned station.', castSize: 2, preferences: { passageWords: 100 } }, randomUUID()), plan = blankSetupPlan();
  const captain = plan.canon.characters[0], engineer = { ...structuredClone(captain), id: randomUUID(), name: 'Leto', role: 'Engineer' }, bag = randomUUID();
  captain.name = 'Ava'; captain.role = 'Captain'; captain.visual!.eyes = 'Green eyes'; captain.persona!.voice = 'Quiet and deliberate';
  plan.canon.characters.push(engineer);
  plan.canon.places[0].name = 'The Kite'; plan.canon.places[0].description = 'A small independent freighter.';
  plan.canon.items.push({ id: bag, name: 'Canvas bag', description: 'A sturdy bag.', quantity: 1, ownerId: captain.id, equipped: false, isContainer: true }, { id: randomUUID(), name: 'Copper tokens', description: 'Station currency.', quantity: 10, ownerId: bag, equipped: false });
  plan.canon.relationships.push({ id: randomUUID(), fromId: captain.id, toId: engineer.id, notes: 'They trust each other with their ship.' });
  plan.canon.threads.push({ id: randomUUID(), title: 'The missing delivery', notes: 'Who took the cargo?', status: 'open' });
  plan.canon.funds = 80;
  plan.context.lore.push({ id: randomUUID(), title: 'World foundations', text: 'Independent traders serve isolated stations.', visibility: 'always', keywords: [], relatedIds: [] });
  plan.context.sceneBrief.castIds.push(engineer.id);
  plan.factPins = { fields: [{ kind: 'character', recordId: captain.id, field: 'visual.eyes' }, { kind: 'item', recordId: plan.canon.items[1].id, field: 'rootOwnerId' }, { kind: 'world', recordId: null, field: 'funds' }], rules: [{ id: randomUUID(), text: 'Interstellar travel takes at least one week.' }] };
  return repository.saveSetup(draft.id, { expectedRevision: 0, requestId: randomUUID(), input: draft.input, plan });
}
function characterWire(plan: SetupPlan) {
  const p = normalizeCharacterProfile(plan.canon.characters[0]);
  return { name: p.name, role: p.role, notes: p.notes, visual: p.visual, persona: p.persona, wardrobe: p.wardrobe, injuries: p.injuries, appearanceNotes: p.appearanceNotes, outfitNotes: p.outfitNotes, locationId: p.locationId };
}
function rawSetup(plan: SetupPlan) {
  return { title: 'A new beginning', chapterTitle: 'The quiet berth', worldNotes: 'Stations lie a week apart.', funds: 80, cargoNotes: '', places: [{ ref: 'ship', name: 'The Tern', description: 'A working freighter.', parentRef: null }],
    characters: plan.canon.characters.map((p, index) => { const { locationId: _, ...profile } = characterWire({ ...plan, canon: { ...plan.canon, characters: [p] } }); return { ref: `cast-${index}`, ...profile, locationRef: 'ship' }; }), items: [], relationships: [], threads: [], opening: { viewpointRef: 'cast-0', locationRef: 'ship', castRefs: ['cast-0'], purpose: 'Inspect a delivery.', tension: 'The manifest is empty.', stopAt: 'Before opening the cargo.' } };
}
function opening(draft: SetupDraft): z.infer<typeof passageProposalSchema> {
  return { mode: 'continue', direction: '', draft: { title: 'An empty berth', chapterTitle: draft.plan!.chapterTitle, startsChapter: true, endOfChapter: false, viewpointId: draft.plan!.canon.characters[0].id, paragraphs: ['Ava checked the manifest while Leto waited beside the empty cargo berth.'] }, effects: [] };
}

test('setup pins default safely, validate references and protect manually updated saved values', () => {
  const repository = new StoryRepository(':memory:');
  try {
    const draft = fixture(repository), plan = structuredClone(draft.plan)!, { factPins: _, ...legacy } = plan;
    assert.deepEqual(setupPlanSchema.parse(legacy).factPins, emptyFactPins());
    assert.deepEqual(blankSetupPlan().factPins, emptyFactPins());
    const base = setupStoryBase(draft); assert.deepEqual(base.factPins, plan.factPins);
    base.factPins.rules[0].text = 'Changed only on the copy'; assert.notEqual(draft.plan!.factPins.rules[0].text, base.factPins.rules[0].text);
    const invalid = structuredClone(plan); invalid.factPins.fields[0].recordId = 'missing'; assert.throws(() => validateSetupPlan(invalid), /missing record or field/);
    plan.canon.characters[0].visual!.eyes = 'Amber eyes';
    const saved = repository.saveSetup(draft.id, { expectedRevision: draft.revision, requestId: randomUUID(), input: draft.input, plan });
    assert.equal(resolvedFactPins(saved.plan!).fields[0].value, 'Amber eyes');
    assert.deepEqual(saved.plan!.factPins, draft.plan!.factPins);
  } finally { repository.close(); }
});

test('AI setup commits independently reject changed pin settings, pinned values and indirect ownership, with replay preserved', () => {
  const repository = new StoryRepository(':memory:');
  try {
    const draft = fixture(repository), plan = draft.plan!;
    const changes: ((next: SetupPlan) => void)[] = [next => { next.factPins = emptyFactPins(); }, next => { next.factPins.rules[0].text = 'An AI replacement rule.'; }, next => { next.canon.characters[0].visual!.eyes = 'Blue eyes'; }, next => { next.canon.funds++; }, next => { next.canon.items[0].ownerId = next.canon.characters[1].id; }];
    for (const change of changes) { const next = structuredClone(plan); change(next); assert.throws(() => repository.commitGeneratedSetup(draft.id, draft.revision, randomUUID(), 'invalid', next), /pins|pinned|world rules/i); assert.deepEqual(repository.readSetup(draft.id), draft); }
    const next = structuredClone(plan); next.canon.characters[0].role = 'Independent trader';
    const requestId = randomUUID(), saved = repository.commitGeneratedSetup(draft.id, draft.revision, requestId, 'valid-role', next);
    const manual = structuredClone(saved.plan)!; manual.canon.characters[0].visual!.eyes = 'Amber eyes';
    const edited = repository.saveSetup(saved.id, { expectedRevision: saved.revision, requestId: randomUUID(), input: saved.input, plan: manual });
    assert.deepEqual(repository.commitGeneratedSetup(draft.id, draft.revision, requestId, 'valid-role', next), edited);
    assert.throws(() => repository.commitGeneratedSetup(draft.id, draft.revision, requestId, 'different-request', next), /another operation/);
  } finally { repository.close(); }
});

test('whole-setup regeneration blocks field pins before the provider and retains rules-only constraints', async () => {
  const repository = new StoryRepository(':memory:');
  try {
    const draft = fixture(repository); let calls = 0;
    await assert.rejects(() => generateSetup(draft, settings(), new AbortController().signal, async () => { calls++; return completion(rawSetup(draft.plan!)); }), /targeted redesign controls|pinned fields/);
    assert.equal(calls, 0); assert.throws(() => normalizeSetup(rawSetup(draft.plan!), draft), /pinned fields/);
    const rulesOnly = structuredClone(draft); rulesOnly.plan!.factPins.fields = [];
    let sent: any; const generated = await generateSetup(rulesOnly, settings(), new AbortController().signal, async (_url, init) => { calls++; sent = JSON.parse(String(init!.body)); return completion(rawSetup(rulesOnly.plan!)); });
    assert.deepEqual(JSON.parse(sent.messages[1].content).factPins, rulesOnly.plan!.factPins);
    assert.match(sent.messages[0].content, /Respect saved world rules/); assert.deepEqual(generated.factPins, rulesOnly.plan!.factPins);
    assert.notEqual(generated.canon.characters[0].id, rulesOnly.plan!.canon.characters[0].id);
    assert.deepEqual(repository.readSetup(draft.id), draft);
  } finally { repository.close(); }
});

test('character name, revise and full redesign honor field pins and send all saved constraints as required input', async () => {
  const repository = new StoryRepository(':memory:');
  try {
    const draft = fixture(repository), person = draft.plan!.canon.characters[0];
    for (const mode of ['revise', 'full'] as const) {
      let sent: any; const wire = characterWire(draft.plan!); wire.visual = { ...wire.visual, eyes: 'Blue eyes' };
      await assert.rejects(() => generateSetupCharacter(draft, person.id, 'Refresh the character.', settings(), new AbortController().signal, async (_url, init) => { sent = JSON.parse(String(init!.body)); return completion(wire); }, { mode, allowAppearanceChanges: true }), /Pinned eyes/);
      assert.deepEqual(JSON.parse(sent.messages[1].content).factPins, resolvedFactPins(draft.plan!)); assert.match(sent.messages[0].content, /Author factPins/);
    }
    const named = structuredClone(draft); named.plan!.factPins.fields.push({ kind: 'character', recordId: person.id, field: 'name' });
    let nameContext: any;
    await assert.rejects(() => generateSetupCharacter(named, person.id, '', settings(), new AbortController().signal, async (_url, init) => { nameContext = JSON.parse(JSON.parse(String(init!.body)).messages[1].content); return completion({ name: 'Rowan' }); }, { mode: 'name' }), /Pinned name/);
    assert.deepEqual(nameContext.factPins, resolvedFactPins(named.plan!));
    const wire = characterWire(draft.plan!); wire.persona = { ...wire.persona, voice: 'Short, careful replies' };
    const allowed = await generateSetupCharacter(draft, person.id, 'Make their voice concise.', settings(), new AbortController().signal, async () => completion(wire));
    assert.equal(allowed.canon.characters[0].persona!.voice, 'Short, careful replies'); assert.deepEqual(allowed.factPins, draft.plan!.factPins);
    assert.deepEqual(repository.readSetup(draft.id), draft);
  } finally { repository.close(); }
});

test('targeted setup designs and name rerolls guard pinned records and nested ultimate owners', async () => {
  const repository = new StoryRepository(':memory:');
  try {
    const draft = fixture(repository), plan = draft.plan!;
    const cases: { input: SetupDesignInput; pin: SetupPlan['factPins']['fields'][number]; value: unknown }[] = [
      { input: { kind: 'place', mode: 'name', targetId: plan.canon.places[0].id, direction: '' }, pin: { kind: 'place', recordId: plan.canon.places[0].id, field: 'name' }, value: { name: 'The Tern' } },
      { input: { kind: 'item', mode: 'full', targetId: plan.canon.items[0].id, direction: '' }, pin: plan.factPins.fields[1], value: { ...plan.canon.items[0], id: undefined, ownerId: plan.canon.characters[1].id } },
      { input: { kind: 'relationship', mode: 'revise', targetId: plan.canon.relationships[0].id, direction: '' }, pin: { kind: 'relationship', recordId: plan.canon.relationships[0].id, field: 'notes' }, value: { ...plan.canon.relationships[0], id: undefined, notes: 'They distrust each other.' } },
      { input: { kind: 'thread', mode: 'name', targetId: plan.canon.threads[0].id, direction: '' }, pin: { kind: 'thread', recordId: plan.canon.threads[0].id, field: 'title' }, value: { title: 'The silent inspector' } }
    ];
    for (const entry of cases) {
      const pinned = structuredClone(draft); if (!pinned.plan!.factPins.fields.some(pin => JSON.stringify(pin) === JSON.stringify(entry.pin))) pinned.plan!.factPins.fields.push(entry.pin);
      let sent: any; await assert.rejects(() => generateSetupRecord(pinned, entry.input, settings(), new AbortController().signal, async (_url, init) => { sent = JSON.parse(String(init!.body)); return completion(entry.value); }), /Pinned /);
      assert.deepEqual(JSON.parse(sent.messages[1].content).factPins, resolvedFactPins(pinned.plan!)); assert.match(sent.messages[0].content, /Author factPins/);
    }
    let sent: any; const created = await generateSetupRecord(draft, { kind: 'item', mode: 'create', direction: 'A station access card' }, settings(), new AbortController().signal, async (_url, init) => { sent = JSON.parse(String(init!.body)); return completion({ name: 'Access card', description: 'An old station pass.', quantity: 1, ownerId: plan.canon.characters[1].id, equipped: false }); });
    assert.equal(created.canon.items.length, plan.canon.items.length + 1); assert.deepEqual(created.factPins, plan.factPins); assert.deepEqual(JSON.parse(sent.messages[1].content).factPins, resolvedFactPins(plan));
    assert.deepEqual(repository.readSetup(draft.id), draft);
  } finally { repository.close(); }
});

test('saved setup pins and rules are never truncated to make generation fit a smaller context budget', async () => {
  const repository = new StoryRepository(':memory:');
  try {
    const draft = fixture(repository); draft.plan!.factPins.rules = Array.from({ length: 20 }, (_, index) => ({ id: `rule-${index}`, text: `Rule ${index}: ` + 'X'.repeat(1900) }));
    const small = settings(); small.text.contextTokens = 16384; let calls = 0;
    const fetcher: typeof fetch = async () => { calls++; throw new Error('The provider must not be called.'); }, signal = new AbortController().signal;
    for (const mode of ['name', 'revise', 'full'] as const) await assert.rejects(() => generateSetupCharacter(draft, draft.plan!.canon.characters[0].id, '', small, signal, fetcher, { mode }), /context budget/);
    const requests: SetupDesignInput[] = [
      ...(['name', 'revise', 'full'] as const).map(mode => ({ kind: 'place' as const, mode, targetId: draft.plan!.canon.places[0].id, direction: '' })),
      { kind: 'item', mode: 'create', direction: '' }, { kind: 'world', mode: 'revise', direction: '' }, { kind: 'opening', mode: 'revise', direction: '' }
    ];
    for (const request of requests) await assert.rejects(() => generateSetupRecord(draft, request, small, signal, fetcher), /context budget/);
    const rulesOnly = structuredClone(draft); rulesOnly.plan!.factPins.fields = [];
    await assert.rejects(() => generateSetup(rulesOnly, small, signal, fetcher), /context budget/);
    await assert.rejects(() => generatePassage({ setup: draft }, small, signal, () => {}, fetcher), /context budget/);
    assert.equal(calls, 0);
  } finally { repository.close(); }
});

test('opening generation receives pins in both prompts and conflicting opening effects commit nothing', async () => {
  const repository = new StoryRepository(':memory:');
  try {
    const draft = fixture(repository), person = draft.plan!.canon.characters[0], observed: any[] = [];
    const paragraph = 'Ava kept the manifest spread beneath her hands while Leto searched the empty cargo berth. The ship had arrived on schedule, but nobody waited beyond the glass. She checked the figures again, finding the same blank line under the delivery number. Leto pointed toward a light above the hatch and asked whether the station had sent a message. Ava shook her head. Their receiver had been silent since docking, and she wanted an answer before she opened the door.';
    const proposal = await generatePassage({ setup: draft }, settings(), new AbortController().signal, () => {}, async (_url, init) => {
      const body = JSON.parse(String(init!.body)), context = JSON.parse(body.messages[1].content); observed.push(context);
      return completion(context.before ? { effects: [], memory: { summary: 'The crew examines the delivery manifest.', facts: [], openQuestions: ['Why is the berth empty?'], characterIds: [person.id], locationIds: [draft.plan!.canon.places[0].id] } } : { title: 'An empty berth', chapterTitle: draft.plan!.chapterTitle, viewpointId: person.id, endOfChapter: false, paragraphs: [paragraph] });
    });
    assert.equal(observed.length, 2); for (const context of observed) assert.deepEqual(context.factPins, resolvedFactPins(draft.plan!));
    const invalid = structuredClone(proposal); invalid.draft.paragraphs = ['Ava gave her canvas bag and all its contents to Leto.']; invalid.effects = [{ type: 'item.transfer', itemId: draft.plan!.canon.items[0].id, fromOwnerId: person.id, toOwnerId: draft.plan!.canon.characters[1].id, evidence: invalid.draft.paragraphs[0] }];
    assert.throws(() => prepareOpening(draft, invalid, randomUUID()), /Pinned ultimate owner/);
    assert.throws(() => repository.commitOpening(draft.id, draft.revision, randomUUID(), 'conflicting-opening', invalid), /Pinned ultimate owner/);
    assert.equal(repository.list().length, 0); assert.deepEqual(repository.readSetup(draft.id), draft);
    const story = repository.commitOpening(draft.id, draft.revision, randomUUID(), 'valid-opening', proposal);
    assert.deepEqual(story.factPins, draft.plan!.factPins); assert.equal(story.passages.length, 1);
  } finally { repository.close(); }
});

test('setup ZIP imports preserve pin constraints through publication and subsequent story ZIPs', async () => {
  const repository = new StoryRepository(':memory:');
  try {
    const draft = fixture(repository), imported = repository.importSetup(repository.exportSetup(draft.id));
    assert.notEqual(imported.id, draft.id); assert.deepEqual(imported.plan!.factPins, draft.plan!.factPins);
    const story = repository.commitOpening(imported.id, imported.revision, randomUUID(), 'portable-opening', opening(imported));
    const copied = await repository.import(repository.export(story.id));
    assert.deepEqual(copied.factPins, draft.plan!.factPins); assert.deepEqual(resolvedFactPins(copied), resolvedFactPins(draft.plan!));
    assert.deepEqual(repository.readSetup(draft.id), draft);
  } finally { repository.close(); }
});
