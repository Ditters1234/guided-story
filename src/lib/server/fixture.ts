import { randomUUID } from 'node:crypto';
import type { Canon, Passage, Story } from '../story';
import { emptyContext } from '../context-types';
import { storyPreferencesSchema } from '../settings';
import type { PassageCommit } from './passage-commit';
import { emptyMedia } from '../media';
import { normalizeCharacterProfile } from '../character-profile';
import { emptyFactPins } from '../fact-pins';

export function sampleContinuationProposal(direction: string): PassageCommit['proposal'] {
  return { mode: 'continue', direction, draft: { title: 'An old acquaintance', chapterTitle: 'Debts at Halcyon', startsChapter: true, endOfChapter: false, viewpointId: 'ren', paragraphs: [
    'In the dark, Ren could hear Mira counting the seconds between the emergency beacons. He wished she would stop.',
    '“I brought one here before,” he said. “Different ship. Different captain.”',
    'Elias held out his access fob. “Then you know which doors we need open. Take this.” Ren closed his hand around it.',
    'The officer’s voice returned over a battery-powered channel. “Ren. Tell me you haven’t connected it to your ship’s power.”'
  ] }, effects: [{ type: 'item.transfer', itemId: 'fob', fromOwnerId: 'elias', toOwnerId: 'ren', evidence: 'Elias held out his access fob.' }] };
}
export function sampleReplacementProposal(story: Story, passageId: string): PassageCommit['proposal'] {
  const latest = story.passages.at(-1)!;
  return { mode: 'replace', passageId, direction: '', draft: { title: latest.chapter === 2 ? 'No one goes alone' : 'A moment to choose', chapterTitle: latest.chapterTitle, startsChapter: false, endOfChapter: latest.endOfChapter, viewpointId: latest.chapter === 2 ? 'ren' : 'elias', paragraphs: latest.chapter === 2 ? [
    'Ren stared at the captain’s access fob, but Elias closed his hand around it.',
    '“We go together,” Elias said. “Whatever happened here before, you are not facing it alone.”',
    'Mira disconnected the cargo coupling. The bridge lights returned, one by one.'
  ] : ['“Keep the cargo sealed,” Elias said. “We are not making this decision in the dark.”', 'He cut the docking connection before the clamps could close. Beside him, Ren let out a breath he had been holding for years.'] }, effects: [] };
}
import { memorySourceHash } from './context-state';

export function createSample(): Story {
  const now = new Date().toISOString();
  const canon: Canon = {
    characters: [
      { id: 'elias', name: 'Elias Voss', role: 'Captain', appearance: 'Weathered face, dark hair threaded with grey.', notes: 'A charming trader trying to keep his crew together and his ship afloat.', outfit: 'Worn flight jacket, charcoal shirt', locationId: 'bridge', noNsfw: true, pinnedAppearance: true },
      { id: 'mira', name: 'Mira Sol', role: 'Engineer', appearance: 'Short copper hair, watchful eyes.', notes: 'Precise, guarded, and protective of the crew.', outfit: 'Olive work coveralls, utility belt', locationId: 'bridge', noNsfw: true, pinnedAppearance: false },
      { id: 'ren', name: 'Ren Calder', role: 'Pilot', appearance: 'Tousled dark hair, a narrow scar over one eyebrow.', notes: 'A gifted pilot who makes jokes when cornered. Has avoided Halcyon for three years.', outfit: 'Blue flight suit, rolled sleeves', locationId: 'bridge', noNsfw: true, pinnedAppearance: false }
    ],
    places: [
      { id: 'halcyon', name: 'Halcyon Station', description: 'A trading hub with unreliable power and expensive secrets.', parentId: null },
      { id: 'wayward', name: 'The Wayward', description: 'A battered crew freighter docked at Halcyon.', parentId: 'halcyon' },
      { id: 'bridge', name: 'Bridge', description: 'Cramped consoles and a wide view of the station.', parentId: 'wayward' },
      { id: 'hold', name: 'Cargo hold', description: 'A sealed container occupies the central cradle.', parentId: 'wayward' },
      { id: 'glass', name: 'The Glass Belt', description: 'Salvage fields and a quiet refuelling depot, one jump away.', parentId: null }
    ],
    items: [
      { id: 'cargo', name: 'Sealed container', description: 'Declared as agricultural machinery. Contents unknown.', quantity: 1, ownerId: 'hold', equipped: false },
      { id: 'fob', name: 'Access fob', description: 'Opens the Wayward’s crew-only doors.', quantity: 1, ownerId: 'elias', equipped: false },
      { id: 'tool', name: 'Multitool', description: 'Mira’s battered diagnostic tool.', quantity: 1, ownerId: 'mira', equipped: true }
    ],
    relationships: [{ id: 'crew-trust', fromId: 'elias', toId: 'ren', notes: 'Trusts Ren at the controls, knows little about his past.' }],
    threads: [
      { id: 'container', title: 'The sealed container', notes: 'Who—or what—is knocking?', status: 'open' },
      { id: 'past', title: 'Ren’s unfinished business', notes: 'Someone on Halcyon remembers the pilot.', status: 'open' }
    ], funds: 840, cargoNotes: 'One sealed container under a suspiciously generous delivery contract.'
  };
  canon.characters=canon.characters.map(normalizeCharacterProfile);
  const paragraphs = [
    ['Halcyon Station had gone dark twice in the last hour. Captain Elias Voss watched its docking lights blink back into existence and decided, against experience, to take that as a welcome.', '“Our contact wants the cargo delivered before the next blackout,” said Mira. “Triple the agreed fee. No inspection.”', 'From somewhere below the bridge came three slow knocks. Beneath a manifest that said agricultural machinery, something knocked again.'],
    ['Mira reached the cargo hold first. She did not touch the container. Instead, she crouched beside its power coupling and listened.', '“That is not coming from inside,” she said.', 'Beyond the sealed hatch, Halcyon’s docking arm locked onto the Wayward. The knocks stopped. Over the comm came a voice Ren knew very well. “Captain Voss. We need to talk about your cargo.”'],
    ['“You can keep your triple fee,” Elias told the docking officer. “We’d like to know what we’re delivering.”', 'The woman on the screen looked past him, straight at Ren. For the first time since they’d entered the system, the pilot had nothing to say.', '“Ask him,” she said. “And whatever he tells you, Captain—do not let them take that container off your ship.”', 'The docking clamps closed. Across the bridge, every light went out.']
  ];
  const passages: Passage[] = paragraphs.map((p, i) => ({ id: randomUUID(), chapter: 1, chapterTitle: 'Unusual cargo', title: ['A delivery with no questions', 'The silence in the hold', 'Terms of arrival'][i], viewpoint: i === 1 ? 'Mira' : 'Elias', paragraphs: p, direction: '', endOfChapter: i === 2, createdAt: now }));
  const context = emptyContext();
  context.sceneBrief = { scope: 'ongoing', clearAfterPassage: false, purpose: 'Bring the crew’s doubts about the delivery into the open.', tension: 'The station recognizes Ren, but Elias does not know why.', stopAt: 'A meaningful choice about the cargo or Ren’s past.', viewpointId: 'elias', locationId: 'bridge', castIds: ['elias', 'mira', 'ren'] };
  context.knowledge = [{ id: 'officer-recognition', fact: 'The docking officer recognizes Ren, but the reason has not been disclosed.', truth: 'established', knownBy: ['elias', 'mira', 'ren'], readerRevealed: true, sourcePassageId: passages.at(-1)!.id, sourceHash: memorySourceHash({ passages }, [passages.at(-1)!.id]) }];
  return { origin: 'sample', id: randomUUID(), title: 'The Far Side of Fortune', premise: 'A sci-fi story about a rogue space trader and his crew.', revision: 0, createdAt: now, updatedAt: now, canon, passages, recovery: { passageId: passages.at(-1)!.id, canon: structuredClone(canon), valid: true }, narrationStyle: 'Character-driven science-fiction adventure with a little mystery.', artStyle: 'Painterly science-fiction illustration, muted colors, soft cinematic lighting.', adultContent: false, preferences: storyPreferencesSchema.parse({}), recap: null, summaryCache: [], context, media: emptyMedia(), factPins: emptyFactPins() };
}
