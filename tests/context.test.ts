import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createSample } from '../src/lib/server/fixture';
import { buildStoryContext } from '../src/lib/server/context-builder';
import { memorySourceHash } from '../src/lib/server/context-state';
import { generateContinuityMemory } from '../src/lib/server/continuity';
import { StoryRepository } from '../src/lib/server/repository';
import { normalizeCharacterProfile } from '../src/lib/character-profile';
import { visualIdentitySchema } from '../src/lib/visual-identity';
const settings = { baseUrl: 'http://127.0.0.1:8888/v1', model: 'test', apiKey: 'private-test-credential', maxTokens: 1536, contextTokens: 16384 };

test('equally relevant memories prefer more recent source passages under a constrained budget', () => {
  const story = createSample();
  for (const [id, passage] of [['older', story.passages[0]], ['newer', story.passages.at(-1)!]] as const) story.context.memories.push({ id, passageIds: [passage.id], summary: id + ' ' + 'x'.repeat(4500), facts: [], openQuestions: [], characterIds: ['elias'], locationIds: ['bridge'], sourceHash: memorySourceHash(story, [passage.id]), createdAt: new Date().toISOString(), source: 'manual' });
  const full = buildStoryContext(story, '', 65536, 1536);
  const required = full.sources.filter(s => s.included && s.kind !== 'memory').reduce((sum, s) => sum + s.tokens, 0);
  const oneMemory = full.sources.find(s => s.id === 'newer')!.tokens;
  const report = buildStoryContext(story, '', required + oneMemory + 200 + 1536 + 1024, 1536);
  assert.equal(report.runnable, true); assert.equal(report.sources.find(s => s.id === 'newer')!.included, true); assert.equal(report.sources.find(s => s.id === 'older')!.included, false);
});

test('context selects relevant records and preserves required character preferences, without leaking secrets or reader recap', () => {
  const s = createSample();
  s.canon.characters.push({ ...s.canon.characters[0], id: 'remote', name: 'Distant Stranger', notes: 'Remote-character-secret', locationId: 'glass' });
  s.context.knowledge.push({ id: 'unrevealed', fact: 'Secret future ending: the station is alive.', truth: 'established', knownBy: ['ren'], readerRevealed: false, sourcePassageId: null, sourceHash: null });
  s.context.lore.push({ id: 'hidden', title: 'Hidden lore', text: 'Hidden-lore-secret', keywords: ['cargo'], relatedIds: [], visibility: 'hidden' });
  s.context.lore.push({ id: 'always', title: 'World rule', text: 'Travel requires fuel.', keywords: [], relatedIds: [], visibility: 'always' });
  s.recap = { text: 'Reader-edited-false-ending', sourceHash: '0'.repeat(64), throughPassageId: s.passages.at(-1)!.id, passageCount: 3, source: 'manual', updatedAt: new Date().toISOString(), stale: true };
  const report = buildStoryContext(s, 'Inspect the cargo.', 16384, 1536), text = report.messages.map(m => m.content).join('\n');
  assert.equal(report.runnable, true); assert.ok(report.inputTokens <= report.inputBudget);
  assert.ok(text.includes('Travel requires fuel.')); assert.ok(text.includes('"noNsfw":true'));
  assert.ok(text.includes(s.canon.characters[0].appearance));
  for (const excluded of ['Remote-character-secret', 'Secret future ending', 'Hidden-lore-secret', 'Reader-edited-false-ending']) assert.ok(!text.includes(excluded));
  assert.ok(report.sources.some(r => r.id === 'unrevealed' && !r.included));
});

test('narration context shares structured identity, persona and current clothing without competing summaries or picture directions',()=>{
  const s=createSample(),original=s.canon.characters[0];
  s.artStyle='Medium-only-test watercolor';
  s.canon.characters[0]=normalizeCharacterProfile({...original,visual:visualIdentitySchema.parse({age:'842',apparentAge:'mid thirties',gender:'woman',presentation:'androgynous',species:'vampire',eyes:'hazel eyes'}),persona:{personality:'Patient and private',voice:'Measured, dry wit',motives:'Protect the crew',history:'Former navigator'},currentState:'Uneasy about the missing shipment; wants a private word.',wardrobe:{upper_body:'Blue coat',lower_body:'Black trousers',footwear:'Soft boots',accessories:'Silver clasp'},injuries:'A healing cut above the brow',appearanceNotes:'',outfitNotes:''});
  s.canon.places.find(place=>place.id==='bridge')!.visualDescription='Image-only bridge layout';s.canon.items.find(item=>item.id==='fob')!.visualDescription='Image-only prop material';
  const report=buildStoryContext(s,'Let Elias speak to the crew.',65536,1536),text=report.messages.map(m=>m.content).join('\n');
  for(const value of ['"age":"842"','"apparentAge":"mid thirties"','"gender":"woman"','"presentation":"androgynous"','hazel eyes','Measured, dry wit','Blue coat','A healing cut above the brow'])assert.ok(text.includes(value),value);
  assert.equal(text.split('Uneasy about the missing shipment; wants a private word.').length-1,1);assert.ok(report.sources.find(source=>source.id===original.id+':state')?.required);assert.ok(!text.includes('Image-only bridge layout'));assert.ok(!text.includes('Image-only prop material'));
  assert.ok(!text.includes('"appearance":'));assert.ok(!text.includes('"outfit":'));assert.ok(!text.includes('Medium-only-test watercolor'));
  const requiredTokens=report.sources.filter(row=>row.required).reduce((sum,row)=>sum+row.tokens,0),constrained=buildStoryContext(s,'',requiredTokens+1536+1024+200,1536);const core=constrained.messages.map(m=>m.content).join('\n');
  assert.ok(constrained.sources.find(row=>row.id===original.id+':identity')!.required);assert.ok(core.includes('"age":"842"'));assert.ok(core.includes('"apparentAge":"mid thirties"'));
});

test('revealed information retains viewpoint knowledge distinction, and future possibilities are labeled', () => {
  const s = createSample();
  s.context.knowledge.push({ id: 'reader-only', fact: 'Ren has a private debt.', truth: 'belief', knownBy: ['ren'], readerRevealed: true, sourcePassageId: null, sourceHash: null });
  const text = JSON.stringify(buildStoryContext(s, 'Maybe the crew refuses the delivery later.', 16384, 1536).messages);
  assert.ok(text.includes('Character belief (may be false)')); assert.ok(text.includes('"viewpointKnows":false'.replaceAll('"', '\\"')));
  assert.ok(text.includes('not completed events') || text.includes('not history'));
});

test('continuity memories and knowledge become stale when their source is replaced, but irrelevant recap edits do not change context', () => {
  const s = createSample(), p = s.passages.at(-1)!;
  s.context.memories.push({ id: 'memory-test', passageIds: [p.id], summary: 'Exact remembered event.', facts: ['The clamps close.'], openQuestions: [], characterIds: ['elias'], locationIds: ['bridge'], sourceHash: memorySourceHash(s, [p.id]), source: 'manual', createdAt: new Date().toISOString() });
  assert.ok(buildStoryContext(s, '', 16384, 1536).sources.find(r => r.id === 'memory-test')!.included);
  p.paragraphs = ['The captain turns away before docking.'];
  const report = buildStoryContext(s, '', 16384, 1536);
  assert.equal(report.sources.find(r => r.id === 'memory-test')!.included, false);
  assert.equal(report.sources.find(r => r.id === 'officer-recognition')!.included, false);
  assert.ok(report.warnings.length > 0);
});

test('required context cannot be silently dropped to fit, and recent prose retains its exact ending', () => {
  const s = createSample();
  const failed = buildStoryContext(s, '', 1024, 1024);
  assert.equal(failed.runnable, false);
  s.passages.at(-1)!.paragraphs = [('A long early paragraph. ').repeat(1000), 'This exact final line must survive.'];
  const report = buildStoryContext(s, '', 16384, 1536);
  assert.ok(report.messages[0].content.includes('This exact final line must survive.'));
  assert.equal(report.sources.find(r => r.id === 'recent-prose')!.clipped, true);
});

test('manual context records save independently, and unchanged stale sources are not relabeled as current', () => {
  const r = new StoryRepository(':memory:');
  try {
    let s = r.create(); const context = structuredClone(s.context);
    context.memories.push({ id: 'manual-memory', passageIds: [s.passages.at(-1)!.id], summary: 'The station goes dark.', facts: [], openQuestions: [], characterIds: [], locationIds: [], sourceHash: '0'.repeat(64), source: 'manual', createdAt: new Date().toISOString() });
    s = r.mutate(s.id, { expectedRevision: 0, requestId: randomUUID(), action: { type: 'context', context } });
    assert.equal(s.recovery!.valid, true);
    const hash = s.context.memories[0].sourceHash;
    s = r.mutate(s.id, { expectedRevision: 1, requestId: randomUUID(), action: { type: 'sample-replace', passageId: s.passages.at(-1)!.id } });
    s = r.mutate(s.id, { expectedRevision: 2, requestId: randomUUID(), action: { type: 'context', context: { ...s.context, sceneBrief: { ...s.context.sceneBrief, tension: 'A different tension.' } } } });
    assert.equal(s.context.memories[0].sourceHash, hash);
    assert.equal(buildStoryContext(s, '', 16384, 1536).sources.find(r => r.id === 'manual-memory')!.included, false);
  } finally { r.close(); }
});

test('model-generated memory records source provenance and rejects unknown entity IDs', async () => {
  const s = createSample(), passageId = s.passages[0].id;
  const completion = (characterIds: string[]): typeof fetch => async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: 'The crew approaches Halcyon.', facts: ['Cargo is sealed.'], openQuestions: ['What is inside?'], characterIds, locationIds: ['halcyon'] }) }, finish_reason: 'stop' }] }));
  const result = await generateContinuityMemory(s, passageId, settings, new AbortController().signal, completion(['elias']));
  assert.equal(result.sourceHash, memorySourceHash(s, [passageId])); assert.equal(result.source, 'generated');
  await assert.rejects(generateContinuityMemory(s, passageId, settings, new AbortController().signal, completion(['imaginary-character'])), /unknown entity IDs/);
});
