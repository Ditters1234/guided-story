import { z } from 'zod';
import type { Story } from './story';
import { mediaAssetSchema } from './media';
import { imageVariables, resolveImagePrompt, type ImageVariables } from './image-prompts';
import { identityFields, visualIdentitySchema } from './visual-identity';
import { normalizeCharacterProfile } from './character-profile';

const detail = z.string().max(2000);
export const shotDetailGroups = ['faceHair','build','clothing','accessories','distinctive'] as const;
export const shotDetailLabels:Record<typeof shotDetailGroups[number],string> = {faceHair:'Face, hair & eyes',build:'Build',clothing:'Clothing',accessories:'Accessories',distinctive:'Distinctive details & condition'};
export const shotControlsSchema = z.object({
  position:z.enum(['automatic','left','center','right']).default('automatic'),
  depth:z.enum(['automatic','foreground','middle','background']).default('automatic'),
  gaze:z.union([z.enum(['automatic','camera','elsewhere']),z.string().regex(/^character:.{1,100}$/)]).default('automatic'),
  include:z.object({faceHair:z.boolean().default(true),build:z.boolean().default(true),clothing:z.boolean().default(true),accessories:z.boolean().default(true),distinctive:z.boolean().default(true)}).prefault({})
});
export const visualSubjectDetailsSchema = visualIdentitySchema.extend({ id: z.string().min(1).max(100), appearanceNotes:detail.default(''), outfitNotes:detail.default(''), injuries:detail.default(''), upper_body: detail.default(''), lower_body: detail.default(''), footwear: detail.default(''), accessories: detail.default(''), pose: detail.default(''), expression: detail.default('') });
export const visualSubjectSchema = visualSubjectDetailsSchema.extend({shot:shotControlsSchema.prefault({})});
export type VisualSubject = z.infer<typeof visualSubjectSchema>;
export const illustrationDraftSchema = z.object({ framing: z.enum(['portrait','fullbody','scene']), subjectIds: z.array(z.string().min(1).max(100)).max(12), subjects: z.array(visualSubjectSchema).max(6), passageId: z.string().min(1).max(100).nullable(), parentId: z.string().uuid().nullable().default(null), style: z.string().max(4000), scene: z.string().max(5000), sceneFocus: detail.default(''), background: detail, composition:detail.default(''), lighting:detail.default(''), promptMode:z.enum(['natural','template']).default('template'), template: z.string().min(1).max(10000), negative: z.string().max(10000), promptOverride: z.string().max(15000).default(''), nonsexual: z.boolean().default(true) });
export type IllustrationDraft = z.infer<typeof illustrationDraftSchema>;
export const illustrationCaptureSchema = z.object({ storyId: z.string().min(1).max(100), revision: z.number().int().min(0), source: mediaAssetSchema.shape.source, snapshots: mediaAssetSchema.shape.snapshots, subjectIds: mediaAssetSchema.shape.subjectIds, category: mediaAssetSchema.shape.category, parentId: z.string().uuid().nullable(), draft: illustrationDraftSchema, prompt: z.string().max(16000), protectedNames: z.array(z.string().max(120)).max(6), contentPreferences:z.object({storyAdultContent:z.boolean(),requestedNonsexual:z.boolean(),contentNotes:z.string().max(6000).default(''),characters:z.array(z.object({id:z.string().max(100),noNsfw:z.boolean()})).max(6)}) });
export type IllustrationCapture = z.infer<typeof illustrationCaptureSchema>;
export const groupSceneTemplate = '{{art.style}}. {{image.scene}}. {{image.background}}. {{subjects}}';
export const visualFields = [...identityFields,'appearanceNotes','outfitNotes','injuries','upper_body','lower_body','footwear','accessories','pose','expression'] as const;
type VisualField = typeof visualFields[number];
export const illustrationVariables = [...imageVariables, 'subjects'] as const;

const sentence=(value:string)=>{const s=value.replace(/\s+/g,' ').trim();return s ? s+(/[.!?]$/.test(s)?'':'.') : '';};
const offFrame=/(?:\b(?:shoes?|boots?|feet|footwear|trousers|pants|skirt|legs?|hips?|ankles?|knees?|calves|calf|thighs?|waist|socks?|stockings?|shorts|leggings)\b)/i;
const detailParts=(value:string)=>value.split(/(?<=[.!?;])\s+|\n+/);
const visibleSummary=(value:string,portrait:boolean)=>detailParts(value).filter(part=>!portrait||!offFrame.test(part)).join(' ').slice(0,2000);
export function defaultShotControls(framing:IllustrationDraft['framing']) {
  return shotControlsSchema.parse({include:{build:framing!=='portrait'}});
}
// Omission is a projection: disabling details never erases the saved shot values.
export function includedVisualSubject(subject:VisualSubject,framing:IllustrationDraft['framing']) {
  const visible={...subject},include=subject.shot.include;
  const excluded:VisualField[]=[...(!include.faceHair?['face','hair','eyes'] as const:[]),...(!include.build?['build'] as const:[]),...(!include.clothing?['upper_body','lower_body','footwear','outfitNotes'] as const:[]),...(!include.accessories?['accessories'] as const:[]),...(!include.distinctive?['distinctive','appearanceNotes','injuries'] as const:[]),...(framing==='portrait'?['lower_body','footwear'] as const:[])];
  for(const field of excluded)visible[field]='';
  return visible;
}
function shotStaging(name:string,subject:VisualSubject,people:Story['canon']['characters']) {
  const {position,depth,gaze}=subject.shot;
  const target=gaze.startsWith('character:')?people.find(c=>c.id===gaze.slice(10)&&c.id!==subject.id):undefined;
  const positionText=position==='automatic'?'':position==='center'?'in the center of the image':`on the ${position} side of the image`;
  const depthText=depth==='automatic'?'':depth==='middle'?'in the middle ground':`in the ${depth}`;
  const gazeText=gaze==='camera'?'looking at the camera':gaze==='elsewhere'?'looking away from the camera':target?`looking at ${target.name}`:'';
  return {position:positionText,depth:depthText,gaze:gazeText,text:[positionText||depthText?sentence(`${name} is ${[positionText,depthText].filter(Boolean).join(', ')}`):'',gazeText?sentence(`${name} is ${gazeText}`):''].filter(Boolean).join(' ')};
}
export function usesCurrentCharacterState(story:Story,passageId:IllustrationDraft['passageId']) {
  return !passageId || passageId===story.passages.at(-1)?.id;
}
export function subjectFromCharacter(c:Story['canon']['characters'][number],framing:IllustrationDraft['framing'],includeCurrentState=true) {
  const profile=normalizeCharacterProfile(c),wardrobe=includeCurrentState?profile.wardrobe:{};
  // Stable identity is reusable; current clothing/injuries cannot stand in for
  // historical state. Never place a whole outfit into an upper-body field.
  const visual=visualIdentitySchema.parse(profile.visual || {});if(framing==='portrait')visual.distinctive=visibleSummary(visual.distinctive,true);
  return visualSubjectSchema.parse({id:c.id,...visual,...wardrobe,shot:defaultShotControls(framing),
    appearanceNotes:visibleSummary(profile.appearanceNotes,framing==='portrait'),outfitNotes:includeCurrentState?visibleSummary(profile.outfitNotes,framing==='portrait'):'',
    injuries:includeCurrentState?visibleSummary(profile.injuries,framing==='portrait'):'',
    lower_body:framing==='portrait'?'':('lower_body' in wardrobe?wardrobe.lower_body:''),footwear:framing==='portrait'?'':('footwear' in wardrobe?wardrobe.footwear:'')});
}
export function fillFromSavedProfiles(story:Story,draft:IllustrationDraft) {
  return illustrationDraftSchema.parse({...draft,subjects:draft.subjects.map(s=>{const c=story.canon.characters.find(c=>c.id===s.id);if(!c)return s;const saved=subjectFromCharacter(c,draft.framing,usesCurrentCharacterState(story,draft.passageId));return {...s,...Object.fromEntries(visualFields.map(k=>[k,s[k].trim()?s[k]:saved[k]]))};})});
}
export function reframeVisualSubject(c:Story['canon']['characters'][number],subject:z.infer<typeof visualSubjectSchema>,previous:IllustrationDraft['framing'],next:IllustrationDraft['framing'],includeCurrentState=true){
  const before=subjectFromCharacter(c,previous,includeCurrentState),after=subjectFromCharacter(c,next,includeCurrentState);
  // Reproject inherited values; keep actual per-picture edits when changing crop.
  return visualSubjectSchema.parse({...subject,...Object.fromEntries(visualFields.filter(f=>subject[f]===before[f]).map(f=>[f,after[f]])),shot:{...subject.shot,include:{...subject.shot.include,...Object.fromEntries(shotDetailGroups.filter(f=>subject.shot.include[f]===before.shot.include[f]).map(f=>[f,after.shot.include[f]]))}}});
}
export function reframeIllustration(story:Story,draft:IllustrationDraft,next:IllustrationDraft['framing']){
  const currentState=usesCurrentCharacterState(story,draft.passageId);
  return illustrationDraftSchema.parse({...draft,framing:next,subjects:draft.subjects.map(s=>{const c=story.canon.characters.find(c=>c.id===s.id);return c?reframeVisualSubject(c,s,draft.framing,next,currentState):s;})});
}
export function visualIdentityToRemember(c:Story['canon']['characters'][number],subject:z.infer<typeof visualSubjectSchema>,framing:IllustrationDraft['framing']='scene'){
  const current=visualIdentitySchema.parse(c.visual || {});
  const hidden=framing==='portrait'?detailParts(current.distinctive).filter(part=>offFrame.test(part)).join(' '):'';
  const distinctive=framing==='portrait'?[visibleSummary(subject.distinctive,true),hidden].filter(Boolean).join(' '):subject.distinctive;
  return visualIdentitySchema.parse({...subject,distinctive,age:current.age || subject.age,gender:current.gender || subject.gender});
}
function identityDescription(name:string,s:z.infer<typeof visualSubjectSchema>,fields:readonly string[]=identityFields,portrait=false){
  const sentences:string[]=[];
  const age=s.apparentAge.trim()||s.age.trim(),presentation=s.presentation.trim()||s.gender.trim();
  if((fields.includes('age')||fields.includes('apparentAge'))&&age)sentences.push(sentence(/^\d+$/.test(age)?`${name} appears ${age} years old`:`${name}'s apparent age is ${age}`));
  if((fields.includes('gender')||fields.includes('presentation'))&&presentation)sentences.push(sentence(`${name} presents as ${presentation}`));
  if(fields.includes('species')&&s.species.trim())sentences.push(sentence(`${name} is ${s.species}`));
  const traits=fields.filter(f=>!['age','apparentAge','gender','presentation','species'].includes(f)).map(f=>(f==='distinctive'&&portrait?visibleSummary(s.distinctive,true):s[f as VisualField]).trim()).filter(Boolean);
  if(traits.length)sentences.push(sentence(`${name}'s visible appearance includes ${traits.join('; ')}`));
  return sentences.join(' ');
}
export function mergeIllustrationSuggestions(draft:IllustrationDraft,result:{scene:string;background:string;subjects:z.infer<typeof visualSubjectDetailsSchema>[]},mode:'refresh'|'fill-missing'){
  if(result.subjects.length!==draft.subjects.length||new Set(result.subjects.map(s=>s.id)).size!==draft.subjects.length||result.subjects.some(s=>!draft.subjects.some(d=>d.id===s.id)))throw new Error('The visual assistant must return each selected cast member exactly once.');
  const keep=(current:string,suggested:string,identity=false)=>current.trim()&&(mode==='fill-missing'||identity)?current:suggested;
  return illustrationDraftSchema.parse({...draft,scene:keep(draft.scene,result.scene),background:keep(draft.background,result.background),subjects:draft.subjects.map(s=>{
    const suggested=result.subjects.find(r=>r.id===s.id)!;
    return {id:s.id,shot:s.shot,...Object.fromEntries(visualFields.map(f=>[f,draft.framing==='portrait'&&['lower_body','footwear'].includes(f)?'':keep(s[f],suggested[f],((identityFields as readonly string[]).includes(f)||f==='appearanceNotes'))]))};
  })});
}

// Freshness for story-derived shot details, independent of image saves, seed or template edits.
export function illustrationSourceKey(story:Story,draft:IllustrationDraft){
  const people=story.canon.characters.filter(c=>draft.subjectIds.includes(c.id)),source=story.passages.find(p=>p.id===draft.passageId);
  return JSON.stringify({storyId:story.id,framing:draft.framing,subjectIds:[...draft.subjectIds].sort(),passageId:draft.passageId,sceneFocus:draft.passageId?draft.sceneFocus.trim():'',
    source:source?{id:source.id,title:source.title,viewpoint:source.viewpoint,paragraphs:source.paragraphs}:null,
    people,places:story.canon.places.filter(p=>draft.subjectIds.includes(p.id)||people.some(c=>c.locationId===p.id)),items:story.canon.items.filter(i=>draft.subjectIds.includes(i.id)),
    adultContent:story.adultContent,requestedNonsexual:draft.nonsexual,contentNotes:story.preferences.contentNotes});
}

export function illustrationContentPolicy(story:Story,draft:Pick<IllustrationDraft,'subjectIds'|'nonsexual'>){
  const people=story.canon.characters.filter(c=>draft.subjectIds.includes(c.id));
  const storyRequiresNonsexual=!story.adultContent,globalNonsexual=draft.nonsexual||storyRequiresNonsexual;
  return {storyRequiresNonsexual,globalNonsexual,individualNames:people.filter(c=>c.noNsfw).map(c=>c.name),protectedNames:people.filter(c=>globalNonsexual||c.noNsfw).map(c=>c.name)};
}

export function resolveIllustration(story: Story, value: unknown) {
  const draft = illustrationDraftSchema.parse(value);
  const entities = [...story.canon.characters,...story.canon.places,...story.canon.items];
  if (new Set(draft.subjectIds).size !== draft.subjectIds.length || draft.subjectIds.some(id=>!entities.some(e=>e.id===id))) throw new Error('Choose existing, distinct depicted subjects.');
  const people = story.canon.characters.filter(c=>draft.subjectIds.includes(c.id));
  if (people.length > 6 || (draft.framing !== 'scene' && people.length !== 1)) throw new Error('Choose one cast member for a portrait/full-body picture, or up to six for a scene.');
  if (new Set(draft.subjects.map(s=>s.id)).size !== draft.subjects.length || draft.subjects.length !== people.length || draft.subjects.some(s=>!people.some(c=>c.id===s.id))) throw new Error('Each depicted cast member needs their own visual details.');
  if(draft.subjects.some(s=>s.shot.gaze.startsWith('character:')&&!people.some(c=>c.id===s.shot.gaze.slice(10)&&c.id!==s.id)))throw new Error('Choose another depicted cast member as the gaze target, or use automatic gaze.');
  if (draft.passageId && !story.passages.some(p=>p.id===draft.passageId)) throw new Error('Source passage does not exist.');
  if (draft.parentId && !story.media.assets.some(a=>a.id===draft.parentId)) throw new Error('Parent picture does not exist.');
  // A user can prepare the shot manually without a text connection. Use their
  // selected moment verbatim only when there is no resolved scene to replace it.
  const scene=draft.scene.trim()?draft.scene:draft.passageId?draft.sceneFocus.trim():'';
  const {globalNonsexual,protectedNames}=illustrationContentPolicy(story,draft);
  const visibleSubjects=draft.subjects.map(s=>includedVisualSubject(s,draft.framing));
  const subjectValues = people.map(c=>{
    const details = visibleSubjects.find(s=>s.id===c.id)!,staging=shotStaging(c.name,details,people);
    const visibleAge=details.apparentAge.trim()||details.age,visiblePresentation=details.presentation.trim()||details.gender;
    return Object.fromEntries(imageVariables.map(key=>[key, key === 'art.style' ? draft.style : key === 'image.scene' ? scene : key === 'image.background' ? draft.background : key === 'image.composition' ? draft.composition : key === 'image.lighting' ? draft.lighting : key === 'subject.name' ? c.name : key==='subject.position'?staging.position:key==='subject.depth'?staging.depth:key==='subject.gaze'?staging.gaze:key==='subject.age'?visibleAge:key==='subject.apparent_age'?details.apparentAge:key==='subject.actual_age'?details.age:key==='subject.gender'?visiblePresentation:key==='subject.presentation'?details.presentation:key==='subject.gender_identity'?details.gender:key==='subject.distinctive'?visibleSummary(details.distinctive,draft.framing==='portrait'):key==='subject.appearance_notes'?visibleSummary(details.appearanceNotes,draft.framing==='portrait'):key==='subject.outfit_notes'?visibleSummary(details.outfitNotes,draft.framing==='portrait'):key==='subject.injuries'?visibleSummary(details.injuries,draft.framing==='portrait'):details[key.slice(8) as VisualField] || ''])) as ImageVariables;
  });
  const castBlocks = people.map((c,i)=>{
    const s = visibleSubjects.find(s=>s.id===c.id)!;
    const clothing:VisualField[]=['upper_body',...(draft.framing==='portrait'?[]:['lower_body','footwear'] as const),'accessories'];
    const fallback=s.shot.include.distinctive&&!['age','apparentAge','skin','build','face','hair','eyes','distinctive'].some(f=>s[f as VisualField].trim())?visibleSummary(normalizeCharacterProfile(c).appearanceNotes,draft.framing==='portrait'):'',injuries=visibleSummary(s.injuries,draft.framing==='portrait'),appearanceNotes=visibleSummary(s.appearanceNotes||fallback,draft.framing==='portrait'),outfitNotes=visibleSummary(s.outfitNotes,draft.framing==='portrait');
    return [people.length>1?`Subject ${i+1}, ${c.name}.`:sentence(c.name),identityDescription(c.name,s,identityFields,draft.framing==='portrait'),appearanceNotes?sentence(`${c.name}'s additional visible features: ${appearanceNotes}`):'',
      ...clothing.filter(f=>s[f].trim()).map(f=>sentence(`${c.name} wears ${s[f]}`)),
      outfitNotes?sentence(`${c.name}'s additional clothing details: ${outfitNotes}`):'',
      injuries?sentence(`${c.name}'s visible injuries: ${injuries}`):'',
      shotStaging(c.name,s,people).text,s.pose.trim()?sentence(`${c.name}'s position and action: ${s.pose}`):'',s.expression.trim()?sentence(`${c.name}'s expression: ${s.expression}`):''].filter(Boolean).join(' ');
  }).join('\n');
  const otherBlocks = [...story.canon.places,...story.canon.items].filter(e=>draft.subjectIds.includes(e.id)).map(e=>`${story.canon.places.some(p=>p.id===e.id)?'Depicted setting':'Depicted object'}, ${e.name}: ${'visualDescription' in e&&typeof e.visualDescription==='string'&&e.visualDescription.trim()?e.visualDescription:e.description}`).join('\n');
  const blocks = [castBlocks,otherBlocks].filter(Boolean).join('\n');
  const defaults = Object.fromEntries(imageVariables.map(k=>[k,''])) as ImageVariables;
  const first = subjectValues[0] || {...defaults,'art.style':draft.style,'image.scene':scene,'image.background':draft.background,'image.composition':draft.composition,'image.lighting':draft.lighting};
  const unknown = [...draft.template.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map(m=>m[1]).filter(k=>!(illustrationVariables as readonly string[]).includes(k));
  if (unknown.length && draft.promptMode==='template' && !draft.promptOverride.trim()) throw new Error('Unknown prompt variables: '+[...new Set(unknown)].join(', '));
  if (people.length > 1 && draft.promptMode==='template' && !/\{\{\s*subjects\s*\}\}/.test(draft.template) && !draft.promptOverride.trim()) throw new Error('Use {{subjects}} in a group template so every cast member keeps their own details.');
  const placeholder = '__STORYWEAVER_SUBJECTS__';
  const framing=draft.framing==='portrait'?'A bust portrait of one character, framed from the chest up':draft.framing==='fullbody'?'A full-body view of one character, with the entire figure visible':people.length?`One scene showing exactly ${people.length} ${people.length===1?'character':'characters'}`:'A view of the environment or object';
  const natural=[sentence(framing),sentence(scene),castBlocks,otherBlocks,sentence(draft.background?`The setting is ${draft.background}`:''),sentence(draft.composition),sentence(draft.lighting),sentence(draft.style?`Visual style: ${draft.style}`:'')].filter(Boolean).join('\n\n');
  // Older/custom single-subject templates must not silently lose identity or eye details.
  const hasVariable=(...fields:string[])=>fields.some(f=>new RegExp('\\{\\{\\s*subject\\.'+f+'\\s*\\}\\}').test(draft.template));
  const extraIdentity=people.length===1&&!/\{\{\s*subjects\s*\}\}/.test(draft.template)?identityDescription(people[0].name,visibleSubjects[0],identityFields.filter(f=>f==='age'||f==='apparentAge'?!hasVariable('age','apparent_age'):f==='gender'||f==='presentation'?!hasVariable('gender','presentation'):!hasVariable(f)),draft.framing==='portrait'):'';
  const visibleInjuries=people.length===1?visibleSummary(visibleSubjects[0].injuries,draft.framing==='portrait'):'';
  const extraInjuries=people.length===1&&!/\{\{\s*subjects\s*\}\}/.test(draft.template)&&!hasVariable('injuries')&&visibleInjuries?sentence(`${people[0].name}'s visible injuries: ${visibleInjuries}`):'';
  const extraNotes=people.length===1&&!/\{\{\s*subjects\s*\}\}/.test(draft.template)?[['appearance_notes','additional visible features',visibleSubjects[0].appearanceNotes],['outfit_notes','additional clothing details',visibleSubjects[0].outfitNotes]].filter(([field,,value])=>value.trim()&&!hasVariable(field)).map(([,label,value])=>{const visible=visibleSummary(value,draft.framing==='portrait');return visible?sentence(`${people[0].name}'s ${label}: ${visible}`):'';}).filter(Boolean).join(' '):'';
  const extraStaging=people.length===1&&!/\{\{\s*subjects\s*\}\}/.test(draft.template)?(()=>{const staging=shotStaging(people[0].name,visibleSubjects[0],people);return (['position','depth','gaze'] as const).filter(f=>staging[f]&&!hasVariable(f)).map(f=>sentence(`${people[0].name} is ${staging[f]}`)).join(' ');})():'';
  const rendered = draft.promptOverride.trim() ? '' : draft.promptMode==='natural'?natural:[resolveImagePrompt(draft.template.replace(/\{\{\s*subjects\s*\}\}/g,placeholder), first,draft.framing,false).text.replaceAll(placeholder,blocks),extraIdentity,extraInjuries,extraNotes,extraStaging].filter(Boolean).join('\n');
  const instructions = globalNonsexual ? people.length ? 'Nonsexual presentation, fully clothed.' : 'Nonsexual presentation.' : protectedNames.length ? `Keep these depicted characters nonsexual and fully clothed: ${protectedNames.join(', ')}.` : '';
  const contentNotes = story.preferences.contentNotes.trim();
  const text = [draft.promptOverride.trim() || rendered,instructions,contentNotes ? `Story content preferences: ${contentNotes}` : ''].filter(Boolean).join('\n').trim();
  if (!text || text.length > 16000) throw new Error('The resolved prompt must contain 1–16,000 characters. Shorten the scene or subject details.');
  return { draft, text, protectedNames, variables: { ...first, subjects:blocks }, omitted: draft.framing === 'portrait' ? ['subject.lower_body','subject.footwear'] : [] };
}
