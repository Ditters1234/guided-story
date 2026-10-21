// Existing age/gender variables describe what is visible. Actual identity is only
// exposed when a deliberately authored template asks for it explicitly.
export const imageVariables = ['art.style', 'subject.name', 'subject.age', 'subject.apparent_age', 'subject.actual_age', 'subject.gender', 'subject.presentation', 'subject.gender_identity', 'subject.species', 'subject.skin', 'subject.build', 'subject.distinctive', 'subject.face', 'subject.hair', 'subject.eyes', 'subject.injuries', 'subject.appearance_notes', 'subject.outfit_notes', 'subject.upper_body', 'subject.lower_body', 'subject.footwear', 'subject.accessories', 'subject.pose', 'subject.expression', 'subject.position', 'subject.depth', 'subject.gaze', 'image.background', 'image.scene', 'image.composition', 'image.lighting'] as const;
export type ImageVariables = Record<(typeof imageVariables)[number], string>;
export const defaultFullBodyTemplate = '{{art.style}}. Full-body view of {{subject.name}}. {{subject.face}}, {{subject.hair}}. {{subject.upper_body}}, {{subject.lower_body}}, {{subject.footwear}}, {{subject.accessories}}. {{subject.pose}}. {{image.background}}.';
// Fix the former application default without rewriting deliberately authored templates/styles.
export function normalizeStockImageTemplate(template:string) {
  return template === defaultFullBodyTemplate.replace('Full-body view','Full-body illustration') ? defaultFullBodyTemplate : template;
}
export function resolveImagePrompt(template: string, values: ImageVariables, framing: 'portrait' | 'fullbody' | 'scene', nonsexual = true) {
  template = normalizeStockImageTemplate(template);
  const omitted = framing === 'portrait' ? ['subject.lower_body', 'subject.footwear'] : [];
  const unknown = [...template.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map(m => m[1]).filter(key => !(imageVariables as readonly string[]).includes(key));
  if (unknown.length) throw new Error('Unknown prompt variables: ' + [...new Set(unknown)].join(', '));
  const text = template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, key) => omitted.includes(key) ? '' : values[key as keyof ImageVariables] || '').replace(/\s+/g, ' ').trim();
  return { text: text + (nonsexual ? ' Nonsexual presentation, fully clothed.' : ''), omitted };
}
