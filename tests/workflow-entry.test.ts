import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { generatePassageEntry } from '../src/lib/server/passage-entry';
import { maintainMemoryAfterPassage } from '../src/lib/server/memory-compaction';
import { getJobs } from '../src/lib/server/jobs';
import { workflowFixture, workflowSettings, scriptedProvider, generationInput, memory } from './workflow-fixture';

const signal=()=>new AbortController().signal;
for(const scenario of ['disabled','no-pending','success','failure'] as const)test(`integrated passage entry preserves conditional post-commit maintenance: ${scenario}`,async()=>{
  const {repository:r,story}=workflowFixture();
  try {
    const c=workflowSettings();c.context.autoCompact=scenario!=='disabled';
    const input={...generationInput(story.revision),chapterEnding:scenario==='no-pending'?'auto' as const:'close' as const};
    const provider=scriptedProvider();let maintenance=0;
    const fetcher:typeof fetch=async(url,init)=>{
      const body=JSON.parse(String(init?.body));
      if(!body.messages[0].content.startsWith('Compress written fictional history'))return provider.fetcher(url,init);
      maintenance++;
      const run=r.workflows.find(story.id,input.requestId)!;
      assert.equal(run.status,'completed');assert.equal(r.read(story.id).passages.length,2);
      assert.equal(getJobs().find({storyId:story.id,requestId:input.requestId})!.state,'complete');
      if(scenario==='failure')return new Response('Injected maintenance failure',{status:400});
      return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(memory)},finish_reason:'stop'}]}));
    };
    const saved=await generatePassageEntry(r,'continue',story.id,input,c,signal(),{fetcher});
    assert.equal(saved.passages.length,2);assert.deepEqual(provider.stages,['narrate','extract']);
    assert.equal(maintenance,scenario==='success'||scenario==='failure'?1:0);
    assert.equal(saved.context.compaction.chapters.length,scenario==='success'?1:0);
    assert.equal(saved.revision,story.revision+(scenario==='success'?2:1));
    // Completion/failure of maintenance belongs to a separate job and cannot
    // cause the passage or failed maintenance request to run again on replay.
    const replay=await generatePassageEntry(r,'continue',story.id,input,c,signal(),{fetcher:async()=>{throw Error('unexpected replay request');}});
    assert.deepEqual(replay,saved);
    assert.equal(getJobs().find({storyId:story.id,requestId:input.requestId})!.state,'complete');
  } finally {r.close();}
});

test('the integrated entry keeps legacy receipt/job identity when the configured engine changes',async()=>{
  const {repository:r,story}=workflowFixture();
  try {
    const c=workflowSettings(),input=generationInput(story.revision),provider=scriptedProvider();c.context.autoCompact=false;
    const saved=await generatePassageEntry(r,'continue',story.id,input,c,signal(),{fetcher:provider.fetcher,engine:'legacy'});
    assert.equal(r.workflows.find(story.id,input.requestId),null);
    assert.deepEqual(await generatePassageEntry(r,'continue',story.id,input,c,signal(),{fetcher:async()=>{throw Error('unexpected resubmission');},engine:'workflow'}),saved);
    assert.equal(getJobs().find({storyId:story.id,requestId:input.requestId})!.kind,'story-narration');
    const next=await generatePassageEntry(r,'continue',story.id,generationInput(saved.revision),c,signal(),{fetcher:provider.fetcher});
    assert.equal(next.passages.length,3);
  } finally {r.close();}
});

test('a maintenance configuration failure still returns the already committed story',async()=>{
  const {repository:r,story}=workflowFixture();
  try {
    const saved=await maintainMemoryAfterPassage(story,signal(),randomUUID(),{repository:r,get connections():ReturnType<typeof workflowSettings>{throw Error('Injected configuration failure');}});
    assert.deepEqual(saved,story);
  } finally {r.close();}
});
