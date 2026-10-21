// Isolated production browser acceptance for author-side Lore diagnostics. Build first.
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
const require=createRequire(import.meta.url),{chromium}=require('C:/Users/n_tin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const folder=mkdtempSync(join(tmpdir(),'storyweaver-lore-dev-')),config=join(folder,'config'),data=join(folder,'data');mkdirSync(config);mkdirSync(data);
let child,browser,base,output='';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function api(path,init){const response=await fetch(base+path,{...init,headers:{...(init?.method?{Origin:base}:{}),...init?.headers},signal:AbortSignal.timeout(10000)}),body=await response.json();assert.equal(response.ok,true,JSON.stringify(body));return body;}
const send=(path,body)=>api(path,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
async function stop(){if(!child||child.exitCode!==null)return;const done=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await done;}
try{
  const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));base=`http://127.0.0.1:${port}`;
  const connections=JSON.parse(readFileSync('config/connections.example.json','utf8'));connections.text={...connections.text,baseUrl:'http://127.0.0.1:1/v1',model:'qa-lore-no-model-calls',contextTokens:32000,maxTokens:4096};writeFileSync(join(config,'connections.play.local.json'),JSON.stringify(connections));
  child=spawn(process.execPath,['scripts/start-production.mjs'],{windowsHide:true,env:{...process.env,STORY_PORT:String(port),STORY_DATA_DIR:data,STORY_CONFIG_DIR:config,STORY_SEED_SAMPLE:'0'},stdio:['ignore','pipe','pipe']});for(const stream of[child.stdout,child.stderr])stream.on('data',chunk=>output=(output+chunk).slice(-14000));
  for(let n=0;n<120;n++){if(child.exitCode!==null)throw new Error(output);try{if((await fetch(base+'/api/stories')).ok)break;}catch{}if(n===119)throw new Error(output);await pause(200);}
  const sample=createSample();sample.title='Lore diagnostics QA';
  sample.canon.items.push({id:'treat-tin',name:'Treat Tin',description:'A small tin.',quantity:1,ownerId:'elias',equipped:false,isContainer:true},{id:'sugar-cubes',name:'Sugar Cubes',description:'Pony treats.',quantity:1,ownerId:'treat-tin',equipped:false,unlimited:true});
  sample.context.lore=[
    {id:'world',title:'World foundations',text:'Crews trade between independent stations.',keywords:[],relatedIds:[],visibility:'always'},
    {id:'treat-routine',title:'Treat routine',text:'Treat Tin contains Sugar Cubes; 2 cubes are usually offered, not already consumed.',keywords:['treats','feeding'],relatedIds:['treat-tin','sugar-cubes'],visibility:'relevant'},
    {id:'treat-duplicate',title:'Treat routine!',text:'An optional custom around giving treats.',keywords:['treats'],relatedIds:[],visibility:'relevant'},
    {id:'private',title:'A private route',text:'HIDDEN-LORE-SENTINEL: a secret door lies behind the panel.',keywords:['door'],relatedIds:['bridge'],visibility:'hidden'}
  ];
  let story=await api('/api/import',{method:'POST',body:zipSync({'manifest.json':strToU8(JSON.stringify({format:'guided-story-dev-1',media:[]})),'story.json':strToU8(JSON.stringify(sample))})});
  browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base);await page.waitForLoadState('networkidle');
  await page.getByRole('navigation',{name:'Story navigation'}).getByRole('button',{name:'Dev',exact:true}).click();
  const tabs=page.getByRole('group',{name:'Developer sections'});await tabs.getByRole('button',{name:'Lore',exact:true}).click();
  const panel=page.getByRole('region',{name:'Lore developer tools',exact:true});await panel.getByRole('heading',{name:'Background & lore diagnostics',exact:true}).waitFor();
  await panel.getByText('Treat routine',{exact:true}).click();
  await panel.getByRole('region',{name:'Current links for Treat routine',exact:true}).getByText(/Always available supply/).waitFor();
  await panel.getByText(/after case, spacing and punctuation normalization/).waitFor();
  await panel.getByText(/this does not establish a contradiction/).waitFor();
  await page.getByLabel('Lore context preview direction',{exact:true}).fill('Elias uses Sugar Cubes from Treat Tin.');
  const previewResponse=page.waitForResponse(response=>response.url().endsWith('/api/dev/context')&&response.request().method()==='POST');await page.getByRole('button',{name:'Preview lore selection',exact:true}).click();const report=await(await previewResponse).json();
  assert.equal(report.sources.find(source=>source.id==='treat-routine').included,true);assert.equal(JSON.stringify(report.messages).includes('HIDDEN-LORE-SENTINEL'),false);
  await panel.getByRole('region',{name:'Selection for Treat routine',exact:true}).getByRole('heading',{name:'Included in preview',exact:true}).waitFor();
  await panel.getByLabel(/^Visibility/).selectOption('hidden');await panel.getByText('A private route',{exact:true}).click();assert.equal(await panel.getByLabel('Background text',{exact:true}).inputValue(),sample.context.lore[3].text);
  await panel.getByRole('region',{name:'Selection for A private route',exact:true}).getByRole('heading',{name:'Excluded from preview',exact:true}).waitFor();
  await panel.getByLabel(/^Visibility/).selectOption('all');await panel.getByLabel('Search lore',{exact:true}).fill('treat-routine');await panel.getByText('Treat routine',{exact:true}).click();
  await panel.getByLabel(/^Preview selection/).selectOption('included');
  await panel.getByLabel('Background text',{exact:true}).fill('Offering a treat is an optional quiet routine.');
  assert.equal(await panel.getByLabel(/^Preview selection/).inputValue(),'all');assert.equal(await panel.getByLabel('Background text',{exact:true}).inputValue(),'Offering a treat is an optional quiet routine.');
  await panel.getByLabel(/^Keywords/).fill('treats, quiet');await panel.getByLabel(/^Related records/).selectOption(['sugar-cubes','elias']);
  let dismissed=false;page.once('dialog',async dialog=>{dismissed=true;await dialog.dismiss();});await tabs.getByRole('button',{name:'Memory',exact:true}).click();assert.equal(dismissed,true);
  const before=await api('/api/stories/'+story.id);const savedResponse=page.waitForResponse(response=>response.url().endsWith('/api/stories/'+story.id)&&response.request().method()==='PATCH');await panel.getByRole('button',{name:'Save background edits',exact:true}).click();assert.equal((await savedResponse).ok(),true);await panel.getByText(/Background saved/).waitFor();story=await api('/api/stories/'+story.id);
  assert.equal(story.context.lore.find(entry=>entry.id==='treat-routine').text,'Offering a treat is an optional quiet routine.');assert.deepEqual(story.canon,before.canon);assert.deepEqual(story.passages,before.passages);assert.deepEqual(story.context.knowledge,before.context.knowledge);assert.deepEqual(story.context.memories,before.context.memories);
  await panel.getByText('Treat routine',{exact:true}).click();await panel.getByLabel('Background text',{exact:true}).fill('Unsaved wording to preserve during reload.');
  await send('/api/stories/'+story.id,{expectedRevision:story.revision,requestId:randomUUID(),action:{type:'world',funds:story.canon.funds+1,cargoNotes:story.canon.cargoNotes}});
  await page.getByRole('button',{name:'Load latest saved story',exact:true}).click();await panel.getByRole('alert').filter({hasText:'The saved story changed'}).waitFor();assert.equal(await panel.getByLabel('Background text',{exact:true}).inputValue(),'Unsaved wording to preserve during reload.');assert.equal(await panel.getByRole('button',{name:'Save background edits',exact:true}).isDisabled(),true);
  await panel.getByRole('button',{name:'Reset to latest saved lore',exact:true}).click();await panel.getByText('Treat routine',{exact:true}).click();assert.equal(await panel.getByLabel('Background text',{exact:true}).inputValue(),'Offering a treat is an optional quiet routine.');
  await page.setViewportSize({width:320,height:884});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);assert.equal((await api('/api/dev/jobs')).jobs.length,0);
  console.log('PASS: Dev Lore paths/supply mode, duplicate/heuristic flags, actual selection and hidden exclusion, filters, linked editing/save, stale reload preserving draft, tab guard and mobile layout; zero model calls.');
}finally{await browser?.close();await stop();const target=resolve(folder);assert.ok(target.startsWith(resolve(tmpdir())+sep)&&basename(target).startsWith('storyweaver-lore-dev-'));rmSync(target,{recursive:true,force:true});}
