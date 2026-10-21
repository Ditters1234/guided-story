// Optional real-model length check, with isolated saves and the previously validated setup.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const folder = mkdtempSync(join(tmpdir(), 'storyweaver-length-'));
process.env.STORY_DATA_DIR = folder;
let repository, diagnostics;
try {
  const { StoryRepository } = await import('../src/lib/server/repository.ts');
  const { connectionSchema } = await import('../src/lib/server/connections.ts');
  const { generatePassage } = await import('../src/lib/server/story-generation.ts');
  const { narrationSchema } = await import('../src/lib/server/story-generation.ts');
  const { parseModelObject } = await import('../src/lib/server/model-output.ts');
  const { countWords } = await import('../src/lib/story-length.ts');
  const { getDiagnostics } = await import('../src/lib/server/diagnostics.ts');
  diagnostics = getDiagnostics();
  const c = connectionSchema.parse(JSON.parse(readFileSync('config/connections.play.local.json', 'utf8')));
  const checkpoint = JSON.parse(readFileSync('test-results/new-story-live-setup.json', 'utf8'));
  repository = new StoryRepository(join(folder, 'library.sqlite'));
  let setup = repository.createSetup({ ...checkpoint.input, preferences: { ...checkpoint.input.preferences, passageWords: 800, chapterWords: 3000 } }, randomUUID());
  setup = repository.commitGeneratedSetup(setup.id, setup.revision, randomUUID(), 'length-setup', checkpoint.plan);
  const resumeProse = process.argv.includes('--resume-prose');
  let fetcher;
  if (resumeProse) {
    const failure = JSON.parse(readFileSync('test-results/chapter-length-live-failure.json', 'utf8'));
    const trace = failure.traces.find(t => t.kind === 'story-opening' && t.status === 'complete');
    const narration = parseModelObject(trace.response.content, narrationSchema, 'validated real opening');
    assert.ok(countWords(narration.paragraphs) >= 480);
    fetcher = async (url, init) => {
      const body = JSON.parse(String(init.body));
      if (body.messages[0].content.startsWith('Return {effects:')) return fetch(url, init);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(narration) }, finish_reason: 'stop' }] }));
    };
  }
  console.log(resumeProse ? 'Reusing the validated real 800-word opening; checking live extraction and commit with the saved context limit.' : 'Writing a fresh 800-word opening using the saved local text connection and validated setup. Normal libraries are untouched.');
  const proposal = await generatePassage({ setup }, c, new AbortController().signal, draft => {
    if (draft.stage === 'length-check' || draft.stage === 'expanding-short-passage') console.log(JSON.stringify({ stage: draft.stage, words: draft.words, targetWords: draft.targetWords }));
    if (draft.stage === 'narration') console.log('Prose length checked; extracting effects and continuity memory.');
  }, fetcher);
  const story = repository.commitOpening(setup.id, setup.revision, randomUUID(), 'length-opening', proposal);
  const words = countWords(story.passages[0].paragraphs);
  assert.ok(words >= 480); assert.equal(story.passages[0].endOfChapter, false); assert.equal(story.context.memories.length, 1);
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/chapter-length-live.json', JSON.stringify({ words, story }, null, 2));
  writeFileSync('test-results/chapter-length-live.md', [`# ${story.title}`, '', `Chapter 1: ${story.passages[0].chapterTitle}`, '', `## ${story.passages[0].title}`, '', `Development preview: ${words} words toward a 3,000-word chapter.`, '', ...story.passages[0].paragraphs.flatMap(p=>[p,''])].join('\n'));
  console.log(`PASS: real opening ${words} words in ${story.passages[0].paragraphs.length} paragraphs; chapter remains open; prose/effects/memory committed atomically.`);
} catch (e) {
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/chapter-length-live-failure.json', JSON.stringify({ error: e.message, traces: diagnostics?.traces() }, null, 2));
  throw e;
} finally {
  repository?.close(); diagnostics?.close();
  const target = resolve(folder);
  if ((target.startsWith(resolve(tmpdir()) + '\\') || target.startsWith(resolve(tmpdir()) + '/')) && basename(target).startsWith('storyweaver-length-')) rmSync(target, { recursive: true, force: true });
}
