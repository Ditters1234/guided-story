// node --import tsx scripts/fact-pins-smoke.mjs — isolated production fact-pin acceptance.
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,basename,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {zipSync,strToU8} from 'fflate';
import {createSample} from '../src/lib/server/fixture.ts';

const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/n_tin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const folder=mkdtempSync(join(tmpdir(),'storyweaver-fact-pins-'));
const config=join(folder,'config'),data=join(folder,'data');mkdirSync(config);mkdirSync(data);
const errors=[],dialogs=[],pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let child,browser,page,base,story,output='',dialogDecision='accept';

async function request(path,init){
  const response=await fetch(base+path,{...init,headers:{...(init?.method?{Origin:base}:{}),...init?.headers}});
  return {response,body:await response.json()};
}
async function json(path,init){const {response,body}=await request(path,init);assert.equal(response.ok,true,JSON.stringify(body));return body;}
const read=()=>json('/api/stories/'+story.id);
const mutate=(current,action)=>request('/api/stories/'+current.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:current.revision,requestId:randomUUID(),action})});
const nav=name=>page.getByRole('navigation',{name:'Story navigation'}).getByRole('button',{name,exact:true});
const panel=()=>page.locator('.pins-view');
const pinsForm=()=>page.getByRole('form',{name:'Fact pins and world rules',exact:true});
const cards=()=>panel().locator('.pin-card');
const rule=index=>pinsForm().getByLabel('World rule '+index,{exact:true});
const pinned=(kind,recordId,field)=>story.factPins.fields.some(pin=>pin.kind===kind&&pin.recordId===recordId&&pin.field===field);
async function start(port){
  output='';child=spawn(process.execPath,['scripts/start-production.mjs'],{windowsHide:true,env:{...process.env,STORY_PORT:String(port),STORY_DATA_DIR:data,STORY_CONFIG_DIR:config,STORY_SEED_SAMPLE:'0'},stdio:['ignore','pipe','pipe']});
  for(const stream of[child.stdout,child.stderr])stream.on('data',bytes=>output=(output+bytes).slice(-30000));
  for(let i=0;i<120;i++){if(child.exitCode!==null)throw new Error(output);try{if((await fetch(base+'/api/stories')).ok)return;}catch{}await pause(200);}throw new Error(output);
}
async function stop(){if(!child)return;const current=child;child=undefined;if(current.exitCode!==null)return;const done=new Promise(resolve=>current.once('exit',resolve));current.kill('SIGKILL');await done;}
async function selectPin(kind,recordId,field){
  await pinsForm().getByLabel('Record type',{exact:true}).selectOption(kind);
  if(kind!=='world')await pinsForm().getByLabel('Record',{exact:true}).selectOption(recordId);
  await pinsForm().getByLabel('Field',{exact:true}).selectOption(field);
}
async function addPin(kind,recordId,field){await selectPin(kind,recordId,field);await pinsForm().getByRole('button',{name:'Pin selected field',exact:true}).click();}
async function savePins(){
  const response=page.waitForResponse(reply=>reply.url()===base+'/api/stories/'+story.id&&reply.request().method()==='PATCH');
  await pinsForm().getByRole('button',{name:'Save pins & rules',exact:true}).click();
  const reply=await response,body=await reply.json();assert.equal(reply.ok(),true,JSON.stringify(body));
  await panel().getByRole('status').filter({hasText:'Fact pins and world rules saved.'}).waitFor();
  await page.waitForFunction(()=>document.querySelector('.pins-view fieldset')?.disabled===false);
  story=await read();return body;
}
async function reopenPins(){await nav('Contents').click();await nav('Pins').click();await panel().getByRole('heading',{name:'Fact pins & world rules',exact:true}).waitFor();}
async function discardAttempt(action,accept){
  const count=dialogs.length;dialogDecision=accept?'accept':'dismiss';await action();
  for(let i=0;i<40&&dialogs.length===count;i++)await pause(20);
  assert.equal(dialogs.length,count+1,'Unsaved pins should ask before leaving.');
  assert.match(dialogs.at(-1).message,/unsaved fact pins and world rules/);dialogDecision='accept';
}
async function beforeUnloadBlocked(){return page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;});}
async function assertNoOverflow(label){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,label);}

try{
  const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));base=`http://127.0.0.1:${port}`;
  const connections=JSON.parse(readFileSync('config/connections.example.json','utf8'));
  // No live service is used. An accidental request must fail locally, without contacting a user's provider.
  connections.text={...connections.text,baseUrl:'http://127.0.0.1:1/v1',model:'',apiKey:''};
  connections.images={...connections.images,baseUrl:'http://127.0.0.1:1'};
  writeFileSync(join(config,'connections.play.local.json'),JSON.stringify(connections));
  await start(port);
  const sample=createSample();sample.title='Fact pins acceptance';
  story=await json('/api/import',{method:'POST',body:zipSync({'manifest.json':strToU8(JSON.stringify({format:'guided-story-dev-1',media:[]})),'story.json':strToU8(JSON.stringify(sample))})});
  const originalProse=structuredClone(story.passages),originalRecovery=structuredClone(story.recovery);
  browser=await chromium.launch({channel:'msedge',headless:true});page=await browser.newPage({viewport:{width:1280,height:1000}});page.setDefaultTimeout(18000);
  page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>{dialogs.push({message:dialog.message(),type:dialog.type()});return dialog[dialogDecision]();});
  await page.goto(base);await page.waitForLoadState('networkidle');await nav('Pins').click();
  assert.equal(await nav('Pins').getAttribute('aria-current'),'page');
  await panel().getByRole('heading',{name:'Fact pins & world rules',exact:true}).waitFor();
  assert.equal(await cards().count(),0);assert.equal(await pinsForm().getByRole('button',{name:'Save pins & rules',exact:true}).isDisabled(),true);

  const examples=[['character','elias','role'],['place','wayward','description'],['item','fob','ownerId'],['relationship','crew-trust','notes'],['thread','container','status'],['world',null,'cargoNotes']];
  for(const [index,[kind,id,field]]of examples.entries()){
    await addPin(kind,id,field);assert.equal(await cards().count(),index+1);
    assert.equal(await pinsForm().getByRole('button',{name:'Already pinned',exact:true}).isDisabled(),true);
    await savePins();assert.equal(story.factPins.fields.length,index+1);assert.equal(pinned(kind,id,field),true);
    await reopenPins();assert.equal(await cards().count(),index+1);
  }
  assert.deepEqual(story.passages,originalProse);assert.deepEqual(story.recovery,originalRecovery,'Changing pin configuration alone must keep the replacement baseline.');
  const ownerCard=()=>cards().filter({hasText:'Access fob · Owner / storage'});
  assert.equal(await ownerCard().locator('.pin-value').innerText(),'Elias Voss');
  await panel().getByText(/Appearance & outfit pins are also enabled for Elias Voss/).waitFor();
  console.log('PASS: Pins navigation, six saved field categories, duplicate prevention, current-value labels and config-only recovery preservation.');

  await pinsForm().getByRole('button',{name:'Add world rule',exact:true}).click();
  assert.equal(await pinsForm().getByRole('button',{name:'Save pins & rules',exact:true}).isDisabled(),true);
  await rule(1).fill('Travel between star systems takes at least a week.');await savePins();
  const worldRuleId=story.factPins.rules[0].id;assert.match(worldRuleId,/^[a-f\d-]{36}$/i);
  await reopenPins();assert.equal(await rule(1).inputValue(),'Travel between star systems takes at least a week.');
  await rule(1).fill('Travel between star systems takes at least two days.');await savePins();assert.equal(story.factPins.rules[0].id,worldRuleId);assert.match(story.factPins.rules[0].text,/two days/);
  await pinsForm().getByRole('button',{name:'Remove world rule 1',exact:true}).click();await savePins();assert.deepEqual(story.factPins.rules,[]);
  const keptRule='Ship clocks use standard shipboard time. '+ 'UnbrokenClockReference'.repeat(18);
  await pinsForm().getByRole('button',{name:'Add world rule',exact:true}).click();await rule(1).fill(keptRule);await savePins();

  await rule(1).fill('Unsaved rule for navigation QA.');assert.equal(await beforeUnloadBlocked(),true);
  await discardAttempt(()=>nav('Contents').click(),false);assert.equal(await rule(1).inputValue(),'Unsaved rule for navigation QA.');
  await pinsForm().getByRole('button',{name:'Reset changes',exact:true}).click();assert.equal(await rule(1).inputValue(),keptRule);assert.equal(await beforeUnloadBlocked(),false);
  await addPin('world',null,'funds');assert.equal(await cards().count(),7);
  await discardAttempt(()=>nav('Contents').click(),true);await nav('Pins').click();assert.equal(await cards().count(),6);assert.equal(pinned('world',null,'funds'),false);
  await page.reload();await page.waitForLoadState('networkidle');await nav('Pins').click();assert.equal(await rule(1).inputValue(),keptRule);assert.equal(await cards().count(),6);
  console.log('PASS: world-rule add/edit/remove/reopen, empty-rule validation, Reset and unsaved navigation/unload protection.');

  await nav('Records').click();await page.getByRole('group',{name:'Record sections'}).getByRole('button',{name:'Cast',exact:true}).click();await page.locator('.record-picker select').selectOption('elias');
  const characterForm=page.getByRole('form',{name:'character editor',exact:true});await characterForm.getByLabel('Role',{exact:true}).fill('Licensed trader QA');
  const manualSaved=page.waitForResponse(reply=>reply.url()===base+'/api/stories/'+story.id&&reply.request().method()==='PATCH');await characterForm.getByRole('button',{name:'Save record',exact:true}).click();assert.equal((await manualSaved).ok(),true);await page.getByText('Record saved.',{exact:true}).waitFor();story=await read();
  assert.equal(story.canon.characters.find(person=>person.id==='elias').role,'Licensed trader QA');assert.equal(pinned('character','elias','role'),true);
  await nav('Pins').click();assert.equal(await cards().filter({hasText:'Elias Voss · Role'}).locator('.pin-value').innerText(),'Licensed trader QA');
  assert.deepEqual(story.passages,originalProse);
  console.log('PASS: an explicit manual edit updates the value protected by an existing pin without changing prose.');

  // The normal page does not refresh the root story while Pins is mounted. Exercise the
  // real cross-tab race at the server boundary: a stale draft must remain unsaved.
  await rule(1).fill('Stale unsaved rule must not replace the newer configuration.');
  const concurrentPins=structuredClone(story.factPins);concurrentPins.fields.push({kind:'world',recordId:null,field:'funds'});
  const concurrent=await mutate(story,{type:'fact-pins',factPins:concurrentPins});assert.equal(concurrent.response.ok,true,JSON.stringify(concurrent.body));const externallySaved=concurrent.body;
  const staleReply=page.waitForResponse(reply=>reply.url()===base+'/api/stories/'+story.id&&reply.request().method()==='PATCH');await pinsForm().getByRole('button',{name:'Save pins & rules',exact:true}).click();assert.equal((await staleReply).status(),409);
  await page.getByRole('alert').filter({hasText:/This story changed in another tab/}).waitFor();assert.equal(await rule(1).inputValue(),'Stale unsaved rule must not replace the newer configuration.');assert.deepEqual(await read(),externallySaved);
  await discardAttempt(()=>page.getByRole('button',{name:'Reload saved story (discards unsaved fields)',exact:true}).click(),true);
  await nav('Pins').click();story=await read();assert.equal(await cards().count(),7);assert.equal(await rule(1).inputValue(),keptRule);assert.equal(pinned('world',null,'funds'),true);
  console.log('PASS: external concurrent pin changes reject stale saves, preserve the draft for review, and load only after an explicit discard/reload.');

  const beforeBlocked=await read();let result=await mutate(beforeBlocked,{type:'sample-continue',direction:''});
  assert.equal(result.response.ok,false);assert.match(result.body.error,/Pinned owner \/ storage for Access fob/);assert.deepEqual(await read(),beforeBlocked,'A rejected event must leave the complete story unchanged.');
  await pinsForm().getByRole('button',{name:'Unpin Access fob: Owner / storage',exact:true}).click();await savePins();assert.equal(pinned('item','fob','ownerId'),false);
  result=await mutate(story,{type:'sample-continue',direction:''});assert.equal(result.response.ok,true,JSON.stringify(result.body));story=result.body;
  assert.equal(story.passages.length,originalProse.length+1);assert.equal(story.canon.items.find(item=>item.id==='fob').ownerId,'ren');assert.equal(story.recovery.valid,true);
  await page.reload();await page.waitForLoadState('networkidle');await nav('Pins').click();await addPin('item','fob','ownerId');await savePins();
  assert.equal(await ownerCard().locator('.pin-value').innerText(),'Ren Calder');assert.equal(story.recovery.valid,true,'Adding a current pin should not erase the latest recovery baseline.');
  const beforeReplacement=await read();result=await mutate(beforeReplacement,{type:'sample-replace',passageId:beforeReplacement.passages.at(-1).id});
  assert.equal(result.response.ok,false);assert.match(result.body.error,/Pinned owner \/ storage for Access fob/);assert.deepEqual(await read(),beforeReplacement,'Replacement must honor current pins rather than a pre-event notebook.');
  console.log('PASS: pinned owner blocks an atomic sample trade; unpinning permits it; latest replacement honors a pin added after the trade.');

  await page.setViewportSize({width:320,height:884});
  for(const [kind,id,field]of examples){await selectPin(kind,id,field);await assertNoOverflow(kind+' pin picker fits 320px');}
  assert.equal(await rule(1).inputValue(),keptRule);await assertNoOverflow('All pinned cards and a long world rule fit 320px');
  mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/fact-pins-mobile.png',fullPage:true});
  const savedPins=structuredClone(story.factPins);await stop();await start(port);await page.goto(base);await page.waitForLoadState('networkidle');await nav('Pins').click();story=await read();
  assert.deepEqual(story.factPins,savedPins);assert.equal(await cards().count(),savedPins.fields.length);assert.equal(await rule(1).inputValue(),keptRule);await assertNoOverflow('Restarted pin configuration fits 320px');
  assert.deepEqual(errors,[]);console.log('PASS: 320px field/rule layout, restart durability and no browser exceptions. Only isolated temporary config and stories were used.');
}catch(error){mkdirSync('test-results',{recursive:true});await page?.screenshot({path:'test-results/fact-pins-failure.png',fullPage:true}).catch(()=>{});writeFileSync('test-results/fact-pins-failure.log',output);throw error;}
finally{await browser?.close();await stop();const target=resolve(folder);assert.ok(target.startsWith(resolve(tmpdir())+sep)&&basename(target).startsWith('storyweaver-fact-pins-'));rmSync(target,{recursive:true,force:true});}
