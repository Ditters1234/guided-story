import {readFileSync,writeFileSync,readdirSync,mkdirSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {zipSync} from 'fflate';
import {buildIsCurrent} from './release-runtime.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
if(!buildIsCurrent(root))throw new Error('Run npm run build before packaging the current release.');
const {version}=JSON.parse(readFileSync(join(root,'package.json'),'utf8')),files={};
const roots=['src','static','scripts','tests','docs','licenses','AI','build'];
function include(path){const name=relative(root,path).replaceAll('\\','/');if(name.includes('.local.')||name.endsWith('.log'))throw new Error('Private/local files cannot enter a release: '+name);files['storyweaver/'+name]=new Uint8Array(readFileSync(path));}
function walk(folder){if(!existsSync(folder))return;for(const item of readdirSync(folder,{withFileTypes:true})){const path=join(folder,item.name);if(item.isDirectory())walk(path);else if(item.isFile())include(path);}}
for(const folder of roots)walk(join(root,folder));
for(const name of ['package.json','package-lock.json','vite.config.ts','tsconfig.json','README.md','THIRD_PARTY_NOTICES.md','Start Guided Story.bat','config/connections.example.json'])include(join(root,name));
mkdirSync(join(root,'dist'),{recursive:true});const name=`storyweaver-${version}.zip`,bytes=zipSync(files,{level:6});writeFileSync(join(root,'dist',name),bytes);writeFileSync(join(root,'dist',name+'.sha256'),createHash('sha256').update(bytes).digest('hex')+'  '+name+'\n');
console.log(`Created dist/${name} (${Object.keys(files).length} files, ${bytes.length.toLocaleString()} bytes). No local saves, settings, keys or reference checkouts included.`);
