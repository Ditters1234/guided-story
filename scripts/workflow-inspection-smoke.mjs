// Build first. Isolated production/browser recovery with a deterministic local provider.
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,basename,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {blankSetupPlan} from '../src/lib/setup.ts';

const require=createRequire(import.meta.url),{chromium}=require('C:/Users/n_tin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const folder=mkdtempSync(join(tmpdir(),'storyweaver-workflow-inspection-')),config=join(folder,'config'),data=join(folder,'data');mkdirSync(config);mkdirSync(data);
let child,browser,page,base,port,output='',mode='bad',held=false,narrations=0,extractions=0,reviews=0;
const errors=[],beforeQuantities=[],pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const paragraphs=['Alex gave two sugar cubes to the pony. He waited by the stable door while she finished the treats and listened to the quiet sound of rain on the roof. The morning was still young, and there was plenty of time to enjoy it. He folded the cloth over his arm and looked toward the yard. A pair of birds had settled on the fence beside the old gate. For a moment he watched them in silence, happy to let the rest of the work wait until the shower passed. The pony leaned toward his shoulder, then turned her attention to the open doorway.'];
const memory={summary:'Alex offered the pony two treats.',facts:['Alex gave two sugar cubes to the pony.'],openQuestions:[],characterIds:['alex'],locationIds:['stable']};
const provider=createServer(async(request,response)=>{
  try{
    let raw='';for await(const chunk of request)raw+=chunk;
    const payload=JSON.parse(raw),system=payload.messages[0].content;
    let value;
    if(system.startsWith('Review inventory consistency.')){reviews++;value={consistent:true,issues:[]};}
    else if(system.startsWith('Return {effects:')){
      extractions++;const before=JSON.parse(payload.messages[1].content).before,quantity=before.items.find(item=>item.id==='sugar').quantity;beforeQuantities.push(quantity);
      if(mode==='hold'){held=true;return;}
      value={effects:[mode==='bad'?{type:'item.split',ref:'new-treats',itemId:'sugar',expectedQuantity:1,quantity:2,ownerId:'alex',evidenceId:'source-0'}:{type:'item.quantity',itemId:'sugar',expectedQuantity:quantity,quantity:quantity-2,evidenceId:'source-0'}],memory};
    }else{narrations++;value={title:'A quiet morning',chapterTitle:'Morning',viewpointId:'alex',endOfChapter:false,paragraphs};}
    response.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({choices:[{message:{content:JSON.stringify(value)},finish_reason:'stop'}]}));
  }catch(error){response.writeHead(500,{'Content-Type':'application/json'}).end(JSON.stringify({error:error.message}));}
});
async function api(path,init={},status=200){const response=await fetch(base+path,{...init,headers:{...(init.method?{Origin:base}:{}),...init.headers},signal:AbortSignal.timeout(15000)}),body=await response.json();if(status>=400)assert.equal(response.status,status,JSON.stringify(body));else assert.equal(response.ok,true,JSON.stringify(body));return body;}
const send=(path,body,method='POST',status=200)=>api(path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},status);
const recovery=()=>page.getByRole('region',{name:'Retained passages',exact:true});
const nav=name=>page.getByRole('navigation',{name:'Story navigation'}).getByRole('button',{name,exact:true});
async function stop(){if(!child||child.exitCode!==null)return;const done=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await done;}
async function start(){child=spawn(process.execPath,['scripts/start-production.mjs'],{windowsHide:true,env:{...process.env,STORY_PORT:String(port),STORY_DATA_DIR:data,STORY_CONFIG_DIR:config,STORY_SEED_SAMPLE:'0'},stdio:['ignore','pipe','pipe']});for(const stream of[child.stdout,child.stderr])stream.on('data',chunk=>output=(output+chunk).slice(-20000));for(let n=0;n<120;n++){if(child.exitCode!==null)throw Error(output);try{if((await fetch(base+'/api/stories')).ok)return;}catch{}await pause(200);}throw Error(output);}
async function clickResponse(button,path){const [response]=await Promise.all([page.waitForResponse(response=>new URL(response.url()).pathname===path&&response.request().method()==='POST'),button.click()]);return response;}
async function ready(path){const result=await clickResponse(recovery().getByRole('button',{name:'Retry world updates',exact:true}),path);assert.equal(result.ok(),true,await result.text());await recovery().getByRole('button',{name:'Save recovered passage',exact:true}).waitFor();assert.equal(await recovery().getByRole('heading',{name:'Recover a generated passage',exact:true}).evaluate(element=>element===document.activeElement),true);}

try{
  await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));port=probe.address().port;await new Promise(resolve=>probe.close(resolve));base=`http://127.0.0.1:${port}`;
  const connections=JSON.parse(readFileSync('config/connections.example.json','utf8'));Object.assign(connections.text,{model:'workflow-inspection-mock',baseUrl:`http://127.0.0.1:${provider.address().port}/v1`,contextTokens:32000,maxTokens:4096,structuredOutput:'prompt'});writeFileSync(join(config,'connections.play.local.json'),JSON.stringify(connections));await start();
  let setup=await send('/api/setups',{input:{premise:'A quiet morning at a stable.',castSize:1,preferences:{passageWords:100}},requestId:randomUUID()}),plan=blankSetupPlan();plan.title='Workflow inspection QA';plan.chapterTitle='Morning';plan.canon.places=[{id:'stable',name:'Stable',description:'A quiet stable.',parentId:null}];Object.assign(plan.canon.characters[0],{id:'alex',name:'Alex',locationId:'stable'});plan.canon.items=[{id:'sugar',name:'Sugar Cubes',description:'Small sugar cubes as pony treats in tin.',quantity:1,ownerId:'alex',equipped:false}];plan.context.sceneBrief={...plan.context.sceneBrief,viewpointId:'alex',locationId:'stable',castIds:['alex'],purpose:'Offer the pony a treat.'};setup=await send(`/api/setups/${setup.id}`,{expectedRevision:setup.revision,requestId:randomUUID(),input:setup.input,plan},'PATCH');
  const opening={expectedRevision:setup.revision,requestId:randomUUID()};await send(`/api/setups/${setup.id}/opening`,opening,'POST',502);
  const originalRun=(await api('/api/story-workflows')).runs[0].run.id;
  browser=await chromium.launch({channel:'msedge',headless:true});page=await browser.newPage({viewport:{width:1280,height:1000}});page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base);await nav('Workflows').click();await page.getByRole('heading',{name:'Workflow history',exact:true}).waitFor();
  const runList=()=>page.getByLabel('Workflow runs',{exact:true}),selected=()=>page.getByRole('region',{name:'Selected workflow run',exact:true}),stages=()=>page.getByRole('navigation',{name:'Workflow stages',exact:true}),inspector=()=>page.getByRole('region',{name:'Stage inspector',exact:true});
  await runList().getByRole('button',{name:/Workflow inspection QA/}).click();await selected().getByRole('heading',{name:'Validate repaired updates',exact:true}).waitFor();
  await stages().getByRole('button',{name:/Validate updates/}).click();await inspector().getByText('Deterministic validation · issues',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Show workflow diagram',exact:true}).click();assert.equal(await page.getByRole('region',{name:'Read-only workflow diagram',exact:true}).getByRole('button').count(),20);
  await inspector().getByText(/Typed connections/).click();assert.ok(await inspector().getByRole('button',{name:/Extract world updates.*Validate updates/}).count());
  const selectExtract=stages().getByRole('button',{name:/Extract world updates/});await selectExtract.focus();await page.keyboard.press('Enter');await inspector().getByRole('heading',{name:'Extract world updates',exact:true}).waitFor();assert.equal(await inspector().getByRole('heading',{name:'Extract world updates',exact:true}).evaluate(element=>element===document.activeElement),true);
  let releaseNode,enteredNode;const delayed=new Promise(resolve=>enteredNode=resolve),release=new Promise(resolve=>releaseNode=resolve),sourceNodeRoute=`**/api/story-workflows/${originalRun}/nodes/source`;
  await page.route(sourceNodeRoute,async route=>{const response=await route.fetch();enteredNode();await release;await route.fulfill({response}).catch(()=>{});});
  await stages().getByRole('button',{name:/Saved source/}).click();await delayed;await stages().getByRole('button',{name:/Write prose/}).click();await inspector().getByRole('heading',{name:'Write prose',exact:true}).waitFor();releaseNode();await page.unroute(sourceNodeRoute);await inspector().getByText('Stored prose',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Remove stored details',exact:true}).isDisabled(),true);
  const noCalls=narrations+extractions+reviews;await page.getByRole('button',{name:'Refresh workflow history',exact:true}).click();await page.getByText('Loading run and current saved facts…',{exact:true}).waitFor({state:'hidden'});assert.equal(narrations+extractions+reviews,noCalls);
  await page.getByRole('button',{name:'Open current setup and editors',exact:true}).click();await page.getByRole('heading',{name:'Shape your story',exact:true}).waitFor();
  await page.getByRole('group',{name:'Setup sections'}).getByRole('button',{name:'Possessions',exact:true}).click();await page.getByRole('region',{name:'Possession · Sugar Cubes',exact:true}).getByLabel('Quantity',{exact:true}).fill('3');const setupSaved=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/setups/${setup.id}`&&response.request().method()==='PATCH');await page.getByRole('button',{name:'Save setup draft',exact:true}).first().click();assert.equal((await setupSaved).ok(),true);
  await nav('Workflows').click();await selected().getByText(/Saved world facts changed/).waitFor();
  const guidance=()=>recovery().getByLabel(/Guidance for rechecking/);await guidance().fill('Use the corrected saved count.');
  assert.equal(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;}),true);
  page.once('dialog',dialog=>dialog.dismiss());await nav('Library').click();await page.getByRole('heading',{name:'Workflow history',exact:true}).waitFor();assert.equal(await guidance().inputValue(),'Use the corrected saved count.');
  mode='good';const retryPath=`/api/setups/${setup.id}/recovery/${(await api(`/api/setups/${setup.id}/recovery`)).drafts[0].id}/retry`;
  await ready(retryPath);await page.getByRole('button',{name:'Inspect latest successful check',exact:true}).waitFor();assert.equal(narrations,1);
  await page.getByRole('button',{name:'Inspect latest successful check',exact:true}).click();await selected().getByText('awaiting acceptance',{exact:false}).waitFor();
  const readyRun=(await api('/api/story-workflows')).runs[0].run.id;
  await guidance().fill('Unsubmitted new guidance.');assert.equal(await recovery().getByRole('button',{name:'Save recovered passage',exact:true}).isDisabled(),true);await recovery().getByRole('button',{name:'Clear rechecking guidance',exact:true}).click();
  // Cancellation must supersede the older successful proposal without renarration.
  mode='hold';held=false;await recovery().getByRole('button',{name:'Retry world updates',exact:true}).click();for(let n=0;n<100&&!held;n++)await pause(25);assert.equal(held,true);await recovery().getByRole('button',{name:'Cancel check',exact:true}).click();await recovery().getByText(/The update check was cancelled/).waitFor();
  await page.getByRole('button',{name:'Refresh workflow history',exact:true}).click();await selected().getByText(/reviewed proposal was superseded/).waitFor();assert.equal(await recovery().getByRole('button',{name:'Save recovered passage',exact:true}).count(),0);assert.equal(narrations,1);
  mode='good';await ready(retryPath);await page.getByRole('button',{name:'Inspect latest successful check',exact:true}).click();await selected().getByText('awaiting acceptance',{exact:false}).waitFor();
  // Reload/failure guards must not allow actions against a stale inspection.
  const failedDetailRoute=`**/api/story-workflows/${(await api('/api/story-workflows')).runs[0].run.id}`;await page.route(failedDetailRoute,route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Workflow inspection unavailable for QA.'})}));await page.getByRole('button',{name:'Refresh workflow history',exact:true}).click();await page.getByText('Workflow inspection unavailable for QA.',{exact:true}).waitFor();assert.equal(await recovery().getByRole('button',{name:'Save recovered passage',exact:true}).isDisabled(),true);await page.unroute(failedDetailRoute);await page.getByRole('button',{name:'Refresh workflow history',exact:true}).click();await recovery().getByRole('button',{name:'Save recovered passage',exact:true}).waitFor();
  const observer=await browser.newPage();await observer.goto(base);await observer.getByRole('navigation',{name:'Story navigation'}).getByRole('button',{name:'Workflows',exact:true}).click();await observer.getByLabel('Workflow runs',{exact:true}).getByRole('button').first().click();
  const applyPath=retryPath.replace('/retry','/apply'),savedResponse=await clickResponse(recovery().getByRole('button',{name:'Save recovered passage',exact:true}),applyPath);assert.equal(savedResponse.ok(),true);const story=await savedResponse.json();assert.equal(story.passages.length,1);assert.equal(story.canon.items[0].quantity,1);assert.equal(narrations,1);
  await observer.getByRole('button',{name:'Refresh workflow history',exact:true}).click();await observer.getByText(/already been published/).waitFor();await observer.close();
  await page.getByRole('button',{name:'Refresh workflow history',exact:true}).click();await selected().getByText('completed',{exact:true}).waitFor();
  for(const width of[320,390]){await page.setViewportSize({width,height:884});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`Workflow overflow at ${width}px`);}
  mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/workflow-inspection-mobile.png',fullPage:true});await page.setViewportSize({width:1280,height:1000});if(await page.getByRole('button',{name:'Show workflow diagram',exact:true}).count())await page.getByRole('button',{name:'Show workflow diagram',exact:true}).click();await page.screenshot({path:'test-results/workflow-inspection-desktop.png',fullPage:true});
  // Each retry points to the original retained artifact: remove the child first.
  const finalRun=(await api('/api/story-workflows')).runs[0].run.id,finalDetail=await api(`/api/story-workflows/${finalRun}`);assert.equal(finalDetail.removal.allowed,true);
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Remove stored details',exact:true}).click();await page.getByText(/Stored details were removed on/).waitFor();assert.deepEqual(await api(`/api/stories/${story.id}`),story);
  const oldDetail=await api(`/api/story-workflows/${readyRun}`);assert.equal(oldDetail.removal.allowed,true);await send(`/api/story-workflows/${readyRun}`,{expectedVersion:oldDetail.version},'DELETE');
  await stop();await start();await page.reload();await nav('Workflows').click();await page.getByText(/Stored details were removed on/).waitFor();assert.deepEqual(await send(`/api/setups/${setup.id}/opening`,opening),story);assert.equal(narrations,1);
  assert.deepEqual(errors,[]);console.log(`PASS: typed diagram/list inspection, provenance, deterministic issues, saved-fact staleness, editor handoff, effects-only retries, unused-guidance/reload/failure guards, cancellation/superseded checks, another-window publication, lifecycle cleanup, restart/replay and 320/390px layout. ${narrations} narration; no narration repeated. Normal libraries/settings untouched.`);
}catch(error){mkdirSync('test-results',{recursive:true});await page?.screenshot({path:'test-results/workflow-inspection-failure.png',fullPage:true}).catch(()=>{});writeFileSync('test-results/workflow-inspection-failure.log',output);throw error;}
finally{await browser?.close();await stop();provider.closeAllConnections();await new Promise(resolve=>provider.close(resolve));const target=resolve(folder);assert.equal(dirname(target),resolve(tmpdir()));assert.ok(basename(target).startsWith('storyweaver-workflow-inspection-'));rmSync(target,{recursive:true,force:true});}
