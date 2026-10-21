import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync,rmSync,readFileSync,writeFileSync } from 'node:fs';
import { join,resolve,basename } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { createSample,sampleContinuationProposal,sampleReplacementProposal } from '../src/lib/server/fixture';
import { illustrationDraftSchema,visualSubjectSchema,visualSubjectDetailsSchema,groupSceneTemplate,resolveIllustration,illustrationContentPolicy,illustrationSourceKey,subjectFromCharacter,fillFromSavedProfiles,mergeIllustrationSuggestions,usesCurrentCharacterState,visualIdentityToRemember } from '../src/lib/illustration';
import { visualIdentitySchema } from '../src/lib/visual-identity';
import { normalizeCharacterProfile } from '../src/lib/character-profile';
import { applyStoryEffects } from '../src/lib/story-effects';
import { promptSettingsSchema } from '../src/lib/settings';
import { captureIllustration,suggestIllustration } from '../src/lib/server/story-illustrations';
import { connectionSchema } from '../src/lib/server/connections';
import { imageProvenanceSchema } from '../src/lib/media';
import { StoryRepository } from '../src/lib/server/repository';
import { passageImageHash } from '../src/lib/server/media-store';

function composition(ids=['elias'],framing:'portrait'|'scene'='portrait') {return illustrationDraftSchema.parse({framing,subjectIds:ids,subjects:ids.map(id=>visualSubjectSchema.parse({id,face:id==='elias'?'weathered face':'freckled face',hair:id==='elias'?'grey hair':'red curls',upper_body:'flight jacket',lower_body:'blue trousers',footwear:'bright orange boots'})),passageId:null,style:'Painterly science fiction',scene:'A quiet moment',background:'Ship bridge',template:groupSceneTemplate,negative:''});}

test('shot controls deterministically stage separate characters and omit unchecked detail groups in both prompt formats',()=>{
  const story=createSample(),draft=composition(['elias','mira'],'scene'),subject=draft.subjects[0];
  Object.assign(subject,{build:'stocky silhouette',distinctive:'star-shaped cheek marking',appearanceNotes:'silver face paint',injuries:'bandaged left wrist',outfitNotes:'embroidered jacket lining',accessories:'brass monocle'});
  subject.shot.position='left';subject.shot.depth='foreground';subject.shot.gaze='character:mira';
  draft.subjects[1].shot.position='right';draft.subjects[1].shot.depth='background';draft.subjects[1].shot.gaze='camera';
  for(const group of Object.keys(subject.shot.include) as (keyof typeof subject.shot.include)[])subject.shot.include[group]=false;
  const before=structuredClone(draft);
  for(const promptMode of ['natural','template'] as const){
    const result=resolveIllustration(story,{...draft,promptMode});
    assert.match(result.text,/Elias Voss is on the left side of the image, in the foreground/);
    assert.match(result.text,/Elias Voss is looking at Mira Sol/);
    assert.match(result.text,/Mira Sol is on the right side of the image, in the background/);
    assert.match(result.text,/Mira Sol is looking at the camera/);
    for(const hidden of ['weathered face','grey hair','stocky silhouette','star-shaped cheek marking','silver face paint','bandaged left wrist','embroidered jacket lining','brass monocle'])assert.ok(!result.text.includes(hidden),hidden);
    assert.ok(result.text.includes('freckled face'));assert.ok(result.text.includes('red curls'));
    assert.equal(result.variables['subject.face'],'');assert.equal(result.variables['subject.upper_body'],'');assert.equal(result.variables['subject.gaze'],'looking at Mira Sol');
  }
  assert.deepEqual(draft,before,'Prompt omission must keep the editable source details.');
  subject.shot.gaze='character:elias';assert.throws(()=>resolveIllustration(story,draft),/another depicted/);
  subject.shot.gaze='character:unknown';assert.throws(()=>resolveIllustration(story,draft),/another depicted/);
});

test('single-character templates honor inclusion and append staging when older templates lack shot variables',()=>{
  const story=createSample(),draft=composition(),s=draft.subjects[0];s.shot.position='center';s.shot.depth='middle';s.shot.gaze='elsewhere';s.shot.include.faceHair=false;s.shot.include.clothing=false;
  draft.template='A portrait of {{subject.name}}, {{subject.face}}, {{subject.hair}}, {{subject.upper_body}}.';
  const result=resolveIllustration(story,draft);assert.doesNotMatch(result.text,/weathered face|grey hair|flight jacket/);assert.match(result.text,/in the center of the image/);assert.match(result.text,/in the middle ground/);assert.match(result.text,/looking away from the camera/);
  draft.template+=' {{subject.position}}; {{subject.depth}}; {{subject.gaze}}.';
  const explicit=resolveIllustration(story,draft);assert.equal(explicit.text.match(/looking away from the camera/g)?.length,1);
  draft.promptOverride='A complete authored prompt.';assert.ok(resolveIllustration(story,draft).text.startsWith(draft.promptOverride));assert.ok(!resolveIllustration(story,draft).text.includes('middle ground'));
});

test('shot choices survive profile filling, both suggestion modes and captures without making story details stale',()=>{
  const story=createSample(),draft=composition(),s=draft.subjects[0];s.shot.position='left';s.shot.gaze='camera';s.shot.include.clothing=false;s.shot.include.distinctive=false;
  const key=illustrationSourceKey(story,draft),original=structuredClone(s.shot);s.shot.depth='foreground';original.depth='foreground';
  assert.equal(illustrationSourceKey(story,draft),key);
  const filled=fillFromSavedProfiles(story,draft);assert.deepEqual(filled.subjects[0].shot,original);
  const model={scene:'A changed moment',background:'A quiet room',subjects:[{...s,shot:{...s.shot,position:'right' as const,include:{...s.shot.include,clothing:true}}}]};
  for(const mode of ['refresh','fill-missing'] as const)assert.deepEqual(mergeIllustrationSuggestions(draft,model,mode).subjects[0].shot,original);
  const capture=captureIllustration(story,draft).capture;assert.deepEqual(capture.draft.subjects[0].shot,original);assert.equal(capture.snapshots[0].outfit,'');
  const restored=illustrationDraftSchema.parse(JSON.parse(JSON.stringify(capture.draft)));assert.deepEqual(restored.subjects[0].shot,original);assert.equal(resolveIllustration(story,restored).text,capture.prompt);
  assert.equal(subjectFromCharacter(story.canon.characters[0],'portrait').shot.include.build,false);assert.equal(subjectFromCharacter(story.canon.characters[0],'fullbody').shot.include.build,true);
  const {shot,...legacy}=s;assert.equal(visualSubjectSchema.parse(legacy).shot.include.build,true,'Older compositions retain their existing detail inclusion.');
});

test('selected places and objects use reusable visual descriptions with legacy description fallback',()=>{
  const story=createSample(),draft=composition([],'scene'),place=story.canon.places[0],item=story.canon.items[0];draft.subjectIds=[place.id,item.id];
  Object.assign(place,{visualDescription:'Tall copper walls beneath a glass dome.'});Object.assign(item,{visualDescription:'An oval brass case with a blue clasp.'});
  for(const promptMode of ['natural','template'] as const){const text=resolveIllustration(story,{...draft,promptMode}).text;assert.ok(text.includes('Tall copper walls'));assert.ok(text.includes('oval brass case'));assert.ok(!text.includes(place.description));assert.ok(!text.includes(item.description));}
  Object.assign(place,{visualDescription:''});Object.assign(item,{visualDescription:''});const fallback=resolveIllustration(story,draft).text;assert.ok(fallback.includes(place.description));assert.ok(fallback.includes(item.description));
});

test('framing and stock templates do not impose an image medium, while explicit art direction and custom wording survive',()=>{
  const story=createSample(),templates=promptSettingsSchema.parse({}),forcedMedium=/\b(?:illustration|illustrated|painting|painterly|drawing|cgi|render)\b/i;
  for(const style of ['', 'Photorealistic studio photography, natural skin texture'])for(const promptMode of ['natural','template'] as const)for(const framing of ['portrait','fullbody','scene','environment'] as const){
    const draft=composition(framing==='environment'?[]:['elias'],framing==='portrait'?'portrait':'scene');draft.framing=framing==='environment'?'scene':framing;draft.promptMode=promptMode;draft.style=style;draft.template=framing==='environment'||framing==='scene'?templates.group:templates[framing];
    const text=resolveIllustration(story,draft).text;assert.doesNotMatch(text,forcedMedium,`${framing}/${promptMode} must not choose a medium`);if(style)assert.ok(text.includes(style));
  }
  const draft=composition();draft.promptMode='natural';draft.style='Watercolor illustration on textured paper';assert.ok(resolveIllustration(story,draft).text.includes(draft.style));
  draft.promptMode='template';draft.template='A pen-and-ink illustration of {{subject.name}}.';assert.ok(resolveIllustration(story,draft).text.includes('A pen-and-ink illustration of Elias Voss.'));
  draft.promptOverride='A charcoal drawing of the captain.';assert.ok(resolveIllustration(story,draft).text.startsWith(draft.promptOverride));
});

test('natural-language shots retain age, gender, eyes and shot direction without off-frame wardrobe or duplicated content instructions',()=>{
  const story=createSample(),draft=composition();draft.promptMode='natural';draft.subjects[0]={...draft.subjects[0],age:'47',gender:'man, masculine presentation',species:'human',eyes:'hazel eyes',skin:'warm olive complexion'};draft.composition='Eye level, three-quarter view';draft.lighting='Soft amber window light';draft.template='{{unknown.old.template}}';
  const prompt=resolveIllustration(story,draft).text;
  for(const phrase of ['chest up','47 years old','man, masculine presentation','human','hazel eyes','warm olive','Eye level','Soft amber'])assert.ok(prompt.includes(phrase),phrase);
  assert.ok(!prompt.includes('orange boots'));assert.ok(!prompt.includes('blue trousers'));assert.equal(prompt.match(/Nonsexual presentation/g)?.length,1);assert.ok(!/\.\s*\./.test(prompt));
  draft.promptMode='template';draft.template='Portrait of {{subject.name}} with {{subject.hair}}.';const custom=resolveIllustration(story,draft).text;
  assert.ok(custom.includes('47 years old'));assert.ok(custom.includes('masculine'));assert.ok(custom.includes('hazel eyes'));
});

test('saved profiles supply granular identity while blank-filling preserves shot choices and respects the portrait crop',()=>{
  const story=createSample(),c=story.canon.characters[0];c.visual=visualIdentitySchema.parse({age:'47',gender:'man',eyes:'hazel eyes',hair:'silver hair'});c.wardrobe={upper_body:'A leather jacket',lower_body:'Blue trousers',footwear:'Bright orange boots',accessories:'A silver collar pin'};c.injuries='A bruised cheek. A broken leg.';
  const fromProfile=subjectFromCharacter(c,'portrait');assert.equal(fromProfile.age,'47');assert.equal(fromProfile.eyes,'hazel eyes');assert.equal(fromProfile.upper_body,'A leather jacket');assert.equal(fromProfile.footwear,'');assert.equal(fromProfile.lower_body,'');assert.equal(fromProfile.injuries,'A bruised cheek.');assert.equal(fromProfile.accessories,'A silver collar pin');
  const fullbody=subjectFromCharacter(c,'fullbody');assert.equal(fullbody.lower_body,'Blue trousers');assert.equal(fullbody.footwear,'Bright orange boots');assert.equal(fullbody.injuries,c.injuries);
  const draft=composition();draft.subjects[0]=visualSubjectSchema.parse({id:c.id,hair:'windblown black hair'});const filled=fillFromSavedProfiles(story,draft);
  assert.equal(filled.subjects[0].eyes,'hazel eyes');assert.equal(filled.subjects[0].hair,'windblown black hair');assert.equal(draft.subjects[0].eyes,'');
});

test('visible age and presentation do not leak contradictory chronological identity into default image prompts',()=>{
  const story=createSample(),draft=composition();draft.subjects[0]=visualSubjectSchema.parse({id:'elias',age:'512',apparentAge:'30',gender:'man',presentation:'androgynous',species:'vampire',eyes:'silver eyes'});
  for(const promptMode of ['natural','template'] as const){draft.promptMode=promptMode;draft.template='Portrait of {{subject.name}}, {{subject.age}}, {{subject.gender}}.';const resolved=resolveIllustration(story,draft);
    assert.ok(resolved.text.includes('30'));assert.ok(resolved.text.includes('androgynous'));assert.ok(!resolved.text.includes('512'));assert.doesNotMatch(resolved.text,/\bman\b/);assert.equal(resolved.variables['subject.age'],'30');assert.equal(resolved.variables['subject.actual_age'],'512');assert.equal(resolved.variables['subject.gender'],'androgynous');assert.equal(resolved.variables['subject.gender_identity'],'man');
  }
  draft.template='Archive label: chronological age {{subject.actual_age}}, gender identity {{subject.gender_identity}}. Visible: {{subject.apparent_age}}, {{subject.presentation}}.';
  const explicit=resolveIllustration(story,draft).text;assert.ok(explicit.includes('chronological age 512'));assert.ok(explicit.includes('Visible: 30, androgynous'));assert.equal(explicit.match(/30/g)?.length,1,'Explicit visible-age variables should not gain a duplicate age sentence.');
});

test('remembering image proposals updates visible identity without retconning actual age, gender, current clothes or injuries',()=>{
  const original=normalizeCharacterProfile({...createSample().canon.characters[0],visual:visualIdentitySchema.parse({age:'512',apparentAge:'30',gender:'man',presentation:'masculine',eyes:'blue eyes'}),wardrobe:{upper_body:'A red coat',lower_body:'Black trousers',footwear:'Leather boots',accessories:''},injuries:'Bruised right cheek'}),before=structuredClone(original);
  const proposed=visualSubjectSchema.parse({id:original.id,age:'19',apparentAge:'35',gender:'woman',presentation:'androgynous',eyes:'silver eyes',upper_body:'Image-only white shirt',injuries:'Image-only bandage'});
  const saved=normalizeCharacterProfile({...original,visual:visualIdentityToRemember(original,proposed)});
  assert.equal(saved.visual.age,'512');assert.equal(saved.visual.gender,'man');assert.equal(saved.visual.apparentAge,'35');assert.equal(saved.visual.presentation,'androgynous');assert.equal(saved.visual.eyes,'silver eyes');assert.ok(saved.appearance.includes('Apparent age: 35'));assert.deepEqual(saved.wardrobe,before.wardrobe);assert.equal(saved.injuries,before.injuries);assert.deepEqual(original,before);
});

test('historical images reuse identity without treating current clothes or injuries as historical facts',()=>{
  const story=createSample(),c=story.canon.characters[0];Object.assign(c,normalizeCharacterProfile({...c,visual:visualIdentitySchema.parse({age:'47',hair:'silver hair'}),wardrobe:{upper_body:'CURRENT crimson uniform',lower_body:'CURRENT black trousers',footwear:'CURRENT combat boots',accessories:''},injuries:'CURRENT scarred cheek'}));
  assert.equal(usesCurrentCharacterState(story,story.passages[0].id),false);assert.equal(usesCurrentCharacterState(story,story.passages.at(-1)!.id),true);
  const draft=composition();draft.passageId=story.passages[0].id;draft.subjects=[visualSubjectSchema.parse({id:'elias'})];
  const filled=fillFromSavedProfiles(story,draft);assert.equal(filled.subjects[0].hair,'silver hair');assert.equal(filled.subjects[0].upper_body,'');assert.equal(filled.subjects[0].injuries,'');
  const capture=captureIllustration(story,filled).capture;assert.ok(!capture.prompt.includes('CURRENT'));assert.equal(capture.snapshots[0].outfit,'');assert.ok(!capture.snapshots[0].appearance.includes('CURRENT'));
  draft.passageId=story.passages.at(-1)!.id;const current=fillFromSavedProfiles(story,draft);assert.equal(current.subjects[0].upper_body,'CURRENT crimson uniform');assert.equal(current.subjects[0].injuries,'CURRENT scarred cheek');
  const manual={...filled,subjects:[{...filled.subjects[0],upper_body:'An explicit image-only silver jacket'}]};assert.equal(fillFromSavedProfiles(story,manual).subjects[0].upper_body,'An explicit image-only silver jacket');assert.equal(c.wardrobe!.upper_body,'CURRENT crimson uniform');
});

test('designing missing traits cannot overwrite entered identity, clothing or action and validates returned cast IDs',()=>{
  const draft=composition();draft.subjects[0].age='47';draft.subjects[0].gender='man';draft.subjects[0].eyes='';
  const result={scene:'A different moment',background:'A different room',subjects:[visualSubjectSchema.parse({id:'elias',age:'19',gender:'woman',eyes:'hazel eyes',hair:'new hair',upper_body:'a different shirt',footwear:'orange boots'})]};
  const filled=mergeIllustrationSuggestions(draft,result,'fill-missing');assert.equal(filled.subjects[0].eyes,'hazel eyes');assert.equal(filled.subjects[0].age,'47');assert.equal(filled.subjects[0].gender,'man');assert.equal(filled.subjects[0].hair,draft.subjects[0].hair);assert.equal(filled.subjects[0].upper_body,draft.subjects[0].upper_body);assert.equal(filled.scene,draft.scene);assert.equal(filled.background,draft.background);assert.equal(filled.subjects[0].footwear,'');
  const refresh=mergeIllustrationSuggestions(draft,result,'refresh');assert.equal(refresh.scene,result.scene);assert.equal(refresh.subjects[0].age,'47');assert.equal(refresh.subjects[0].gender,'man');assert.equal(refresh.subjects[0].upper_body,'a different shirt');
  assert.throws(()=>mergeIllustrationSuggestions(draft,{...result,subjects:[{...result.subjects[0],id:'mira'}]},'fill-missing'),/each selected/);
});

test('scene focus is optional, bounded, preserved in suggestions and used verbatim only for an otherwise blank scene',()=>{
  const story=createSample(),draft=composition(['elias'],'scene');assert.equal(draft.sceneFocus,'');
  assert.equal(illustrationDraftSchema.safeParse({...draft,sceneFocus:'x'.repeat(2001)}).success,false);
  draft.passageId=story.passages[0].id;draft.sceneFocus='Elias passes his jacket across the counter before accepting the brass key.';draft.scene='';
  for(const promptMode of ['natural','template'] as const){draft.promptMode=promptMode;const resolved=resolveIllustration(story,draft);assert.ok(resolved.text.includes(draft.sceneFocus));assert.equal(resolved.variables['image.scene'],draft.sceneFocus);}
  const result={scene:'Elias holds his folded jacket over the counter.',background:'A narrow trading booth.',subjects:[{...draft.subjects[0],pose:'Holding a folded jacket forward'}]};
  const prepared=mergeIllustrationSuggestions(draft,result,'refresh');assert.equal(prepared.sceneFocus,draft.sceneFocus);assert.equal(prepared.scene,result.scene);assert.equal(resolveIllustration(story,prepared).text.includes(draft.sceneFocus),false,'Selection wording must not be appended to an already prepared scene.');
  assert.equal(mergeIllustrationSuggestions(prepared,result,'fill-missing').sceneFocus,draft.sceneFocus);
  const reference={...draft,passageId:null};assert.ok(!resolveIllustration(story,reference).text.includes(draft.sceneFocus),'An old passage selection must not affect a reference picture.');assert.equal(illustrationSourceKey(story,reference),illustrationSourceKey(story,{...reference,sceneFocus:''}));
  draft.promptOverride='An explicit picture prompt.';assert.equal(resolveIllustration(story,draft).text.includes(draft.sceneFocus),false,'Explicit prompt overrides remain authoritative.');
});

test('scene preparation receives the chosen passage moment and preserves identity, preferences and canon',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'story-illustration-focus-')),previousConfig=process.env.STORY_CONFIG_DIR;
  try{
    const config=connectionSchema.parse({...JSON.parse(readFileSync('config/connections.example.json','utf8')),text:{baseUrl:'http://localhost:9999/v1',model:'focus-test',temperature:0.8,maxTokens:4096,contextTokens:65536,structuredOutput:'prompt'}});
    writeFileSync(join(folder,'connections.local.json'),JSON.stringify(config));process.env.STORY_CONFIG_DIR=folder;
    const story=createSample(),draft=composition(['elias'],'scene');story.adultContent=true;story.preferences.contentNotes='Avoid graphic injury.';draft.nonsexual=false;draft.passageId=story.passages.at(-1)!.id;draft.sceneFocus='The moment he offers his jacket, before receiving the key.';
    story.passages.at(-1)!.paragraphs=['Elias held his folded jacket over the booth counter. Later, he accepted the brass key and pulled on a borrowed coat.'];
    draft.subjects[0].age='47';draft.subjects[0].gender='man';const before=structuredClone(story);let sent:any;
    const proposed={scene:'Elias extends his folded jacket over the booth counter.',background:'A narrow trading booth.',subjects:[visualSubjectDetailsSchema.parse({id:'elias',age:'19',gender:'woman',upper_body:'A plain shirt',pose:'Extending a folded jacket over the counter'})]};
    const prepared=await suggestIllustration(story,draft,new AbortController().signal,async(_url,init)=>{sent=JSON.parse(String(init!.body));return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(proposed)},finish_reason:'stop'}]}));});
    const payload=JSON.parse(sent.messages[1].content),system=sent.messages[0].content;
    assert.equal(payload.sceneFocus,draft.sceneFocus);assert.equal(payload.existingDetails.sceneFocus,draft.sceneFocus);assert.deepEqual(payload.passage,story.passages.at(-1)!.paragraphs);
    assert.match(system,/ONE concrete frozen moment/);assert.match(system,/selected moment/);assert.match(system,/not historical evidence/);assert.match(system,/never story events or canon edits/);
    assert.equal(prepared.sceneFocus,draft.sceneFocus);assert.equal(prepared.scene,proposed.scene);assert.equal(prepared.subjects[0].pose,proposed.subjects[0].pose);assert.equal(prepared.subjects[0].upper_body,'A plain shirt');assert.equal(prepared.subjects[0].age,'47');assert.equal(prepared.subjects[0].gender,'man');
    const capture=captureIllustration(story,prepared).capture;assert.equal(capture.draft.sceneFocus,draft.sceneFocus);assert.equal(capture.contentPreferences.contentNotes,story.preferences.contentNotes);assert.ok(capture.prompt.includes('Elias Voss'));assert.ok(capture.prompt.includes(story.preferences.contentNotes));assert.ok(capture.prompt.includes('nonsexual and fully clothed'));assert.deepEqual(story,before);
    draft.sceneFocus='';await suggestIllustration(story,draft,new AbortController().signal,async(_url,init)=>{const request=JSON.parse(String(init!.body));assert.equal(JSON.parse(request.messages[1].content).sceneFocus,'');assert.ok(!request.messages[0].content.includes('The user supplied sceneFocus'));return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(proposed)},finish_reason:'stop'}]}));});
    draft.sceneFocus='A retained selection for the old source.';draft.passageId=null;
    const reference=await suggestIllustration(story,draft,new AbortController().signal,async(_url,init)=>{const request=JSON.parse(String(init!.body)),data=JSON.parse(request.messages[1].content);assert.equal(data.sceneFocus,'');assert.equal(data.existingDetails.sceneFocus,'');assert.ok(!request.messages[0].content.includes('The user supplied sceneFocus'));return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(proposed)},finish_reason:'stop'}]}));});assert.equal(reference.sceneFocus,draft.sceneFocus,'Reference preparation retains the hidden selection without applying it.');
  }finally{if(previousConfig===undefined)delete process.env.STORY_CONFIG_DIR;else process.env.STORY_CONFIG_DIR=previousConfig;const target=resolve(folder);if(target.startsWith(resolve(tmpdir())+'\\')&&basename(target).startsWith('story-illustration-focus-'))rmSync(target,{recursive:true,force:true});}
});

test('visual identity persists across save/export and explicit evidence-based changes preserve untouched traits and pins',async()=>{
  const r=new StoryRepository(':memory:');try{
    let story=r.create(),c=story.canon.characters.find(c=>c.id==='mira')!;c={...c,visual:visualIdentitySchema.parse({age:'32',gender:'woman',eyes:'green eyes',hair:'copper hair'})};
    story=r.mutate(story.id,{expectedRevision:story.revision,requestId:randomUUID(),action:{type:'character',character:c}});
    assert.deepEqual(r.read(story.id).canon.characters.find(p=>p.id===c.id)!.visual,c.visual);assert.deepEqual((await r.import(r.export(story.id))).canon,story.canon);
    const prose='Mira dyed her hair a deep shade of blue.',effect={type:'character.update',characterId:c.id,visual:{hair:'deep blue hair'},evidence:prose};
    const result=applyStoryEffects(story.canon,[effect],prose);assert.equal(result.canon.characters.find(p=>p.id===c.id)!.visual!.hair,'deep blue hair');assert.equal(result.canon.characters.find(p=>p.id===c.id)!.visual!.eyes,'green eyes');
    story.canon.characters.find(p=>p.id===c.id)!.pinnedAppearance=true;assert.throws(()=>applyStoryEffects(story.canon,[effect],prose),/Pinned/);
  }finally{r.close();}
});

test('shot freshness follows the selected source, cast, framing and content preferences without expiring on unrelated saves or manual prompt edits',()=>{
  const story=createSample(),draft=composition();draft.passageId=story.passages[0].id;const key=illustrationSourceKey(story,draft);
  story.revision++;story.canon.funds+=1;draft.style='A new art style';draft.scene='A manual action';draft.template+=' {{subject.hair}}';draft.subjects[0].hair='A manual hairstyle';assert.equal(illustrationSourceKey(story,draft),key);
  const changes:((s:typeof story,d:typeof draft)=>void)[]=[
    s=>s.passages[0].paragraphs[0]+=' A new source sentence.',s=>s.canon.characters[0].wardrobe={upper_body:'A red coat.',lower_body:'',footwear:'',accessories:''},s=>s.canon.characters[0].noNsfw=false,
    s=>s.preferences.contentNotes='Avoid violence.',(_,d)=>d.framing='fullbody',(_,d)=>d.nonsexual=false,(_,d)=>d.passageId=story.passages[1].id,
    (_,d)=>d.subjectIds=['mira'],(_,d)=>d.sceneFocus='Before the exchange, as Elias removes his jacket.'
  ];
  for(const change of changes){const s=structuredClone(story),d=structuredClone(draft);change(s,d);assert.notEqual(illustrationSourceKey(s,d),key);}
});
test('image content checkbox removes its instruction only when story and depicted character preferences permit it',()=>{
  const story=createSample(),draft=composition(['elias','mira'],'scene');draft.nonsexual=false;
  const before=structuredClone(story);assert.equal(illustrationContentPolicy(story,draft).storyRequiresNonsexual,true);
  assert.ok(resolveIllustration(story,draft).text.includes('Nonsexual presentation, fully clothed.'));
  story.adultContent=true;
  for(const c of story.canon.characters)c.noNsfw=false;
  for(const mode of ['natural','template'] as const){draft.promptMode=mode;const result=resolveIllustration(story,draft);assert.doesNotMatch(result.text,/nonsexual|fully clothed/i);assert.deepEqual(result.protectedNames,[]);}
  draft.promptOverride='An authored scene prompt.';assert.equal(resolveIllustration(story,draft).text,'An authored scene prompt.');draft.promptOverride='';
  draft.nonsexual=true;assert.ok(resolveIllustration(story,draft).text.includes('Nonsexual presentation, fully clothed.'));
  draft.nonsexual=false;story.canon.characters.find(c=>c.id==='elias')!.noNsfw=true;
  const partial=resolveIllustration(story,draft);assert.ok(!partial.text.includes('Nonsexual presentation, fully clothed.'));assert.ok(partial.text.includes('Keep these depicted characters nonsexual and fully clothed: Elias Voss.'));assert.deepEqual(illustrationContentPolicy(story,draft).individualNames,['Elias Voss']);
  draft.subjectIds=['mira'];draft.subjects=draft.subjects.filter(s=>s.id==='mira');assert.doesNotMatch(resolveIllustration(story,draft).text,/nonsexual|fully clothed/i,'Unselected cast preferences must not restrict this picture.');
  assert.equal(before.adultContent,false);assert.equal(draft.nonsexual,false);
});

test('portraits omit off-frame fields, group members remain distinct and content preferences survive overrides',()=>{
  const story=createSample(),draft=composition();draft.template+=' {{subject.footwear}}';
  const before=structuredClone(story),portrait=resolveIllustration(story,draft);
  assert.ok(portrait.text.includes('weathered face'));assert.ok(!portrait.text.includes('orange boots'));assert.ok(!portrait.text.includes('blue trousers'));assert.ok(portrait.text.includes('Nonsexual'));
  story.adultContent=true;story.canon.characters.find(c=>c.id==='mira')!.noNsfw=false;
  const group=composition(['elias','mira'],'scene');group.nonsexual=false;
  const resolved=resolveIllustration(story,group);
  assert.ok(resolved.text.includes('Subject 1, Elias Voss.'));assert.ok(resolved.text.includes("Elias Voss's visible appearance includes weathered face; grey hair"));
  assert.ok(resolved.text.includes('Subject 2, Mira Sol.'));assert.ok(resolved.text.includes("Mira Sol's visible appearance includes freckled face; red curls"));
  assert.deepEqual(resolved.protectedNames,['Elias Voss']);
  group.promptOverride='Two crewmates beside a console.';assert.ok(resolveIllustration(story,group).text.includes('Keep these depicted characters nonsexual and fully clothed: Elias Voss'));
  assert.deepEqual(before.media,story.media);assert.equal(story.canon.characters[0].noNsfw,true);
  const unknown=composition();unknown.template='{{subject.biography}}';assert.throws(()=>resolveIllustration(story,unknown),/Unknown prompt/);
  unknown.promptOverride='A quiet portrait.';unknown.nonsexual=false;story.preferences.contentNotes='Avoid graphic injury.';const override=resolveIllustration(story,unknown);assert.ok(override.text.includes('Avoid graphic injury.'));assert.ok(override.text.includes('Elias Voss'));
  const mixed=composition(['elias','mira'],'scene');mixed.template='{{subject.name}} only';assert.throws(()=>resolveIllustration(story,mixed),/group template/);
  mixed.template=groupSceneTemplate;mixed.subjects[1].id='ren';assert.throws(()=>resolveIllustration(story,mixed),/own visual details/);
  const setting=composition([],'scene');setting.subjectIds=[story.canon.places[0].id];const place=resolveIllustration(story,setting);assert.ok(place.text.includes('Depicted setting, '+story.canon.places[0].name));assert.ok(!place.text.includes('fully clothed'));
});

test('generated pictures preserve queue-time facts and select portraits atomically without changing canon',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'story-illustration-test-')),r=new StoryRepository(':memory:',false,join(folder,'media'));
  try{
    let story=r.create();const draft=composition();draft.sceneFocus='The captain pauses before the exchange.';const capture=captureIllustration(story,draft).capture;
    const changed=normalizeCharacterProfile({...story.canon.characters[0],appearanceNotes:'Newly corrected appearance.'});
    story=r.mutate(story.id,{expectedRevision:story.revision,requestId:randomUUID(),action:{type:'character',character:changed}});
    const bytes=await sharp({create:{width:32,height:40,channels:3,background:'#708085'}}).png().toBuffer();
    const input={expectedRevision:story.revision,requestId:randomUUID(),caption:'Captain portrait',category:'portrait' as const,subjectIds:draft.subjectIds,passageId:null,parentId:null,status:'canonical' as const};
    const provenance=imageProvenanceSchema.parse({kind:'comfy',generationId:randomUUID(),outputIndex:0,composition:draft,prompt:capture.prompt});
    const saved=await r.addMedia(story.id,bytes,input,provenance,capture,'elias');
    assert.equal(saved.media.assets[0].snapshots[0].appearance,capture.snapshots[0].appearance);assert.notEqual(saved.media.assets[0].snapshots[0].appearance,changed.appearance);
    assert.deepEqual(saved.canon,story.canon);assert.equal(saved.media.portraits.elias,saved.media.assets[0].id);
    assert.equal((await r.addMedia(story.id,bytes,input,provenance,capture,'elias')).media.assets.length,1);
    const imported=await r.import(r.export(saved.id));assert.deepEqual(imported.media,saved.media);assert.equal(illustrationDraftSchema.parse(imported.media.assets[0].provenance.composition).sceneFocus,draft.sceneFocus);
    await assert.rejects(()=>r.addMedia(story.id,bytes,{...input,expectedRevision:saved.revision,requestId:randomUUID()},provenance,{...capture,storyId:'wrong'}),/capture does not match/);
  }finally{r.close();const target=resolve(folder);if(target.startsWith(resolve(tmpdir())+'\\')&&basename(target).startsWith('story-illustration-test-'))rmSync(target,{recursive:true,force:true});}
});

test('accepting a delayed illustration after latest replacement keeps its old source and marks it superseded',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'story-illustration-test-')),r=new StoryRepository(':memory:',false,join(folder,'media'));
  try{
    let story=r.create();story=r.commitGeneratedPassage(story.id,{expectedRevision:story.revision,requestId:randomUUID(),proposal:sampleContinuationProposal('')});
    const draft=composition();draft.passageId=story.passages.at(-1)!.id;const capture=captureIllustration(story,draft).capture;
    story=r.commitGeneratedPassage(story.id,{expectedRevision:story.revision,requestId:randomUUID(),proposal:sampleReplacementProposal(story,draft.passageId)});
    assert.notEqual(capture.source!.hash,passageImageHash(story.passages.at(-1)!));
    const bytes=await sharp({create:{width:32,height:40,channels:3,background:'#908075'}}).png().toBuffer();
    const saved=await r.addMedia(story.id,bytes,{expectedRevision:story.revision,requestId:randomUUID(),caption:'Old ending',category:'portrait',subjectIds:draft.subjectIds,passageId:draft.passageId,parentId:null,status:'canonical'},imageProvenanceSchema.parse({kind:'comfy'}),capture,'elias');
    assert.equal(saved.media.assets[0].status,'superseded');assert.deepEqual(saved.media.assets[0].source,capture.source);assert.equal(saved.media.portraits.elias,undefined);assert.deepEqual(saved.canon,story.canon);
  }finally{r.close();const target=resolve(folder);if(target.startsWith(resolve(tmpdir())+'\\')&&basename(target).startsWith('story-illustration-test-'))rmSync(target,{recursive:true,force:true});}
});
