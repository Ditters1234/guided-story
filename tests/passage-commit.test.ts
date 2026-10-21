import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { StoryRepository } from '../src/lib/server/repository';
import { createSample, sampleContinuationProposal, sampleReplacementProposal } from '../src/lib/server/fixture';
import { applyStoryEffects } from '../src/lib/story-effects';
import { preparePassageCommit, type PassageCommit } from '../src/lib/server/passage-commit';
import { normalizeCharacterProfile } from '../src/lib/character-profile';
import { visualIdentitySchema } from '../src/lib/visual-identity';
import { evidenceSources,resolveEffectEvidence } from '../src/lib/server/evidence-sources';
const request = (proposal = sampleContinuationProposal('')): PassageCommit => ({ expectedRevision: 0, requestId: randomUUID(), proposal });

test('a passage and evidenced ensemble effects commit atomically, deduplicate, and replace only the latest passage from its baseline', async () => {
  const repository = new StoryRepository(':memory:');
  try {
    const initial = repository.create(), input = request();
    const continued = repository.commitGeneratedPassage(initial.id, input);
    assert.equal(continued.passages.length, 4); assert.equal(continued.revision, 1); assert.equal(continued.canon.items.find(i => i.id === 'fob')!.ownerId, 'ren');
    assert.equal(continued.passages.at(-1)!.generation!.requestId, input.requestId); assert.equal(continued.passages.at(-1)!.generation!.effects[0].type, 'item.transfer');
    const imported = await repository.import(repository.export(initial.id)); assert.deepEqual(imported.passages.at(-1)!.generation, continued.passages.at(-1)!.generation);
    assert.deepEqual(repository.commitGeneratedPassage(initial.id, input), continued);
    assert.throws(() => repository.commitGeneratedPassage(initial.id, { ...input, proposal: { ...input.proposal, direction: 'changed intent' } }), /different passage proposal/);
    const replacement: PassageCommit = { expectedRevision: 1, requestId: randomUUID(), proposal: sampleReplacementProposal(continued, continued.passages.at(-1)!.id) };
    const replaced = repository.commitGeneratedPassage(initial.id, replacement);
    assert.equal(replaced.passages.length, 4); assert.equal(replaced.passages.at(-1)!.id, continued.passages.at(-1)!.id); assert.equal(replaced.canon.items.find(i => i.id === 'fob')!.ownerId, 'elias');
    assert.throws(() => repository.commitGeneratedPassage(initial.id, { ...replacement, requestId: randomUUID(), expectedRevision: 2, proposal: { ...replacement.proposal, passageId: replaced.passages[0].id } }), /Only the latest/);
  } finally { repository.close(); }
});
test('invalid or late effects leave both prose and world intact', () => {
  const repository = new StoryRepository(':memory:');
  try {
    const story = repository.create(), input = request();
    const invalid = structuredClone(input); invalid.proposal.effects = [{ type: 'character.move', characterId: 'elias', locationId: 'missing-place', evidence: 'Elias held out his access fob.' }];
    assert.throws(() => repository.commitGeneratedPassage(story.id, invalid), /invalid entity references/); assert.deepEqual(repository.read(story.id), story);
    repository.mutate(story.id, { expectedRevision: 0, requestId: randomUUID(), action: { type: 'world', funds: 88, cargoNotes: 'Manual correction' } });
    const before = repository.read(story.id);
    assert.throws(() => repository.commitGeneratedPassage(story.id, input), /story changed/); assert.deepEqual(repository.read(story.id), before);
  } finally { repository.close(); }
});

test('evidenced item condition/name updates commit with the passage and roll back on latest replacement', () => {
  const r = new StoryRepository(':memory:');
  try {
    const original = r.create(), before = structuredClone(original.canon.items.find(i=>i.id==='fob')!);
    const proposal = sampleContinuationProposal(''), quote = 'The access fob was scorched along its brass edge.';
    proposal.draft.paragraphs.push(quote);
    proposal.effects.push({type:'item.update',itemId:'fob',name:'Scorched access fob',description:'Scorched along its brass edge.',evidence:quote});
    const saved = r.commitGeneratedPassage(original.id,request(proposal)), item = saved.canon.items.find(i=>i.id==='fob')!;
    assert.equal(item.name,'Scorched access fob'); assert.equal(item.description,'Scorched along its brass edge.'); assert.equal(item.ownerId,'ren'); assert.equal(item.quantity,before.quantity);
    const replaced = r.commitGeneratedPassage(saved.id,{expectedRevision:saved.revision,requestId:randomUUID(),proposal:sampleReplacementProposal(saved,saved.passages.at(-1)!.id)});
    assert.deepEqual(replaced.canon.items.find(i=>i.id==='fob'),before);
    assert.throws(()=>applyStoryEffects(original.canon,[{type:'item.update',itemId:'missing',description:'Damaged',evidence:quote}],quote),/Unknown item/);
    assert.throws(()=>applyStoryEffects(original.canon,[{type:'item.update',itemId:'fob',description:'Damaged',ownerId:'ren',evidence:quote}],quote));
    assert.deepEqual(r.read(saved.id),replaced);
  } finally { r.close(); }
});
test('generation cannot change content preferences or pinned fields, skip source evidence, or silently accept malformed effects', () => {
  const story = createSample(), base = structuredClone(story.canon), prose = 'Elias changed his jacket.';
  assert.throws(() => applyStoryEffects(base, [{ type: 'character.update', characterId: 'elias', outfit: 'Different jacket', evidence: prose }], prose), /Pinned/);
  assert.throws(() => applyStoryEffects(base, [{ type: 'character.update', characterId: 'elias', noNsfw: false, evidence: prose }], prose));
  assert.throws(() => applyStoryEffects(base, [{ type: 'character.move', characterId: 'elias', locationId: 'hold', evidence: 'An event never written.' }], prose), /evidence is not present/);
  assert.throws(() => preparePassageCommit(story, { ...sampleContinuationProposal(''), effects: undefined }));
  assert.deepEqual(base, story.canon);
});

test('sparse evidenced profile changes preserve identity and persona while synchronizing current clothing and injuries',()=>{
  const base=createSample().canon,c=base.characters.find(c=>c.id==='mira')!;
  Object.assign(c,normalizeCharacterProfile({...c,visual:visualIdentitySchema.parse({age:'33',apparentAge:'early thirties',gender:'woman',presentation:'feminine',hair:'copper hair',eyes:'green eyes'}),persona:{personality:'Practical',voice:'Quick and direct',motives:'Protect the ship',history:'Trained engineer'},wardrobe:{upper_body:'Grey shirt',lower_body:'Work trousers',footwear:'Black boots',accessories:'Tool belt'},injuries:'',appearanceNotes:'',outfitNotes:'',pinnedAppearance:false}));
  const prose='Mira dyed her hair blue, pulled on a red shirt, and caught her sleeve on a sharp edge, cutting her forearm.';
  const effect={type:'character.update',characterId:c.id,visual:{hair:'blue hair'},persona:{motives:'Repair the damaged ship'},wardrobe:{upper_body:'Red shirt'},injuries:'A cut on the forearm',evidence:prose};
  const result=applyStoryEffects(base,[effect],prose).canon.characters.find(p=>p.id===c.id)!;
  assert.equal(result.visual!.hair,'blue hair');assert.equal(result.visual!.eyes,'green eyes');assert.equal(result.visual!.age,'33');assert.equal(result.visual!.presentation,'feminine');assert.equal(result.wardrobe!.upper_body,'Red shirt');assert.equal(result.wardrobe!.footwear,'Black boots');assert.equal(result.persona!.voice,'Quick and direct');assert.equal(result.persona!.motives,'Repair the damaged ship');assert.equal(result.injuries,'A cut on the forearm');assert.equal(result.noNsfw,c.noNsfw);
  assert.ok(result.appearance.includes('blue hair'));assert.ok(!result.appearance.includes('copper hair'));assert.ok(result.outfit.includes('Red shirt'));assert.ok(!result.outfit.includes('Grey shirt'));assert.equal(c.visual!.hair,'copper hair');
  c.pinnedAppearance=true;for(const change of [{visual:{eyes:'blue eyes'}},{wardrobe:{upper_body:'Red shirt'}},{injuries:'A bruise'}])assert.throws(()=>applyStoryEffects(base,[{type:'character.update',characterId:c.id,...change,evidence:prose}],prose),/Pinned/);
  const personalityOnly=applyStoryEffects(base,[{type:'character.update',characterId:c.id,persona:{voice:'Quiet and deliberate'},evidence:prose}],prose);assert.equal(personalityOnly.canon.characters.find(p=>p.id===c.id)!.persona!.voice,'Quiet and deliberate');
});

test('new model extraction requires structured profiles and rejects competing freeform appearance updates',()=>{
  const paragraphs=['Iona, a dockmaster with grey hair, arrived at the berth.'],sources=evidenceSources(paragraphs),base={type:'character.create',ref:'new-iona',name:'Iona',role:'Dockmaster',notes:'',visual:visualIdentitySchema.parse({hair:'grey hair'}),persona:{personality:'',voice:'',motives:'',history:''},wardrobe:{upper_body:'',lower_body:'',footwear:'',accessories:''},injuries:'',appearanceNotes:'',outfitNotes:'',locationId:'bridge',evidenceId:sources[0].id};
  const [created]=resolveEffectEvidence([base],sources,paragraphs);assert.equal(created.type,'character.create');assert.equal(created.evidence,paragraphs[0]);if(created.type==='character.create'){assert.equal(created.visual!.age,'');assert.equal(created.visual!.eyes,'');assert.equal(created.visual!.hair,'grey hair');}
  const {persona:_persona,...missing}=base;assert.throws(()=>resolveEffectEvidence([missing],sources,paragraphs),/invalid effect fields/);
  assert.throws(()=>resolveEffectEvidence([{type:'character.update',characterId:'mira',appearance:'Blue hair',evidenceId:sources[0].id}],sources,paragraphs),/invalid effect fields/);
});
test('new entities use application IDs, resolve cross references, avoid duplicate cast names and default No NSFW', () => {
  const story = createSample(), prose = 'Iona arrived in the new berth carrying a brass token.';
  const result = applyStoryEffects(story.canon, [
    { type: 'character.create', ref: 'new-iona', name: 'Iona', role: 'Dockmaster', notes: '', appearance: 'Grey hair.', outfit: 'Uniform.', locationId: 'new-berth', evidence: prose },
    { type: 'item.create', ref: 'new-token', name: 'Brass token', description: '', quantity: 1, ownerId: 'new-iona', equipped: false, evidence: prose },
    { type: 'place.create', ref: 'new-berth', name: 'Outer berth', description: '', parentId: 'halcyon', evidence: prose }
  ], prose);
  const character = result.canon.characters.find(c => c.name === 'Iona')!;
  assert.equal(character.noNsfw, true); assert.notEqual(character.id, 'new-iona'); assert.equal(character.locationId, result.assigned['new-berth']);
  assert.equal(result.canon.items.find(i => i.name === 'Brass token')!.ownerId, character.id);
  assert.throws(() => applyStoryEffects(story.canon, [{ type: 'character.create', ref: 'new-duplicate', name: '  ELIAS VOSS ', role: '', notes: '', appearance: '', outfit: '', locationId: 'bridge', evidence: prose }], prose), /already exists/);
  assert.throws(() => applyStoryEffects(story.canon, [{ type: 'place.create', ref: 'new-cycle', name: 'Cycle', description: '', parentId: 'new-cycle', evidence: prose }], prose), /invalid entity references/);
});
test('ownership/quantity preconditions reject inconsistent effects and existing new-prefixed IDs remain valid', () => {
  const story = createSample(), prose = 'The crew moved their belongings.';
  assert.throws(() => applyStoryEffects(story.canon, [{ type: 'item.transfer', itemId: 'fob', fromOwnerId: 'mira', toOwnerId: 'ren', evidence: prose }], prose), /current owner/);
  assert.throws(() => applyStoryEffects(story.canon, [{ type: 'item.quantity', itemId: 'fob', expectedQuantity: 20, quantity: 1, evidence: prose }], prose), /quantity changed/);
  story.canon.places.push({ id: 'new-existing-place', name: 'Known place', description: '', parentId: null });
  const result = applyStoryEffects(story.canon, [{ type: 'character.move', characterId: 'elias', locationId: 'new-existing-place', evidence: prose }], prose);
  assert.equal(result.canon.characters[0].locationId, 'new-existing-place');
});
test('replacement refuses to silently remove entities referenced by manual context records', () => {
  const repository = new StoryRepository(':memory:');
  try {
    const initial = repository.create(), proposal = sampleContinuationProposal('');
    const prose = 'Iona joined the crew.'; proposal.draft.paragraphs = [prose]; proposal.effects = [{ type: 'character.create', ref: 'new-iona', name: 'Iona', role: '', notes: '', appearance: '', outfit: '', locationId: 'bridge', evidence: prose }];
    const continued = repository.commitGeneratedPassage(initial.id, request(proposal));
    const context = structuredClone(continued.context), iona = continued.canon.characters.find(c => c.name === 'Iona')!;
    context.sceneBrief.castIds.push(iona.id);
    const edited = repository.mutate(initial.id, { expectedRevision: 1, requestId: randomUUID(), action: { type: 'context', context } });
    assert.throws(() => repository.commitGeneratedPassage(initial.id, { expectedRevision: 2, requestId: randomUUID(), proposal: sampleReplacementProposal(edited, edited.passages.at(-1)!.id) }), /invalid story or context references/);
    assert.deepEqual(repository.read(initial.id), edited);
  } finally { repository.close(); }
});
