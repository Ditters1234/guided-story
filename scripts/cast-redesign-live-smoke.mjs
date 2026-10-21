// Real saved local text connection; setup records and diagnostics stay isolated.
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,basename} from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';

const folder=mkdtempSync(join(tmpdir(),'storyweaver-cast-redesign-'));
process.env.STORY_DATA_DIR=folder;process.env.STORY_INSTANCE='play';
let repository,diagnostics;
const expandedOnly=process.argv.includes('--expanded-only');
try {
  const {StoryRepository}=await import('../src/lib/server/repository.ts');
  const {getDiagnostics}=await import('../src/lib/server/diagnostics.ts');
  const {readPrivateConnections}=await import('../src/lib/server/connections.ts');
  const {blankSetupPlan}=await import('../src/lib/setup.ts');
  const {normalizeCharacterProfile}=await import('../src/lib/character-profile.ts');
  const {generateSetupCharacter}=await import('../src/lib/server/story-generation.ts');
  diagnostics=getDiagnostics();repository=new StoryRepository(join(folder,'library.sqlite'));
  const connections=readPrivateConnections(),signal=AbortSignal.timeout(600000);
  let draft=repository.createSetup({premise:'An adult diplomatic courier and her archivist colleague prepare for a formal reception aboard an interplanetary liner. Their biographies and wardrobe are editable before the novel begins.',castSize:2},randomUUID());
  const plan=blankSetupPlan(randomUUID),leadId=plan.canon.characters[0].id,placeId=plan.canon.places[0].id;
  plan.title='The Quiet Reception';plan.chapterTitle='A sealed invitation';plan.canon.places[0].name='The liner reception lounge';
  plan.canon.characters[0]=normalizeCharacterProfile({...plan.canon.characters[0],name:'Rowan Vale',role:'Diplomatic courier',visual:{age:'39',apparentAge:'39',gender:'man',presentation:'masculine',species:'human',skin:'warm olive complexion',build:'tall, lean frame',face:'angular jaw',hair:'short dark hair',eyes:'green eyes',distinctive:'a small scar through the left eyebrow'},persona:{personality:'He is deliberate and courteous.',voice:'He speaks in a low measured voice.',motives:'He wants the reception to end without a diplomatic incident.',history:'He spent ten years working as a diplomatic courier.'},wardrobe:{upper_body:"Navy men's tuxedo jacket over a stiff white shirt.",lower_body:"Matching men's formal trousers.",footwear:'Polished black formal lace-up shoes.',accessories:"Black bow tie and engraved men's cufflinks."},injuries:'',appearanceNotes:'',outfitNotes:"His formal outfit is cut for his original masculine silhouette.",notes:'He carries the sealed invitation and dislikes attention.'});
  const colleague=normalizeCharacterProfile({...plan.canon.characters[0],id:randomUUID(),name:'Neri Quill',role:'Archivist',visual:{age:'46',apparentAge:'mid forties',gender:'woman',presentation:'androgynous',species:'human',hair:'silver bob',eyes:'brown eyes'},persona:{personality:'Patient and skeptical.',voice:'Dry and concise.',motives:'Authenticate the invitation.',history:'A former court archivist.'},wardrobe:{upper_body:'Grey linen tunic.',lower_body:'Charcoal trousers.',footwear:'Soft leather boots.',accessories:'A brass pen.'},outfitNotes:'',notes:'Keeps a private catalogue of seal designs.'});
  plan.canon.characters.push(colleague);plan.context.sceneBrief.castIds=[leadId,colleague.id];
  plan.canon.relationships.push({id:randomUUID(),fromId:leadId,toId:colleague.id,notes:'Longtime professional colleagues.'});
  plan.canon.items.push({id:randomUUID(),name:'Sealed invitation',description:'An unopened diplomatic invitation.',quantity:1,ownerId:leadId,equipped:false});
  draft=repository.saveSetup(draft.id,{expectedRevision:draft.revision,requestId:randomUUID(),input:draft.input,plan});
  const direction='Redesign Rowan as an adult woman with feminine presentation and she/her pronouns. Keep her name, profession, age, species, hair, eye color and eyebrow scar. Replace the old tuxedo outfit with a tailored red jacket, black tapered trousers, black ankle boots and a silver necklace; remove the bow tie and cufflinks. Adapt clothing fit and all old masculine wording, including supplemental notes and biography pronouns, to this revised design. Keep her location and the other cast member unchanged. No sexual content.';
  const results={before:plan.canon.characters[0]};
  if(!expandedOnly){
    console.log('Testing a coherent character and wardrobe redesign against the saved local LLM.');
    const revised=await generateSetupCharacter(draft,leadId,direction,connections,signal,fetch,{allowAppearanceChanges:true});
    const lead=revised.canon.characters[0];
    assert.match(lead.visual.gender,/woman|female/i);assert.match(lead.visual.presentation,/feminine/i);
    assert.match(lead.wardrobe.upper_body,/red/i);assert.match(lead.wardrobe.lower_body,/black/i);assert.match(lead.wardrobe.footwear,/ankle/i);assert.match(lead.wardrobe.accessories,/silver.*necklace|necklace.*silver/i);
    assert.doesNotMatch(JSON.stringify({visual:lead.visual,persona:lead.persona,wardrobe:lead.wardrobe,appearanceNotes:lead.appearanceNotes,outfitNotes:lead.outfitNotes,notes:lead.notes}),/\b(?:men's|masculine|tuxedo|bow tie|cufflinks|he|his|him)\b/i);
    assert.equal(lead.visual.age,'39');assert.equal(lead.locationId,placeId);assert.equal(lead.id,leadId);assert.equal(lead.noNsfw,true);assert.equal(lead.pinnedAppearance,false);
    assert.deepEqual(revised.canon.characters[1],draft.plan.canon.characters[1]);assert.deepEqual({...revised.canon,characters:[]},{...draft.plan.canon,characters:[]});assert.deepEqual(revised.context,draft.plan.context);
    draft=repository.commitGeneratedSetup(draft.id,draft.revision,randomUUID(),'live-redesign',revised);
    console.log('Testing an explicit story-details-only redesign preserves every physical field.');
    const storyOnly=await generateSetupCharacter(draft,leadId,'Make her more wary of strangers and more patient with her colleague. The physical profile and outfit must remain unchanged.',connections,signal,fetch,{allowAppearanceChanges:false});
    const guarded=storyOnly.canon.characters[0];for(const key of ['visual','wardrobe','injuries','appearanceNotes','outfitNotes','locationId'])assert.deepEqual(guarded[key],lead[key],key);
    assert.deepEqual(storyOnly.canon.characters[1],colleague);assert.deepEqual(repository.readSetup(draft.id),draft);
    Object.assign(results,{direction,after:lead,storyOnly:guarded});
  }
  console.log('Testing a name-only reroll leaves the complete profile and linked records unchanged.');
  const nameBefore=structuredClone(draft.plan),renamed=await generateSetupCharacter(draft,leadId,'Give this courier a different believable first and last name for the science-fiction setting.',connections,signal,fetch,{mode:'name',allowAppearanceChanges:true});
  const renamedLead=renamed.canon.characters[0];assert.notEqual(renamedLead.name.toLowerCase(),nameBefore.canon.characters[0].name.toLowerCase());
  assert.deepEqual({...renamedLead,name:''},{...nameBefore.canon.characters[0],name:''});assert.deepEqual({...renamed,canon:{...renamed.canon,characters:[]}},{...nameBefore,canon:{...nameBefore.canon,characters:[]}});assert.deepEqual(renamed.canon.characters[1],colleague);
  draft=repository.commitGeneratedSetup(draft.id,draft.revision,randomUUID(),'live-name-reroll',renamed);
  console.log('Testing a full-profile refresh creates a fresh coherent concept and honors retained constraints.');
  const fullDirection='Create a fresh adult woman courier with a new first and last name, feminine presentation, curly copper hair, blue eyes, warm brown skin, an athletic build, a rounded face and a cheek dimple instead of the old eyebrow scar. Rebuild her personality, speaking voice, motives, history and notes around an outgoing former stage performer who recently became a courier; do not keep the original ten-year courier biography. Give her a tailored red jacket, black tapered trousers, black ankle boots and a silver necklace. Remove the old tuxedo, bow tie and cufflinks. Keep only age 39, human species, diplomatic courier ensemble role and current location. No injuries or sexual content. Update all dependent wording to she/her.';
  const refreshed=await generateSetupCharacter(draft,leadId,fullDirection,connections,signal,fetch,{mode:'full',allowAppearanceChanges:true}),fresh=refreshed.canon.characters[0];
  assert.notEqual(fresh.name.toLowerCase(),renamedLead.name.toLowerCase());assert.match(fresh.visual.gender,/woman|female/i);assert.match(fresh.visual.presentation,/feminine/i);assert.match(fresh.visual.hair,/copper/i);assert.match(fresh.visual.eyes,/blue/i);assert.match(fresh.visual.skin,/brown/i);assert.match(fresh.visual.build,/athletic/i);assert.match(fresh.visual.face,/round/i);assert.match(fresh.visual.distinctive,/dimple/i);assert.equal(fresh.visual.age,'39');assert.match(fresh.visual.species,/human/i);
  for(const field of ['personality','voice','motives','history'])assert.notEqual(fresh.persona[field],renamedLead.persona[field],field);assert.match(fresh.persona.history,/performer|stage|theat[er]+|actor|actress/i);
  assert.match(fresh.wardrobe.upper_body,/red/i);assert.match(fresh.wardrobe.lower_body,/black/i);assert.match(fresh.wardrobe.footwear,/ankle/i);assert.match(fresh.wardrobe.accessories,/silver.*necklace|necklace.*silver/i);assert.equal(fresh.injuries,'');
  assert.doesNotMatch(JSON.stringify({visual:fresh.visual,persona:fresh.persona,wardrobe:fresh.wardrobe,appearanceNotes:fresh.appearanceNotes,outfitNotes:fresh.outfitNotes,notes:fresh.notes}),/\b(?:men's|masculine|tuxedo|bow tie|cufflinks|he|his|him|eyebrow scar)\b/i);
  assert.equal(fresh.id,leadId);assert.equal(fresh.locationId,placeId);assert.equal(fresh.noNsfw,true);assert.equal(fresh.pinnedAppearance,false);assert.deepEqual(refreshed.canon.characters[1],colleague);assert.deepEqual({...refreshed.canon,characters:[]},{...draft.plan.canon,characters:[]});assert.deepEqual(refreshed.context,draft.plan.context);assert.deepEqual(repository.readSetup(draft.id),draft);
  Object.assign(results,{nameReroll:renamedLead,fullDirection,fullRefresh:fresh});
  const timings=diagnostics.traces().map(({kind,status,durationMs})=>({kind,status,durationMs}));
  mkdirSync('test-results',{recursive:true});writeFileSync(`test-results/cast-redesign-${expandedOnly?'expanded-':''}live.json`,JSON.stringify({...results,timings},null,2));
  console.log('Request timings:',JSON.stringify(timings));
  console.log('PASS: name reroll changes only the name; full-profile refresh replaces the concept coherently while honoring explicit constraints. Normal saves and settings unchanged.');
} catch(error) {
  mkdirSync('test-results',{recursive:true});writeFileSync('test-results/cast-redesign-live-failure.json',JSON.stringify({error:error.message,traces:diagnostics?.traces()},null,2));throw error;
} finally {
  repository?.close();diagnostics?.close();const target=resolve(folder);
  if((target.startsWith(resolve(tmpdir())+'\\')||target.startsWith(resolve(tmpdir())+'/'))&&basename(target).startsWith('storyweaver-cast-redesign-'))rmSync(target,{recursive:true,force:true});
}
