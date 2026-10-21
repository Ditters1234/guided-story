import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { characterSchema } from '../src/lib/story';
import { normalizeCharacterProfile, personaSchema, wardrobeSchema } from '../src/lib/character-profile';
import { visualIdentitySchema } from '../src/lib/visual-identity';
import { createSample } from '../src/lib/server/fixture';
import { StoryRepository } from '../src/lib/server/repository';
import { illustrationDraftSchema,subjectFromCharacter,resolveIllustration,visualIdentityToRemember,reframeIllustration } from '../src/lib/illustration';

const profile=()=>({visual:visualIdentitySchema.parse({age:'900',apparentAge:'30',gender:'nonbinary',presentation:'androgynous',species:'elf',eyes:'green eyes',hair:'silver hair'}),persona:personaSchema.parse({personality:'Patient and observant',voice:'Precise, measured sentences',motives:'Protect the crew',history:'Former archivist'}),wardrobe:wardrobeSchema.parse({upper_body:'a dark linen coat',lower_body:'grey trousers',footwear:'red boots',accessories:'a silver brooch'}),injuries:'A healing cut on the left cheek',appearanceNotes:'Faint runes on the ears',outfitNotes:'The coat is rain-damp'});

test('structured profiles determine summaries, distinguish actual/apparent identity and preserve preferences',()=>{
  const raw={...createSample().canon.characters[0],...profile(),appearance:'WRONG blue eyes',outfit:'WRONG orange jacket',noNsfw:false,pinnedAppearance:true};
  const saved=characterSchema.parse(raw);
  assert.ok(saved.appearance.includes('900'));assert.ok(saved.appearance.includes('30'));assert.ok(saved.appearance.includes('green eyes'));assert.ok(saved.appearance.includes('healing cut'));assert.ok(saved.outfit.includes('dark linen coat'));assert.ok(saved.outfit.includes('red boots'));
  assert.ok(!saved.appearance.includes('WRONG'));assert.ok(!saved.outfit.includes('WRONG'));assert.equal(saved.noNsfw,false);assert.equal(saved.pinnedAppearance,true);
  assert.deepEqual(characterSchema.parse(saved),saved);assert.deepEqual(normalizeCharacterProfile(saved),saved);
});

test('legacy freeform descriptions are carried once when no structured profile exists, without recurring stale summaries',()=>{
  const base={id:'person',name:'Person',role:'Traveller',notes:'A cautious traveller',locationId:'place',appearance:'A weathered face',outfit:'A blue coat'};
  const saved=characterSchema.parse(base);assert.equal(saved.appearanceNotes,'A weathered face');assert.equal(saved.outfitNotes,'A blue coat');assert.deepEqual(characterSchema.parse(saved),saved);
  const corrected=characterSchema.parse({...saved,...profile(),appearanceNotes:'',outfitNotes:''});assert.ok(!corrected.appearance.includes('weathered face'));assert.ok(!corrected.outfit.includes('blue coat'));assert.deepEqual(characterSchema.parse(corrected),corrected);
});

test('image projections retain supplemental visible details while cropping off-frame notes and preserving chronological identity',()=>{
  const story=createSample(),c=normalizeCharacterProfile({...story.canon.characters[0],...profile(),visual:{...profile().visual,distinctive:'A tattoo around the left ankle.'},appearanceNotes:'Faint runes on the ears. A tattoo around the left ankle.',outfitNotes:'The coat is rain-damp. The red boots are muddy.'});story.canon.characters[0]=c;
  const subject=subjectFromCharacter(c,'portrait'),draft=illustrationDraftSchema.parse({framing:'portrait',promptMode:'natural',subjectIds:[c.id],subjects:[subject],passageId:null,style:'Photorealistic photography',scene:'A quiet moment',background:'A ship bridge',template:'{{subject.name}}',negative:''});
  const natural=resolveIllustration(story,draft).text;assert.ok(natural.includes('Faint runes'));assert.ok(natural.includes('rain-damp'));assert.ok(natural.includes('30 years old'));assert.ok(!natural.includes('900'));assert.ok(!natural.includes('muddy'));assert.ok(!natural.includes('boots'));assert.ok(!natural.includes('ankle'));
  draft.promptMode='template';const custom=resolveIllustration(story,draft).text;assert.ok(custom.includes('Faint runes'));assert.ok(custom.includes('rain-damp'));assert.ok(!custom.includes('muddy'));assert.equal(c.visual.age,'900');
  assert.equal(visualIdentityToRemember(c,{...subject,eyes:'hazel eyes'},'portrait').distinctive,c.visual.distinctive,'Remembering a portrait must not erase a known off-frame marking');
});

test('manual profile corrections persist as shared canon, invalidate dependent memory and preserve picture history through ZIP',async()=>{
  const r=new StoryRepository(':memory:');try{
    let story=r.create(),person=story.canon.characters[0],beforeMedia=structuredClone(story.media),epoch=story.context.compaction.epoch;
    const input={expectedRevision:story.revision,requestId:randomUUID(),action:{type:'character' as const,character:{...person,...profile()}}};
    story=r.mutate(story.id,input);person=story.canon.characters[0];
    assert.deepEqual(r.read(story.id).canon.characters[0],person);assert.deepEqual(story.media,beforeMedia);assert.notEqual(story.context.compaction.epoch,epoch);assert.equal(story.recovery?.valid,false);
    assert.deepEqual(r.mutate(story.id,input).canon,story.canon);assert.deepEqual((await r.import(r.export(story.id))).canon,story.canon);
    assert.equal(person.visual?.age,'900');assert.equal(person.visual?.apparentAge,'30');assert.equal(person.persona?.voice,'Precise, measured sentences');assert.equal(person.wardrobe?.footwear,'red boots');
  }finally{r.close();}
});

test('changing crop restores inherited wardrobe and markings while preserving manual shot edits',()=>{
  const story=createSample(),c=normalizeCharacterProfile({...story.canon.characters[0],...profile(),visual:{...profile().visual,distinctive:'A tattoo around the left ankle.'}});story.canon.characters[0]=c;
  const draft=illustrationDraftSchema.parse({framing:'portrait',promptMode:'natural',subjectIds:[c.id],subjects:[{...subjectFromCharacter(c,'portrait'),pose:'one hand raised'}],passageId:null,style:'Photography',scene:'A quiet moment',background:'A ship bridge',template:'{{subjects}}',negative:''});
  const body=reframeIllustration(story,draft,'fullbody');assert.equal(body.subjects[0].footwear,'red boots');assert.equal(body.subjects[0].distinctive,c.visual.distinctive);assert.equal(body.subjects[0].pose,'one hand raised');
  body.subjects[0].footwear='silver boots';const portrait=reframeIllustration(story,body,'portrait');assert.ok(!resolveIllustration(story,portrait).text.includes('boots'));assert.ok(!resolveIllustration(story,portrait).text.includes('ankle'));
  assert.equal(reframeIllustration(story,portrait,'fullbody').subjects[0].footwear,'silver boots');assert.equal(c.wardrobe.footwear,'red boots');
});
