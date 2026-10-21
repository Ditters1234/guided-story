// Verify the exact production ZIP using its own newly installed dependencies and temporary data.
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync,existsSync} from 'node:fs';
import {resolve,join,dirname,sep,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {unzipSync} from 'fflate';
import sharp from 'sharp';
import assert from 'node:assert/strict';

const root=resolve('.'),{version}=JSON.parse(readFileSync('package.json','utf8')),name=`storyweaver-${version}-production.zip`;
const bytes=readFileSync(join(root,'dist',name));assert.equal(createHash('sha256').update(bytes).digest('hex'),readFileSync(join(root,'dist',name+'.sha256'),'utf8').split(/\s/)[0]);
const files=unzipSync(bytes),secrets=[];
for(const file of ['config/connections.play.local.json','config/connections.dev.local.json','config/connections.local.json'])if(existsSync(file)){const key=JSON.parse(readFileSync(file,'utf8')).text?.apiKey;if(key?.length>=8)secrets.push(key);}
for(const [file,value]of Object.entries(files)){
  assert.ok(/^storyweaver\/(?:build\/(?:client|server)\/|build\/(?:index|handler|adapter-node)\.js$|scripts\/start-production\.mjs$|licenses\/[^/]+\.txt$|AI\/Comfy Workflow\/portrait\.comfy-desktop\.api\.json$|config\/connections\.example\.json$|package(?:-lock)?\.json$|README\.md$|THIRD_PARTY_NOTICES\.md$|Start Guided Story\.bat$)/.test(file),'Unexpected production path: '+file);
  assert.ok(!file.includes('..')&&!file.includes('\\')&&!file.includes('.local.')&&!/\.(?:map|sqlite|log|tmp)$/.test(file));
  for(const key of secrets)assert.ok(!Buffer.from(value).includes(key),'A private credential entered the production ZIP.');
}
const manifest=JSON.parse(new TextDecoder().decode(files['storyweaver/package.json']));assert.equal(manifest.devDependencies,undefined);assert.deepEqual(manifest.scripts,{start:'node scripts/start-production.mjs'});
const folder=mkdtempSync(join(tmpdir(),'storyweaver-production-package-')),app=join(folder,'storyweaver');let child,output='';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function run(command,args,cwd,options={}){return new Promise((resolveRun,reject)=>{let output='';const process=spawn(command,args,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe'],...options});for(const stream of[process.stdout,process.stderr])stream.on('data',chunk=>output=(output+chunk).slice(-16000));process.once('error',reject);process.once('exit',code=>resolveRun({code,output}));});}
async function stop(){if(!child||child.exitCode!==null)return;const current=child;child=undefined;const done=new Promise(r=>current.once('exit',r));current.kill('SIGKILL');await done;}
let base,port;
async function start(){
  output='';child=spawn(process.execPath,[join(app,'scripts/start-production.mjs')],{cwd:folder,windowsHide:true,env:{...process.env,STORY_PORT:String(port),STORY_DATA_DIR:join(app,'data/play'),STORY_CONFIG_DIR:join(app,'config')},stdio:['ignore','pipe','pipe']});
  for(const stream of[child.stdout,child.stderr])stream.on('data',chunk=>output=(output+chunk).slice(-20000));
  for(let n=0;n<150;n++){if(child.exitCode!==null)throw new Error(output);try{if((await fetch(base+'/api/app',{signal:AbortSignal.timeout(1200)})).ok)return;}catch{}await pause(200);}throw new Error('Production startup timed out: '+output);
}
async function json(path,init){const response=await fetch(base+path,{...init,headers:{...(init?.method?{Origin:base}:{}),...init?.headers},signal:AbortSignal.timeout(10000)}),body=await response.json();assert.equal(response.ok,true,JSON.stringify(body));return body;}
try{
  for(const [file,value]of Object.entries(files)){const target=resolve(folder,file);assert.ok(target.startsWith(resolve(folder)+sep));mkdirSync(dirname(target),{recursive:true});writeFileSync(target,value);}
  const npm=process.env.npm_execpath;assert.ok(npm&&existsSync(npm),'Run this through npm run release:production:verify.');
  console.log('Installing the packaged dependency manifest into the extracted folder (offline cache first).');
  let install=await run(process.execPath,[npm,'ci','--omit=dev','--offline','--no-audit','--no-fund'],app);
  if(install.code!==0&&install.output.includes('ENOTCACHED')){console.log('A dependency is not cached; fetching the locked packages.');install=await run(process.execPath,[npm,'ci','--omit=dev','--no-audit','--no-fund'],app);}
  assert.equal(install.code,0,install.output);console.log('PASS: production-only manifest and lock install with npm ci --omit=dev; no shared dependency junction.');
  if(process.platform==='win32'){
    const line=readFileSync(join(app,'Start Guided Story.bat'),'utf8').split(/\r?\n/).find(line=>line.startsWith('node -e '));const check=await run('cmd.exe',['/d','/s','/c',`"${line}"`],app,{windowsVerbatimArguments:true});assert.equal(check.code,0,check.output);
  }
  const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));port=probe.address().port;await new Promise(r=>probe.close(r));base=`http://127.0.0.1:${port}`;await start();
  assert.deepEqual(await json('/api/app'),{app:'storyweaver',version,instance:'play',runtime:'production'});assert.deepEqual(await json('/api/stories'),[]);assert.deepEqual(await json('/api/setups'),[]);
  const connections=await json('/api/connections');assert.equal(connections.text.hasApiKey,false);assert.equal(connections.text.model,'');
  const response=await fetch(base),html=await response.text();assert.equal(response.status,200);assert.ok(html.includes('No written stories yet'));assert.equal((await fetch(base+'/favicon.svg')).status,200);
  const assetPaths=[...html.matchAll(/(?:src|href)="([^"?]*_app[^"?]*\.(?:css|js))"/g)].map(m=>m[1]);assert.ok(assetPaths.length);for(const path of assetPaths)assert.equal((await fetch(new URL(path,base))).status,200,path);
  const workflows=await json('/api/workflows');assert.equal(workflows.length,1);assert.equal(workflows[0].path,connections.images.workflow);
  const refused=await fetch(base+'/api/stories',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://other-site.invalid'},body:'{}'});assert.equal(refused.status,403);assert.deepEqual(await json('/api/stories'),[]);
  console.log('PASS: empty library/setups, no saved key/model, production HTML/assets, supplied workflow and origin checks.');
  let story=await json('/api/stories',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'Temporary extracted-package check'})});
  const factPins={fields:[{kind:'item',recordId:'fob',field:'ownerId'}],rules:[{id:randomUUID(),text:'Travel between star systems takes at least a week.'}]};
  story=await json(`/api/stories/${story.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:story.revision,requestId:randomUUID(),action:{type:'fact-pins',factPins}})});assert.deepEqual(story.factPins,factPins);
  const pinnedTrade=await fetch(base+`/api/stories/${story.id}`,{method:'PATCH',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({expectedRevision:story.revision,requestId:randomUUID(),action:{type:'sample-continue',direction:''}})});assert.equal(pinnedTrade.status,400);assert.match((await pinnedTrade.json()).error,/Pinned owner/);assert.deepEqual(await json('/api/stories/'+story.id),story);
  const png=await sharp({create:{width:16,height:16,channels:3,background:'#45796c'}}).png().toBuffer(),form=new FormData();form.set('image',new File([png],'temporary.png',{type:'image/png'}));form.set('metadata',JSON.stringify({expectedRevision:story.revision,requestId:randomUUID(),caption:'Temporary package media check',category:'portrait',subjectIds:['elias'],passageId:null,parentId:null,status:'canonical'}));
  story=await json(`/api/stories/${story.id}/media`,{method:'POST',body:form});assert.equal(story.media.assets.length,1);
  const archive=await fetch(base+`/api/stories/${story.id}/export`),copy=await json('/api/import',{method:'POST',body:new Uint8Array(await archive.arrayBuffer())});assert.deepEqual(copy.media,story.media);assert.deepEqual(copy.factPins,factPins);
  await stop();await start();assert.equal((await json('/api/stories')).length,2);const reopened=await json('/api/stories/'+story.id);assert.deepEqual(reopened.media,story.media);assert.deepEqual(reopened.factPins,factPins);
  console.log('PASS: packaged fact pins/world rules reject a conflicting event atomically and survive archive import and restart.');
  console.log(`PASS: ${Object.keys(files).length} production files, SHA-256 and secret scan; native image processing, archive import/export and restart persistence with fresh installed dependencies. Normal libraries were untouched.`);
}finally{
  await stop();const target=resolve(folder);assert.ok(target.startsWith(resolve(tmpdir())+sep)&&basename(target).startsWith('storyweaver-production-package-'));rmSync(target,{recursive:true,force:true});
}
