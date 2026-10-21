// node --import tsx scripts/memory-live-smoke.mjs — saved local provider, isolated fictional data.
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,basename} from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {zipSync,strToU8} from 'fflate';
import {longStory} from '../tests/memory-fixture.ts';
const folder=mkdtempSync(join(tmpdir(),'storyweaver-memory-live-'));
process.env.STORY_DATA_DIR=folder;process.env.STORY_INSTANCE='play';
let repository,jobs,diagnostics;
try{
  const {getRepository}=await import('../src/lib/server/repository.ts');
  const {getJobs}=await import('../src/lib/server/jobs.ts');
  const {getDiagnostics}=await import('../src/lib/server/diagnostics.ts');
  const {readPrivateConnections}=await import('../src/lib/server/connections.ts');
  const {runCompaction}=await import('../src/lib/server/memory-compaction.ts');
  const {bookMemoryCurrent,compactionPlan}=await import('../src/lib/server/context-state.ts');
  const {buildStoryContext}=await import('../src/lib/server/context-builder.ts');
  repository=getRepository();jobs=getJobs();diagnostics=getDiagnostics();const c=readPrivateConnections();
  const fixture=longStory(5,4),archive=zipSync({'manifest.json':strToU8(JSON.stringify({format:'guided-story-dev-1',media:[]})),'story.json':strToU8(JSON.stringify(fixture))});
  let story=await repository.import(archive),before=JSON.stringify({canon:story.canon,passages:story.passages,recovery:story.recovery});
  console.log('Building four chapter memories and an earlier-book overview with the saved local text connection.');
  story=await runCompaction(story,randomUUID(),AbortSignal.timeout(600000));
  assert.equal(compactionPlan(story,c.context.recentChapters).pending,0);assert.ok(bookMemoryCurrent(story));
  assert.equal(JSON.stringify({canon:story.canon,passages:story.passages,recovery:story.recovery}),before);
  const report=buildStoryContext(story,'Follow the cobalt ledger clue and account for the access fob.',c.text.contextTokens,c.text.maxTokens,c.context,c.prompts);
  assert.ok(report.runnable);assert.ok(report.inputTokens<=report.inputBudget);assert.ok(report.memoryCoverage.bookOverview);
  assert.ok(report.messages.some(m=>m.content.includes('Elias handed the access fob to Mira beside the cobalt ledger.')));
  for(const hidden of ['UNWRITTEN FUTURE','HIDDEN REVEAL','SECRET KNOWLEDGE'])assert.ok(!JSON.stringify(report.messages).includes(hidden));
  const copy=await repository.import(repository.export(story.id));assert.deepEqual(copy.context.compaction,story.context.compaction);
  mkdirSync('test-results',{recursive:true});writeFileSync('test-results/memory-live.json',JSON.stringify({compaction:story.context.compaction,coverage:report.memoryCoverage,inputBytes:report.inputBytes,inputTokens:report.inputTokens,inputBudget:report.inputBudget,jobs:jobs.list()},null,2));
  console.log('PASS: real chapter/book summaries, old source-quoted event recall, bounded context, unchanged canon/prose and archive round trip. Normal play saves are untouched.');
}catch(e){mkdirSync('test-results',{recursive:true});writeFileSync('test-results/memory-live-failure.json',JSON.stringify({error:e.message,traces:diagnostics?.traces()},null,2));throw e;}
finally{repository?.close();jobs?.close();diagnostics?.close();const target=resolve(folder);if(target.startsWith(resolve(tmpdir())+'\\')&&basename(target).startsWith('storyweaver-memory-live-'))rmSync(target,{recursive:true,force:true});}
