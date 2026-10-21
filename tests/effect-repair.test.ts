import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { StoryRepository } from '../src/lib/server/repository';
import { blankSetupPlan } from '../src/lib/setup';
import { normalizeCharacterProfile } from '../src/lib/character-profile';
import { connectionSchema } from '../src/lib/server/connections';
import { generatePassage } from '../src/lib/server/story-generation';

const settings = () => connectionSchema.parse({ ...JSON.parse(readFileSync('config/connections.example.json', 'utf8')), text: { baseUrl: 'http://localhost:9999/v1', model: 'test-model', maxTokens: 4096, contextTokens: 32000, temperature: 0.8, structuredOutput: 'prompt' } });
const completion = (value: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) }, finish_reason: 'stop' }] }));
const paragraphs = [
  'Alex finished his breakfast and looked out at the quiet yard.',
  'He set the cup beside his plate and listened to the morning birds.',
  'Alex walked from the kitchen into the stable aisle.',
  'Erin waited in her stall, watching him approach with steady attention.',
  'He greeted her quietly and examined the empty hay rack.',
  'The stored hay smelled sweet in the cool morning air.',
  'Alex moved three flakes of hay from storage into Erin’s stall.',
  'He checked the water before returning to the stall door.',
  'Alex took two sugar cubes from the bag and fed them to Erin, leaving the bag partly used.',
  'She finished the treats while he gathered the grooming tools.',
  'Alex led Erin out of her stall into the stable aisle.'
];
const memory = { summary: 'Alex brought hay and treats to Erin, then led her into the aisle.', facts: ['Erin ate two sugar cubes.'], openQuestions: [], characterIds: ['alex', 'erin'], locationIds: ['stable-aisle', 'erin-stall'] };
const otherEffects = [
  { type: 'character.move', characterId: 'alex', locationId: 'stable-aisle', evidenceId: 'source-2' },
  { type: 'item.split', ref: 'new-hay-flakes-erin', itemId: 'hay-flakes', expectedQuantity: 60, quantity: 3, ownerId: 'erin-stall', evidenceId: 'source-6' },
  { type: 'character.move', characterId: 'erin', locationId: 'stable-aisle', evidenceId: 'source-10' }
];
const invalidSugar = [
  { type: 'item.quantity', itemId: 'sugar-cubes', expectedQuantity: 1, quantity: 0, evidenceId: 'source-8' },
  { type: 'item.split', ref: 'new-sugar-cubes-consumed', itemId: 'sugar-cubes', expectedQuantity: 1, quantity: 2, ownerId: 'erin', evidenceId: 'source-8' }
];
const fixedSugar = { type: 'item.update', itemId: 'sugar-cubes', description: 'A partly used bag of sugar cubes; two cubes were used. Exact remaining contents are unspecified.', evidenceId: 'source-8' };
function fixture(r: StoryRepository) {
  const draft = r.createSetup({ premise: 'A quiet morning at a stable.', castSize: 2, preferences: { passageWords: 100 } }, randomUUID());
  const plan = blankSetupPlan();
  plan.canon.places = [
    { id: 'kitchen', name: 'Kitchen', description: '', parentId: null },
    { id: 'stable-aisle', name: 'Stable Aisle', description: '', parentId: null },
    { id: 'erin-stall', name: 'Erin Stall', description: '', parentId: 'stable-aisle' }
  ];
  plan.canon.characters = [
    normalizeCharacterProfile({ ...plan.canon.characters[0], id: 'alex', name: 'Alex', locationId: 'kitchen' }),
    normalizeCharacterProfile({ ...plan.canon.characters[0], id: 'erin', name: 'Erin', locationId: 'erin-stall', visual: { species: 'horse' } })
  ];
  plan.canon.items = [
    { id: 'hay-flakes', name: 'Hay flakes', description: 'Counted whole flakes.', quantity: 60, ownerId: 'stable-aisle', equipped: false },
    { id: 'sugar-cubes', name: 'Sugar cubes', description: 'One bag of sugar cubes, exact contents unspecified.', quantity: 1, ownerId: 'alex', equipped: false }
  ];
  plan.context.sceneBrief = { ...plan.context.sceneBrief, viewpointId: 'alex', locationId: 'kitchen', castIds: ['alex'], purpose: 'Alex visits the stable.' };
  return r.saveSetup(draft.id, { expectedRevision: 0, requestId: randomUUID(), input: draft.input, plan });
}

for (const failure of ['invalid-fields', 'invalid-preconditions', 'invalid-evidence'] as const) test(`opening repairs ${failure} once without regenerating prose or losing valid changes`, async () => {
  const r = new StoryRepository(':memory:');
  try {
    const setup = fixture(r), before = structuredClone(setup);
    let narrations = 0, extractions = 0, reviews = 0;
    const stages: unknown[] = [];
    const proposal = await generatePassage({ setup }, settings(), new AbortController().signal, stage => stages.push(stage), async (_url, init) => {
      const body = JSON.parse(String(init!.body)), system = body.messages[0].content;
      if (system.startsWith('Review inventory consistency.')) {
        reviews++;
        const after = JSON.parse(body.messages[1].content).after;
        assert.equal(after.items.find((i: any) => i.id === 'sugar-cubes').quantity, 1);
        assert.match(after.items.find((i: any) => i.id === 'sugar-cubes').description, /partly used/);
        assert.equal(after.items.filter((i: any) => i.name === 'Sugar cubes').length, 1);
        assert.equal(after.items.find((i: any) => i.id === 'hay-flakes').quantity, 57);
        return completion({ consistent: true, issues: [] });
      }
      if (system.startsWith('Return {effects:')) {
        extractions++;
        assert.match(system, /One bag\/box\/supply with unspecified contents is not one individual piece/);
        if (extractions === 2) {
          const repair = JSON.parse(body.messages.at(-1).content);
          assert.ok(repair.issues.length); assert.match(repair.task, /do not change prose/);
          return completion({ effects: [...otherEffects, fixedSugar], memory });
        }
        const sugar = failure === 'invalid-fields' ? invalidSugar
          : failure === 'invalid-preconditions' ? invalidSugar.map(e => e.type === 'item.split' ? { ...e, expectedQuantity: 2 } : e)
          : [{ ...fixedSugar, evidenceId: 'source-999' }];
        return completion({ effects: [...otherEffects.slice(0, 2), ...sugar, otherEffects[2]], memory });
      }
      narrations++;
      assert.match(system, /Never increase stock just to make prose possible/);
      return completion({ title: 'A stable morning', chapterTitle: setup.plan!.chapterTitle, viewpointId: 'alex', endOfChapter: false, paragraphs });
    });
    assert.equal(narrations, 1); assert.equal(extractions, 2); assert.equal(reviews, 1);
    assert.ok(JSON.stringify(stages).includes('repairing-inventory'));
    assert.deepEqual(r.readSetup(setup.id), before); assert.deepEqual(r.list(), []);
    const story = r.commitOpening(setup.id, setup.revision, randomUUID(), 'opening-with-repair', proposal);
    assert.deepEqual(story.passages[0].paragraphs, paragraphs);
    assert.equal(story.canon.characters.find(c => c.id === 'erin')!.locationId, 'stable-aisle');
    assert.equal(story.canon.items.find(i => i.id === 'hay-flakes')!.quantity, 57);
    assert.equal(story.canon.items.find(i => i.id === 'sugar-cubes')!.quantity, 1);
    assert.equal(story.canon.items.filter(i => i.name === 'Sugar cubes').length, 1);
  } finally { r.close(); }
});

for (const persistent of ['invalid-fields', 'semantic-disagreement', 'cancelled-repair'] as const) test(`${persistent} after structural failure cannot publish or trigger a second repair`, async () => {
  const r = new StoryRepository(':memory:');
  try {
    const setup = fixture(r), before = structuredClone(setup), controller = new AbortController();
    let extractions = 0, reviews = 0;
    await assert.rejects(() => generatePassage({ setup }, settings(), controller.signal, () => {}, async (_url, init) => {
      const body = JSON.parse(String(init!.body)), system = body.messages[0].content;
      if (system.startsWith('Review inventory consistency.')) { reviews++; return completion({ consistent: false, issues: ['Deleting a partly used bag loses its remaining contents.'] }); }
      if (system.startsWith('Return {effects:')) {
        extractions++;
        if (extractions === 2 && persistent === 'cancelled-repair') { controller.abort(); return completion({ effects: [...otherEffects, fixedSugar], memory }); }
        return completion({ effects: [...otherEffects, ...(extractions === 2 && persistent === 'semantic-disagreement' ? [invalidSugar[0]] : invalidSugar)], memory });
      }
      return completion({ title: 'A stable morning', chapterTitle: setup.plan!.chapterTitle, viewpointId: 'alex', endOfChapter: false, paragraphs });
    }), persistent === 'invalid-fields' ? /invalid passage effects after one repair/ : persistent === 'semantic-disagreement' ? /still disagree after a repair attempt/ : /cancel|abort/i);
    assert.equal(extractions, 2); assert.equal(reviews, persistent === 'semantic-disagreement' ? 1 : 0);
    assert.deepEqual(r.readSetup(setup.id), before); assert.deepEqual(r.list(), []);
  } finally { r.close(); }
});

test('two consumed cubes cannot silently turn one counted cube into an unlimited tin', async () => {
  const r = new StoryRepository(':memory:');
  try {
    let setup = fixture(r);
    const plan = structuredClone(setup.plan!);
    plan.canon.items.find(item => item.id === 'sugar-cubes')!.description = 'Small sugar cubes as pony treats in tin.';
    setup = r.saveSetup(setup.id, { expectedRevision: setup.revision, requestId: randomUUID(), input: setup.input, plan });
    const before = structuredClone(setup), prose = paragraphs.map((p, i) => i === 8 ? 'Alex took two sugar cubes from the tin and fed them to Erin.' : p);
    let extractions = 0, reviews = 0;
    await assert.rejects(() => generatePassage({ setup }, settings(), new AbortController().signal, () => {}, async (_url, init) => {
      const body = JSON.parse(String(init!.body)), system = body.messages[0].content;
      if (system.startsWith('Review inventory consistency.')) {
        reviews++;
        const sugar = JSON.parse(body.messages[1].content).after.items.find((item: any) => item.id === 'sugar-cubes');
        assert.equal(sugar.quantity, 1); assert.equal(sugar.unlimited, undefined);
        return completion({ consistent: false, issues: ['Only one counted sugar cube is recorded, but the prose consumes two. Review the count or explicitly choose Always available in Possessions.'] });
      }
      if (system.startsWith('Return {effects:')) { extractions++; return completion({ effects: [...otherEffects, ...(extractions === 1 ? invalidSugar : [])], memory }); }
      return completion({ title: 'A stable morning', chapterTitle: setup.plan!.chapterTitle, viewpointId: 'alex', endOfChapter: false, paragraphs: prose });
    }), /Only one counted sugar cube/);
    assert.equal(extractions, 2); assert.equal(reviews, 1);
    assert.deepEqual(r.readSetup(setup.id), before); assert.deepEqual(r.list(), []);
  } finally { r.close(); }
});
