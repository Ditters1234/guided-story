// Real saved local connections; all setup, story, diagnostics and image data are isolated.
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,basename} from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const folder=mkdtempSync(join(tmpdir(),'storyweaver-character-alignment-'));
process.env.STORY_DATA_DIR=folder;process.env.STORY_INSTANCE='play';
let r,jobs,diagnostics;
try{
  const {getRepository}=await import('../src/lib/server/repository.ts');
  const {getJobs}=await import('../src/lib/server/jobs.ts');
  const {getDiagnostics}=await import('../src/lib/server/diagnostics.ts');
  const {readPrivateConnections}=await import('../src/lib/server/connections.ts');
  const {generateSetup,generatePassage}=await import('../src/lib/server/story-generation.ts');
  const {normalizeCharacterProfile}=await import('../src/lib/character-profile.ts');
  const {illustrationDraftSchema,subjectFromCharacter,resolveIllustration}=await import('../src/lib/illustration.ts');
  const {startIllustration,acceptIllustration}=await import('../src/lib/server/story-illustrations.ts');
  const {readStoryImage,completedStoryImage}=await import('../src/lib/server/image-tests.ts');
  r=getRepository();jobs=getJobs();diagnostics=getDiagnostics();const c=readPrivateConnections(),signal=AbortSignal.timeout(900000);
  let draft=r.createSetup({premise:'A quiet science-fantasy adventure about two adult crewmates aboard a small trading ship. Aster is an elf archivist, actual age 300, apparent age 30, nonbinary, androgynous presentation, green eyes, silver hair. Aster wears a blue linen coat, grey trousers, red leather boots and a silver brooch. Bram is a human male engineer, age 40, with brown eyes and short dark hair, wearing olive work coveralls and practical black boots. Give both distinct voices and motives. Their opening is a calm discussion about an unsigned delivery manifest on the ship bridge; no danger, injuries, wardrobe change or hidden revelation. Fully clothed and nonsexual.',castSize:2,artStyle:'Photorealistic photography, natural skin texture, neutral color grading',preferences:{passageWords:150}},randomUUID());
  console.log('Generating two structured character profiles with the saved local LLM.');
  const plan=await generateSetup(draft,c,signal);draft=r.commitGeneratedSetup(draft.id,draft.revision,randomUUID(),'alignment-setup',plan);
  assert.ok(plan.canon.characters.every(p=>p.visual&&p.persona?.voice.trim()&&p.wardrobe?.upper_body.trim()));
  const lead=plan.canon.characters.find(p=>/aster/i.test(p.name))||plan.canon.characters[0];
  assert.match(lead.visual.age,/300|three hundred|three centuries/i);assert.match(lead.visual.apparentAge,/30|thirty/i);
  console.log('Structured setup validated. Generating an opening and its evidenced state extraction.');
  const proposal=await generatePassage({setup:draft},c,signal);
  let story=r.commitOpening(draft.id,draft.revision,randomUUID(),'alignment-opening',proposal),person=story.canon.characters.find(p=>p.id===lead.id);
  assert.ok(person);assert.deepEqual(person.visual,lead.visual);assert.deepEqual(person.wardrobe,lead.wardrobe);assert.deepEqual(normalizeCharacterProfile(person),person);
  const shot=illustrationDraftSchema.parse({framing:'portrait',promptMode:'natural',subjectIds:[person.id],subjects:[subjectFromCharacter(person,'portrait')],passageId:story.passages[0].id,style:draft.input.artStyle,scene:`${person.name} stands beside the bridge window, holding a closed manifest at chest level`,background:'A practical trading-ship bridge with restrained metal and fabric surfaces',composition:'Eye-level chest-up view, face clearly visible',lighting:'Soft daylight from a window, neutral color balance',template:'{{subjects}}',negative:''});
  const resolved=resolveIllustration(story,shot);assert.doesNotMatch(resolved.text,/\b300\b|three hundred|three centuries/i);assert.match(resolved.text,/30|thirty/i);assert.doesNotMatch(resolved.text,/\billustration\b|\bpainterly\b|\bred leather boots\b/i);
  console.log('Canonical profile resolves to visible age/presentation and upper-body wardrobe. Queueing one real ComfyUI portrait.');
  const queued=await startIllustration(story.id,{expectedRevision:story.revision,requestId:randomUUID(),draft:shot,images:{...c.images,steps:8,seed:271828}});
  let result=queued;while(result.status==='queued'){await new Promise(resolve=>setTimeout(resolve,4000));result=await readStoryImage(story.id,queued.id);}assert.equal(result.status,'complete',result.error);
  const image=completedStoryImage(story.id,queued.id,0);assert.equal(image.capture.prompt,resolved.text);
  story=await acceptIllustration(story.id,queued.id,{expectedRevision:story.revision,requestId:randomUUID(),index:0,caption:'Aligned character portrait',status:'canonical',setPortrait:true});
  const copy=await r.import(r.export(story.id));assert.deepEqual(copy.canon,story.canon);assert.deepEqual(copy.media,story.media);assert.equal(story.media.portraits[person.id],story.media.assets[0].id);
  mkdirSync('test-results',{recursive:true});writeFileSync('test-results/character-alignment-live-portrait.png',image.bytes);writeFileSync('test-results/character-alignment-live.json',JSON.stringify({story,prompt:resolved.text,durationMs:result.durationMs},null,2));
  console.log('PASS: real structured setup -> narrated opening -> canonical state -> medium-neutral visible-age image prompt -> ComfyUI -> portrait/photobook -> archive. Normal saves/settings unchanged.');
}catch(e){mkdirSync('test-results',{recursive:true});writeFileSync('test-results/character-alignment-live-failure.json',JSON.stringify({error:e.message,traces:diagnostics?.traces()},null,2));throw e;}
finally{r?.close();jobs?.close();diagnostics?.close();const target=resolve(folder);if((target.startsWith(resolve(tmpdir())+'\\')||target.startsWith(resolve(tmpdir())+'/'))&&basename(target).startsWith('storyweaver-character-alignment-'))rmSync(target,{recursive:true,force:true});}
