// Inspect real request construction with mocked completions. No network/model/library access.
// Run: node --import tsx exports/scoping-stress-test/request-audit.ts
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
const root='exports/scoping-stress-test/',testRoot=resolve('test-results');mkdirSync(testRoot,{recursive:true});
const after=process.argv.includes('--after');
if(!after)throw new Error('The historical baseline is preserved. Run with --after to evaluate current fixes.');
const scratch=mkdtempSync(join(testRoot,'scoping-request-audit-'));
process.env.STORY_DATA_DIR=scratch;
const {generatePassage}=await import('../../src/lib/server/story-generation');
const {connectionSchema}=await import('../../src/lib/server/connections');
const {estimateInputTokens}=await import('../../src/lib/server/token-budget');
const {getDiagnostics}=await import('../../src/lib/server/diagnostics');
const story=JSON.parse(readFileSync(root+'story.json','utf8'));
const settings=connectionSchema.parse(JSON.parse(readFileSync('config/connections.example.json','utf8')));
settings.text.model='synthetic-request-audit';
const paragraphs=Array.from({length:25},()=> 'Iris studied the chart while Tamsin checked a pencil mark. Ren waited beside the table. The letter remained sealed, and nobody changed places or possessions.');
const attempts:unknown[]=[];
try{
 for(const contextTokens of [32000,262144]){
  const requests:any[]=[];
  const fetcher:typeof fetch=async(_url,init)=>{
   const body=JSON.parse(String(init!.body)),extract=body.messages[0].content.startsWith('Return {effects:');
   if(body.messages[0].content.startsWith('Review inventory consistency.')){
    requests.push({stage:'inventory-review',estimatedInputTokens:estimateInputTokens(body.messages,body.response_format?.json_schema?.schema),outputAllowance:body.max_tokens});
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({consistent:true,issues:[]})},finish_reason:'stop'}]}),{headers:{'Content-Type':'application/json'}});
   }
   const user=JSON.parse(body.messages[1].content.startsWith('{')?body.messages[1].content:'{}');
   requests.push({stage:extract?'effects':'narration',estimatedInputTokens:estimateInputTokens(body.messages,body.response_format?.json_schema?.schema),outputAllowance:body.max_tokens,...(extract?{characters:user.before.characters.length,items:user.before.items.length,places:user.before.places.length,directoryCharacters:user.directory.characters.length,directoryItems:user.directory.items.length}:{})});
   const content=extract?{effects:[],memory:{summary:'The crew continued examining the chart; no possessions changed hands.',facts:[],openQuestions:[],characterIds:['iris','tamsin','ren'],locationIds:['chartroom']}}:{title:'Request audit only',chapterTitle:story.passages[0].chapterTitle,viewpointId:'iris',endOfChapter:false,paragraphs};
   return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(content)},finish_reason:'stop'}]}),{headers:{'Content-Type':'application/json'}});
  };
  let error:string|undefined;
  try{await generatePassage({story,mode:'continue',direction:'Continue examining the chart without changing possessions.'},{...settings,text:{...settings.text,contextTokens}},new AbortController().signal,()=>{},fetcher);}catch(e){error=e instanceof Error?e.message:String(e);}
  attempts.push({contextTokens,requests,...(error?{error}:{} )});
 }
 const large=(attempts[1] as any).requests.find((r:any)=>r.stage==='effects');
 assert.equal(large.directoryCharacters,24);assert.equal(large.directoryItems,170);assert.ok(large.characters<24);assert.ok(large.items<170);
 assert.equal((attempts[0] as any).error,undefined);
 const result={realModelCalls:0,networkCalls:0,userLibraryChanged:false,attempts,limitations:'Mock prose is repetitive filler solely for request construction. The 262144-token setting is a diagnostic probe, not a recommended configuration. Counts are app estimates, not provider token usage or quality results.'};
 writeFileSync(root+(process.argv.includes('--phase-four')?'request-phase-four-continuation.json':process.argv.includes('--phase-three')?'request-phase-three-continuation.json':process.argv.includes('--phase-two')?'request-phase-two.json':'request-after.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}finally{getDiagnostics().close();assert.ok(scratch.startsWith(testRoot+'\\scoping-request-audit-'));rmSync(scratch,{recursive:true,force:true});}
