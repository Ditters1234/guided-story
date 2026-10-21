import { estimateInputTokens } from '../src/lib/server/token-budget';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {createSample} from '../src/lib/server/fixture';
import {novelMarkdown} from '../src/lib/server/novel-export';
import {generateContinuityMemory} from '../src/lib/server/continuity';
import {buildIsCurrent,releaseSignature,stampBuild} from '../scripts/release-runtime.mjs';
import {compactMemory} from '../src/lib/server/memory-compaction';
import {generateRecap} from '../src/lib/server/recap';
import {buildStoryContext} from '../src/lib/server/context-builder';
import {continuityQuestion} from '../src/lib/narrative-quality';
import {longStory} from './memory-fixture';
import {generateEditorResult} from '../src/lib/server/story-editor';
import {answerSources} from '../src/lib/server/answer-sources';
import {connectionSchema} from '../src/lib/server/connections';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';

test('novel export contains accepted chapter prose but excludes hidden notes, canon and editor diagnostics',()=>{
  const story=createSample();story.title='A # book';story.context.lore.push({id:'hidden',title:'Hidden',text:'DO_NOT_EXPORT_SECRET',keywords:[],relatedIds:[],visibility:'hidden'});story.canon.cargoNotes='PRIVATE_CANON_ONLY';
  const before=JSON.stringify(story),text=novelMarkdown(story);assert.ok(text.startsWith('# A \\# book'));assert.equal((text.match(/^## Chapter /gm)||[]).length,1);assert.ok(text.includes(story.passages[0].paragraphs[0]));assert.ok(!text.includes('DO_NOT_EXPORT_SECRET'));assert.ok(!text.includes('PRIVATE_CANON_ONLY'));assert.equal(JSON.stringify(story),before);
});

test('continuity extraction counts the full contract, escaping and schema before a provider request',async()=>{
  const story=createSample();let calls=0;
  await assert.rejects(generateContinuityMemory(story,story.passages[0].id,{baseUrl:'http://localhost:9999/v1',model:'qa',maxTokens:1800,contextTokens:3000,structuredOutput:'schema'},new AbortController().signal,async()=>{calls++;throw new Error('should not call');}),/budget/);assert.equal(calls,0);
});

test('production build freshness follows runtime source content and excludes private data/settings changes',()=>{
  const folder=mkdtempSync(join(tmpdir(),'story-release-signature-'));
  try{
    const files={'package.json':'{"version":"1.0.0"}','package-lock.json':'{}','vite.config.ts':'export default {};','tsconfig.json':'{}','scripts/build.mjs':'build','scripts/start.mjs':'start','scripts/release-runtime.mjs':'release','src/main.ts':'hello','static/icon.svg':'icon','build/index.js':'server'};
    for(const [file,text]of Object.entries(files)){mkdirSync(dirname(join(folder,file)),{recursive:true});writeFileSync(join(folder,file),text);}
    assert.equal(buildIsCurrent(folder),false);stampBuild(folder);assert.equal(buildIsCurrent(folder),true);const signature=releaseSignature(folder);
    mkdirSync(join(folder,'config'));writeFileSync(join(folder,'config/connections.play.local.json'),'private key');assert.equal(releaseSignature(folder),signature);
    writeFileSync(join(folder,'src/main.ts'),'changed');assert.equal(buildIsCurrent(folder),false);stampBuild(folder);assert.equal(buildIsCurrent(folder),true);
    writeFileSync(join(folder,'static/another.svg'),'new asset');assert.equal(buildIsCurrent(folder),false);stampBuild(folder);
    writeFileSync(join(folder,'tsconfig.json'),'{"compilerOptions":{"strict":true}}');assert.equal(buildIsCurrent(folder),false);
  }finally{const target=resolve(folder);assert.ok(target.startsWith(resolve(tmpdir())+'\\'));rmSync(target,{recursive:true,force:true});}
});

test('quoted Unicode history fits full wire budgets during chapter compression and reader recap chunking',async()=>{
  const s=createSample(),settings={baseUrl:'http://localhost:9999/v1',model:'qa',temperature:0.1,maxTokens:1024,contextTokens:10000,structuredOutput:'schema' as const};
  s.passages=s.passages.slice(0,1);s.passages[0].endOfChapter=true;s.passages[0].paragraphs=['Mira said, "Only a suspicion \\ not proof." 🔎 '.repeat(600)];s.recovery=null;s.context.memories=[];
  let calls=0;
  const provider:typeof fetch=async(_,init)=>{
    const body=JSON.parse(String(init!.body)),schema=body.response_format?.json_schema?.schema;
    assert.ok(estimateInputTokens(body.messages,schema)+body.max_tokens+1024<=settings.contextTokens);
    calls++;const content=body.messages[0].content.startsWith('Compress written')?JSON.stringify({summary:'Mira described a suspicion without proof.',facts:['Mira voiced a suspicion.'],openQuestions:[],characterIds:['mira'],locationIds:['bridge']}):'Mira voiced a suspicion; the explanation remains unproven.';
    return new Response(JSON.stringify({choices:[{message:{content},finish_reason:'stop'}]}));
  };
  const compacted=await compactMemory(s,settings,new AbortController().signal,undefined,provider);assert.equal(compacted.compaction.chapters.length,1);
  const recap=await generateRecap(s,settings,new AbortController().signal,provider);assert.ok(recap.recap.text.includes('unproven'));assert.ok(calls>2);
});

test('explicitly quoted passage titles keep intended comparison sources ahead of generic review terms',()=>{
  const story=longStory(4,8),focus=story.passages[3],question=continuityQuestion(story,focus.id);
  const report=buildStoryContext(story,question,16384,1536,undefined,undefined,{purpose:'ask',focusPassageId:focus.id});
  for(const p of story.passages.slice(1,4))assert.ok(report.answerSourceIds.includes(p.id),p.title+' should be supplied for the requested comparison.');
});

test('indexed answers bind exact supplied excerpts and reject invented or mixed citations without changing the story',async()=>{
  const story=createSample(),before=JSON.stringify(story),c=connectionSchema.parse(JSON.parse(readFileSync('config/connections.example.json','utf8')));c.text.model='qa';
  const input={kind:'ask' as const,expectedRevision:story.revision,requestId:randomUUID(),passageId:story.passages[0].id,text:'What happened in the first passage?'},source=answerSources(story,story.passages[0])[0];
  const provider=(value:unknown):typeof fetch=>async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(value)},finish_reason:'stop'}]}));
  const result=await generateEditorResult(story,input,c,new AbortController().signal,()=>{},provider({answer:'The crew arrived ('+source.id+').',uncertain:false,citationIds:[source.id]}));
  assert.equal(result.kind,'ask');assert.ok(!result.answer.includes('quote-'));assert.ok(result.answer.includes('source 1'));if(result.kind==='ask')assert.deepEqual(result.sources,[{passageId:source.passageId,quote:source.quote}]);
  for(const value of [{answer:'A guess.',uncertain:true,citationIds:['quote-999-0']},{answer:'Mixed.',uncertain:true,citationIds:[source.id],sources:[]}])await assert.rejects(generateEditorResult(story,input,c,new AbortController().signal,()=>{},provider(value)),/citation|invalid/);
  assert.equal(JSON.stringify(story),before);
});
