import { estimateInputTokens } from '../src/lib/server/token-budget';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { zipSync, strToU8 } from 'fflate';
import { longStory } from './memory-fixture';
import { compactMemory } from '../src/lib/server/memory-compaction';
import { buildStoryContext } from '../src/lib/server/context-builder';
import { bookMemoryCurrent, chapterMemoryCurrent, compactionPlan } from '../src/lib/server/context-state';
import { StoryRepository } from '../src/lib/server/repository';
import { contextSettingsSchema } from '../src/lib/settings';
import { preparePassageCommit } from '../src/lib/server/passage-commit';

const settings = { baseUrl: 'http://127.0.0.1:8888/v1', model: 'qa', maxTokens: 1800, contextTokens: 16384, structuredOutput: 'prompt' };
const signal = () => new AbortController().signal;
function provider(inputs: string[] = [], change: Record<string,unknown> = {}): typeof fetch {
  return async (_, init) => {
    const body = JSON.parse(String(init?.body)), input = body.messages.map((m: { content: string }) => m.content).join('\n'); inputs.push(input);
    assert.ok(estimateInputTokens(body.messages) + body.max_tokens + 1024 <= settings.contextTokens);
    const content = JSON.stringify({ summary: 'The crew inspected the route, made a delivery and continued their journey.', facts: ['The crew continued its journey.'], openQuestions: ['What awaits at the next stop?'], characterIds: ['elias','mira'], locationIds: ['bridge'], ...change });
    return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }));
  };
}
async function compact(story = longStory(), inputs: string[] = []) {
  const result = await compactMemory(story, settings, signal(), undefined, provider(inputs));
  story.context.compaction = result.compaction; return { story, result };
}

test('chapter/book compaction bounds requests, covers completed chapters and excludes plans, secrets and reader recaps', async () => {
  const story = longStory(), before = JSON.stringify({ canon: story.canon, passages: story.passages }), inputs: string[] = [];
  story.recap = { text: 'FALSE READER RECAP: the ship exploded.', source: 'manual', sourceHash: '0'.repeat(64), throughPassageId: story.passages.at(-1)!.id, passageCount: story.passages.length, updatedAt: story.updatedAt, stale: true };
  const { result } = await compact(story,inputs);
  assert.equal(result.pending, 0); assert.equal(result.compaction.chapters.length, 4); assert.deepEqual(result.compaction.book!.chapterNumbers,[1,2]);
  assert.equal(bookMemoryCurrent(story),true); assert.ok(result.compaction.chapters.every(m => chapterMemoryCurrent(story,m)));
  for (const hidden of ['UNWRITTEN FUTURE','HIDDEN REVEAL','SECRET KNOWLEDGE','FALSE READER RECAP']) assert.ok(!inputs.join('\n').includes(hidden));
  assert.equal(JSON.stringify({ canon: story.canon, passages: story.passages }),before);
  assert.ok(result.calls >= 5);
  const cached = await compactMemory(story,settings,signal(),undefined,provider()); assert.equal(cached.calls,0);
});

test('bounded narration uses a book overview, recent chapter summaries and source-quoted old ownership/clue events', async () => {
  const { story } = await compact(), report = buildStoryContext(story,'Follow the cobalt ledger clue and account for the access fob.',16384,1800);
  const text = report.messages.map(m => m.content).join('\n');
  assert.equal(report.runnable,true); assert.ok(report.inputTokens <= report.inputBudget);
  assert.ok(report.sources.some(s => s.kind === 'book-memory' && s.included));
  assert.ok(report.sources.some(s => s.kind === 'chapter-memory' && s.included));
  assert.ok(report.sources.some(s => s.kind === 'event-record' && s.included));
  assert.ok(text.includes('Elias handed the access fob to Mira beside the cobalt ledger.'));
  assert.ok(text.includes('What does the cobalt ledger unlock?'));
  assert.ok(report.sources.some(s => s.kind === 'memory' && !s.included && s.reason.includes('Covered by')));
  assert.equal(report.memoryCoverage.representedPassages,10); assert.equal(report.memoryCoverage.missingPassageIds.length,0);
  assert.ok(!text.includes('UNWRITTEN FUTURE')); assert.ok(!text.includes('HIDDEN REVEAL'));
});

test('latest replacement expires only its chapter and dependent overview, and excludes discarded endings and receipts', async () => {
  const { story } = await compact(longStory(5,1));
  // Complete the final chapter and summarize it, then replace its ending.
  story.passages.at(-1)!.endOfChapter = true;
  story.context.compaction = (await compactMemory(story,settings,signal(),undefined,provider())).compaction;
  const last = story.passages.at(-1)!;
  const replaced = preparePassageCommit(story,{ mode:'replace',passageId:last.id,direction:'Different ending',draft:{title:'Different ending',startsChapter:false,endOfChapter:false,viewpointId:'elias',paragraphs:['The crew turned away from the station and kept their cargo.']},effects:[] }).story;
  assert.equal(compactionPlan(replaced).chapters.find(c => c.chapter === 5)!.status,'open');
  assert.equal(chapterMemoryCurrent(replaced,replaced.context.compaction.chapters.find(m => m.chapter === 5)!),false);
  assert.ok(chapterMemoryCurrent(replaced,replaced.context.compaction.chapters[0]));
  assert.equal(bookMemoryCurrent(replaced),true); // Its older prefix did not change.
  const text = JSON.stringify(buildStoryContext(replaced,'',16384,1800).messages);
  assert.ok(!text.includes('Stop 5.2')); assert.ok(text.includes('The crew turned away'));
  const oldChapter = replaced.passages.find(p => p.chapter === 1)!; oldChapter.paragraphs = ['A corrected earlier historical passage.'];
  assert.equal(bookMemoryCurrent(replaced),false);
});

test('manual fact corrections invalidate every derived summary; rebuild changes no canon and receipt replay is idempotent', async () => {
  const r = new StoryRepository(':memory:');
  try {
    const { story } = await compact(longStory(5,1));
    const archive = zipSync({ 'manifest.json':strToU8(JSON.stringify({format:'guided-story-dev-1',media:[]})), 'story.json':strToU8(JSON.stringify(story)) });
    let saved = await r.import(archive);
    const recapOnly = r.mutate(saved.id,{expectedRevision:saved.revision,requestId:randomUUID(),action:{type:'recap',text:'An editorial recap.',confirmCurrent:true}});
    assert.ok(bookMemoryCurrent(recapOnly));
    saved = r.mutate(saved.id,{expectedRevision:recapOnly.revision,requestId:randomUUID(),action:{type:'world',funds:1234,cargoNotes:'Corrected cargo notes.'}});
    assert.equal(saved.context.compaction.epoch,1); assert.equal(bookMemoryCurrent(saved),false);
    assert.ok(saved.context.compaction.chapters.every(m => !chapterMemoryCurrent(saved,m)));
    const baseline = JSON.stringify({canon:saved.canon,passages:saved.passages,recovery:saved.recovery});
    const rebuilt = await compactMemory(saved,settings,signal(),undefined,provider()), requestId = randomUUID();
    saved = r.commitCompaction(saved.id,saved.revision,requestId,rebuilt.compaction);
    assert.ok(bookMemoryCurrent(saved)); assert.equal(JSON.stringify({canon:saved.canon,passages:saved.passages,recovery:saved.recovery}),baseline);
    assert.deepEqual(r.commitCompaction(saved.id,0,requestId,rebuilt.compaction),saved);
    const roundtrip = await r.import(r.export(saved.id)); assert.deepEqual(roundtrip.context.compaction,saved.context.compaction);
  } finally { r.close(); }
});

test('ordinary context saves cannot forge compaction freshness or overwrite its server-owned correction epoch', async () => {
  const r = new StoryRepository(':memory:');
  try {
    let story = r.create(); const context = structuredClone(story.context);
    context.compaction.epoch = 999; context.sceneBrief.tension = 'Different tension.';
    story = r.mutate(story.id,{expectedRevision:0,requestId:randomUUID(),action:{type:'context',context}});
    assert.equal(story.context.compaction.epoch,0);
  } finally { r.close(); }
});

test('intervening edits reject a compaction commit; unknown entity IDs and provider failures preserve existing memories', async () => {
  const r = new StoryRepository(':memory:');
  try {
    let saved = r.create(), result = await compactMemory(saved,settings,signal(),undefined,provider());
    saved = r.mutate(saved.id,{expectedRevision:0,requestId:randomUUID(),action:{type:'world',funds:1,cargoNotes:'Changed while summarizing.'}});
    assert.throws(() => r.commitCompaction(saved.id,0,randomUUID(),result.compaction),/story changed/);
    const before = JSON.stringify(saved);
    await assert.rejects(compactMemory(saved,settings,signal(),undefined,provider([], {characterIds:['invented']})),/unknown entity/);
    await assert.rejects(compactMemory(saved,settings,signal(),undefined,async () => new Response('unavailable',{status:503})),/HTTP 503/);
    const controller = new AbortController(); controller.abort(); await assert.rejects(compactMemory(saved,settings,controller.signal,undefined,provider()));
    assert.equal(JSON.stringify(r.read(saved.id)),before);
  } finally { r.close(); }
});

test('maintenance reports a partial backlog and context reports history omitted by a constrained budget', async () => {
  const story = longStory(8,30), result = await compactMemory(story,settings,signal(),contextSettingsSchema.parse({recentChapters:1}),provider(),()=>{},1);
  assert.equal(result.compaction.chapters.length,1); assert.ok(result.pending > 0); assert.equal(result.compaction.book,null);
  const report = buildStoryContext(story,'',5500,1800); assert.ok(report.memoryCoverage.missingPassageIds.length > 0); assert.ok(report.warnings.some(w => w.includes('coverage')));
});

test('oversized chapters use bounded intermediate summaries without dropping source text', async () => {
  const story = longStory(2,220), inputs: string[] = [];
  story.passages[1].paragraphs.push('END OF LONG CHAPTER: the cobalt ledger remained unread.');
  const result = await compactMemory(story,settings,signal(),undefined,provider(inputs));
  assert.ok(result.calls > 2); assert.equal(result.compaction.chapters.length,1);
  assert.ok(inputs.join('\n').includes('END OF LONG CHAPTER: the cobalt ledger remained unread.'));
});

test('editing a chapter source note expires its chapter and book; unrelated brief/style edits do not', async () => {
  const { story } = await compact(longStory(5,1));
  story.context.sceneBrief.tension = 'A new direction.'; story.narrationStyle = 'More spare prose.';
  assert.equal(bookMemoryCurrent(story),true);
  story.context.memories[0].facts.push('The ledger has a second lock.');
  assert.equal(chapterMemoryCurrent(story,story.context.compaction.chapters[0]),false); assert.equal(bookMemoryCurrent(story),false);
  const inputs: string[] = []; const result = await compactMemory(story,settings,signal(),undefined,provider(inputs));
  assert.ok(inputs.join('\n').includes('The ledger has a second lock.')); assert.equal(result.pending,0);
});

test('increasing recent-chapter retention uses chapter summaries rather than an overbroad cached book overview', async () => {
  const { story } = await compact(longStory(5,1));
  const report = buildStoryContext(story,'',16384,1800,contextSettingsSchema.parse({recentChapters:6}));
  assert.equal(report.memoryCoverage.bookOverview,false); assert.equal(report.memoryCoverage.chapterSummaries,4);
  assert.ok(report.sources.find(s => s.kind === 'book-memory')!.reason.includes('setting'));
});

test('precise event retrieval resolves passage-local creation aliases to current canonical entity IDs', () => {
  const story = longStory(3,1), passage = story.passages[0];
  const evidence = 'The access fob acquired a long scratch across its face.'; passage.paragraphs.push(evidence);
  passage.generation = {sourceRevision:0,assignedIds:{'new-fob':'fob'},effects:[{type:'item.update',itemId:'new-fob',description:'A long scratch across its face.',evidence}]};
  const report = buildStoryContext(story,'',16384,1800);
  assert.ok(report.sources.some(s => s.id === `events:${passage.id}` && s.included));
  assert.ok(JSON.stringify(report.messages).includes('new-fob')); assert.ok(JSON.stringify(report.messages).includes('assignedIds'));
});
