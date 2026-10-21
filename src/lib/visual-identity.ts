import { z } from 'zod';

// Persistent visible identity. Pose, expression and clothing belong to an individual shot.
const trait = z.string().max(2000).default('');
export const visualIdentitySchema = z.object({ age:trait, apparentAge:trait, gender:trait, presentation:trait, species:trait, skin:trait, build:trait, face:trait, hair:trait, eyes:trait, distinctive:trait });
export type VisualIdentity = z.infer<typeof visualIdentitySchema>;
export const identityFields = ['age','apparentAge','gender','presentation','species','skin','build','face','hair','eyes','distinctive'] as const;
export const visualIdentityUpdateSchema = z.partialRecord(z.enum(identityFields),z.string().max(2000));
export const identityLabels:Record<typeof identityFields[number],string> = {
  age:'Age (actual age)',apparentAge:'Apparent age',gender:'Gender',presentation:'Presentation',species:'Species / form',skin:'Skin / complexion',build:'Build / silhouette',face:'Face',hair:'Hair',eyes:'Eyes',distinctive:'Distinctive features'
};
