import {readFileSync,writeFileSync,mkdirSync,existsSync,unlinkSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {createSample} from '../src/lib/server/fixture.ts';
import {illustrationDraftSchema,subjectFromCharacter,resolveIllustration} from '../src/lib/illustration.ts';
import {suggestIllustration} from '../src/lib/server/story-illustrations.ts';
import {estimateInputTokens} from '../src/lib/server/token-budget.ts';

const root=resolve('test-results/model-defaults-live');
mkdirSync(resolve(root,'config'),{recursive:true});
process.env.STORY_CONFIG_DIR=resolve(root,'config');
process.env.STORY_DATA_DIR=resolve(root,'data');
process.env.STORY_INSTANCE='dev';
const settings=JSON.parse(readFileSync('config/connections.play.local.json','utf8'));
assert.ok(settings.text.model);
const configFile=resolve(root,'config/connections.dev.local.json');
writeFileSync(configFile,JSON.stringify(settings));
const story=createSample(),characters=story.canon.characters.slice(0,2);
const draft=illustrationDraftSchema.parse({framing:'scene',subjectIds:characters.map(c=>c.id),subjects:characters.map(c=>subjectFromCharacter(c,'scene')),passageId:story.passages.at(-1).id,style:'Painterly science-fiction illustration, muted colors.',scene:'',background:'',promptMode:'natural',template:'{{subjects}}',negative:''});
let calls=0,estimatedTokens,usage;
const fetcher=async(url,init)=>{
  calls++;
  const body=JSON.parse(String(init.body));
  estimatedTokens=estimateInputTokens(body.messages,body.response_format?.json_schema?.schema);
  const response=await fetch(url,init);
  usage=(await response.clone().json()).usage;
  return response;
};
const before=structuredClone(story),started=Date.now();
try {
const prepared=await suggestIllustration(story,draft,new AbortController().signal,fetcher);
assert.equal(calls,1);
assert.deepEqual(story,before);
assert.equal(prepared.subjects.length,2);
for(const subject of prepared.subjects)assert.deepEqual(subject.shot,draft.subjects.find(s=>s.id===subject.id).shot);
const prompt=resolveIllustration(story,prepared).text;
writeFileSync(resolve(root,'prepared.json'),JSON.stringify(prepared,null,2)+'\n');
writeFileSync(resolve(root,'prompt.txt'),prompt+'\n');
const result={calls,elapsedMs:Date.now()-started,estimatedTokens,usage,preparedSubjects:prepared.subjects.length,canonUnchanged:true,controlsPreserved:true};
writeFileSync(resolve(root,'validation.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));

} finally { if(existsSync(configFile))unlinkSync(configFile); }
