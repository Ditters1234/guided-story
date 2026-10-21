// node --import tsx scripts/director-live-smoke.mjs — real local model; normal saves/configuration untouched.
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,basename} from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {zipSync,strToU8} from 'fflate';
const folder=mkdtempSync(join(tmpdir(),'storyweaver-director-live-'));
process.env.STORY_DATA_DIR=folder;process.env.STORY_INSTANCE='play';
let repository,jobs,diagnostics;
try{
  const {getRepository}=await import('../src/lib/server/repository.ts');
  const {getJobs,jobFingerprint}=await import('../src/lib/server/jobs.ts');
  const {getDiagnostics}=await import('../src/lib/server/diagnostics.ts');
  const {readPrivateConnections}=await import('../src/lib/server/connections.ts');
  const {generatePassage}=await import('../src/lib/server/story-generation.ts');
  const {runEditor}=await import('../src/lib/server/story-editor.ts');
  const {runCompaction}=await import('../src/lib/server/memory-compaction.ts');
  const {createSample}=await import('../src/lib/server/fixture.ts');
  const {emptyContext}=await import('../src/lib/context-types.ts');
  const {countWords}=await import('../src/lib/story-length.ts');
  repository=getRepository();jobs=getJobs();diagnostics=getDiagnostics();const c=readPrivateConnections(),signal=AbortSignal.timeout(1200000);
  // Constrain JSON syntax for this isolated acceptance run; do not change the saved play preferences.
  c.text.structuredOutput='json';const config=join(folder,'config');mkdirSync(config);writeFileSync(join(config,'connections.play.local.json'),JSON.stringify(c));process.env.STORY_CONFIG_DIR=config;
  console.log('Using JSON-object output in a temporary copy of the saved connection.');
  let story,counts;
  const checkpoint=()=>{mkdirSync('test-results',{recursive:true});writeFileSync('test-results/director-live-checkpoint.json',JSON.stringify(story,null,2));};
  if(process.argv.includes('--resume')){
    const saved=JSON.parse(readFileSync('test-results/director-live-checkpoint.json','utf8'));
    story=await repository.import(zipSync({'manifest.json':strToU8(JSON.stringify({format:'guided-story-dev-1',media:[]})),'story.json':strToU8(JSON.stringify(saved))}));counts=story.passages.map(p=>countWords(p.paragraphs));
    console.log('Resuming '+counts.length+' previously generated, committed passages in an isolated library.');
  }else{
  const input={premise:'A rogue space trader and their small crew investigate a suspicious cargo delivery at a failing station. A character-driven science-fiction mystery with practical work, sharp but restrained dialogue and clear cause and effect.',castSize:3,preferences:{passageWords:350,chapterWords:1100},narrationStyle:'Past tense, third person limited. Elias masks worry with dry jokes; Mira is precise and practical; Ren deflects uncomfortable questions. Ground each viewpoint in what that person can observe. Avoid repeating the same mystery beat.',adultContent:false};
  let setup=repository.createSetup(input,randomUUID()),context=emptyContext();
  context.sceneBrief={purpose:'Open on a concrete problem with the sealed delivery while the ship is docked at Halcyon. Establish crew voices through immediate work, not a cast introduction.',tension:'Power outages and an incomplete delivery manifest.',stopAt:'A practical decision about checking the cargo externally.',viewpointId:'elias',locationId:'bridge',castIds:['elias','mira','ren'],clearAfterPassage:false};
  context.lore.push({id:'private-plan',title:'Hidden later reveal',text:'PRIVATE_TEST_ONLY: the container holds an impossible star seed. Do not reveal this plan yet.',visibility:'hidden',keywords:[],relatedIds:[]});
  setup=repository.saveSetup(setup.id,{expectedRevision:0,requestId:randomUUID(),input:setup.input,plan:{title:'The Unlisted Delivery',chapterTitle:'A quiet berth',canon:createSample().canon,context}});
  console.log('Writing a real opening and three directed continuations across two chapters.');
  const proposal=await generatePassage({setup},c,signal);story=repository.commitOpening(setup.id,setup.revision,randomUUID(),'director-live-opening',proposal);
  counts=[countWords(story.passages[0].paragraphs)];assert.ok(counts[0]>=210);console.log(`Opening saved: ${counts[0]} words.`);
  }
  checkpoint();
  async function passage(viewpointId,direction,chapterEnding){
    story=repository.mutate(story.id,{expectedRevision:story.revision,requestId:randomUUID(),action:{type:'scene-brief',brief:{purpose:direction,tension:'Practical choices under station pressure.',stopAt:chapterEnding==='close'?'A temporary chapter close, leaving the larger mystery open.':'A concrete new observation or practical next step.',viewpointId,locationId:null,castIds:[],clearAfterPassage:true}}});
    const source={story,mode:'continue',direction,chapterEnding};const p=await generatePassage(source,c,signal);const requestId=randomUUID();
    story=repository.commitGeneratedPassage(story.id,{expectedRevision:story.revision,requestId,proposal:p},jobFingerprint({direction,chapterEnding}));
    assert.equal(story.context.sceneBrief.purpose,'');counts.push(countWords(story.passages.at(-1).paragraphs));console.log(`Passage ${counts.length} saved: ${counts.at(-1)} words · viewpoint ${story.passages.at(-1).viewpoint}.`);checkpoint();
  }
  if(story.passages.length<2){await passage('mira','Elias hands his access fob to Mira before she leaves the bridge. Follow Mira walking from the bridge to the cargo hold and inspecting only the external power coupling of the sealed container. Establish a concrete observation she can report. Keep the container sealed; do not reveal its contents or resolve the delivery mystery.','keep-open');
  assert.equal(story.canon.items.find(i=>i.id==='fob').ownerId,'mira');assert.equal(story.canon.characters.find(p=>p.id==='mira').locationId,'hold');}
  if(story.passages.length<3)await passage('ren','Follow Ren on the bridge with Elias, responding to Mira’s actual report. Give Ren a distinct deflecting voice without inventing a confession or explaining the cargo’s contents. End this chapter after the crew decides to leave Halcyon and inspect their delivery records at the Glass Belt next; they have not departed yet.','close');
  assert.equal(story.passages[2].endOfChapter,true);
  console.log('Building the completed chapter memory.');story=await runCompaction(story,randomUUID(),signal);checkpoint();
  if(story.passages.length<4)await passage('mira','Begin chapter two in Mira’s viewpoint. The Wayward makes one ordinary jump from Halcyon to the Glass Belt and docks at its refuelling depot; establish that the Wayward is now at the Glass Belt. Keep all crew aboard the ship and the container sealed. Mira returns to the bridge with the access fob and compares their manifest against the route records. Develop a practical new lead without resolving the main mystery.','keep-open');
  assert.equal(story.passages.at(-1).chapter,2);let shipParent=story.canon.places.find(p=>p.id==='wayward').parentId;const visited=new Set();while(shipParent&&shipParent!=='glass'&&!visited.has(shipParent)){visited.add(shipParent);shipParent=story.canon.places.find(p=>p.id===shipParent)?.parentId;}assert.equal(shipParent,'glass');
  const before=JSON.stringify(story),question={expectedRevision:story.revision,requestId:randomUUID(),passageId:story.passages.at(-1).id,kind:'ask',text:'Who has the access fob now? Quote the written line where Elias handed it to Mira.'};
  console.log('Asking a grounded question without advancing the novel.');const answer=await runEditor(story.id,question,signal);assert.equal(answer.kind,'ask');assert.ok(answer.answer.includes('Mira'));assert.ok(answer.sources.some(s=>s.passageId===story.passages[1].id),'Ask must retrieve and cite the earlier handover, not only the current possession.');assert.equal(JSON.stringify(repository.read(story.id)),before);
  console.log('Drafting and reviewing wording for an earlier passage.');
  const preview=await runEditor(story.id,{expectedRevision:story.revision,requestId:randomUUID(),passageId:story.passages[0].id,kind:'polish',text:'Make a light copyedit. Improve the rhythm of only one or two unquoted narrative sentences; keep all other sentences, every dialogue line and every protected source quote exactly as written. Do not add details or change events.'},signal);
  assert.equal(preview.kind,'polish');assert.equal(JSON.stringify(repository.read(story.id)),before);
  const canon=JSON.stringify(story.canon),recovery=JSON.stringify(story.recovery);story=repository.acceptPolish(story.id,preview.id,story.revision,randomUUID());assert.equal(JSON.stringify(story.canon),canon);assert.equal(JSON.stringify(story.recovery),recovery);
  const copy=await repository.import(repository.export(story.id));assert.deepEqual(copy.passages,story.passages);assert.deepEqual(copy.canon,story.canon);
  mkdirSync('test-results',{recursive:true});writeFileSync('test-results/director-live.json',JSON.stringify({counts,story,answer,preview},null,2));
  writeFileSync('test-results/director-live.md',story.passages.map(p=>`## Chapter ${p.chapter}: ${p.chapterTitle}\n\n### ${p.title} — ${p.viewpoint}\n\n${p.paragraphs.join('\n\n')}`).join('\n\n')+`\n\n## Read-only answer\n\n${answer.answer}\n`);
  console.log('PASS: real two-chapter narration, three viewpoints, possession transfer, travel, one-shot briefs, grounded Ask, earlier wording preview/acceptance and archive. Normal play saves are untouched.');
}catch(e){mkdirSync('test-results',{recursive:true});writeFileSync('test-results/director-live-failure.json',JSON.stringify({error:e.message,traces:diagnostics?.traces(),jobs:jobs?.list()},null,2));throw e;}
finally{repository?.close();jobs?.close();diagnostics?.close();const target=resolve(folder);if(target.startsWith(resolve(tmpdir())+'\\')&&basename(target).startsWith('storyweaver-director-live-'))rmSync(target,{recursive:true,force:true});}
