import { z } from 'zod';
import { storyEffectSchema } from '../effect-types';
import { StoryError } from '../errors';
import { visualIdentitySchema } from '../visual-identity';
import { personaSchema,wardrobeSchema } from '../character-profile';

// Wire format selects a source anchor. Saved/domain effects always retain the actual verbatim quote.
// Only historical receipts accept the former freeform appearance/outfit fields.
// New extraction must address the same structured profile used by editors/images.
const generatedOptions=[
  storyEffectSchema.options[0].omit({appearance:true,outfit:true}).extend({visual:visualIdentitySchema,persona:personaSchema,wardrobe:wardrobeSchema,injuries:z.string().max(10000),appearanceNotes:z.string().max(10000),outfitNotes:z.string().max(10000)}),
  storyEffectSchema.options[1].omit({appearance:true,outfit:true}),
  ...storyEffectSchema.options.slice(2)
];
const generatedEffectsSchema=z.array(z.union([generatedOptions[0]!,...generatedOptions.slice(1)])).max(100);
const indexedOptions = generatedOptions.map(option => { const {evidence: _evidence,...fields}=option.shape; return z.strictObject({...fields,evidenceId:z.string().regex(/^source-\d+$/).max(60)}); });
export const indexedEffectsSchema = z.array(z.union([indexedOptions[0]!,...indexedOptions.slice(1)])).max(100);
import { evidenceSources } from '../passage-evidence';
export { evidenceSources } from '../passage-evidence';
export function resolveEffectEvidence(value: unknown[], sources: ReturnType<typeof evidenceSources>, paragraphs: string[]) {
  const mapped=value.map(effect=>{
    if (!effect || typeof effect!=='object' || Array.isArray(effect)) return effect;
    const record={...effect} as Record<string,unknown>;
    if ('evidenceId' in record) {
      if ('evidence' in record) throw new StoryError('Choose one evidence anchor per effect, not both an ID and a quote.',502);
      const source=sources.find(s=>s.id===record.evidenceId);
      if (!source) throw new StoryError('The model selected an unknown evidence source. Nothing was saved.',502);
      delete record.evidenceId;record.evidence=source.text;
    }
    return record;
  });
  const checked=generatedEffectsSchema.safeParse(mapped);
  if (!checked.success) throw new StoryError('The model returned invalid effect fields ('+checked.error.issues.slice(0,3).map(i=>`${i.path.join('.')}: ${i.message}`).join('; ')+'). Nothing was saved.',502);
  const effects=checked.data, prose=paragraphs.join('\n\n').replace(/\s+/g,' ').trim();
  if (effects.some(e=>!prose.includes(e.evidence.replace(/\s+/g,' ').trim()))) throw new StoryError('The model returned a nonverbatim effect quote. Nothing was saved; select a supplied source ID instead.',502);
  return effects;
}
