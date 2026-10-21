import {spawn,execFile} from 'node:child_process';
import {createServer} from 'node:net';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createServer as createHttpServer} from 'node:http';
import {buildIsCurrent} from './release-runtime.mjs';

if(Number(process.versions.node.split('.')[0])<24){console.error('Storyweaver needs Node.js 24 or newer.');process.exit(1);}
const mode=process.argv[2]==='play'?'play':'dev',production=process.argv.includes('--production'),open=process.argv.includes('--open');
const port=Number(process.env.STORY_PORT||(mode==='play'?5175:5173));
if(!Number.isInteger(port)||port<1||port>65535){console.error('STORY_PORT must be a whole port number from 1 to 65535.');process.exit(1);}
const root=fileURLToPath(new URL('../',import.meta.url)),url=`http://127.0.0.1:${port}`;
function openBrowser(){const command=process.platform==='win32'?'rundll32.exe':process.platform==='darwin'?'open':'xdg-open';const args=process.platform==='win32'?['url.dll,FileProtocolHandler',url]:[url];execFile(command,args,{windowsHide:true},()=>{});}
async function identify(){try{const response=await fetch(url+'/api/app',{signal:AbortSignal.timeout(1200)});return response.ok?await response.json():null;}catch{return null;}}
const probe=createServer();
probe.once('error',async()=>{
  const app=await identify();
  if(app?.app==='storyweaver'&&app.instance===mode){console.log(`Storyweaver ${app.version} is already running at ${url}/ (${app.runtime}).`);if(open)openBrowser();return;}
  console.error(`Port ${port} is already in use. Stop that program or choose a different STORY_PORT. No saves were changed.`);process.exitCode=1;
});
probe.listen(port,'127.0.0.1',()=>probe.close(async()=>{
  if(production&&!buildIsCurrent(root)){
    console.log('Preparing the current Storyweaver release…');
    const code=await new Promise(resolveCode=>{const builder=spawn(process.execPath,[resolve(root,'scripts/build.mjs')],{cwd:root,env:process.env,stdio:'inherit',windowsHide:true});builder.once('error',()=>resolveCode(1));builder.once('exit',code=>resolveCode(code??1));});
    if(code!==0){console.error('The build failed. Existing saves were kept.');process.exitCode=1;return;}
  }
  const env={...process.env,STORY_DATA_DIR:process.env.STORY_DATA_DIR||resolve(root,'data',mode),STORY_INSTANCE:mode,...(production?{STORY_PRODUCTION:'1',PROTOCOL_HEADER:'x-storyweaver-protocol',BODY_SIZE_LIMIT:'128M'}:{})};
  const args=production?[resolve(root,'build/index.js')]:[resolve(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port',String(port),'--strictPort'];
  console.log(`Storyweaver ${mode} · ${url}/ · ${production?'production':'development'}`);console.log(`Local saves: ${env.STORY_DATA_DIR}`);
  if(production){
    Object.assign(process.env,env);
    try{
      const {handler}=await import(pathToFileURL(resolve(root,'build/handler.js')).href);
      const server=createHttpServer((request,response)=>{
        if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(request.headers.host)){response.writeHead(403).end('Open Storyweaver from its local address.');return;}
        // Adapter 6 infers HTTPS without a protocol header. This loopback server always serves HTTP.
        request.headers['x-storyweaver-protocol']='http';handler(request,response);
      });
      await new Promise((ready,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',ready);});
      console.log(`Listening on ${url}`);
      const shutdown=()=>{server.close(()=>process.exit(0));server.closeIdleConnections();setTimeout(()=>{server.closeAllConnections();process.exit(0);},5000).unref();};
      process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
      if(open)openBrowser();
    }
    catch(e){console.error('Storyweaver could not start: '+e.message);process.exitCode=1;}
    return;
  }
  const child=spawn(process.execPath,args,{cwd:root,env,stdio:'inherit',windowsHide:true});
  child.once('error',e=>{console.error(e.message);process.exitCode=1;});child.once('exit',code=>{process.exitCode=code??0;});
  process.on('SIGINT',()=>child.kill('SIGINT'));process.on('SIGTERM',()=>child.kill('SIGTERM'));
  if(open){for(let attempt=0;attempt<80&&child.exitCode===null;attempt++){if((await identify())?.app==='storyweaver'){openBrowser();break;}await new Promise(r=>setTimeout(r,150));}}
}));
