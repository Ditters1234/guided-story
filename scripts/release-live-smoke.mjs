// A longer real-service acceptance case. Uses temporary stores/configuration and a prior accepted four-passage test checkpoint.
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {join,resolve,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {zipSync,strToU8} from 'fflate';
import assert from 'node:assert/strict';
const folder=mkdtempSync(join(tmpdir(),'storyweaver-release-live-'));
process.env.STORY_INSTANCE='play';process.env.STORY_DATA_DIR=folder;
let r,jobs,diagnostics;
try{
  const {getRepository}=await import('../src/lib/server/repository.ts');
  const {getJobs}=await import('../src/lib/server/jobs.ts');
  const {getDiagnostics}=await import('../src/lib/server/diagnostics.ts');
  const {readPrivateConnections}=await import('../src/lib/server/connections.ts');
  const {generatePassage}=await import('../src/lib/server/story-generation.ts');
  const {runCompaction}=await import('../src/lib/server/memory-compaction.ts');
  const {runEditor}=await import('../src/lib/server/story-editor.ts');
  const {continuityQuestion}=await import('../src/lib/narrative-quality.ts');
  const {novelMarkdown}=await import('../src/lib/server/novel-export.ts');
  const {countWords}=await import('../src/lib/story-length.ts');
  r=getRepository();jobs=getJobs();diagnostics=getDiagnostics();const c=readPrivateConnections();c.text.structuredOutput='json';c.context.recentChapters=1;
  const config=join(folder,'config');mkdirSync(config);writeFileSync(join(config,'connections.play.local.json'),JSON.stringify(c));process.env.STORY_CONFIG_DIR=config;
  const resumed=process.argv.includes('--resume')&&existsSync('test-results/release-live-checkpoint.json');
  const saved=JSON.parse(readFileSync(resumed?'test-results/release-live-checkpoint.json':'test-results/director-live-checkpoint.json','utf8'));
  let story=await r.import(zipSync({'manifest.json':strToU8(JSON.stringify({format:'guided-story-dev-1',media:[]})),'story.json':strToU8(JSON.stringify(saved))}));
  const signal=AbortSignal.timeout(1200000),checkpoint=()=>{mkdirSync('test-results',{recursive:true});writeFileSync('test-results/release-live-checkpoint.json',JSON.stringify(story,null,2));};
  console.log(`Starting with ${story.passages.length} accepted checkpoint passages in a temporary library.`);
  async function passage(viewpointId,direction,chapterEnding){
    story=r.mutate(story.id,{expectedRevision:story.revision,requestId:randomUUID(),action:{type:'scene-brief',brief:{...story.context.sceneBrief,purpose:direction,viewpointId,scope:'next-passage',clearAfterPassage:true}}});
    const proposal=await generatePassage({story,mode:'continue',direction,chapterEnding},c,signal);story=r.commitGeneratedPassage(story.id,{expectedRevision:story.revision,requestId:randomUUID(),proposal});
    assert.equal(story.context.sceneBrief.purpose,'');checkpoint();console.log(`Saved passage ${story.passages.length}: ${countWords(story.passages.at(-1).paragraphs)} words · ${story.passages.at(-1).viewpoint}.`);
  }
  if(story.passages.length<5){await passage('mira','While docked at the Glass Belt depot, follow Mira on the bridge. She physically hands the access fob to Ren so he can check the depot terminal, then she walks down to the cargo hold and checks only the exterior power coupling. Develop a practical crew conversation and one new observation, keeping the container sealed and its contents unknown. No confession or hidden reveal.','keep-open');assert.equal(story.canon.items.find(i=>i.id==='fob').ownerId,'ren');assert.equal(story.canon.characters.find(c=>c.id==='mira').locationId,'hold');}
  if(story.passages.length<6)await passage('ren','Continue from Ren’s viewpoint at the Glass Belt depot. Keep Ren aboard the Wayward with the fob. He explicitly voices an unproven suspicion that someone sabotaged the cargo manifest. Mira’s report gives no proof of sabotage; nobody confirms who did it or what the container holds. End chapter two with a practical decision to return to Halcyon to question the broker, without departing yet. Avoid repeating gestures or images from the previous passages.','close');
  if(story.passages.length<7){await passage('elias','Begin chapter three in Elias’s viewpoint. Ren physically hands the access fob back to Elias before the Wayward leaves the Glass Belt, makes an ordinary jump and docks at Halcyon. Keep all crew aboard and preserve their internal room locations unless they visibly move rooms. The container stays sealed in the hold; its contents are unknown. Develop dialogue and a practical plan to contact the broker without inventing an answer.','keep-open');assert.equal(story.canon.items.find(i=>i.id==='fob').ownerId,'elias');}
  if(story.passages.length<8){const before=story.canon.funds;await passage('mira','Close this chapter from Mira’s viewpoint after a concrete small step: Elias explicitly pays 12 credits from the shared ship funds for the Halcyon docking fee, completed on-page. Mira compares the broker’s delivery appointment against the actual route log and identifies a scheduling discrepancy they can ask about later. Keep all crew aboard, Elias holding the fob, the cargo sealed and its contents unknown. Ren’s earlier suspicion of sabotage remains unproven. Do not resolve the mystery.','close');assert.equal(story.canon.funds,before-12);}
  let replacement=null;
  if(process.argv.includes('--revise-latest')){
    const originalFunds=story.canon.funds,baselineFunds=story.recovery.canon.funds,direction='Replace this installment in Mira’s viewpoint. All three crew members MUST remain aboard the Wayward through the final sentence: nobody departs, reaches the station or leaves via an airlock. Elias completes the 12-credit docking-fee payment on-page. Mira compares two dispatch records: the promised pickup is 09:00 and the recorded pickup is 10:00, exactly one hour later. She shares this one-hour discrepancy with Elias and Ren. End with the crew deciding to call Vane later, still aboard. Keep Elias holding the fob and the container sealed; its contents and Ren’s sabotage suspicion remain unproven. Do not repeat the previous ending or add a departure.';
    story=r.mutate(story.id,{expectedRevision:story.revision,requestId:randomUUID(),action:{type:'scene-brief',brief:{...story.context.sceneBrief,purpose:direction,viewpointId:'mira',stopAt:'All three crew members still aboard, with a plan for a later conversation.',scope:'next-passage',clearAfterPassage:true}}});
    const proposal=await generatePassage({story,mode:'replace',direction,chapterEnding:'close'},c,signal);story=r.commitGeneratedPassage(story.id,{expectedRevision:story.revision,requestId:randomUUID(),proposal});
    assert.equal(story.canon.funds,baselineFunds-12);assert.equal(story.canon.funds,originalFunds);assert.equal(story.passages.length,8);
    for(const person of story.canon.characters){let location=person.locationId,seen=new Set();while(location&&location!=='wayward'&&!seen.has(location)){seen.add(location);location=story.canon.places.find(p=>p.id===location)?.parentId;}assert.equal(location,'wayward',person.name+' must remain aboard.');}
    replacement={originalFunds,baselineFunds,acceptedFunds:story.canon.funds,crewStayedAboard:true};checkpoint();console.log('Latest passage replaced: fee restored/reapplied once and all crew remained aboard.');
  }
  console.log('Building chapter memories and an earlier-book overview.');story=await runCompaction(story,randomUUID(),signal);checkpoint();assert.ok(story.context.compaction.book);
  const before=JSON.stringify(story),ask=async text=>runEditor(story.id,{expectedRevision:story.revision,requestId:randomUUID(),passageId:story.passages.at(-1).id,kind:'ask',text},signal);
  console.log('Checking old handover recall, present ownership, uncertainty and advisory review.');
  const answer=await ask(`Who has the access fob now? Cite its first handover in ${JSON.stringify(story.passages[1].title)} and explain any later changes. Use the current canonical owner for the present.`);
  assert.ok(/Elias/i.test(answer.answer));assert.ok(answer.sources.some(s=>s.passageId===story.passages[1].id),'The answer must retrieve the first historical handover.');
  const unknown=await ask('Do we know the actual contents of the sealed container or that sabotage occurred? Distinguish observations and suspicions from established facts.');
  assert.ok(unknown.uncertain||/unknown|unproven|not confirmed|unconfirmed|not established|not know/i.test(unknown.answer));
  const review=await ask(continuityQuestion(story,story.passages.at(-1).id));assert.equal(JSON.stringify(r.read(story.id)),before);
  story=r.mutate(story.id,{expectedRevision:story.revision,requestId:randomUUID(),action:{type:'record-save',edit:{kind:'item',value:{...story.canon.items.find(i=>i.id==='fob'),description:'A manually corrected access credential; still held by Elias.'}}}});
  assert.equal(story.recovery.valid,false);const copy=await r.import(r.export(story.id));assert.deepEqual(copy.canon,story.canon);assert.deepEqual(copy.passages,story.passages);
  const counts=story.passages.map(p=>countWords(p.paragraphs));writeFileSync('test-results/release-live.json',JSON.stringify({counts,story,answer,unknown,review,replacement},null,2));writeFileSync('test-results/release-live.md',novelMarkdown(story));
  assert.ok(diagnostics.traces().every(t=>!JSON.stringify(t.request).includes('PRIVATE_TEST_ONLY')));
  console.log(`PASS: ${counts.length} passages / ${story.passages.at(-1).chapter} chapters / ${counts.reduce((a,b)=>a+b,0)} words, possession changes, funds, layered memory, grounded questions, read-only review, correction and ZIP. Normal saves and settings were untouched.`);
}catch(e){mkdirSync('test-results',{recursive:true});writeFileSync('test-results/release-live-failure.json',JSON.stringify({error:e.message,traces:diagnostics?.traces(),jobs:jobs?.list()},null,2));throw e;}
finally{r?.close();jobs?.close();diagnostics?.close();const target=resolve(folder);assert.ok(target.startsWith(resolve(tmpdir())+'\\')&&basename(target).startsWith('storyweaver-release-live-'));rmSync(target,{recursive:true,force:true});}
