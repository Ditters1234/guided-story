import {readFileSync,writeFileSync,readdirSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {zipSync,strToU8} from 'fflate';
import {buildIsCurrent} from './release-runtime.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
if(!buildIsCurrent(root))throw new Error('Run npm run build before packaging the current production release.');
const source=JSON.parse(readFileSync(join(root,'package.json'),'utf8')),files={};
function include(from,to=from){
  if(to.includes('.local.')||/\.(?:map|sqlite|log|tmp)$/.test(to))throw new Error('Non-production file: '+to);
  let bytes=readFileSync(join(root,from));
  if(to.endsWith('.js'))bytes=Buffer.from(bytes.toString('utf8').replace(/^\/\/# sourceMappingURL=.*(?:\r?\n|$)/gm,''));
  files['storyweaver/'+to]=new Uint8Array(bytes);
}
function walk(folder){for(const entry of readdirSync(join(root,folder),{withFileTypes:true})){if(entry.name.startsWith('.')||entry.name.endsWith('.map'))continue;const path=join(folder,entry.name);if(entry.isDirectory())walk(path);else if(entry.isFile())include(relative(root,join(root,path)).replaceAll('\\','/'));}}
walk('build');walk('licenses');
for(const path of ['scripts/start-production.mjs','config/connections.example.json','AI/Comfy Workflow/portrait.comfy-desktop.api.json'])include(path);
include('scripts/production/Start Guided Story.bat','Start Guided Story.bat');include('scripts/production/README.md','README.md');
const notice=readFileSync(join(root,'THIRD_PARTY_NOTICES.md'),'utf8');
files['storyweaver/THIRD_PARTY_NOTICES.md']=strToU8('# Third-party notices\n\nPhotoSwipe: MIT, see [license](licenses/PhotoSwipe.txt). Sharp: Apache 2.0, see [license](licenses/Sharp.txt). Native dependency licenses are supplied by their installed npm packages.\n\nThis application includes code adapted from [Corvus Story Core](https://github.com/JustLateNightAI/Corvus-Story-Core), revision 8e5e7345eb349581febfd9d73bd45d4edea59717. Its license follows. Other runtime dependencies retain their licenses in node_modules after installation.\n\n'+notice.slice(notice.indexOf('MIT License')));
const manifest={name:'storyweaver',version:source.version,private:true,type:'module',engines:source.engines,scripts:{start:'node scripts/start-production.mjs'},dependencies:source.dependencies};
const lock=JSON.parse(readFileSync(join(root,'package-lock.json'),'utf8'));lock.name=manifest.name;lock.version=manifest.version;lock.packages['']={name:manifest.name,version:manifest.version,dependencies:manifest.dependencies,engines:manifest.engines};
// Keep the resolved runtime/peer/optional graph; discard entries belonging only to development tools.
for(const [path,entry]of Object.entries(lock.packages))if(path&&(entry.dev||entry.devOptional))delete lock.packages[path];
files['storyweaver/package.json']=strToU8(JSON.stringify(manifest,null,2)+'\n');files['storyweaver/package-lock.json']=strToU8(JSON.stringify(lock,null,2)+'\n');
const config=JSON.parse(readFileSync(join(root,'config/connections.example.json'),'utf8'));if(config.text.apiKey||config.text.model)throw new Error('Production defaults must have no API key or selected model.');
mkdirSync(join(root,'dist'),{recursive:true});const name=`storyweaver-${manifest.version}-production.zip`,bytes=zipSync(files,{level:6});
writeFileSync(join(root,'dist',name),bytes);writeFileSync(join(root,'dist',name+'.sha256'),createHash('sha256').update(bytes).digest('hex')+'  '+name+'\n');
console.log(`Created dist/${name}: ${Object.keys(files).length} files, ${bytes.length.toLocaleString()} bytes. Production runtime only; no saved data, credentials, source maps, source checkout, tests or references.`);
