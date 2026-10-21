// node --import tsx scripts/release-smoke.mjs — actual production launcher, temporary library/config and mock text service.
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,basename} from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import {zipSync,strToU8} from 'fflate';
import sharp from 'sharp';
import assert from 'node:assert/strict';
import {createSample} from '../src/lib/server/fixture.ts';
import {answerSources} from '../src/lib/server/answer-sources.ts';
const require=createRequire(import.meta.url),{chromium}=require('C:/Users/n_tin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const folder=mkdtempSync(join(tmpdir(),'storyweaver-production-')),config=join(folder,'config'),data=join(folder,'data');mkdirSync(config);mkdirSync(data);
let child,browser,page,base,output='',fail=false,hold=false,held=false,story;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const provider=createServer(async(req,res)=>{
  for await(const part of req){}if(fail){res.writeHead(503).end('Unavailable');return;}if(hold){held=true;return;}
  const source=answerSources(story,story.passages[0])[0];
  res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({choices:[{message:{content:JSON.stringify({answer:'No contradiction is established by these supplied excerpts.\n\n**Advisory review** ('+source.id+'). Treat <img src=x> as text.',uncertain:true,citationIds:[source.id]})},finish_reason:'stop'}]}));
});
const listen=s=>new Promise(r=>s.listen(0,'127.0.0.1',r));
const json=async(path,init)=>{const res=await fetch(base+path,{...init,headers:{...(init?.method?{Origin:base}:{}),...init?.headers}}),body=await res.json();assert.equal(res.ok,true,JSON.stringify(body));return body;};
async function stop(){if(!child)return;const current=child;child=undefined;if(current.exitCode!==null)return;const done=new Promise(r=>current.once('exit',r));current.kill('SIGKILL');await done;}
function env(port){return {...process.env,STORY_PORT:String(port),STORY_DATA_DIR:data,STORY_CONFIG_DIR:config};}
async function start(port){output='';child=spawn(process.execPath,['scripts/start.mjs','play','--production'],{cwd:resolve('.'),windowsHide:true,env:env(port),stdio:['ignore','pipe','pipe']});for(const stream of[child.stdout,child.stderr])stream.on('data',c=>output=(output+c).slice(-30000));for(let i=0;i<200;i++){if(child.exitCode!==null)throw new Error(output);try{if((await fetch(base+'/api/app')).ok)return;}catch{}await pause(200);}throw new Error(output);}
try{
  await listen(provider);const probe=createServer();await listen(probe);const port=probe.address().port;await new Promise(r=>probe.close(r));base=`http://127.0.0.1:${port}`;
  const c=JSON.parse(readFileSync('config/connections.example.json','utf8'));c.text={...c.text,model:'',baseUrl:`http://127.0.0.1:${provider.address().port}/v1`,apiKey:'qa-production-only-key',structuredOutput:'json'};writeFileSync(join(config,'connections.play.local.json'),JSON.stringify(c));
  await start(port);assert.deepEqual(await json('/api/app'),{app:'storyweaver',version:'1.0.0',instance:'play',runtime:'production'});
  const count=(await json('/api/stories')).length,rejected=await fetch(base+'/api/stories',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://another-site.invalid'},body:'{}'});assert.equal(rejected.status,403);assert.equal((await json('/api/stories')).length,count);
  const repeated=spawn(process.execPath,['scripts/start.mjs','play','--production'],{windowsHide:true,env:env(port),stdio:['ignore','pipe','pipe']});let repeatedOutput='';repeated.stdout.on('data',c=>repeatedOutput+=c);assert.equal(await new Promise(r=>repeated.once('exit',r)),0);assert.ok(repeatedOutput.includes('already running'));
  browser=await chromium.launch({channel:'msedge',headless:true});page=await browser.newPage({viewport:{width:1280,height:1000}});page.setDefaultTimeout(20000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.getByRole('button',{name:'Set up connections',exact:true}).click();assert.equal(await page.getByRole('tab',{name:'Text LLM',exact:true}).getAttribute('aria-selected'),'true');
  await page.getByRole('tab',{name:'Reading',exact:true}).click();await page.getByRole('button',{name:'Help',exact:true}).click();await page.getByRole('button',{name:'Connection settings',exact:true}).click();assert.equal(await page.getByRole('tab',{name:'Text LLM',exact:true}).getAttribute('aria-selected'),'true');
  await page.getByRole('button',{name:'Help',exact:true}).click();await page.getByRole('heading',{name:'A novel you can guide',exact:true}).waitFor();
  await page.setViewportSize({width:320,height:884});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/release-help-mobile.png',fullPage:true});await page.setViewportSize({width:1280,height:1000});
  c.text.model='production-qa';const publicConfig=await json('/api/connections',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:c.text})});assert.ok(!JSON.stringify(publicConfig).includes(c.text.apiKey));
  const sample=createSample();sample.title='Production acceptance';sample.origin='generated';sample.context.lore.push({id:'hidden-release-note',title:'Private',text:'NOT_IN_PUBLIC_NOVEL',keywords:[],relatedIds:[],visibility:'hidden'});
  story=await json('/api/import',{method:'POST',body:zipSync({'manifest.json':strToU8(JSON.stringify({format:'guided-story-dev-1',media:[]})),'story.json':strToU8(JSON.stringify(sample))})});
  await page.goto(base);await page.getByRole('button',{name:'Review continuity',exact:true}).click();const ask=page.getByRole('region',{name:'Ask about the story'});assert.ok((await ask.getByLabel('Your story question').inputValue()).includes('advisory continuity'));
  const before=JSON.stringify(story);await ask.getByRole('button',{name:'Ask without advancing'}).click();await ask.getByText('No contradiction is established by these supplied excerpts.',{exact:false}).waitFor();assert.equal(JSON.stringify(await json('/api/stories/'+story.id)),before);
  assert.equal(await ask.locator('strong').filter({hasText:'Advisory review'}).count(),1);assert.equal(await ask.locator('img').count(),0);assert.ok(!(await ask.innerText()).includes('quote-'));await ask.getByRole('button',{name:/Read source 1 ·/}).waitFor();
  fail=true;await ask.getByRole('button',{name:'Ask without advancing'}).click();await ask.getByRole('alert').filter({hasText:/HTTP 503/}).waitFor();fail=false;hold=true;held=false;await ask.getByRole('button',{name:'Ask without advancing'}).click();for(let i=0;i<100&&!held;i++)await pause(50);assert.equal(held,true);
  const viewer=page.getByRole('region',{name:'API request viewer',exact:true}),toggle=viewer.getByRole('button',{name:'Toggle API request viewer',exact:true});
  await toggle.click();await viewer.locator('.request-call[data-status=pending]').first().waitFor();assert.ok((await viewer.innerText()).includes('1 running'));await viewer.locator('.request-call[data-status=pending]').first().click();await viewer.getByText('Waiting for the completed response.',{exact:true}).waitFor();assert.ok((await viewer.locator('.request-viewer-detail').innerText()).includes('production-qa'));assert.ok(!(await viewer.innerText()).includes(c.text.apiKey));
  assert.equal(await ask.getByRole('button',{name:'Cancel editor request'}).isEnabled(),true);await page.screenshot({path:'test-results/request-viewer-running.png',fullPage:true});
  await viewer.getByRole('button',{name:'Collapse request viewer',exact:true}).click();assert.equal(await toggle.getAttribute('aria-expanded'),'false');
  await ask.getByRole('button',{name:'Cancel editor request'}).click();await ask.getByRole('alert').filter({hasText:/cancelled/}).waitFor();hold=false;assert.equal(JSON.stringify(await json('/api/stories/'+story.id)),before);
  await toggle.click();await viewer.locator('.request-call[data-status=pending]').waitFor({state:'detached'});await viewer.locator('.request-call[data-status=error]').first().click();await viewer.getByText('Request failed',{exact:false}).first().waitFor();
  await viewer.getByRole('button',{name:'Collapse request viewer',exact:true}).focus();await page.keyboard.press('Escape');assert.equal(await toggle.getAttribute('aria-expanded'),'false');assert.equal(await toggle.evaluate(el=>el===document.activeElement),true);
  await page.getByRole('button',{name:'Help',exact:true}).click();await toggle.click();await page.setViewportSize({width:320,height:884});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'test-results/request-viewer-mobile.png',fullPage:true});await page.setViewportSize({width:1280,height:1000});
  await page.route('**/api/dev/activity',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Activity service temporarily unavailable.'})}));await viewer.getByRole('button',{name:'Refresh activity',exact:true}).click();await viewer.locator('.request-viewer-problem[role=status]').filter({hasText:'Activity service temporarily unavailable.'}).waitFor();assert.ok((await toggle.innerText()).includes('Status unavailable'));await page.unroute('**/api/dev/activity');await viewer.getByRole('button',{name:'Refresh activity',exact:true}).click();await viewer.locator('.request-viewer-problem[role=status]').filter({hasText:'Activity service temporarily unavailable.'}).waitFor({state:'detached'});await viewer.getByRole('button',{name:'Collapse request viewer',exact:true}).click();
  const activity=await json('/api/dev/activity');assert.ok(activity.requests.every(r=>!('request'in r)&&!('response'in r)));assert.equal(activity.activeRequests,0);assert.ok((await json('/api/dev/diagnostics?limit=100')).logs.every(l=>!l.message.includes('/api/dev/activity')));
  console.log('PASS: fixed request viewer while busy, redacted payload inspection, errors/cancellation, keyboard collapse, navigation, outage recovery and 320px layout.');
  const markdown=await fetch(base+`/api/stories/${story.id}/novel`),text=await markdown.text();assert.equal(markdown.ok,true);assert.ok(markdown.headers.get('content-disposition').includes('attachment'));assert.ok(text.includes(story.passages[0].paragraphs[0]));assert.ok(!text.includes('NOT_IN_PUBLIC_NOVEL'));
  console.log('PASS: production launch/reuse, 1.0 identity, onboarding/help, read-only continuity review, provider failure/cancel and public novel export.');
  const png=await sharp(randomBytes(512*512*3),{raw:{width:512,height:512,channels:3}}).png().toBuffer();assert.ok(png.length>524288);
  const form=new FormData();form.set('image',new File([png],'qa-crew.png',{type:'image/png'}));form.set('metadata',JSON.stringify({expectedRevision:story.revision,requestId:randomUUID(),caption:'Production QA crew',category:'portrait',subjectIds:['elias','mira'],passageId:story.passages[0].id,parentId:null,status:'canonical'}));story=await json(`/api/stories/${story.id}/media`,{method:'POST',headers:{Origin:base},body:form});
  const exported=await fetch(base+`/api/stories/${story.id}/export`),bytes=new Uint8Array(await exported.arrayBuffer());assert.ok(bytes.length>524288);const copy=await json('/api/import',{method:'POST',body:bytes});assert.deepEqual(copy.canon,story.canon);assert.deepEqual(copy.media,story.media);
  await stop();await start(port);assert.ok(!output.includes('Preparing the current'));assert.deepEqual((await json('/api/stories/'+story.id)).media,story.media);assert.equal((await json(`/api/stories/${story.id}/editor`)).results.length,1);
  await page.goto(base);await page.getByRole('button',{name:'Gallery',exact:true}).click();await page.getByRole('button',{name:'Picture details: Production QA crew',exact:true}).waitFor();await page.setViewportSize({width:320,height:884});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'test-results/release-gallery-mobile.png',fullPage:true});
  assert.deepEqual(errors,[]);console.log('PASS: production uploads and ZIPs above 512 KiB, shared media, durable editor results, clean restart and mobile gallery. Normal libraries were untouched.');
}catch(e){mkdirSync('test-results',{recursive:true});await page?.screenshot({path:'test-results/release-failure.png',fullPage:true}).catch(()=>{});writeFileSync('test-results/release-failure.log',output);throw e;}
finally{await browser?.close();await stop();provider.closeAllConnections();await new Promise(r=>provider.close(r));const target=resolve(folder);assert.ok(target.startsWith(resolve(tmpdir())+'\\')&&basename(target).startsWith('storyweaver-production-'));rmSync(target,{recursive:true,force:true});}
