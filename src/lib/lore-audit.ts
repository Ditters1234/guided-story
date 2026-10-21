import type { Story } from './story';
import { contextSchema, type ContextData, type ContextReport } from './context-types';

type AuditStory = Pick<Story, 'id' | 'revision' | 'canon' | 'context'>;
type LoreEntry = ContextData['lore'][number];
export type LoreAuditIssue = {
  code: 'missing-reference' | 'invalid-path' | 'duplicate-title' | 'duplicate-text' | 'stock-language' | 'placement-language' | 'condition-language';
  message: string;
  heuristic: boolean;
  relatedIds: string[];
};
export type LoreAuditPathPart = { id: string; name: string; kind: 'character' | 'place' | 'item' | 'missing' };
export type LoreAuditLink = LoreAuditPathPart & {
  exists: boolean; path: LoreAuditPathPart[]; pathLabel: string; pathValid: boolean;
  holderId?: string; holderName?: string; rootHolderId?: string | null;
  quantity?: number; unlimited?: boolean; isContainer?: boolean;
};
export type LoreAuditSelection = {
  status: 'included' | 'excluded' | 'unreported' | 'no-preview' | 'stale-preview';
  reason: string; tokens?: number; bytes?: number; required?: boolean;
};
export type LoreAuditEntry = LoreEntry & { links: LoreAuditLink[]; issues: LoreAuditIssue[]; selection: LoreAuditSelection };
export type LoreAudit = {
  storyId: string; revision: number;
  preview: { status: 'current' | 'stale' | 'none'; reason: string; revision?: number };
  entries: LoreAuditEntry[];
  duplicates: { kind: 'title' | 'text'; entryIds: string[] }[];
  summary: { total: number; always: number; relevant: number; hidden: number; missingReferences: number; entriesWithIssues: number; included: number; excluded: number };
};
export type LoreEditBaseline = { storyId: string; revision: number; contextJson: string };

const normalized = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Author-side diagnostics only. Language flags are wording heuristics, never
 * proof of a contradiction, an event, or viewpoint knowledge. */
export function buildLoreAudit(story: AuditStory, report?: ContextReport | null): LoreAudit {
  const records = new Map<string, LoreAuditPathPart>([
    ...story.canon.characters.map(record => [record.id, { id: record.id, name: record.name, kind: 'character' as const }] as const),
    ...story.canon.places.map(record => [record.id, { id: record.id, name: record.name, kind: 'place' as const }] as const),
    ...story.canon.items.map(record => [record.id, { id: record.id, name: record.name, kind: 'item' as const }] as const)
  ]);
  const people = new Map(story.canon.characters.map(record => [record.id, record]));
  const places = new Map(story.canon.places.map(record => [record.id, record]));
  const items = new Map(story.canon.items.map(record => [record.id, record]));
  const normalizedNames = new Map([...records].map(([id, record]) => [id, normalized(record.name)]));
  function physicalPath(id: string): { parts: LoreAuditPathPart[]; valid: boolean } {
    const parts: LoreAuditPathPart[] = [], seen = new Set<string>();
    let current: string | null | undefined = id;
    while (current) {
      const record = records.get(current) || { id: current, name: `Missing record: ${current}`, kind: 'missing' as const };
      if (seen.has(current)) { parts.push({ ...record, name: `Cycle: ${record.name}` }); return { parts: parts.reverse(), valid: false }; }
      parts.push(record);
      if (!records.has(current)) return { parts: parts.reverse(), valid: false };
      seen.add(current);
      current = people.get(current)?.locationId ?? places.get(current)?.parentId ?? items.get(current)?.ownerId;
    }
    return { parts: parts.reverse(), valid: true };
  }
  function link(id: string): LoreAuditLink {
    const identity = records.get(id) || { id, name: 'Missing record', kind: 'missing' as const };
    const path = physicalPath(id), item = items.get(id);
    if (!item) return { ...identity, exists: records.has(id), path: path.parts, pathLabel: path.parts.map(part => part.name).join(' › '), pathValid: path.valid };
    let root = item.ownerId; const seen = new Set([id]);
    while (items.has(root) && !seen.has(root)) { seen.add(root); root = items.get(root)!.ownerId; }
    return { ...identity, exists: true, path: path.parts, pathLabel: path.parts.map(part => part.name).join(' › '), pathValid: path.valid,
      holderId: item.ownerId, holderName: records.get(item.ownerId)?.name || 'Missing holder', rootHolderId: people.has(root) || places.has(root) ? root : null,
      quantity: item.quantity, unlimited: Boolean(item.unlimited), isContainer: Boolean(item.isContainer) };
  }
  const preview: LoreAudit['preview'] = !report ? { status: 'none', reason: 'No context preview supplied. Inclusion has not been measured.' }
    : report.storyId !== story.id || report.revision !== story.revision ? { status: 'stale', revision: report.revision, reason: 'The supplied context preview belongs to another story or revision. Rebuild it before interpreting selection.' }
    : { status: 'current', revision: report.revision, reason: 'Selection below comes from the supplied context preview for this saved revision.' };
  const duplicates: LoreAudit['duplicates'] = [];
  for (const kind of ['title', 'text'] as const) {
    const groups = new Map<string, string[]>();
    for (const entry of story.context.lore) { const key = normalized(entry[kind]); if (key) groups.set(key, [...(groups.get(key) || []), entry.id]); }
    for (const entryIds of groups.values()) if (entryIds.length > 1) duplicates.push({ kind, entryIds });
  }
  const entries = story.context.lore.map((entry): LoreAuditEntry => {
    const links = entry.relatedIds.map(link), issues: LoreAuditIssue[] = [];
    for (const reference of links) {
      if (!reference.exists) issues.push({ code: 'missing-reference', message: `Linked ID ${reference.id} does not identify a current character, place or item.`, heuristic: false, relatedIds: [reference.id] });
      else if (!reference.pathValid) issues.push({ code: 'invalid-path', message: `${reference.name} has a missing or cyclic physical location/storage path.`, heuristic: false, relatedIds: [reference.id] });
    }
    for (const group of duplicates.filter(group => group.entryIds.includes(entry.id))) issues.push({ code: group.kind === 'title' ? 'duplicate-title' : 'duplicate-text', message: `This ${group.kind} matches another background entry after case, spacing and punctuation normalization.`, heuristic: false, relatedIds: group.entryIds.filter(id => id !== entry.id) });
    const related = new Set(entry.relatedIds), normalizedText = ` ${normalized(entry.text)} `;
    const referenced = (id: string) => related.has(id) || Boolean(normalizedNames.get(id) && normalizedText.includes(` ${normalizedNames.get(id)} `));
    const referencedItems = story.canon.items.filter(item => referenced(item.id));
    const relatedObjects = [...story.canon.places, ...story.canon.items].filter(record => referenced(record.id));
    if (referencedItems.length && /\b\d[\d,]*\b|\b(?:quantity|remaining|in stock|left)\b/i.test(entry.text)) issues.push({ code: 'stock-language', message: 'Heuristic: a number or stock wording appears alongside an item reference. Review it against current counted stock and supply mode; this does not establish a contradiction.', heuristic: true, relatedIds: referencedItems.map(item => item.id) });
    if (relatedObjects.length && /\b(?:contains?|holds?|stored|kept|starts?|waits?|currently|now)\b|\b(?:is|are)\s+(?:in|at|inside|on|under)\b/i.test(entry.text)) issues.push({ code: 'placement-language', message: 'Heuristic: this background may describe current storage or placement. Current record paths can change; review the wording rather than treating this flag as proof of stale facts.', heuristic: true, relatedIds: relatedObjects.map(record => record.id) });
    if (relatedObjects.length && /\b(?:unfinished|empty|full|broken|damaged|depleted|exhausted|restocked|replenished)\b/i.test(entry.text)) issues.push({ code: 'condition-language', message: 'Heuristic: this background mentions a condition that could change. Check current records and prose; no semantic contradiction has been determined.', heuristic: true, relatedIds: relatedObjects.map(record => record.id) });
    const source = preview.status === 'current' ? report!.sources.find(source => source.kind === 'lore' && source.id === entry.id) : undefined;
    const selection: LoreAuditSelection = preview.status === 'none' ? { status: 'no-preview', reason: preview.reason }
      : preview.status === 'stale' ? { status: 'stale-preview', reason: preview.reason }
      : source ? { status: source.included ? 'included' : 'excluded', reason: source.reason, tokens: source.tokens, bytes: source.bytes, required: source.required }
      : { status: 'unreported', reason: 'This entry is not listed in the supplied preview. No inclusion or omission reason is available.' };
    return { ...entry, keywords: [...entry.keywords], relatedIds: [...entry.relatedIds], links, issues, selection };
  });
  return { storyId: story.id, revision: story.revision, preview, entries, duplicates, summary: {
    total: entries.length, always: entries.filter(entry => entry.visibility === 'always').length, relevant: entries.filter(entry => entry.visibility === 'relevant').length, hidden: entries.filter(entry => entry.visibility === 'hidden').length,
    missingReferences: entries.flatMap(entry => entry.links).filter(reference => !reference.exists).length, entriesWithIssues: entries.filter(entry => entry.issues.length > 0).length,
    included: entries.filter(entry => entry.selection.status === 'included').length, excluded: entries.filter(entry => entry.selection.status === 'excluded').length
  } };
}

export function captureLoreEditBaseline(story: AuditStory): LoreEditBaseline {
  return { storyId: story.id, revision: story.revision, contextJson: JSON.stringify(story.context) };
}

/** The explicit save replaces lore only. Reject stale editors before the parent
 * submits its ordinary revision-checked context mutation. */
export function prepareLoreContextMutation(story: AuditStory, baseline: LoreEditBaseline, lore: ContextData['lore']): { type: 'context'; context: ContextData } {
  if (story.id !== baseline.storyId || story.revision !== baseline.revision || JSON.stringify(story.context) !== baseline.contextJson) throw new Error('The saved story changed. Reset to the latest saved lore before saving these edits. Your unsaved draft has been kept.');
  const context = contextSchema.parse({ ...structuredClone(story.context), lore: structuredClone(lore) });
  if (context.lore.some(entry => !entry.title.trim())) throw new Error('Every background entry needs a title.');
  if (new Set(context.lore.map(entry => entry.id)).size !== context.lore.length) throw new Error('Background entries need unique IDs.');
  const audit = buildLoreAudit({ ...story, context });
  if (audit.summary.missingReferences) throw new Error('Remove or replace the missing background links before saving.');
  return { type: 'context', context };
}
