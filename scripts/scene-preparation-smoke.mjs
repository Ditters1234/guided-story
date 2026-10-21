// Build first, then: node --import tsx scripts/scene-preparation-smoke.mjs
// Production browser acceptance with temporary saves/settings and a local mock provider.
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename,dirname,join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {zipSync,strToU8} from 'fflate';
import {blankSetupPlan} from '../src/lib/setup.ts';
import {createSample} from '../src/lib/server/fixture.ts';

const require=createRequire(import.meta.url),{chromium}=require('C:/Users/n_tin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const folder=mkdtempSync(join(tmpdir(),'storyweaver-scene-preparation-')),config=join(folder,'config'),data=join(folder,'data');mkdirSync(config);mkdirSync(data);
let child,browser,page,base,output='',providerMode='ok',serial=0,dismissDialogs=false;
const dialogs=[];
const providerCalls=[],pageErrors=[];
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function eventually(check,message){for(let n=0;n<100;n++){if(await check())return;await pause(100);}throw new Error(message);}
async function api(path,init={},expected){
  const response=await fetch(base+path,{...init,headers:{...(init.method?{Origin:base}:{}),...init.headers},signal:AbortSignal.timeout(15000)}),body=await response.json();
  if(expected===undefined)assert.equal(response.ok,true,JSON.stringify(body));else assert.equal(response.status,expected,JSON.stringify(body));return body;
}
const send=(path,body,method='POST',expected)=>api(path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},expected);
async function stop(){if(!child)return;const current=child;child=undefined;if(current.exitCode!==null)return;const done=new Promise(resolve=>current.once('exit',resolve));current.kill('SIGKILL');await done;}
async function start(port){
  output='';child=spawn(process.execPath,['scripts/start-production.mjs'],{windowsHide:true,env:{...process.env,STORY_PORT:String(port),STORY_DATA_DIR:data,STORY_CONFIG_DIR:config,STORY_SEED_SAMPLE:'0'},stdio:['ignore','pipe','pipe']});
  for(const stream of[child.stdout,child.stderr])stream.on('data',chunk=>output=(output+chunk).slice(-24000));
  for(let n=0;n<120;n++){if(child.exitCode!==null)throw new Error(output);try{if((await fetch(base+'/api/setups')).ok)return;}catch{}await pause(200);}throw new Error(output||'Production server did not start.');
}
function modelDraft(context){
  const number=++serial,person=context.selectedIds.characterIds[0]||context.directory.characters[0][0];
  const parent=context.currentSceneBrief.locationId||context.currentRecords.characters.find(row=>row.id===person)?.locationId||context.directory.places[0][0];
  const existingItems=context.selectedIds.itemIds.length?context.selectedIds.itemIds:context.directory.items.slice(0,2).map(row=>row[0]);
  return {explanation:`Reuse the selected people and supplies. Add only feeding resources for reviewed future scene ${number}; no feeding or travel has happened.`,reusedIds:[person,parent,...existingItems],
    places:[{ref:'new-room',name:`QA Feed Room ${number}`,description:'A quiet room for measured feed.',parentId:parent}],
    items:[{ref:'new-bin',name:`QA Feed Bin ${number}`,description:'A covered feed bin.',quantity:1,ownerId:'new-room',isContainer:true},{ref:'new-feed',name:`QA Pellet Portions ${number}`,description:'Individual measured portions.',quantity:12,ownerId:'new-bin',isContainer:false}],
    tasks:[{ref:'new-task',title:`QA Optional Feeding ${number}`,notes:'A possible future task; collect feed before offering it.'}],
    lore:[{ref:'new-lore',title:`QA Feeding Custom ${number}`,text:'Quiet handling can make feeding a pleasant optional routine.',keywords:['feeding'],relatedIds:[person,'new-room','new-feed',...existingItems.slice(0,1)]}],
    sceneBrief:{purpose:`Obtain measured feed and develop a quiet feeding scene ${number}, allowing any necessary travel first.`,tension:'Avoid rushing the animal.',stopAt:'The animal is settled.',viewpointId:person,locationId:'new-room',castIds:[person]}};
}
const provider=createServer(async(request,response)=>{
  try{
    if(request.method==='GET'){response.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({data:[{id:'scene-preparation-mock'}]}));return;}
    let text='';for await(const chunk of request)text+=chunk;
    const payload=JSON.parse(text),context=JSON.parse(payload.messages[1].content),mode=providerMode;
    providerCalls.push({mode,context,system:payload.messages[0].content});
    const finish=()=>{if(response.destroyed)return;if(mode==='fail'){response.writeHead(503,{'Content-Type':'application/json'}).end(JSON.stringify({error:'Deliberate isolated provider failure.'}));return;}
      response.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({choices:[{message:{content:JSON.stringify(modelDraft(context))},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:200,total_tokens:300}}));};
    if(mode==='slow')setTimeout(finish,2000);else finish();
  }catch(error){if(!response.destroyed)response.writeHead(500,{'Content-Type':'application/json'}).end(JSON.stringify({error:error.message}));}
});
const prep=()=>page.getByRole('region',{name:'Prepare a scene',exact:true});
const nav=()=>page.getByRole('navigation',{name:'Story navigation'});
async function setupTab(){await page.getByRole('group',{name:'Setup sections'}).getByRole('button',{name:'Prepare scene',exact:true}).click();await prep().getByRole('heading',{name:'Prepare a scene',exact:true}).waitFor();}
async function preview(path,direction){
  if(direction)await prep().getByLabel('Scene preparation request',{exact:true}).fill(direction);
  const response=page.waitForResponse(response=>new URL(response.url()).pathname===path&&response.request().method()==='POST');
  await prep().getByRole('button',{name:'Preview scene preparation',exact:true}).click();
  const result=await response;assert.equal(result.ok(),true,await result.text());
  const proposal=await result.json();await prep().getByRole('heading',{name:'Review scene preparation',exact:true}).waitFor();return proposal;
}
async function selectSaved(resultId){await prep().getByLabel('Saved scene preparations',{exact:true}).selectOption(resultId);await prep().getByRole('heading',{name:'Review scene preparation',exact:true}).waitFor();}
async function applyPreview(path,proposal){
  const response=page.waitForResponse(response=>new URL(response.url()).pathname===`${path}/${proposal.id}/apply`&&response.request().method()==='POST');
  await prep().getByRole('button',{name:'Apply scene preparation',exact:true}).click();const result=await response;assert.equal(result.ok(),true,await result.text());
  const body=result.request().postDataJSON(),saved=await result.json();await prep().getByText(/Scene preparation applied\. Review/).waitFor();
  const replay=await send(`${path}/${proposal.id}/apply`,body);assert.deepEqual(replay,saved);return saved;
}
function assertAdditions(before,after,proposal){
  const old='canon'in before?before:before.plan,current='canon'in after?after:after.plan;
  for(const kind of['characters','places','items','relationships','threads'])assert.deepEqual(current.canon[kind].filter(row=>old.canon[kind].some(prior=>prior.id===row.id)),old.canon[kind],`Existing ${kind} must stay unchanged.`);
  for(const kind of['places','items','threads'])for(const row of proposal.additions[kind])assert.deepEqual(current.canon[kind].find(saved=>saved.id===row.id),row);
  for(const row of proposal.additions.lore)assert.deepEqual(current.context.lore.find(saved=>saved.id===row.id),row);
  assert.deepEqual(current.context.sceneBrief,proposal.sceneBrief);
  const [bin,portions]=proposal.additions.items;assert.equal(current.canon.items.find(row=>row.id===portions.id).ownerId,bin.id);assert.equal(current.canon.items.find(row=>row.id===bin.id).ownerId,proposal.additions.places[0].id);
}

try{
  await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
  const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));base=`http://127.0.0.1:${port}`;
  const connections=JSON.parse(readFileSync('config/connections.example.json','utf8'));Object.assign(connections.text,{baseUrl:`http://127.0.0.1:${provider.address().port}/v1`,model:'scene-preparation-mock',maxTokens:4096,contextTokens:32000,structuredOutput:'prompt',timeoutSeconds:30});writeFileSync(join(config,'connections.play.local.json'),JSON.stringify(connections));
  await start(port);
  let setup=await send('/api/setups',{requestId:randomUUID(),input:{title:'Setup scene preparation QA',premise:'Alex cares for a pony at a quiet stable.',castSize:1}});
  const plan=blankSetupPlan();plan.title='Setup scene preparation QA';plan.canon.places=[{id:'stable',name:'Stable',description:'A quiet working stable.',parentId:null}];Object.assign(plan.canon.characters[0],{id:'alex',name:'Alex',locationId:'stable'});
  plan.canon.items=[{id:'sugar',name:'Sugar cubes',description:'Small white pony treats.',quantity:1,ownerId:'alex',equipped:false,unlimited:true},{id:'brush',name:'Grooming brush',description:'A soft wooden brush.',quantity:5,ownerId:'stable',equipped:false}];
  plan.context.sceneBrief={...plan.context.sceneBrief,viewpointId:'alex',locationId:'stable',castIds:['alex'],purpose:'Visit the pony.'};plan.context.lore=[{id:'routine',title:'Stable routine',text:'Quiet handling is customary; current inventory governs supplies.',keywords:['feeding'],relatedIds:['sugar'],visibility:'relevant'}];plan.factPins.fields=[{kind:'item',recordId:'sugar',field:'unlimited'},{kind:'item',recordId:'brush',field:'quantity'}];
  setup=await send(`/api/setups/${setup.id}`,{expectedRevision:0,requestId:randomUUID(),input:setup.input,plan},'PATCH');const setupBefore=structuredClone(setup),setupPath=`/api/setups/${setup.id}/preparation`;
  browser=await chromium.launch({channel:'msedge',headless:true});page=await browser.newPage({viewport:{width:1280,height:1000}});page.setDefaultTimeout(18000);page.on('pageerror',error=>pageErrors.push(error.message));page.on('dialog',dialog=>{dialogs.push(dialog.message());return dismissDialogs?dialog.dismiss():dialog.accept();});
  await page.goto(base);await page.waitForLoadState('networkidle');await nav().getByRole('button',{name:'Library',exact:true}).click();await page.getByRole('region',{name:setup.plan.title,exact:true}).getByRole('button',{name:'Resume setup ↗',exact:true}).click();await page.getByRole('heading',{name:'Shape your story',exact:true}).waitFor();
  await page.getByLabel('Book title',{exact:true}).fill('Unsaved preparation guard');await setupTab();await prep().getByText('Save or reset the current editor’s changes before preparing a scene.',{exact:true}).waitFor();assert.equal(await prep().getByLabel('Scene preparation request',{exact:true}).isDisabled(),true);assert.equal(providerCalls.length,0);await page.getByLabel('Book title',{exact:true}).fill(setup.plan.title);
  await prep().getByLabel('Scene preparation request',{exact:true}).fill('Unsaved feeding preparation to keep.');
  for(const label of['Manage setup pins','Begin chapter one']){
    const beforeDialogs=dialogs.length;dismissDialogs=true;await page.getByRole('button',{name:label,exact:true}).click();dismissDialogs=false;
    assert.equal(dialogs.length,beforeDialogs+1);assert.match(dialogs.at(-1),/Discard the scene preparation draft/);
    assert.equal(await prep().getByLabel('Scene preparation request',{exact:true}).inputValue(),'Unsaved feeding preparation to keep.');
    assert.deepEqual(await api(`/api/setups/${setup.id}`),setupBefore);assert.equal(providerCalls.length,0);
  }
  await prep().getByRole('button',{name:'Clear preparation draft',exact:true}).click();
  await prep().getByRole('button',{name:'Feeding scene example',exact:true}).click();assert.match(await prep().getByLabel('Scene preparation request',{exact:true}).inputValue(),/Prepare a feeding scene/);
  await prep().getByText('Choose existing records to include (optional)',{exact:true}).click();await prep().getByRole('listbox',{name:/^Preparation cast/}).selectOption(['alex']);await prep().getByRole('listbox',{name:/^Preparation places/}).selectOption(['stable']);await prep().getByRole('listbox',{name:/^Preparation possessions/}).selectOption(['sugar','brush']);
  const setupPreview=await preview(setupPath);assert.deepEqual(await api(`/api/setups/${setup.id}`),setupBefore);assert.equal((await api('/api/stories')).length,0);
  assert.deepEqual(providerCalls[0].context.selectedIds,{characterIds:['alex'],placeIds:['stable'],itemIds:['sugar','brush']});
  for(const id of['sugar','brush',...setupPreview.additions.items.map(item=>item.id),...setupPreview.additions.threads.map(task=>task.id),...setupPreview.additions.lore.map(entry=>entry.id)])assert.ok(setupPreview.sceneBrief.resourceIds.includes(id),`${id} must remain an explicit future resource hint.`);
  const reviewed=prep().getByRole('region',{name:'Scene preparation preview',exact:true});for(const heading of['Reuse existing records','Places to add · 1','Possessions to add · 2','Open tasks / story threads to add · 1','Background to add · 1','Next-scene direction'])await reviewed.getByRole('heading',{name:heading,exact:true}).waitFor();await reviewed.getByText('Sugar cubes',{exact:true}).first().waitFor();await reviewed.getByText('Grooming brush',{exact:true}).first().waitFor();
  await page.setViewportSize({width:320,height:884});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/scene-preparation-mobile.png',fullPage:true});await page.setViewportSize({width:1280,height:1000});
  await page.reload();await page.getByRole('heading',{name:'Shape your story',exact:true}).waitFor();await setupTab();await selectSaved(setupPreview.id);setup=await applyPreview(setupPath,setupPreview);assertAdditions(setupBefore,setup,setupPreview);assert.equal(setup.storyId,null);assert.deepEqual(setup.plan.context.memories,[]);assert.equal(setup.revision,setupBefore.revision+1);assert.deepEqual(setup.plan.factPins,setupBefore.plan.factPins);
  await page.getByRole('group',{name:'Setup sections'}).getByRole('button',{name:'Opening',exact:true}).click();
  assert.equal(await page.getByRole('region',{name:'Prepared scene resources',exact:true}).getByRole('listitem').count(),setup.plan.context.sceneBrief.resourceIds.length);await setupTab();
  await page.getByRole('group',{name:'Setup sections'}).getByRole('button',{name:'Background',exact:true}).click();const preparedLore=setupPreview.additions.lore[0];
  await page.getByRole('region',{name:`Background · ${preparedLore.title}`,exact:true}).getByLabel(/^When to include/).selectOption('hidden');
  let setupSave=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/setups/${setup.id}`&&response.request().method()==='PATCH');await page.getByRole('button',{name:'Save setup draft',exact:true}).first().click();assert.equal((await setupSave).ok(),true);setup=await api(`/api/setups/${setup.id}`);assert.equal(setup.plan.context.sceneBrief.resourceIds.includes(preparedLore.id),false);assert.equal(setup.plan.context.lore.find(entry=>entry.id===preparedLore.id).visibility,'hidden');
  await page.getByRole('group',{name:'Setup sections'}).getByRole('button',{name:'Story threads',exact:true}).click();const preparedTask=setupPreview.additions.threads[0];await page.getByRole('region',{name:`Story thread · ${preparedTask.title}`,exact:true}).getByRole('button',{name:'Remove thread',exact:true}).click();
  setupSave=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/setups/${setup.id}`&&response.request().method()==='PATCH');await page.getByRole('button',{name:'Save setup draft',exact:true}).first().click();assert.equal((await setupSave).ok(),true);setup=await api(`/api/setups/${setup.id}`);assert.equal(setup.plan.context.sceneBrief.resourceIds.includes(preparedTask.id),false);assert.equal(setup.plan.canon.threads.some(task=>task.id===preparedTask.id),false);await setupTab();
  const stale=await preview(setupPath,'QA stale setup feeding scene');const changedSetup=await send(`/api/setups/${setup.id}`,{expectedRevision:setup.revision,requestId:randomUUID(),input:{...setup.input,title:'A concurrent author edit'},plan:setup.plan},'PATCH');
  await page.reload();await page.getByRole('heading',{name:'Shape your story',exact:true}).waitFor();await setupTab();await selectSaved(stale.id);await prep().getByText(/The source changed after this preview/).waitFor();assert.equal(await prep().getByRole('button',{name:'Apply scene preparation',exact:true}).isDisabled(),true);await send(`${setupPath}/${stale.id}/apply`,{expectedRevision:stale.sourceRevision,requestId:randomUUID()},'POST',409);assert.deepEqual(await api(`/api/setups/${setup.id}`),changedSetup);await prep().getByRole('button',{name:'Clear preparation draft',exact:true}).click();
  console.log('PASS: setup saved-field and preparation-draft guards, optional targets, reviewed reuse/additions, untouched preview source, stable atomic apply/replay, mobile layout, reload and stale refusal.');

  const sample=createSample();sample.title='Written scene preparation QA';sample.canon.items.push({id:'sugar',name:'Sugar cubes',description:'Small white treats.',quantity:1,ownerId:'elias',equipped:false,unlimited:true});sample.factPins.fields=[{kind:'item',recordId:'sugar',field:'unlimited'},{kind:'item',recordId:'sugar',field:'ownerId'}];sample.recovery.canon=structuredClone(sample.canon);
  const archive=zipSync({'manifest.json':strToU8(JSON.stringify({format:'guided-story-dev-1',media:[]})),'story.json':strToU8(JSON.stringify(sample))});let story=await api('/api/import',{method:'POST',body:archive});const storyBefore=structuredClone(story),storyPath=`/api/stories/${story.id}/preparation`;
  await nav().getByRole('button',{name:'Library',exact:true}).click();await page.getByRole('button',{name:'Reload library',exact:true}).click();await page.getByRole('region',{name:story.title,exact:true}).getByRole('button',{name:'Resume story ↗',exact:true}).click();await nav().getByRole('button',{name:'Prepare scene',exact:true}).click();const writtenPreview=await preview(storyPath,'QA written feeding scene using the existing sugar cubes');assert.deepEqual(await api(`/api/stories/${story.id}`),storyBefore);
  story=await applyPreview(storyPath,writtenPreview);assertAdditions(storyBefore,story,writtenPreview);assert.deepEqual(story.passages,storyBefore.passages);assert.deepEqual(story.context.memories,storyBefore.context.memories);assert.deepEqual(story.factPins,storyBefore.factPins);assert.deepEqual(story.media,storyBefore.media);assert.equal(story.recovery.valid,false);assert.equal(story.context.compaction.epoch,storyBefore.context.compaction.epoch+1);
  await nav().getByRole('button',{name:'Read',exact:true}).click();const scene=page.locator('details.scene-direction');await scene.locator('summary').click();
  const preparedResources=scene.getByRole('region',{name:'Prepared scene resources',exact:true}),resourcesBefore=structuredClone(story.context.sceneBrief.resourceIds),canonBeforeResources=structuredClone(story.canon);
  assert.equal(await preparedResources.getByRole('listitem').count(),resourcesBefore.length);await scene.getByLabel('Scene purpose',{exact:true}).fill(story.context.sceneBrief.purpose+' Reviewed scene direction.');
  let sceneSave=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/stories/${story.id}`&&response.request().method()==='PATCH');await scene.getByRole('button',{name:'Save scene direction',exact:true}).click();assert.equal((await sceneSave).ok(),true);await scene.getByText('Scene direction saved.',{exact:true}).waitFor();story=await api(`/api/stories/${story.id}`);assert.deepEqual(story.context.sceneBrief.resourceIds,resourcesBefore);
  await preparedResources.getByRole('button',{name:'Clear prepared resource hints',exact:true}).click();assert.deepEqual((await api(`/api/stories/${story.id}`)).context.sceneBrief.resourceIds,resourcesBefore);await scene.getByRole('button',{name:'Reload saved brief',exact:true}).click();assert.equal(await preparedResources.getByRole('listitem').count(),resourcesBefore.length);
  const removedResource=writtenPreview.additions.items[1];await preparedResources.getByRole('button',{name:`Remove prepared resource ${removedResource.name}`,exact:true}).click();
  sceneSave=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/stories/${story.id}`&&response.request().method()==='PATCH');await scene.getByRole('button',{name:'Save scene direction',exact:true}).click();assert.equal((await sceneSave).ok(),true);await scene.getByText('Scene direction saved.',{exact:true}).waitFor();story=await api(`/api/stories/${story.id}`);assert.deepEqual(story.context.sceneBrief.resourceIds,resourcesBefore.filter(id=>id!==removedResource.id));assert.deepEqual(story.canon,canonBeforeResources);
  await nav().getByRole('button',{name:'Prepare scene',exact:true}).click();
  const beforeFailures=structuredClone(story),historyBefore=(await api(storyPath)).results.length;
  providerMode='fail';const beforeFailedCalls=providerCalls.length;await prep().getByLabel('Scene preparation request',{exact:true}).fill('QA provider failure feeding scene');const failed=page.waitForResponse(response=>new URL(response.url()).pathname===storyPath&&response.request().method()==='POST');await prep().getByRole('button',{name:'Preview scene preparation',exact:true}).click();assert.equal((await failed).status(),502);await prep().getByRole('alert').filter({hasText:/provider returned HTTP 503/}).waitFor();assert.equal(providerCalls.length,beforeFailedCalls+1);assert.deepEqual(await api(`/api/stories/${story.id}`),beforeFailures);assert.equal((await api(storyPath)).results.length,historyBefore);
  providerMode='slow';await prep().getByRole('button',{name:'Clear preparation draft',exact:true}).click();await prep().getByLabel('Scene preparation request',{exact:true}).fill('QA cancelled feeding scene');const beforeCancelledCalls=providerCalls.length;const cancelRequest=page.waitForRequest(request=>new URL(request.url()).pathname===storyPath&&request.method()==='POST');await prep().getByRole('button',{name:'Preview scene preparation',exact:true}).click();const cancelledInput=(await cancelRequest).postDataJSON();await eventually(()=>providerCalls.length===beforeCancelledCalls+1,'Mock provider never received the cancelled request.');await prep().getByRole('button',{name:'Cancel scene preparation',exact:true}).click();await prep().getByText(/Preparation cancelled/).waitFor();await pause(2300);
  assert.deepEqual(await api(`/api/stories/${story.id}`),beforeFailures);assert.equal((await api(storyPath)).results.length,historyBefore);const jobs=await api('/api/dev/jobs');assert.equal(jobs.jobs.find(job=>job.storyId===story.id&&job.requestId===cancelledInput.requestId).state,'cancelled');const diagnostics=await api('/api/dev/diagnostics?download=1');assert.ok(diagnostics.traces.some(trace=>trace.kind==='scene-preparation'&&trace.request.stage==='proposal'));
  providerMode='ok';await prep().getByRole('button',{name:'Clear preparation draft',exact:true}).click();await stop();await start(port);await page.goto(base);await page.waitForLoadState('networkidle');assert.deepEqual(await api(`/api/stories/${story.id}`),story);assert.deepEqual(await api(`/api/setups/${setup.id}`),changedSetup);assert.ok((await api(storyPath)).results.some(result=>result.id===writtenPreview.id&&result.appliedAt));assert.ok((await api(setupPath)).results.some(result=>result.id===setupPreview.id&&result.appliedAt));assert.deepEqual(pageErrors,[]);
  console.log('PASS: written-story navigation and reviewed apply preserve paragraphs/memory/pins and invalidate canon recovery; provider failure/cancellation retain state, request stages and previews survive restart. Normal libraries/settings were untouched.');
}catch(error){mkdirSync('test-results',{recursive:true});await page?.screenshot({path:'test-results/scene-preparation-failure.png',fullPage:true}).catch(()=>{});writeFileSync('test-results/scene-preparation-failure.log',output);throw error;}
finally{await browser?.close();await stop();provider.closeAllConnections();await new Promise(resolve=>provider.close(resolve));const target=resolve(folder);assert.equal(dirname(target),resolve(tmpdir()));assert.ok(basename(target).startsWith('storyweaver-scene-preparation-'));rmSync(target,{recursive:true,force:true});}
