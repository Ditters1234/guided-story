import { estimateInputTokens } from '../src/lib/server/token-budget';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StoryRepository } from '../src/lib/server/repository';
import { setupInputSchema, blankSetupPlan } from '../src/lib/setup';
import { generateSetup, generatePassage, normalizeSetup, generateSetupCharacter } from '../src/lib/server/story-generation';
import { connectionSchema } from '../src/lib/server/connections';
import { jobFingerprint } from '../src/lib/server/jobs';
import { readFileSync } from 'node:fs';
import { memoryCurrent } from '../src/lib/server/context-state';
import { countWords } from '../src/lib/story-length';
import { visualIdentitySchema } from '../src/lib/visual-identity';
import { personaSchema,wardrobeSchema,normalizeCharacterProfile } from '../src/lib/character-profile';
import { subjectFromCharacter } from '../src/lib/illustration';

const settings = () => connectionSchema.parse({ ...JSON.parse(readFileSync('config/connections.example.json','utf8')), text: { baseUrl: 'http://localhost:9999/v1', model: 'test-model', maxTokens: 4096, contextTokens: 65536, temperature: 0.8, structuredOutput: 'prompt' } });
const rawPlan = () => ({ title: 'A Quiet Manifest', chapterTitle: 'Unlisted cargo', worldNotes: 'Independent crews trade between frontier stations.', funds: 120, cargoNotes: 'A sealed crate.',
  places: [{ ref: 'ship', name: 'The Kite', description: 'A small freighter.', parentRef: null }, { ref: 'port', name: 'Port Nine', description: 'A trading station.', parentRef: null }],
  characters: [{ ref: 'ava', name: 'Ava', role: 'Trader', notes: '', visual:visualIdentitySchema.parse({age:'842',apparentAge:'mid thirties',gender:'woman',presentation:'androgynous',species:'vampire',hair:'Grey hair.',eyes:'green eyes'}),persona:personaSchema.parse({personality:'Protective of the crew.',voice:'Measured and dry.',motives:'Keep the crew safe.',history:'A long career trading.'}),wardrobe:wardrobeSchema.parse({upper_body:'Blue coat.',lower_body:'Black trousers.',footwear:'Leather boots.'}),injuries:'',appearanceNotes:'',outfitNotes:'', locationRef: 'ship' }, { ref: 'leto', name: 'Leto', role: 'Engineer', notes: '', visual:visualIdentitySchema.parse({age:'31',apparentAge:'early thirties',gender:'man',presentation:'masculine',species:'human',hair:'Dark curls.'}),persona:personaSchema.parse({personality:'Curious and practical.',voice:'Quick and enthusiastic.',motives:'Understand the ship.'}),wardrobe:wardrobeSchema.parse({upper_body:'Work coveralls.'}),injuries:'',appearanceNotes:'',outfitNotes:'', locationRef: 'ship' }],
  items: [{ ref: 'key', name: 'Brass key', description: 'Opens the cargo locker.', quantity: 1, ownerRef: 'ava', equipped: false }], relationships: [{ fromRef: 'ava', toRef: 'leto', notes: 'Longtime colleagues.' }], threads: [{ title: 'The crate', notes: 'Who owns the sealed cargo?' }],
  opening: { viewpointRef: 'ava', locationRef: 'ship', castRefs: ['ava','leto'], purpose: 'Inspect an unexpected delivery.', tension: 'The manifest has a blank line.', stopAt: 'The crew must decide whether to open the crate.' } });
const request = (revision: number) => ({ expectedRevision: revision, requestId: randomUUID() });
const sceneDetail = 'The table trembled beneath the engine vibration. Leto pressed one palm against its edge and waited for Ava to explain, but she kept her eyes on the ink. Outside the viewport, loading lights moved slowly through the station mist. Nobody had come to claim the delivery. Nobody had asked for a receipt. That silence troubled her more than the blank line itself, and she said so at last.';
function completion(value: unknown, finish = 'stop') { return new Response(JSON.stringify({ choices: [{ message: { content: typeof value === 'string' ? value : JSON.stringify(value) }, finish_reason: finish }] })); }
function draft(r: StoryRepository) { const s = r.createSetup(setupInputSchema.parse({ premise: 'A rogue trader and their crew.', castSize: 2, preferences: { passageWords: 100 } }), randomUUID()); return r.commitGeneratedSetup(s.id, 0, randomUUID(), 'setup', normalizeSetup(rawPlan(), s)); }
function proseFetcher(personId: string, effects: unknown[] = [], options: { failExtraction?: boolean; onNarration?: (messages: string) => void; endOfChapter?: boolean; text?: string } = {}): typeof fetch {
  return async (_url, init) => {
    const body = JSON.parse(String(init!.body)), extracting = body.messages[0].content.startsWith('Return {effects:');
    if(body.messages[0].content.startsWith('Review inventory consistency.'))return completion({consistent:true,issues:[]});
    if (extracting) {
      if (options.failExtraction) return completion('{broken effects');
      const before = JSON.parse(body.messages[1].content).before;
      return completion({ effects, memory: { summary: 'The crew considers the unexpected cargo.', facts: ['Ava offered Leto the key.'], openQuestions: ['Who sent the crate?'], characterIds: [personId], locationIds: [before.places[0].id] } });
    }
    options.onNarration?.(JSON.stringify(body.messages));
    return completion({ title: 'The blank line', chapterTitle: 'A changed manifest', viewpointId: personId, endOfChapter: options.endOfChapter || false, paragraphs: [options.text || 'Ava handed Leto the brass key. The manifest lay open on the table, its last line blank. Neither of them had left it that way.', sceneDetail] });
  };
}

test('setup drafts persist separately from novels, replay safely, reject stale edits and resume after reopen', () => {
  const folder = mkdtempSync(join(tmpdir(),'story-setup-test-')), path = join(folder,'library.sqlite'); let r = new StoryRepository(path);
  try {
    const id = randomUUID(), input = setupInputSchema.parse({ premise: 'A forest mystery.' }), s = r.createSetup(input,id);
    assert.equal(r.list().length,0); assert.equal(r.createSetup(input,id).id,s.id); assert.equal(r.listSetups().length,1);
    assert.throws(() => r.createSetup({ ...input, premise: 'A different premise.' },id), /another premise/);
    const update = { ...request(0), input, plan: blankSetupPlan() }, saved = r.saveSetup(s.id,update);
    assert.equal(r.saveSetup(s.id,update).revision,1); assert.throws(() => r.saveSetup(s.id,{ ...update, ...request(0) }), /setup changed/);
    r.close(); r = new StoryRepository(path); assert.deepEqual(r.readSetup(s.id),saved);
    const invalid = structuredClone(saved.plan!); invalid.canon.items.push({ id: randomUUID(), name: 'Lost item', description: '', quantity: 1, ownerId: 'missing', equipped: false });
    assert.throws(() => r.saveSetup(s.id,{ ...request(1), input, plan: invalid }), /owner does not exist/); assert.equal(r.readSetup(s.id).revision,1);
  } finally { r.close(); for (const file of readdirSync(folder)) unlinkSync(join(folder,file)); rmdirSync(folder); }
});

test('model setup uses application IDs, defaults No NSFW and rejects duplicate or dangling references', async () => {
  const r = new StoryRepository(':memory:');
  try {
    const s = r.createSetup({ premise: 'Frontier traders.', castSize: 2 },randomUUID());
    const plan = await generateSetup(s,settings(),new AbortController().signal,async () => completion(rawPlan()));
    assert.ok(plan.canon.characters.every(c => c.noNsfw && !c.pinnedAppearance)); assert.notEqual(plan.canon.characters[0].id,'ava');
    assert.equal(plan.canon.items[0].ownerId,plan.canon.characters[0].id);
    assert.equal(plan.canon.characters[0].visual!.age,'842');assert.equal(plan.canon.characters[0].visual!.apparentAge,'mid thirties');assert.equal(plan.canon.characters[0].wardrobe!.upper_body,'Blue coat.');assert.equal(plan.canon.characters[0].persona!.voice,'Measured and dry.');
    const missingProfile=rawPlan() as unknown as {characters:Record<string,unknown>[]};delete missingProfile.characters[0].persona;assert.throws(()=>normalizeSetup(missingProfile,s),/persona/);
    const legacy=rawPlan() as unknown as {characters:Record<string,unknown>[]};legacy.characters[0].appearance='Competing hair description';assert.throws(()=>normalizeSetup(legacy,s),/Unrecognized key/);
    const bad = rawPlan(); bad.characters[0].locationRef = 'missing'; assert.throws(() => normalizeSetup(bad,s), /unknown reference/);
    const duplicate = rawPlan(); duplicate.places[0].ref = 'ava'; assert.throws(() => normalizeSetup(duplicate,s), /reused/);
    const flags = rawPlan() as unknown as Record<string,unknown>; (flags.characters as Record<string,unknown>[])[0].noNsfw = false;
    assert.throws(() => normalizeSetup(flags,s), /Unrecognized key/);
    const tiny = settings(); tiny.text.contextTokens = 1024; let calls = 0;
    await assert.rejects(() => generateSetup(s,tiny,new AbortController().signal,async () => { calls++; return completion(rawPlan()); }), /context budget/); assert.equal(calls,0);
  } finally { r.close(); }
});

test('setup generation produces bounded relevant background with resolved links in the same request', async () => {
  const r = new StoryRepository(':memory:');
  try {
    const saved = r.createSetup({ premise: 'Frontier traders.', castSize: 2 }, randomUUID());
    const lore = [{ title: 'Dockside customs', text: 'Crews may share tea before discussing a delivery; this is an optional custom.', keywords: ['tea', 'customs'], relatedRefs: ['port', 'ava', 'key', 'port'] }];
    let calls = 0;
    const plan = await generateSetup(saved, settings(), new AbortController().signal, async (_url, init) => {
      calls++;
      const prompt = JSON.parse(String(init!.body)).messages[0].content;
      assert.match(prompt, /up to THREE useful background entries/);
      assert.match(prompt, /never mandatory checklists or already completed events/);
      return completion({ ...rawPlan(), lore });
    });
    assert.equal(calls, 1);
    const entry = plan.context.lore[1];
    assert.equal(plan.context.lore[0].visibility, 'always');
    assert.equal(entry.title, lore[0].title); assert.equal(entry.text, lore[0].text);
    assert.equal(entry.visibility, 'relevant'); assert.match(entry.id, /^[a-f0-9-]{36}$/);
    assert.deepEqual(entry.keywords, lore[0].keywords);
    assert.deepEqual(entry.relatedIds, [plan.canon.places[1].id, plan.canon.characters[0].id, plan.canon.items[0].id]);
    assert.deepEqual(plan.context.knowledge, []);
    const committed = r.commitGeneratedSetup(saved.id, saved.revision, randomUUID(), 'setup', plan);
    const imported = r.importSetup(r.exportSetup(committed.id));
    assert.deepEqual(imported.plan!.context.lore, plan.context.lore);
  } finally { r.close(); }
});

test('generated background rejects unknown links and oversized collections without changing the saved draft', () => {
  const r = new StoryRepository(':memory:');
  try {
    const saved = r.createSetup({ premise: 'Frontier traders.', castSize: 2 }, randomUUID());
    const entry = { title: 'Dockside customs', text: 'Crews may share tea.', keywords: ['tea'], relatedRefs: ['port'] };
    assert.throws(() => normalizeSetup({ ...rawPlan(), lore: [{ ...entry, relatedRefs: ['invented-place'] }] }, saved), /unknown reference/);
    for (const lore of [Array(4).fill(entry), [{ ...entry, text: 'x'.repeat(801) }], [{ ...entry, visibility: 'hidden' }]]) assert.throws(() => normalizeSetup({ ...rawPlan(), lore }, saved));
    assert.equal(normalizeSetup(rawPlan(), saved).context.lore.length, 1); // Older model results remain valid.
    assert.deepEqual(r.readSetup(saved.id), saved);
  } finally { r.close(); }
});

test('one-character redesign preserves other records, identity/content flags and pinned details', async () => {
  const r = new StoryRepository(':memory:');
  try {
    const s = draft(r), plan = structuredClone(s.plan!); plan.canon.characters[0].noNsfw = false; plan.canon.characters[0].pinnedAppearance = true;
    const saved = r.saveSetup(s.id,{...request(s.revision),input:s.input,plan}), person = saved.plan!.canon.characters[0];
    const p=normalizeCharacterProfile(person),result = { name:person.name,role:'Independent trader',notes:'',visual:p.visual,persona:{...p.persona,motives:'More cautious about strangers.'},wardrobe:p.wardrobe,injuries:p.injuries,appearanceNotes:p.appearanceNotes,outfitNotes:p.outfitNotes,locationId:person.locationId };
    const revised = await generateSetupCharacter(saved,person.id,'Make their motives more cautious.',settings(),new AbortController().signal,async()=>completion(result));
    assert.equal(revised.canon.characters[0].id,person.id);assert.equal(revised.canon.characters[0].noNsfw,false);assert.equal(revised.canon.characters[0].pinnedAppearance,true);
    assert.deepEqual(revised.canon.characters[1],saved.plan!.canon.characters[1]);
    assert.deepEqual({...revised.canon,characters:[]},{...saved.plan!.canon,characters:[]});assert.deepEqual(revised.context,saved.plan!.context);
    await assert.rejects(()=>generateSetupCharacter(saved,person.id,'Change their coat.',settings(),new AbortController().signal,async()=>completion({...result,wardrobe:{...result.wardrobe,upper_body:'New coat.'}}),{allowAppearanceChanges:true}),/pinned/);
  } finally { r.close(); }
});

test('personality redesign retains physical state by default; explicit appearance opt-in permits a reviewed redesign',async()=>{
  const r=new StoryRepository(':memory:');
  try{
    const saved=draft(r),current=normalizeCharacterProfile(saved.plan!.canon.characters[0]);let payload:Record<string,unknown>={};
    const result={name:current.name,role:current.role,notes:current.notes,visual:{...current.visual,hair:'Black hair',eyes:'amber eyes'},persona:{...current.persona,voice:'Quiet, clipped answers.'},wardrobe:{...current.wardrobe,upper_body:'White shirt'},injuries:'A cut on the cheek',appearanceNotes:'Different features',outfitNotes:'A red scarf',locationId:saved.plan!.canon.places[1].id};
    const fetcher:typeof fetch=async(_url,init)=>{payload=JSON.parse(JSON.parse(String(init!.body)).messages[1].content);return completion(result);};
    const revised=await generateSetupCharacter(saved,current.id,'Make their voice terse.',settings(),new AbortController().signal,fetcher);
    const person=normalizeCharacterProfile(revised.canon.characters[0]);assert.equal(person.persona.voice,'Quiet, clipped answers.');assert.deepEqual(person.visual,current.visual);assert.deepEqual(person.wardrobe,current.wardrobe);assert.equal(person.locationId,current.locationId);assert.equal(person.injuries,current.injuries);assert.equal(person.appearanceNotes,current.appearanceNotes);assert.equal(payload.allowAppearanceChanges,false);
    const physical=await generateSetupCharacter(saved,current.id,'Give them black hair, amber eyes and a white shirt; move them to port after a fight.',settings(),new AbortController().signal,fetcher,{allowAppearanceChanges:true});
    assert.equal(physical.canon.characters[0].visual!.hair,'Black hair');assert.equal(physical.canon.characters[0].wardrobe!.upper_body,'White shirt');assert.equal(physical.canon.characters[0].visual!.age,current.visual.age);assert.equal(payload.allowAppearanceChanges,true);
    assert.deepEqual(r.readSetup(saved.id),saved);
  }finally{r.close();}
});

test('name rerolls change only the chosen name and preserve the complete cast profile and opening references',async()=>{
  const r=new StoryRepository(':memory:');
  try{
    let saved=draft(r);const plan=structuredClone(saved.plan!);plan.canon.characters[0].noNsfw=false;plan.canon.characters[0].pinnedAppearance=true;
    saved=r.saveSetup(saved.id,{...request(saved.revision),input:saved.input,plan});
    const current=saved.plan!.canon.characters[0];let sent:Record<string,unknown>={},system='',maxTokens=0;
    const revised=await generateSetupCharacter(saved,current.id,'A short frontier name. Also change their coat.',settings(),new AbortController().signal,async(_url,init)=>{
      const body=JSON.parse(String(init!.body));sent=JSON.parse(body.messages[1].content);system=body.messages[0].content;maxTokens=body.max_tokens;
      return completion({name:'  Rowan Vale  '});
    },{mode:'name',allowAppearanceChanges:true});
    assert.equal(revised.canon.characters[0].name,'Rowan Vale');
    assert.deepEqual(revised,{...saved.plan!,canon:{...saved.plan!.canon,characters:saved.plan!.canon.characters.map(c=>c.id===current.id?{...c,name:'Rowan Vale'}:c)}});
    assert.deepEqual(sent.current,{name:current.name,role:current.role,visual:current.visual,persona:current.persona});
    assert.deepEqual(sent.otherNames,[saved.plan!.canon.characters[1].name]);assert.equal(sent.premise,saved.input.premise);
    assert.match(system,/naming guidance only/);assert.ok(maxTokens<=256);
    assert.equal(revised.context.sceneBrief.viewpointId,current.id);assert.ok(revised.context.sceneBrief.castIds.includes(current.id));
    assert.deepEqual(r.readSetup(saved.id),saved);
    const stored=r.saveSetup(saved.id,{...request(saved.revision),input:saved.input,plan:revised});
    assert.deepEqual(stored.plan,revised);assert.equal(stored.plan!.canon.items[0].ownerId,current.id);
  }finally{r.close();}
});

test('name rerolls reject unchanged, duplicate and overreaching model responses without changing the saved setup',async()=>{
  const r=new StoryRepository(':memory:');
  try{
    const saved=draft(r),current=saved.plan!.canon.characters[0];
    const failures:[unknown,RegExp][]=[
      [{name:`  ${current.name.toUpperCase()}  `},/same name/],
      [{name:`  ${saved.plan!.canon.characters[1].name.toUpperCase()}  `},/already used/],
      [{name:'Rowan',noNsfw:false},/Unrecognized key/],
      [{name:'Rowan',visual:{gender:'man'}},/Unrecognized key/],
      [{name:' '},/at least|Too small/]
    ];
    for(const [response,message] of failures){
      await assert.rejects(()=>generateSetupCharacter(saved,current.id,'Reroll their name.',settings(),new AbortController().signal,async()=>completion(response),{mode:'name'}),message);
      assert.deepEqual(r.readSetup(saved.id),saved);
    }
  }finally{r.close();}
});

test('a full cast redesign refreshes every profile field, persists coherent sex/presentation and wardrobe, and projects the new image details',async()=>{
  const r=new StoryRepository(':memory:');
  try{
    let saved=draft(r);const plan=structuredClone(saved.plan!),original=plan.canon.characters[0];
    Object.assign(original,normalizeCharacterProfile({...original,noNsfw:false,visual:{...original.visual!,gender:'woman',presentation:'feminine'},wardrobe:{upper_body:'Fitted evening bodice.',lower_body:'Long formal skirt.',footwear:'Red heels.',accessories:'Pearl necklace.'},notes:'She commands the crew.',appearanceNotes:'She has a narrow silhouette.',outfitNotes:'Her formal gown has silver seams.'}));
    saved=r.saveSetup(saved.id,{...request(saved.revision),input:saved.input,plan});
    const current=saved.plan!.canon.characters[0];let sent:Record<string,unknown>={},system='';
    const result={name:'Rowan Vale',role:'Salvage captain',notes:'He knows the station customs officers.',
      visual:{age:'43',apparentAge:'early forties',gender:'man',presentation:'masculine',species:'human',skin:'Warm brown complexion.',build:'Broad athletic silhouette.',face:'Square jaw and weathered cheeks.',hair:'Close-cropped black hair.',eyes:'Amber eyes.',distinctive:'A silver streak at the temple.'},
      persona:{personality:'Sociable but patient.',voice:'Deep, unhurried phrases.',motives:'Recover a lost salvage claim.',history:'He spent a decade hauling station wreckage.'},
      wardrobe:{upper_body:'A navy jacket tailored to his broad shoulders.',lower_body:'Grey utility trousers.',footwear:'Scuffed pressure boots.',accessories:'A brass salvage licence on his lapel.'},
      injuries:'A healing cut on his right cheek.',appearanceNotes:'His eyebrows are thick and dark.',outfitNotes:'The jacket collar is open.',locationId:saved.plan!.canon.places[1].id};
    const revised=await generateSetupCharacter(saved,current.id,'Make this cast member a masculine man with a complete new outfit and refreshed background.',settings(),new AbortController().signal,async(_url,init)=>{
      const body=JSON.parse(String(init!.body));sent=JSON.parse(body.messages[1].content);system=body.messages[0].content;return completion(result);
    },{mode:'full',allowAppearanceChanges:true});
    const person=revised.canon.characters[0];
    assert.deepEqual(person,normalizeCharacterProfile({...current,...result}));
    for(const key of ['visual','persona','wardrobe'] as const)for(const field of Object.keys(result[key])){
      assert.notEqual((person[key] as Record<string,string>)[field],(current[key] as Record<string,string>)[field],`${key}.${field} should refresh`);
    }
    assert.equal(person.id,current.id);assert.equal(person.noNsfw,false);assert.equal(person.pinnedAppearance,false);
    assert.deepEqual(revised.canon.characters[1],saved.plan!.canon.characters[1]);assert.deepEqual({...revised.canon,characters:[]},{...saved.plan!.canon,characters:[]});assert.deepEqual(revised.context,saved.plan!.context);
    assert.equal(sent.mode,'full');assert.equal(sent.allowAppearanceChanges,true);assert.match(system,/FULL CHARACTER REDESIGN/);
    assert.match(person.appearance,/Gender: man/);assert.match(person.appearance,/Amber eyes/);assert.match(person.outfit,/Grey utility trousers/);assert.match(person.outfit,/jacket collar is open/);
    assert.doesNotMatch(person.appearance+person.outfit+person.notes,/narrow silhouette|formal gown|Red heels|She commands/);
    const fullBody=subjectFromCharacter(person,'fullbody'),portrait=subjectFromCharacter(person,'portrait');
    assert.equal(fullBody.gender,'man');assert.equal(fullBody.presentation,'masculine');assert.equal(fullBody.lower_body,result.wardrobe.lower_body);assert.equal(fullBody.footwear,result.wardrobe.footwear);assert.equal(fullBody.outfitNotes,result.outfitNotes);assert.equal(fullBody.appearanceNotes,result.appearanceNotes);
    assert.equal(portrait.upper_body,result.wardrobe.upper_body);assert.equal(portrait.lower_body,'');assert.equal(portrait.footwear,'');assert.equal(portrait.eyes,result.visual.eyes);
    assert.deepEqual(r.readSetup(saved.id),saved);
    const stored=r.saveSetup(saved.id,{...request(saved.revision),input:saved.input,plan:revised});assert.deepEqual(stored.plan,revised);assert.deepEqual(r.readSetup(saved.id).plan,revised);
  }finally{r.close();}
});

test('full redesign still requires appearance permission and enforces every pinned physical field',async()=>{
  const r=new StoryRepository(':memory:');
  try{
    let saved=draft(r);const current=normalizeCharacterProfile(saved.plan!.canon.characters[0]);
    const result={name:'Rowan',role:'Navigator',notes:'A new role in the crew.',visual:{...current.visual,gender:'man'},persona:{...current.persona,voice:'Gruff and brief.'},wardrobe:{...current.wardrobe,upper_body:'Black jacket.'},injuries:'A bruised cheek.',appearanceNotes:'New facial markings.',outfitNotes:'The jacket is unbuttoned.',locationId:saved.plan!.canon.places[1].id};
    const withoutPermission=await generateSetupCharacter(saved,current.id,'Reimagine them.',settings(),new AbortController().signal,async()=>completion(result),{mode:'full'});
    assert.equal(withoutPermission.canon.characters[0].name,result.name);assert.deepEqual(withoutPermission.canon.characters[0].persona,result.persona);
    for(const key of ['visual','wardrobe','injuries','appearanceNotes','outfitNotes','locationId'] as const)assert.deepEqual(withoutPermission.canon.characters[0][key],current[key]);
    const pinnedPlan=structuredClone(saved.plan!);pinnedPlan.canon.characters[0].pinnedAppearance=true;
    saved=r.saveSetup(saved.id,{...request(saved.revision),input:saved.input,plan:pinnedPlan});
    const allowed={...result,visual:current.visual,wardrobe:current.wardrobe,injuries:current.injuries,appearanceNotes:current.appearanceNotes,outfitNotes:current.outfitNotes,locationId:current.locationId};
    const pinned=await generateSetupCharacter(saved,current.id,'Refresh the profile.',settings(),new AbortController().signal,async()=>completion(allowed),{mode:'full',allowAppearanceChanges:true});
    assert.equal(pinned.canon.characters[0].name,result.name);assert.equal(pinned.canon.characters[0].pinnedAppearance,true);
    for(const key of ['visual','wardrobe','injuries','appearanceNotes','outfitNotes'] as const){
      await assert.rejects(()=>generateSetupCharacter(saved,current.id,'Change everything.',settings(),new AbortController().signal,async()=>completion({...allowed,[key]:result[key]}),{mode:'full',allowAppearanceChanges:true}),/pinned/);
      assert.deepEqual(r.readSetup(saved.id),saved);
    }
  }finally{r.close();}
});

test('setup and cast redesign reject omitted nested traits instead of silently clearing established details',async()=>{
  const r=new StoryRepository(':memory:');
  try{
    const saved=draft(r),current=normalizeCharacterProfile(saved.plan!.canon.characters[0]);
    const result={name:current.name,role:current.role,notes:current.notes,visual:current.visual,persona:current.persona,wardrobe:current.wardrobe,injuries:current.injuries,appearanceNotes:current.appearanceNotes,outfitNotes:current.outfitNotes,locationId:current.locationId};
    for(const [group,trait] of [['visual','eyes'],['persona','voice'],['wardrobe','footwear']] as const){
      const incomplete=structuredClone(result) as unknown as Record<string,Record<string,string>>;delete incomplete[group][trait];
      await assert.rejects(()=>generateSetupCharacter(saved,current.id,'Refresh the complete profile.',settings(),new AbortController().signal,async()=>completion(incomplete),{mode:'full',allowAppearanceChanges:true}),new RegExp(trait));
      const incompletePlan=rawPlan() as unknown as {characters:Record<string,Record<string,string>>[]};delete incompletePlan.characters[0][group][trait];
      assert.throws(()=>normalizeSetup(incompletePlan,saved),new RegExp(trait));assert.deepEqual(r.readSetup(saved.id),saved);
    }
  }finally{r.close();}
});

test('approved setup drives an atomic opening with effects/memory and receipt replay never creates duplicate novels', async () => {
  const r = new StoryRepository(':memory:');
  try {
    let s = draft(r); const plan = structuredClone(s.plan!); plan.canon.characters[0].name = 'Captain Ash';
    s = r.saveSetup(s.id,{ ...request(s.revision), input: s.input, plan }); const person = s.plan!.canon.characters[0]; let sent = '';
    const proposal = await generatePassage({ setup: s },settings(),new AbortController().signal,()=>{},proseFetcher(person.id,[],{ onNarration: text => sent=text }));
    assert.ok(sent.includes('Captain Ash')); assert.ok(!sent.includes('The Far Side of Fortune'));
    assert.ok(sent.includes('842'));assert.ok(sent.includes('mid thirties'));assert.ok(sent.includes('Measured and dry.'));assert.ok(sent.includes('Blue coat.'));assert.ok(!sent.includes('"appearance":'));assert.ok(!sent.includes('"outfit":'));
    const id = randomUUID(), story = r.commitOpening(s.id,s.revision,id,'opening',proposal);
    assert.equal(story.origin,'generated'); assert.equal(story.passages.length,1); assert.equal(story.canon.characters[0].name,'Captain Ash');
    assert.equal(story.context.memories.length,1); assert.equal(memoryCurrent(story,story.context.memories[0]),true); assert.equal(story.context.sceneBrief.purpose,'');
    assert.equal(r.listSetups().length,0); assert.equal(r.list().length,1); assert.equal(r.commitOpening(s.id,s.revision,id,'opening',proposal).id,story.id);
    assert.equal(r.openingResult(s.id,id,'opening')!.id,story.id); assert.throws(() => r.openingResult(s.id,id,'different'), /another operation/);
    assert.throws(() => r.commitOpening(s.id,s.revision,randomUUID(),'other',proposal), /already written/);
  } finally { r.close(); }
});

test('failed extraction, invalid effects and late opening output preserve the reviewed setup and do not publish', async () => {
  const r = new StoryRepository(':memory:');
  try {
    const s = draft(r), person = s.plan!.canon.characters[0]; let lastDraft: unknown;
    await assert.rejects(() => generatePassage({ setup: s },settings(),new AbortController().signal,d => lastDraft=d,proseFetcher(person.id,[],{ failExtraction: true })), /JSON/);
    assert.ok(JSON.stringify(lastDraft).includes('retained-content'));assert.ok(JSON.stringify(lastDraft).includes('Ava handed Leto the brass key.')); assert.equal(r.list().length,0); assert.deepEqual(r.readSetup(s.id),s);
    await assert.rejects(()=>generatePassage({ setup: s },settings(),new AbortController().signal,()=>{},proseFetcher(person.id,[{ type:'item.transfer', itemId:'missing', fromOwnerId:person.id, toOwnerId:s.plan!.canon.characters[1].id, evidence:'Ava handed Leto the brass key.' }])),/item|Item/); assert.equal(r.readSetup(s.id).storyId,null);
    const proposal = await generatePassage({setup:s},settings(),new AbortController().signal,()=>{},proseFetcher(person.id));
    r.saveSetup(s.id,{ ...request(s.revision), input:{ ...s.input, narrationStyle:'A new voice.' }, plan:s.plan });
    assert.throws(() => r.commitOpening(s.id,s.revision,randomUUID(),'late',proposal), /setup changed/); assert.equal(r.list().length,0);
  } finally { r.close(); }
});

test('live continuation and latest replacement use the correct baseline and commit inventory plus source-linked memory together', async () => {
  const r = new StoryRepository(':memory:');
  try {
    const s = draft(r), person = s.plan!.canon.characters[0], colleague = s.plan!.canon.characters[1], key = s.plan!.canon.items[0];
    const opening = await generatePassage({ setup:s },settings(),new AbortController().signal,()=>{},proseFetcher(person.id));
    let story = r.commitOpening(s.id,s.revision,randomUUID(),'start',opening);
    const effect = { type:'item.transfer', itemId:key.id, fromOwnerId:person.id, toOwnerId:colleague.id, evidence:'Ava handed Leto the brass key.' };
    const proposal = await generatePassage({ story,mode:'continue',direction:'Let Leto inspect the locker.' },settings(),new AbortController().signal,()=>{},proseFetcher(person.id,[effect],{ endOfChapter:true }));
    const input = { ...request(story.revision), mode:'continue',direction:'Let Leto inspect the locker.' }, fingerprint = jobFingerprint(input);
    story = r.commitGeneratedPassage(story.id,{ expectedRevision:input.expectedRevision,requestId:input.requestId,proposal },fingerprint);
    assert.equal(story.canon.items[0].ownerId,colleague.id); assert.equal(story.context.memories.length,2); assert.equal(r.generatedPassageResult(story.id,input.requestId,fingerprint)!.passages.length,2);
    let sent = '';
    const replacement = await generatePassage({ story, mode:'replace', direction:'Keep the key with Ava.' },settings(),new AbortController().signal,()=>{},proseFetcher(person.id,[],{ text:'Ava kept the brass key in her coat. Leto watched the unmarked crate from across the room.', onNarration: messages => sent=messages }));
    assert.ok(!sent.includes('Let Leto inspect the locker.')); // Removed passage direction is not prior history.
    story = r.commitGeneratedPassage(story.id,{ ...request(story.revision),proposal:replacement });
    assert.equal(story.canon.items[0].ownerId,person.id); assert.equal(story.passages.length,2); assert.equal(story.context.memories.length,2);
    assert.ok(story.context.memories.every(m=>memoryCurrent(story,m)));
    assert.throws(() => r.generatedPassageResult(story.id,input.requestId,'other'),/different generation/);
    const next = await generatePassage({ story,mode:'continue',direction:'' },settings(),new AbortController().signal,()=>{},proseFetcher(person.id,[],{ endOfChapter:true }));
    assert.equal(next.draft.startsChapter,false);
  } finally { r.close(); }
});

test('a short narration is expanded once and effects use only the expanded prose', async () => {
  const r = new StoryRepository(':memory:');
  try {
    const s = draft(r), person = s.plan!.canon.characters[0]; let proseCalls = 0, extractionCalls = 0; const stages: unknown[] = [];
    const fetcher: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init!.body));
      if (body.messages[0].content.startsWith('Return {effects:')) {
        extractionCalls++;
        assert.deepEqual(JSON.parse(body.messages[1].content).paragraphs, [sceneDetail]);
        return completion({ effects: [], memory: { summary: 'The silent delivery troubles Ava.', facts: [], openQuestions: ['Who sent it?'], characterIds: [person.id], locationIds: [person.locationId] } });
      }
      proseCalls++;
      if (proseCalls === 2) assert.ok(body.messages.at(-1).content.includes('Rewrite this same passage'));
      return completion({ title:'The silent berth', chapterTitle:s.plan!.chapterTitle, viewpointId:person.id, endOfChapter:true, paragraphs:[proseCalls === 1 ? 'The ship was quiet.' : sceneDetail] });
    };
    const proposal = await generatePassage({ setup:s },settings(),new AbortController().signal,d=>stages.push(d),fetcher);
    assert.equal(proseCalls,2); assert.equal(extractionCalls,1);
    assert.ok(countWords(proposal.draft.paragraphs) >= 60); assert.equal(proposal.draft.endOfChapter,false);
    assert.ok(stages.some(s=>(s as {stage:string}).stage==='expanding-short-passage'));
    const story = r.commitOpening(s.id,s.revision,randomUUID(),'expanded',proposal);
    assert.deepEqual(story.passages[0].paragraphs,[sceneDetail]); assert.equal(story.context.memories.length,1);
  } finally { r.close(); }
});

test('two short outputs fail before extraction, preserve the setup, and do not retry indefinitely', async () => {
  const r = new StoryRepository(':memory:');
  try {
    const s = draft(r); let calls = 0;
    const fetcher: typeof fetch = async (_url, init) => {
      calls++; assert.ok(!JSON.parse(String(init!.body)).messages[0].content.startsWith('Return {effects:'));
      return completion({ title:'Too brief',chapterTitle:s.plan!.chapterTitle,viewpointId:s.plan!.canon.characters[0].id,endOfChapter:true,paragraphs:['The crew waited.'] });
    };
    await assert.rejects(()=>generatePassage({setup:s},settings(),new AbortController().signal,()=>{},fetcher),/only 3 words after expansion/);
    assert.equal(calls,2); assert.equal(r.list().length,0); assert.deepEqual(r.readSetup(s.id),s);
  } finally { r.close(); }
});

test('extraction fits its output ceiling to the remaining budget without dropping prose or canon', async () => {
  const r = new StoryRepository(':memory:');
  try {
    const s = draft(r), person = s.plan!.canon.characters[0], c = settings(); let original: { messages: unknown[] } | undefined;
    const provider = proseFetcher(person.id,[],{ text:Array(8).fill(sceneDetail).join(' ') });
    await generatePassage({setup:s},c,new AbortController().signal,()=>{},async (url,init)=>{
      const body = JSON.parse(String(init!.body)); if (body.messages[0].content.startsWith('Return {effects:')) original = body;
      return provider(url,init);
    });
    assert.ok(original);
    c.text.contextTokens = estimateInputTokens(original.messages as {role:string;content:string}[]) + c.context.overheadTokens + 1536;
    let extracted = false;
    const result = await generatePassage({setup:s},c,new AbortController().signal,()=>{},async (url,init)=>{
      const body = JSON.parse(String(init!.body));
      if (body.messages[0].content.startsWith('Return {effects:')) { extracted = true; assert.equal(body.max_tokens,1536); assert.deepEqual(body.messages,original!.messages); }
      return provider(url,init);
    });
    assert.equal(extracted,true); assert.equal(result.memory!.characterIds[0],person.id);
    c.text.contextTokens -= 1025;
    await assert.rejects(()=>generatePassage({setup:s},c,new AbortController().signal,()=>{},provider),/context budget/);
    assert.deepEqual(r.readSetup(s.id),s); assert.equal(r.list().length,0);
  } finally { r.close(); }
});

test('chapter pacing blocks premature endings, permits a developed chapter, and honors reader overrides', async () => {
  const r = new StoryRepository(':memory:');
  try {
    const s = draft(r), person = s.plan!.canon.characters[0];
    const opening = await generatePassage({setup:s},settings(),new AbortController().signal,()=>{},proseFetcher(person.id,[],{endOfChapter:true}));
    assert.equal(opening.draft.endOfChapter,false);
    const story = r.commitOpening(s.id,s.revision,randomUUID(),'pacing',opening);
    const closed = await generatePassage({story,mode:'continue',direction:'End this chapter.',chapterEnding:'close'},settings(),new AbortController().signal,()=>{},proseFetcher(person.id));
    assert.equal(closed.draft.endOfChapter,true);
    const developed = structuredClone(story); developed.preferences.chapterWords = 500;
    developed.passages[0].paragraphs = Array(6).fill(sceneDetail);
    const natural = await generatePassage({story:developed,mode:'continue',direction:''},settings(),new AbortController().signal,()=>{},proseFetcher(person.id,[],{endOfChapter:true}));
    assert.equal(natural.draft.endOfChapter,true);
    const held = await generatePassage({story:developed,mode:'continue',direction:'',chapterEnding:'keep-open'},settings(),new AbortController().signal,()=>{},proseFetcher(person.id,[],{endOfChapter:true}));
    assert.equal(held.draft.endOfChapter,false);
    const nextChapter = structuredClone(developed); nextChapter.passages[0].endOfChapter = true;
    const next = await generatePassage({story:nextChapter,mode:'continue',direction:''},settings(),new AbortController().signal,()=>{},proseFetcher(person.id,[],{endOfChapter:true}));
    assert.equal(next.draft.startsChapter,true); assert.equal(next.draft.endOfChapter,false);
    const replacement = await generatePassage({story:developed,mode:'replace',direction:''},settings(),new AbortController().signal,()=>{},proseFetcher(person.id,[],{endOfChapter:true}));
    assert.equal(replacement.draft.endOfChapter,false); // The removed opening's words do not count toward its replacement.
  } finally { r.close(); }
});
