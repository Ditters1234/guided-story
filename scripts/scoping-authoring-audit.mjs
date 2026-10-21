// Mock provider audit of real opening/correction request construction. No network/library access.
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {resolve,join,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const root=resolve('test-results');mkdirSync(root,{recursive:true});
const scratch=mkdtempSync(join(root,'scoping-authoring-'));process.env.STORY_DATA_DIR=scratch;
const {generatePassage}=await import('../src/lib/server/story-generation.ts');
const {generateCorrectionResult}=await import('../src/lib/server/story-corrections.ts');
const {connectionSchema}=await import('../src/lib/server/connections.ts');
const {estimateInputTokens}=await import('../src/lib/server/token-budget.ts');
const {getDiagnostics}=await import('../src/lib/server/diagnostics.ts');
const load=name=>JSON.parse(readFileSync(`exports/scoping-stress-test/${name}.json`,'utf8'));
const c=connectionSchema.parse(JSON.parse(readFileSync('config/connections.example.json','utf8')));c.text.model='mock-authoring-audit';
const setup=load('setup'),story=load('story'),original=structuredClone({setup,story}),results=[];
const respond=value=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(value)},finish_reason:'stop'}]}));
const counts=canon=>canon?Object.fromEntries(['characters','places','items','relationships','threads'].map(kind=>[kind,canon[kind]?.length||0])):undefined;
function capture(body,task){const input=JSON.parse(body.messages[1].content);results.push({task,estimatedInputTokens:estimateInputTokens(body.messages,body.response_format?.json_schema?.schema),outputAllowance:body.max_tokens,fullRecords:counts(input.currentCanon||input.canon||input.before),directory:counts(input.directory),selectedRecord:input.selectedRecord?.id});return input;}
try{
 await generatePassage({setup},c,new AbortController().signal,()=>{},async(_url,init)=>{
  const body=JSON.parse(String(init.body)),extract=body.messages[0].content.startsWith('Return {effects:');capture(body,extract?'opening-extraction':'opening');
  if(extract)return respond({effects:[],memory:{summary:'The crew considers the chart.',facts:[],openQuestions:[],characterIds:['iris','tamsin','ren'],locationIds:['chartroom']}});
  return respond({title:'Audit only',chapterTitle:setup.plan.chapterTitle,viewpointId:'iris',endOfChapter:false,paragraphs:Array.from({length:16},()=> 'Iris studied the chart while Tamsin checked the pencilled boundary. Ren waited beside the table. Rain tapped against the window, and the quiet room offered time for careful thought.')});
 });
 for(const task of ['name','revise','repair']){
  const input={kind:task==='repair'?'repair':'record',expectedRevision:story.revision,requestId:randomUUID(),passageId:story.passages[0].id,direction:task==='repair'?'Correct the description of Iris Vale’s notebook to say its cover is dark green.':'Give this notebook a more precise '+(task==='name'?'name.':'description.'),...(task==='repair'?{}:{recordKind:'item',targetId:'iris-notebook',mode:task})};
  await generateCorrectionResult(story,input,{...c,text:{...c.text,contextTokens:task==='name'?16384:32000}},new AbortController().signal,()=>{},async(_url,init)=>{
   const body=JSON.parse(String(init.body)),data=capture(body,task);
   if(task==='name')return respond({explanation:'Choose a distinctive name.',name:'The rain ledger'});
   const item=data.selectedRecord||data.currentCanon.items.find(i=>i.id==='iris-notebook'),{id,...value}=item;
   return respond(task==='repair'?{explanation:'Correct only the cover description.',world:null,edits:[{kind:'item',value:{...item,description:'A dark green covered notebook.'}}]}:{explanation:'Clarify the description.',value:{...value,description:'A dark green covered notebook.'}});
  });
 }
 assert.deepEqual({setup,story},original);assert.equal(results.length,5);
 const result={realModelCalls:0,networkCalls:0,userLibraryChanged:false,fixture:{characters:24,places:34,items:170},results,limitations:'Mock prose and responses test request construction and validation only. Input token counts are conservative app estimates, not provider tokenizer usage or narrative-quality measurements. Opening and revise/repair use 32000 context tokens; name uses 16384.'};
 writeFileSync('exports/scoping-stress-test/'+(process.argv.includes('--phase-four')?'request-phase-four-authoring.json':'request-phase-three.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}finally{getDiagnostics().close();assert.ok(scratch.startsWith(root+sep+'scoping-authoring-'));rmSync(scratch,{recursive:true,force:true});}
