// Standalone production launcher: no compiler, source checkout or development scripts required.
import {createServer} from 'node:http';
import {createServer as createProbe} from 'node:net';
import {execFile} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

if(Number(process.versions.node.split('.')[0])<24){console.error('Storyweaver needs Node.js 24 or newer.');process.exit(1);}
const root=fileURLToPath(new URL('../',import.meta.url)),port=Number(process.env.STORY_PORT||5175);
process.chdir(root);
if(!Number.isInteger(port)||port<1||port>65535){console.error('STORY_PORT must be a whole port number from 1 to 65535.');process.exit(1);}
const url=`http://127.0.0.1:${port}`,open=process.argv.includes('--open');
function openBrowser(){const command=process.platform==='win32'?'rundll32.exe':process.platform==='darwin'?'open':'xdg-open';execFile(command,process.platform==='win32'?['url.dll,FileProtocolHandler',url]:[url],{windowsHide:true},()=>{});}
const probe=createProbe();
probe.once('error',async()=>{
  try{
    const response=await fetch(url+'/api/app',{signal:AbortSignal.timeout(1200)}),app=response.ok?await response.json():null;
    if(app?.app==='storyweaver'&&app.instance==='play'){
      console.log(`Storyweaver ${app.version} is already running at ${url}/ (${app.runtime}).`);
      console.log('To run this extracted release instead, stop that instance first or choose another STORY_PORT.');
      if(open)openBrowser();return;
    }
  }catch{}
  console.error(`Port ${port} is already in use. Stop that program or choose another STORY_PORT. No saves were changed.`);process.exitCode=1;
});
probe.listen(port,'127.0.0.1',()=>probe.close(async()=>{
  if(!existsSync(resolve(root,'build/handler.js'))){console.error('The production build is missing. Extract the complete release ZIP again.');process.exitCode=1;return;}
  Object.assign(process.env,{STORY_PRODUCTION:'1',STORY_INSTANCE:'play',STORY_SEED_SAMPLE:'0',STORY_DATA_DIR:resolve(process.env.STORY_DATA_DIR||resolve(root,'data/play')),STORY_CONFIG_DIR:resolve(process.env.STORY_CONFIG_DIR||resolve(root,'config')),PROTOCOL_HEADER:'x-storyweaver-protocol',BODY_SIZE_LIMIT:'128M'});
  try{
    const {handler}=await import(pathToFileURL(resolve(root,'build/handler.js')).href);
    const server=createServer((request,response)=>{
      if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(request.headers.host)){response.writeHead(403).end('Open Storyweaver from its local address.');return;}
      request.headers['x-storyweaver-protocol']='http';handler(request,response);
    });
    await new Promise((ready,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',ready);});
    const {version}=JSON.parse(readFileSync(resolve(root,'package.json'),'utf8'));
    console.log(`Storyweaver ${version} · ${url}/ · production`);console.log(`Local saves: ${process.env.STORY_DATA_DIR}`);console.log('Keep this window open. Press Ctrl+C to stop.');
    const shutdown=()=>{server.close(()=>process.exit(0));server.closeIdleConnections();setTimeout(()=>{server.closeAllConnections();process.exit(0);},5000).unref();};
    process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
    if(open)openBrowser();
  }catch(e){console.error('Storyweaver could not start: '+e.message);console.error('Install dependencies with npm ci --omit=dev, or run Start Guided Story.bat. Your saves were kept.');process.exitCode=1;}
}));
