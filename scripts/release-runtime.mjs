import {createHash} from 'node:crypto';
import {existsSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join,relative} from 'node:path';
export function releaseInputs(root){
  const files=['package.json','package-lock.json','vite.config.ts','tsconfig.json','scripts/build.mjs','scripts/release-runtime.mjs','scripts/start.mjs'];
  function walk(folder){if(!existsSync(folder))return;for(const item of readdirSync(folder,{withFileTypes:true})){const path=join(folder,item.name);if(item.isDirectory())walk(path);else if(item.isFile())files.push(relative(root,path).replaceAll('\\','/'));}}
  for(const folder of ['src','static'])walk(join(root,folder));return files.sort();
}
export function releaseSignature(root){const hash=createHash('sha256');for(const file of releaseInputs(root)){hash.update(file+'\0');hash.update(readFileSync(join(root,file)));hash.update('\0');}return hash.digest('hex');}
export function buildIsCurrent(root){try{const stamp=JSON.parse(readFileSync(join(root,'build/.storyweaver-release.json'),'utf8'));return existsSync(join(root,'build/index.js'))&&stamp.signature===releaseSignature(root);}catch{return false;}}
export function stampBuild(root){const {version}=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));writeFileSync(join(root,'build/.storyweaver-release.json'),JSON.stringify({version,signature:releaseSignature(root),builtAt:new Date().toISOString()},null,2));}
