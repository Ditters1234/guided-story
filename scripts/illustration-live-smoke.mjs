// Real local text-to-image acceptance; normal libraries/configuration are never changed.
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,basename} from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const folder=mkdtempSync(join(tmpdir(),'storyweaver-illustration-live-'));
process.env.STORY_DATA_DIR=folder;process.env.STORY_INSTANCE='play';
let repository,jobs,diagnostics;
try{
  const {getRepository}=await import('../src/lib/server/repository.ts');
  const {getJobs}=await import('../src/lib/server/jobs.ts');
  const {getDiagnostics}=await import('../src/lib/server/diagnostics.ts');
  const {readPrivateConnections}=await import('../src/lib/server/connections.ts');
  const {illustrationDraftSchema,visualSubjectSchema,groupSceneTemplate,subjectFromCharacter,resolveIllustration}=await import('../src/lib/illustration.ts');
  const {visualIdentitySchema}=await import('../src/lib/visual-identity.ts');
  const {startIllustration,acceptIllustration,suggestIllustration}=await import('../src/lib/server/story-illustrations.ts');
  const {readStoryImage,completedStoryImage}=await import('../src/lib/server/image-tests.ts');
  repository=getRepository();jobs=getJobs();diagnostics=getDiagnostics();const c=readPrivateConnections();let story=repository.create('Illustration development check');
  const images={...c.images,steps:8,seed:314159};
  story=repository.mutate(story.id,{expectedRevision:story.revision,requestId:randomUUID(),action:{type:'character',character:{...story.canon.characters[0],visual:visualIdentitySchema.parse({age:'47',apparentAge:'44',gender:'man',presentation:'masculine',species:'human',hair:'dark hair threaded with grey'}),wardrobe:{upper_body:'Worn charcoal flight jacket',lower_body:'Dark grey trousers',footwear:'Scuffed brown boots',accessories:'Small silver collar pin'}}}});
  let portrait=illustrationDraftSchema.parse({framing:'portrait',promptMode:'natural',subjectIds:['elias'],subjects:[subjectFromCharacter(story.canon.characters[0],'portrait')],passageId:null,style:story.artStyle,scene:'',background:'A softly lit freighter bridge',composition:'Eye-level three-quarter view, face in sharp focus',lighting:'Warm side light, cool muted shadows',template:c.prompts.portrait,negative:c.prompts.negative});
  console.log('Filling missing visual details with the saved local text model, preserving the entered age, gender and hair.');
  portrait=await suggestIllustration(story,portrait,new AbortController().signal,fetch,'fill-missing');
  assert.equal(portrait.subjects[0].age,'47');assert.equal(portrait.subjects[0].apparentAge,'44');assert.equal(portrait.subjects[0].gender,'man');assert.equal(portrait.subjects[0].presentation,'masculine');assert.ok(portrait.subjects[0].eyes.trim(),'The visual assistant should propose eyes when explicitly asked to fill missing features.');
  assert.ok(resolveIllustration(story,portrait).text.includes('44 years old'));assert.ok(!resolveIllustration(story,portrait).text.includes('47 years old'));assert.equal(portrait.subjects[0].upper_body,'Worn charcoal flight jacket');
  assert.equal(portrait.subjects[0].footwear,'');assert.equal(portrait.subjects[0].lower_body,'');
  async function generate(draft,label){
    console.log('Queueing real ComfyUI '+label+'.');
    const result=await startIllustration(story.id,{expectedRevision:story.revision,requestId:randomUUID(),draft,images});
    let current=result;
    while(current.status==='queued'){await new Promise(resolve=>setTimeout(resolve,4000));current=await readStoryImage(story.id,result.id);}
    assert.equal(current.status,'complete',current.error);
    const image=completedStoryImage(story.id,result.id,0),extension=image.type==='image/jpeg'?'jpg':image.type==='image/webp'?'webp':'png';
    mkdirSync('test-results',{recursive:true});writeFileSync(`test-results/illustration-live-${label}.${extension}`,image.bytes);
    story=await acceptIllustration(story.id,result.id,{expectedRevision:story.revision,requestId:randomUUID(),index:0,caption:`Real local ${label} check`,status:'canonical',setPortrait:label==='portrait'});
    console.log(`Saved real ${label}; seed ${current.seed}; ${Math.round(current.durationMs/1000)} seconds.`);
  }
  await generate(portrait,'portrait');assert.ok(story.media.portraits.elias);
  const scene=illustrationDraftSchema.parse({framing:'scene',promptMode:'natural',subjectIds:['elias','mira'],subjects:[{...portrait.subjects[0],pose:'standing on the left, looking at a console'},visualSubjectSchema.parse({id:'mira',age:'32',gender:'woman',species:'human',hair:'short copper hair',eyes:'green eyes',upper_body:'olive work coveralls',pose:'standing on the right, one hand beside the console',expression:'focused'})],passageId:story.passages.at(-1).id,style:story.artStyle,scene:'Two spaceship crewmates examining a navigation console together.',composition:'Medium-wide composition showing both people clearly, captain at left and engineer at right',lighting:'Warm console light against cool teal shadows',background:'Dim science-fiction freighter bridge with a glowing console',template:groupSceneTemplate,negative:c.prompts.negative});
  await generate(scene,'scene');assert.equal(story.media.assets.length,2);assert.deepEqual(story.media.assets[1].subjectIds,['elias','mira']);
  const imported=await repository.import(repository.export(story.id));assert.deepEqual(imported.media,story.media);assert.deepEqual(repository.mediaStore.audit(story.media.assets).corrupt,[]);
  writeFileSync('test-results/illustration-live.json',JSON.stringify(story,null,2));
  console.log('PASS: real text-assisted portrait, real two-subject scene, portrait selection, immutable files and portable archive. Normal play saves are untouched.');
}catch(e){mkdirSync('test-results',{recursive:true});writeFileSync('test-results/illustration-live-failure.json',JSON.stringify({error:e.message,traces:diagnostics?.traces()},null,2));throw e;
}finally{repository?.close();jobs?.close();diagnostics?.close();const target=resolve(folder);if((target.startsWith(resolve(tmpdir())+'\\')||target.startsWith(resolve(tmpdir())+'/'))&&basename(target).startsWith('storyweaver-illustration-live-'))rmSync(target,{recursive:true,force:true});}
