// Run with node --import tsx scripts/memory-smoke.mjs. All saves/configuration are temporary.
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,basename} from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {zipSync,strToU8} from 'fflate';
import {longStory} from '../tests/memory-fixture.ts';
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/n_tin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const folder=mkdtempSync(join(tmpdir(),'storyweaver-memory-')),config=join(folder,'config'),data=join(folder,'data');mkdirSync(config);mkdirSync(data);
let child,browser,base,output='',memoryCalls=0,failMemory=false,holdMemory=false,held=false,lastGeneration;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const provider=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  const body=JSON.parse(raw),system=body.messages[0].content;
  const complete=content=>res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({choices:[{message:{content:JSON.stringify(content)},finish_reason:'stop'}]}));
  if(system.startsWith('Compress written fictional history')){
    memoryCalls++;if(failMemory){res.writeHead(503).end('Unavailable');return;}if(holdMemory){held=true;return;}
    assert.ok(!raw.includes('UNWRITTEN FUTURE'));assert.ok(!raw.includes('HIDDEN REVEAL'));assert.ok(!raw.includes('SECRET KNOWLEDGE'));
    return complete({summary:'The crew followed its route and examined the ledger.',facts:['The crew inspected the route.'],openQuestions:['What does the ledger unlock?'],characterIds:['elias','mira'],locationIds:['bridge']});
  }
  if(system.startsWith('Return {effects:'))return complete({effects:[],memory:{summary:'The crew made a new course choice.',facts:['The crew continued.'],openQuestions:[],characterIds:['elias'],locationIds:['bridge']}});
  return complete({title:'The next course',chapterTitle:'The next course',viewpointId:'elias',endOfChapter:true,paragraphs:[('Elias checked the navigation panel while Mira compared their course with the chart. ').repeat(10)]});
});
const listen=s=>new Promise(r=>s.listen(0,'127.0.0.1',r));
async function json(path,init){const r=await fetch(base+path,init),body=await r.json();assert.equal(r.ok,true,JSON.stringify(body));return body;}
const post=(path,value)=>json(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
async function stop(){if(!child)return;const c=child;child=undefined;if(c.exitCode!==null)return;const done=new Promise(r=>c.once('exit',r));c.kill('SIGKILL');await done;}
async function start(port){output='';child=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(port),'--strictPort'],{windowsHide:true,env:{...process.env,STORY_INSTANCE:'memory-test',STORY_DATA_DIR:data,STORY_CONFIG_DIR:config,STORY_VITE_CACHE:join(folder,'cache')},stdio:['ignore','pipe','pipe']});for(const s of[child.stdout,child.stderr])s.on('data',c=>output=(output+c).slice(-16000));for(let i=0;i<120;i++){if(child.exitCode!==null)throw new Error(output);try{if((await fetch(base+'/api/setups')).ok)return;}catch{}await pause(200);}throw new Error(output);}
try{
  await listen(provider);const probe=createServer();await listen(probe);const port=probe.address().port;await new Promise(r=>probe.close(r));base=`http://127.0.0.1:${port}`;
  const c=JSON.parse(readFileSync('config/connections.example.json','utf8'));c.text={...c.text,baseUrl:`http://127.0.0.1:${provider.address().port}/v1`,model:'memory-qa',maxTokens:4096,contextTokens:16384,structuredOutput:'prompt'};writeFileSync(join(config,'connections.dev.local.json'),JSON.stringify(c));
  await start(port);
  const fixture=longStory(5,4);fixture.preferences.passageWords=100;fixture.origin='generated';
  const archive=zipSync({'manifest.json':strToU8(JSON.stringify({format:'guided-story-dev-1',media:[]})),'story.json':strToU8(JSON.stringify(fixture))});
  let story=await json('/api/import',{method:'POST',body:archive});const baseline=JSON.stringify({canon:story.canon,passages:story.passages,recovery:story.recovery});
  browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(20000);
  await page.goto(base);await page.waitForLoadState('networkidle');await page.getByRole('button',{name:'Dev',exact:true}).click();await page.getByRole('button',{name:'Memory',exact:true}).click();
  const panel=page.getByRole('region',{name:'Chapter and book memory'});await panel.getByRole('button',{name:'Rebuild pending memories'}).waitFor();
  const response=page.waitForResponse(r=>r.url().endsWith('/compaction')&&r.request().method()==='POST');await panel.getByRole('button',{name:'Rebuild pending memories'}).click();const request=await response;assert.equal(request.ok(),true,await request.text());await panel.getByText('0 pending update(s)',{exact:false}).waitFor();
  story=await json('/api/stories/'+story.id);assert.equal(story.context.compaction.chapters.length,4);assert.deepEqual(story.context.compaction.book.chapterNumbers,[1,2]);assert.equal(JSON.stringify({canon:story.canon,passages:story.passages,recovery:story.recovery}),baseline);
  const count=memoryCalls;await post(`/api/stories/${story.id}/compaction`,request.request().postDataJSON());assert.equal(memoryCalls,count);
  await page.getByRole('button',{name:'Context',exact:true}).click();await page.getByRole('button',{name:'Build context preview',exact:true}).click();await page.getByText('History coverage: 10 / 10 passages represented',{exact:false}).waitFor();
  console.log('PASS: Dev rebuild, source coverage, context display, no canon mutation and receipt replay.');
  await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('tablist',{name:'Settings sections'}).getByRole('tab',{name:'Context',exact:true}).click();
  const automatic=page.getByLabel('Automatically maintain chapter and book memories after saved passages');await automatic.uncheck();await page.getByRole('button',{name:'Save context settings'}).click();await page.getByText('Context settings saved locally.',{exact:false}).waitFor();assert.equal((await json('/api/connections')).context.autoCompact,false);await automatic.check();await page.getByRole('button',{name:'Save context settings'}).click();await page.getByText('Context settings saved locally.',{exact:false}).waitFor();
  await page.setViewportSize({width:320,height:884});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.getByRole('button',{name:'Dev',exact:true}).click();await page.getByRole('button',{name:'Memory',exact:true}).click();await page.getByRole('heading',{name:'Chapter & book memory'}).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/memory-mobile.png',fullPage:false});await page.setViewportSize({width:1280,height:1000});
  const generate=()=>{lastGeneration={expectedRevision:story.revision,requestId:randomUUID(),mode:'continue',direction:'Follow the route.',chapterEnding:'close'};return post(`/api/stories/${story.id}/generate`,lastGeneration);};
  story=await generate();assert.equal(story.context.compaction.chapters.length,5);assert.deepEqual(story.context.compaction.book.chapterNumbers,[1,2,3]);
  failMemory=true;const previous=story.passages.length;story=await generate();assert.equal(story.passages.length,previous+1);assert.equal((await json(`/api/stories/${story.id}/compaction`)).chapters.find(c=>c.chapter===6).status,'missing');assert.ok((await json('/api/dev/jobs')).jobs.some(j=>j.kind==='memory-compaction'&&j.state==='failed'));const failedCalls=memoryCalls;await post(`/api/stories/${story.id}/generate`,lastGeneration);assert.equal(memoryCalls,failedCalls,'Passage replay must not resubmit failed maintenance');failMemory=false;
  story=await post(`/api/stories/${story.id}/compaction`,{expectedRevision:story.revision,requestId:randomUUID()});
  console.log('PASS: automatic maintenance, book-prefix growth, provider failure preserves the committed passage, explicit retry.');
  const revision=story.revision;
  story=await json('/api/stories/'+story.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:revision,requestId:randomUUID(),action:{type:'world',funds:777,cargoNotes:'User correction.'}})});
  const rejected=await fetch(base+`/api/stories/${story.id}/compaction`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:revision,requestId:randomUUID()})});assert.equal(rejected.status,409);
  await page.reload();await page.waitForLoadState('networkidle');await page.getByRole('button',{name:'Dev',exact:true}).click();await page.getByRole('button',{name:'Memory',exact:true}).click();holdMemory=true;held=false;await panel.getByRole('button',{name:'Rebuild pending memories'}).click();for(let i=0;i<60&&!held;i++)await pause(50);assert.equal(held,true);await panel.getByRole('button',{name:'Cancel memory maintenance'}).click();await panel.getByRole('alert').filter({hasText:/cancelled/}).waitFor();holdMemory=false;
  assert.equal((await json('/api/stories/'+story.id)).revision,story.revision);assert.ok((await json('/api/dev/jobs')).jobs.some(j=>j.kind==='memory-compaction'&&j.state==='cancelled'));
  while((await json(`/api/stories/${story.id}/compaction`)).pending)story=await post(`/api/stories/${story.id}/compaction`,{expectedRevision:story.revision,requestId:randomUUID()});
  held=false;holdMemory=true;const pending=generate();for(let i=0;i<80&&!held;i++)await pause(50);assert.equal(held,true);const cancelled=await post('/api/generation/cancel',{storyId:story.id,requestId:lastGeneration.requestId});assert.equal(cancelled.passageAlreadySaved,true);story=await pending;holdMemory=false;assert.equal(story.passages.at(-1).endOfChapter,true);while((await json(`/api/stories/${story.id}/compaction`)).pending)story=await post(`/api/stories/${story.id}/compaction`,{expectedRevision:story.revision,requestId:randomUUID()});
  await stop();await start(port);const reopened=await json('/api/stories/'+story.id);assert.deepEqual(reopened.context.compaction,story.context.compaction);assert.equal((await json(`/api/stories/${story.id}/compaction`)).pending,0);
  const exported=await fetch(base+`/api/stories/${story.id}/export`), imported=await json('/api/import',{method:'POST',body:await exported.arrayBuffer()});assert.deepEqual(imported.context.compaction,story.context.compaction);
  assert.deepEqual(errors,[]);console.log('PASS: correction invalidation, stale revision rejection, cancellation, backlog rebuild, restart, archive and 320px views.');
}catch(e){console.error(output);throw e;}
finally{await browser?.close();await stop();provider.closeAllConnections();await new Promise(r=>provider.close(r));const target=resolve(folder);if(target.startsWith(resolve(tmpdir())+'\\')&&basename(target).startsWith('storyweaver-memory-'))rmSync(target,{recursive:true,force:true});}
