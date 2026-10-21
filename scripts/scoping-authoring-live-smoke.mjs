// Two short real-provider correction probes; synthetic Brasswater data, isolated diagnostics.
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,join,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const root=resolve('test-results');mkdirSync(root,{recursive:true});
const scratch=mkdtempSync(join(root,'scoping-authoring-live-'));process.env.STORY_DATA_DIR=scratch;
const {generateCorrectionResult}=await import('../src/lib/server/story-corrections.ts');
const {getDiagnostics}=await import('../src/lib/server/diagnostics.ts');
const c=JSON.parse(readFileSync('config/connections.play.local.json','utf8'));
c.text.timeoutSeconds=60;c.text.maxTokens=1024;c.text.contextTokens=32000;
const story=JSON.parse(readFileSync('exports/scoping-stress-test/story.json','utf8')),original=structuredClone(story),results=[];
try{
 for(const mode of ['name','repair']){
  const input={kind:mode==='name'?'record':'repair',expectedRevision:story.revision,requestId:randomUUID(),passageId:story.passages[0].id,direction:mode==='name'?'Give this notebook a different short, distinctive name.':'Correct only the description of Iris Vale’s notebook (iris-notebook) to exactly: A dark green covered notebook. Preserve its ID, name, owner, quantity and equipment. Do not edit any other record.',...(mode==='name'?{recordKind:'item',mode:'name',targetId:'iris-notebook'}:{})};
  const start=Date.now();let realCalls=0;
  const result=await generateCorrectionResult(story,input,{...c,text:{...c.text,contextTokens:mode==='name'?16384:32000}},new AbortController().signal,()=>{},async(...args)=>{realCalls++;return fetch(...args);});
  assert.equal(realCalls,1);assert.equal(result.operations.length,1);assert.equal(result.changes.length,1);
  assert.equal(result.changes[0].recordId,'iris-notebook');assert.equal(result.changes[0].field,mode==='name'?'name':'description');
  if(mode==='repair')assert.equal(result.changes[0].after,'A dark green covered notebook.');
  assert.deepEqual(story,original);
  const row={task:mode,realCalls,elapsedMs:Date.now()-start,changedField:result.changes[0].field,sourceStoryUnchanged:true};results.push(row);console.log(JSON.stringify(row));
  writeFileSync(join(root,'scoping-phase-three-live.json'),JSON.stringify({model:c.text.model,results,limitations:'Two isolated synthetic correction probes, not sustained story-quality evaluation. No user library or settings changed.'},null,2)+'\n');
 }
 console.log('PASS: saved local model produced a scoped rename and a one-record repair without extra changes.');
}finally{getDiagnostics().close();assert.ok(scratch.startsWith(root+sep+'scoping-authoring-live-'));rmSync(scratch,{recursive:true,force:true});}
