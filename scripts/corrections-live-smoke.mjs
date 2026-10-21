// Saved local text connection; synthetic story, corrections and diagnostics stay in a temporary library.
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,basename,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {zipSync,strToU8} from 'fflate';
import assert from 'node:assert/strict';
const folder=mkdtempSync(join(tmpdir(),'storyweaver-corrections-live-'));
process.env.STORY_DATA_DIR=folder;process.env.STORY_INSTANCE='play';
let repository,diagnostics;
try{
  const {getRepository}=await import('../src/lib/server/repository.ts');
  const {getDiagnostics,scrub}=await import('../src/lib/server/diagnostics.ts');
  const {readPrivateConnections}=await import('../src/lib/server/connections.ts');
  const {createSample}=await import('../src/lib/server/fixture.ts');
  const {normalizeCharacterProfile}=await import('../src/lib/character-profile.ts');
  const {generateCorrectionResult}=await import('../src/lib/server/story-corrections.ts');
  repository=getRepository();diagnostics=getDiagnostics();const settings=readPrivateConnections(),sample=createSample();
  assert.ok(settings.text.model.trim(),'Save a text model in the play instance first.');
  const elias=sample.canon.characters.find(c=>c.id==='elias');
  Object.assign(elias,normalizeCharacterProfile({...elias,pinnedAppearance:false,wardrobe:{upper_body:'Worn flight jacket over a charcoal shirt',lower_body:'Grey trousers',footwear:'Black boots',accessories:''},outfitNotes:''}));
  sample.canon.items.find(item=>item.id==='fob').ownerId='mira';
  const passage=sample.passages.at(-1);
  passage.paragraphs=['Elias took off his worn flight jacket, leaving his charcoal shirt on, and handed the jacket to Mira. In return, Mira handed him the access fob. She folded the jacket over her arm rather than putting it on. The trade was complete.'];
  let story=await repository.import(zipSync({'manifest.json':strToU8(JSON.stringify({format:'guided-story-dev-1',media:[]})),'story.json':strToU8(JSON.stringify(sample))}));
  const before=structuredClone(story),input={kind:'repair',expectedRevision:story.revision,requestId:randomUUID(),passageId:story.passages.at(-1).id,direction:'The completed trade in this passage was missed. Elias gave his worn flight jacket to Mira for the access fob. Add the jacket to Mira’s inventory (she is holding it, not wearing it), give the existing fob to Elias, and leave Elias wearing only his charcoal shirt on his upper body. Preserve all other clothes and facts.'};
  console.log('Checking a completed clothing trade with the saved local text model.');
  let started=Date.now();const proposal=await generateCorrectionResult(story,input,settings,AbortSignal.timeout(360000));
  assert.deepEqual(repository.read(story.id),before);
  repository.saveCorrectionResult(story.id,story.revision,input.requestId,'live-trade',proposal);
  story=repository.applyCorrection(story.id,{expectedRevision:story.revision,requestId:randomUUID(),resultId:proposal.id});
  const jacket=story.canon.items.find(item=>!before.canon.items.some(old=>old.id===item.id)&&/jacket/i.test(item.name));
  assert.ok(jacket,'The missing jacket must become an inventory record.');assert.equal(jacket.ownerId,'mira');assert.equal(jacket.equipped,false);
  assert.equal(story.canon.items.find(item=>item.id==='fob').ownerId,'elias');assert.equal(story.canon.items.find(item=>item.id==='fob').equipped,false);
  assert.match(story.canon.characters.find(c=>c.id==='elias').wardrobe.upper_body,/charcoal shirt/i);assert.doesNotMatch(story.canon.characters.find(c=>c.id==='elias').wardrobe.upper_body,/jacket/i);
  assert.deepEqual(story.canon.characters.find(c=>c.id==='mira'),before.canon.characters.find(c=>c.id==='mira'));assert.deepEqual(story.passages,before.passages);assert.deepEqual(story.media,before.media);
  const results=[{kind:'trade',durationMs:Date.now()-started,proposal}];
  const item=story.canon.items.find(i=>i.id==='fob'),next={kind:'record',recordKind:'item',mode:'revise',targetId:item.id,expectedRevision:story.revision,requestId:randomUUID(),passageId:story.passages.at(-1).id,direction:'Describe the fob as cobalt blue with a cracked corner. Keep its name, owner, quantity and equipped state exactly unchanged.'};
  console.log('Checking a directed in-story item edit with the saved local text model.');started=Date.now();
  const edit=await generateCorrectionResult(story,next,settings,AbortSignal.timeout(360000));assert.equal(edit.operations.length,1);
  repository.saveCorrectionResult(story.id,story.revision,next.requestId,'live-item',edit);
  const saved=repository.applyCorrection(story.id,{expectedRevision:story.revision,requestId:randomUUID(),resultId:edit.id}),updated=saved.canon.items.find(i=>i.id===item.id);
  assert.equal(updated.ownerId,item.ownerId);assert.equal(updated.quantity,item.quantity);assert.equal(updated.equipped,item.equipped);assert.equal(updated.name,item.name);assert.match(updated.description,/cobalt|blue/i);assert.match(updated.description,/crack/i);assert.deepEqual(saved.passages,before.passages);
  results.push({kind:'item-edit',durationMs:Date.now()-started,proposal:edit});mkdirSync('test-results',{recursive:true});writeFileSync('test-results/corrections-live.json',JSON.stringify(scrub({results}),null,2));
  console.log('PASS: real clothing trade repair and in-story item edit, reviewed atomic apply, unchanged prose and unrelated facts. Normal libraries and settings were untouched.');
}catch(error){mkdirSync('test-results',{recursive:true});writeFileSync('test-results/corrections-live-failure.json',JSON.stringify({error:error.message},null,2));throw error;}
finally{repository?.close();diagnostics?.close();const target=resolve(folder);assert.ok(target.startsWith(resolve(tmpdir())+sep)&&basename(target).startsWith('storyweaver-corrections-live-'));rmSync(target,{recursive:true,force:true});}
