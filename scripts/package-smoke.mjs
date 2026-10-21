// Verify the distributable and boot an extracted copy with the installed, lock-matched dependencies.
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync,symlinkSync,unlinkSync,existsSync} from 'node:fs';
import {resolve,join,dirname,sep,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {unzipSync} from 'fflate';
import assert from 'node:assert/strict';
const root=resolve('.'),{version}=JSON.parse(readFileSync('package.json','utf8')),name=`storyweaver-${version}.zip`;
const bytes=readFileSync(join(root,'dist',name)),expected=readFileSync(join(root,'dist',name+'.sha256'),'utf8').split(/\s/)[0];assert.equal(createHash('sha256').update(bytes).digest('hex'),expected);
const files=unzipSync(bytes),secrets=[];
for(const file of ['config/connections.play.local.json','config/connections.dev.local.json','config/connections.local.json'])if(existsSync(file)){const key=JSON.parse(readFileSync(file,'utf8')).text?.apiKey;if(key?.length>=8)secrets.push(key);}
for(const [file,value]of Object.entries(files)){
  assert.ok(/^storyweaver\/(?:src\/|static\/|scripts\/|tests\/|docs\/|licenses\/|AI\/|build\/|config\/connections\.example\.json$|package(?:-lock)?\.json$|vite\.config\.ts$|tsconfig\.json$|README\.md$|THIRD_PARTY_NOTICES\.md$|Start Guided Story\.bat$)/.test(file),'Unexpected release path: '+file);
  assert.ok(!file.includes('..')&&!file.includes('\\')&&!file.includes('.local.')&&!file.includes('/data/'));
  for(const key of secrets)assert.ok(!Buffer.from(value).includes(key),'A private API key entered the release.');
}
const folder=mkdtempSync(join(tmpdir(),'storyweaver-package-')),app=join(folder,'storyweaver'),dependencyLink=join(app,'node_modules');let child,output='';
try{
  for(const [file,value]of Object.entries(files)){const target=resolve(folder,file);assert.ok(target.startsWith(resolve(folder)+sep));mkdirSync(dirname(target),{recursive:true});writeFileSync(target,value);}
  symlinkSync(join(root,'node_modules'),dependencyLink,'junction');
  const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));const base=`http://127.0.0.1:${port}`;
  child=spawn(process.execPath,[join(app,'scripts/start.mjs'),'play','--production'],{cwd:app,windowsHide:true,env:{...process.env,STORY_PORT:String(port),STORY_DATA_DIR:join(app,'data/play'),STORY_CONFIG_DIR:join(app,'config')},stdio:['ignore','pipe','pipe']});
  for(const stream of[child.stdout,child.stderr])stream.on('data',c=>output=(output+c).slice(-20000));
  let ready=false;for(let n=0;n<150;n++){if(child.exitCode!==null)throw new Error(output);try{if((await fetch(base+'/api/app')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,200));}assert.ok(ready,output);
  assert.ok(!output.includes('Preparing the current'),'An extracted unchanged release must not rebuild.');
  const meta=await(await fetch(base+'/api/app')).json();assert.equal(meta.version,version);assert.equal(meta.runtime,'production');
  const connections=await(await fetch(base+'/api/connections')).json();assert.equal(connections.text.hasApiKey,false);assert.equal(connections.text.model,'');
  const response=await fetch(base),html=await response.text();assert.equal(response.status,200);assert.ok(html.includes('Storyweaver'));assert.equal((await fetch(base+'/favicon.svg')).status,200);
  const css=html.match(/href="([^"]+_app[^"?]*\.css)"/);if(css)assert.equal((await fetch(new URL(css[1],base))).status,200);
  console.log(`PASS: ${Object.keys(files).length} release files, SHA-256, excluded personal saves/settings/keys, and extracted production startup with a fresh library. Installed dependencies reused; normal libraries untouched.`);
}finally{
  if(child&&child.exitCode===null){const done=new Promise(r=>child.once('exit',r));child.kill('SIGKILL');await done;}
  // Unlink the test junction before deleting its temporary directory; never recurse into shared dependencies.
  if(existsSync(dependencyLink))unlinkSync(dependencyLink);
  const target=resolve(folder);assert.ok(target.startsWith(resolve(tmpdir())+sep)&&basename(target).startsWith('storyweaver-package-'));rmSync(target,{recursive:true,force:true});
}
