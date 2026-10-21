import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSample, sampleReplacementProposal } from '../src/lib/server/fixture';
import { normalizeCharacterProfile } from '../src/lib/character-profile';
import { applyStoryEffects } from '../src/lib/story-effects';
import type { StoryEffect } from '../src/lib/effect-types';
import { connectionSchema } from '../src/lib/server/connections';
import { generatePassage } from '../src/lib/server/story-generation';
import { preparePassageCommit } from '../src/lib/server/passage-commit';

const quote = 'Elias took off his worn flight jacket, leaving his charcoal shirt on, and handed the jacket to Mira. In return, Mira handed him the access fob; she folded the jacket over her arm rather than putting it on.';
function tradeStory() {
  const story = createSample();
  const elias = story.canon.characters.find(c => c.id === 'elias')!;
  Object.assign(elias, normalizeCharacterProfile({ ...elias, pinnedAppearance: false, wardrobe: { upper_body: 'Worn flight jacket over a charcoal shirt', lower_body: 'Grey trousers', footwear: 'Black boots', accessories: '' }, outfitNotes: '' }));
  const mira = story.canon.characters.find(c => c.id === 'mira')!;
  Object.assign(mira, normalizeCharacterProfile({ ...mira, wardrobe: { upper_body: 'Olive work coveralls', lower_body: 'Olive work coveralls', footwear: 'Work boots', accessories: 'Utility belt' }, outfitNotes: '' }));
  story.canon.items.find(i => i.id === 'fob')!.ownerId = 'mira';
  story.preferences.passageWords = 100;
  return story;
}
const untrackedTrade = (): StoryEffect[] => [
  { type: 'item.create', ref: 'new-flight-jacket', name: 'Worn flight jacket', description: 'The worn flight jacket Elias traded to Mira.', quantity: 1, ownerId: 'mira', equipped: false, evidence: quote },
  { type: 'item.transfer', itemId: 'fob', fromOwnerId: 'mira', toOwnerId: 'elias', evidence: quote },
  { type: 'character.update', characterId: 'elias', wardrobe: { upper_body: 'Charcoal shirt' }, evidence: quote }
];
const settings = () => connectionSchema.parse({ ...JSON.parse(readFileSync('config/connections.example.json', 'utf8')), text: { baseUrl: 'http://localhost:9999/v1', model: 'test-model', maxTokens: 4096, contextTokens: 65536, temperature: 0.8, structuredOutput: 'prompt' } });
const completion = (value: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) }, finish_reason: 'stop' }] }));

test('an evidenced trade materializes wardrobe-only clothes for the recipient, commits both sides and rolls back together on replacement', async () => {
  const story = tradeStory(), original = structuredClone(story);
  let extractionPrompt = '', extractionBefore: unknown;
  const fetcher: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init!.body));
    if(body.messages[0].content.startsWith('Review inventory consistency.'))return completion({consistent:true,issues:[]});
    if (body.messages[0].content.startsWith('Return {effects:')) {
      extractionPrompt = body.messages[0].content;
      extractionBefore = JSON.parse(body.messages[1].content).before;
      return completion({ effects: untrackedTrade().map(({ evidence: _evidence, ...effect }) => ({ ...effect, evidenceId: 'source-0' })), memory: { summary: 'Elias traded his jacket to Mira for the access fob.', facts: ['Mira now owns the jacket; Elias owns the fob.'], openQuestions: [], characterIds: ['elias', 'mira'], locationIds: ['bridge'] } });
    }
    return completion({ title: 'An unusual price', chapterTitle: 'Terms of trade', viewpointId: 'elias', endOfChapter: false, paragraphs: [quote, 'The bridge went quiet while the deal settled. Elias turned the fob over in his palm and listened to its metal tap against his fingers. Mira smoothed one sleeve of her new possession, then put it beside her tools. Neither offered to undo the exchange. Outside the viewport, a line of docking lights flickered back into life.'] });
  };
  const proposal = await generatePassage({ story, mode: 'continue', direction: 'Complete the agreed exchange.' }, settings(), new AbortController().signal, () => {}, fetcher);
  assert.match(extractionPrompt, /completed exchange has BOTH sides/);
  assert.match(extractionPrompt, /exists only in a character's wardrobe\/notes, create ONE inventory item/);
  assert.match(extractionPrompt, /transfer that exact item ID instead of creating a duplicate/);
  assert.match(extractionPrompt, /recipient merely holding\/owning clothes does not wear them/);
  assert.doesNotMatch(extractionPrompt, /Do not invent garment inventory entries/);
  assert.equal((extractionBefore as typeof story.canon).characters.find(c => c.id === 'elias')!.wardrobe!.upper_body, 'Worn flight jacket over a charcoal shirt');
  const applied = preparePassageCommit(story, proposal), jacket = applied.story.canon.items.find(i => i.id === applied.assigned['new-flight-jacket'])!;
  assert.equal(jacket.ownerId, 'mira');
  assert.equal(jacket.equipped, false);
  assert.equal(jacket.quantity, 1);
  assert.equal(applied.story.canon.items.find(i => i.id === 'fob')!.ownerId, 'elias');
  assert.equal(applied.story.canon.items.length, story.canon.items.length + 1);
  assert.equal(applied.story.canon.characters.find(c => c.id === 'elias')!.wardrobe!.upper_body, 'Charcoal shirt');
  assert.equal(applied.story.canon.characters.find(c => c.id === 'elias')!.wardrobe!.footwear, 'Black boots');
  assert.deepEqual(applied.story.canon.characters.find(c => c.id === 'mira')!.wardrobe, story.canon.characters.find(c => c.id === 'mira')!.wardrobe);
  assert.equal(applied.passage.generation!.effects.length, 3);
  assert.equal(applied.story.context.memories.at(-1)!.summary, 'Elias traded his jacket to Mira for the access fob.');
  const replaced = preparePassageCommit(applied.story, sampleReplacementProposal(applied.story, applied.passage.id));
  assert.deepEqual(replaced.story.canon, story.canon);
  assert.deepEqual(story, original);
});

test('a tracked garment is transferred once and can be worn by the recipient while structured outfits stay aligned', () => {
  const story = tradeStory(), prose = 'Elias removed his flight jacket, leaving his charcoal shirt on, and traded it for Mira’s access fob. Mira put the jacket on over her olive work coveralls.';
  story.canon.items.push({ id: 'jacket', name: 'Worn flight jacket', description: 'Elias’s worn flight jacket.', quantity: 1, ownerId: 'elias', equipped: true });
  const { canon } = applyStoryEffects(story.canon, [
    { type: 'item.transfer', itemId: 'jacket', fromOwnerId: 'elias', toOwnerId: 'mira', evidence: prose },
    { type: 'item.transfer', itemId: 'fob', fromOwnerId: 'mira', toOwnerId: 'elias', evidence: prose },
    { type: 'character.update', characterId: 'elias', wardrobe: { upper_body: 'Charcoal shirt' }, evidence: prose },
    { type: 'character.update', characterId: 'mira', wardrobe: { upper_body: 'Worn flight jacket over olive work coveralls' }, evidence: prose },
    { type: 'item.equip', itemId: 'jacket', equipped: true, evidence: prose }
  ], prose);
  assert.equal(canon.items.length, story.canon.items.length);
  assert.deepEqual(canon.items.find(i => i.id === 'jacket'), { ...story.canon.items.find(i => i.id === 'jacket')!, ownerId: 'mira', equipped: true });
  assert.equal(canon.items.find(i => i.id === 'fob')!.ownerId, 'elias');
  const giver = canon.characters.find(c => c.id === 'elias')!, recipient = canon.characters.find(c => c.id === 'mira')!;
  assert.equal(giver.wardrobe!.upper_body, 'Charcoal shirt');
  assert.doesNotMatch(giver.outfit, /jacket/i);
  assert.match(recipient.outfit, /Worn flight jacket over olive work coveralls/);
  assert.equal(recipient.wardrobe!.accessories, 'Utility belt');
});

test('an invalid clothing trade cannot publish half the exchange or bypass a pinned outfit or source evidence', () => {
  const story = tradeStory();
  story.canon.characters.find(c => c.id === 'elias')!.pinnedAppearance = true;
  const original = structuredClone(story.canon);
  assert.throws(() => applyStoryEffects(story.canon, untrackedTrade(), quote), /Pinned/);
  assert.deepEqual(story.canon, original);
  story.canon.characters.find(c => c.id === 'elias')!.pinnedAppearance = false;
  const unpinned = structuredClone(story.canon), wrongOwner = untrackedTrade();
  wrongOwner[1] = { type: 'item.transfer', itemId: 'fob', fromOwnerId: 'ren', toOwnerId: 'elias', evidence: quote };
  assert.throws(() => applyStoryEffects(story.canon, wrongOwner, quote), /current owner/);
  assert.throws(() => applyStoryEffects(story.canon, untrackedTrade(), 'The two discussed a trade but did not agree.'), /evidence is not present/);
  assert.deepEqual(story.canon, unpinned);
});
