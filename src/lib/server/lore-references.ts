import type { Canon } from '../story';
import type { ContextData } from '../context-types';

export type LoreLinkSnapshot = { loreId: string; beforeIds: string[]; afterIds: string[] };
type Lore = ContextData['lore'];

/** Restore only automatically detached links when replacing the latest passage.
 * An author-edited list wins over the saved automatic change. */
export function restoreLoreItemLinks(lore: Lore, snapshots: LoreLinkSnapshot[] | undefined, baseline: Canon) {
  const items = new Set(baseline.items.map(item => item.id));
  for (const snapshot of snapshots || []) {
    const entry = lore.find(entry => entry.id === snapshot.loreId);
    if (!entry || JSON.stringify(entry.relatedIds) !== JSON.stringify(snapshot.afterIds)) continue;
    const retained = new Set(snapshot.afterIds);
    entry.relatedIds = snapshot.beforeIds.filter(id => retained.has(id) || items.has(id));
  }
}

/** Consumption can remove a stock record. Detach its live links without deleting
 * the background itself; preserve a small receipt for latest-passage recovery. */
export function pruneRemovedLoreItemLinks(lore: Lore, before: Canon[], after: Canon): LoreLinkSnapshot[] {
  const items = new Set(after.items.map(item => item.id));
  const removed = new Set(before.flatMap(canon => canon.items.filter(item => !items.has(item.id)).map(item => item.id)));
  const snapshots: LoreLinkSnapshot[] = [];
  if (!removed.size) return snapshots;
  for (const entry of lore) {
    const beforeIds = [...entry.relatedIds], afterIds = beforeIds.filter(id => !removed.has(id));
    if (beforeIds.length === afterIds.length) continue;
    snapshots.push({ loreId: entry.id, beforeIds, afterIds });
    entry.relatedIds = afterIds;
  }
  return snapshots;
}
