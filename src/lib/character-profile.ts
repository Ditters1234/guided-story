import { z } from 'zod';
import { identityFields, identityLabels, visualIdentitySchema, type VisualIdentity } from './visual-identity';

const narrative = z.string().max(4000).default('');
const garment = z.string().max(2000).default('');
export const personaSchema = z.object({ personality:narrative, voice:narrative, motives:narrative, history:narrative });
export const wardrobeSchema = z.object({ upper_body:garment, lower_body:garment, footwear:garment, accessories:garment });
export type Persona = z.infer<typeof personaSchema>;
export type Wardrobe = z.infer<typeof wardrobeSchema>;
export const personaFields = ['personality','voice','motives','history'] as const;
export const wardrobeFields = ['upper_body','lower_body','footwear','accessories'] as const;
export const personaLabels:Record<typeof personaFields[number],string>={personality:'Personality',voice:'Voice / manner of speaking',motives:'Motives / goals',history:'History'};
export const wardrobeLabels:Record<typeof wardrobeFields[number],string>={upper_body:'Upper-body clothing',lower_body:'Lower-body clothing',footwear:'Footwear',accessories:'Worn accessories'};
export const personaUpdateSchema = z.partialRecord(z.enum(personaFields),z.string().max(4000));
export const wardrobeUpdateSchema = z.partialRecord(z.enum(wardrobeFields),z.string().max(2000));

export type CharacterProfileLike = {
  visual?:Partial<VisualIdentity>;persona?:Partial<Persona>;wardrobe?:Partial<Wardrobe>;
  currentState?:string;injuries?:string;appearanceNotes?:string;outfitNotes?:string;appearance?:string;outfit?:string;
};
const hasFacts=(value:Record<string,unknown>|undefined)=>Boolean(value&&Object.values(value).some(v=>typeof v==='string'&&v.trim()));
const readable=(parts:string[])=>parts.filter(Boolean).join('\n').slice(0,40000);
function appearanceNotes(c:CharacterProfileLike){return c.appearanceNotes ?? (!hasFacts(c.visual)?c.appearance || '':'');}
function outfitNotes(c:CharacterProfileLike){return c.outfitNotes ?? (!hasFacts(c.wardrobe)?c.outfit || '':'');}

export function characterAppearanceSummary(c:CharacterProfileLike):string {
  const visual=visualIdentitySchema.parse(c.visual || {});
  return readable([...identityFields.filter(f=>visual[f].trim()).map(f=>`${identityLabels[f]}: ${visual[f]}`),c.injuries?.trim()?`Current injuries / condition: ${c.injuries}`:'',appearanceNotes(c)]);
}
export function characterOutfitSummary(c:CharacterProfileLike):string {
  const wardrobe=wardrobeSchema.parse(c.wardrobe || {});
  return readable([...wardrobeFields.filter(f=>wardrobe[f].trim()).map(f=>`${wardrobeLabels[f]}: ${wardrobe[f]}`),outfitNotes(c)]);
}

/** Canonical profile normalization is deterministic and never calls a model or changes content preferences. */
export function normalizeCharacterProfile<T extends CharacterProfileLike>(c:T) {
  const profile={...c,visual:visualIdentitySchema.parse(c.visual || {}),persona:personaSchema.parse(c.persona || {}),currentState:c.currentState || '',wardrobe:wardrobeSchema.parse(c.wardrobe || {}),injuries:c.injuries || '',appearanceNotes:appearanceNotes(c),outfitNotes:outfitNotes(c)};
  return {...profile,appearance:characterAppearanceSummary(profile),outfit:characterOutfitSummary(profile)};
}
