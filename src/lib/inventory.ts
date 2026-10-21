import type { Canon } from './story';
import { StoryError } from './errors';

type Item = Canon['items'][number];

/** Item ownerId is the immediate holder: a person, a place, or a single container. */
export function validateInventoryState(canon: Canon): void {
  const people = new Set(canon.characters.map(person => person.id));
  const roots = new Set([...people, ...canon.places.map(place => place.id)]);
  const items = new Map(canon.items.map(item => [item.id, item]));
  if (items.size !== canon.items.length) throw new Error('Duplicate item IDs in inventory.');
  for (const item of canon.items) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 1000000) throw new Error('Item quantity must be between 1 and 1000000.');
    if (item.unlimited && (item.quantity !== 1 || item.isContainer || item.equipped)) throw new Error('An unlimited supply must have quantity one, cannot be a container, and cannot be equipped.');
    if (item.isContainer && item.quantity !== 1) throw new Error('A container must have a quantity of one.');
    if (roots.has(item.id)) throw new Error('Item ID collides with an inventory holder.');
    if (!roots.has(item.ownerId) && !items.get(item.ownerId)?.isContainer) throw new Error('Item owner does not exist or is not a container. Choose an existing character, place, or container.');
    if (item.equipped && !people.has(item.ownerId)) throw new Error('Only an item directly held by a character can be equipped.');
    const seen = new Set([item.id]);
    let ownerId = item.ownerId;
    while (!roots.has(ownerId)) {
      if (seen.has(ownerId)) throw new Error('An item cannot contain itself or one of its containers.');
      seen.add(ownerId);
      const owner = items.get(ownerId);
      if (!owner?.isContainer) throw new Error('Item owner does not exist or is not a container. Choose an existing character, place, or container.');
      ownerId = owner.ownerId;
    }
  }
}

/** Returns the eventual person/place holder, or null for an invalid or missing path. */
export function itemRootOwnerId(canon: Canon, itemId: string): string | null {
  const roots = new Set([...canon.characters, ...canon.places].map(record => record.id));
  const items = new Map(canon.items.map(item => [item.id, item]));
  const item = items.get(itemId);
  if (!item) return null;
  const seen = new Set([itemId]);
  let ownerId = item.ownerId;
  while (!roots.has(ownerId)) {
    if (seen.has(ownerId)) return null;
    seen.add(ownerId);
    const owner = items.get(ownerId);
    if (!owner?.isContainer) return null;
    ownerId = owner.ownerId;
  }
  return ownerId;
}

/** Names the complete ownership path of an immediate holder, for selects and receipts. */
export function inventoryPath(canon: Canon, ownerId: string): string {
  const roots = new Map([...canon.characters, ...canon.places].map(record => [record.id, record.name]));
  const items = new Map(canon.items.map(item => [item.id, item]));
  const names: string[] = [], seen = new Set<string>();
  let current = ownerId;
  while (!roots.has(current)) {
    if (seen.has(current)) return 'Invalid container path';
    seen.add(current);
    const item = items.get(current);
    if (!item?.isContainer) return 'Unknown holder';
    names.unshift(item.name);
    current = item.ownerId;
  }
  names.unshift(roots.get(current)!);
  return names.join(' › ');
}

/** Excludes a moving item's entire subtree so the UI cannot offer a cyclic destination. */
export function inventoryHolders(canon: Canon, excludeItemId?: string): { id: string; name: string }[] {
  const excluded = new Set(excludeItemId ? [excludeItemId] : []);
  // A graph may be temporarily incomplete in a form. A bounded fixed point also
  // handles that case without trusting a user-supplied ownership chain.
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of canon.items) if (excluded.has(item.ownerId) && !excluded.has(item.id)) { excluded.add(item.id); changed = true; }
  }
  return [
    ...canon.characters.map(person => ({ id: person.id, name: person.name })),
    ...canon.places.map(place => ({ id: place.id, name: place.name })),
    ...canon.items.filter(item => item.isContainer && item.quantity === 1 && !excluded.has(item.id) && itemRootOwnerId(canon, item.id) !== null)
      .map(item => ({ id: item.id, name: inventoryPath(canon, item.id) }))
  ];
}

/** Splits an exact quantity into a new unequipped stack, committing only after validation. */
export function splitItemStack(canon: Canon, itemId: string, quantity: number, ownerId: string, allocateId: () => string = () => crypto.randomUUID()): string {
  const source = canon.items.find(item => item.id === itemId);
  if (!source) throw new StoryError('The item to split does not exist.');
  if (source.unlimited) throw new StoryError('Unlimited supplies cannot be split. Draw a counted portion instead.');
  if (source.isContainer) throw new StoryError('Containers cannot be split.');
  if (!Number.isInteger(quantity) || quantity < 1 || quantity >= source.quantity) throw new StoryError('Split off at least one item and leave at least one in the original stack.');
  if (canon.items.length >= 5000) throw new StoryError('The inventory has reached its item limit.');
  const id = allocateId();
  if (typeof id !== 'string' || !id.length || id.length > 100 || [...canon.characters, ...canon.places, ...canon.items, ...canon.relationships, ...canon.threads].some(record => record.id === id)) throw new StoryError('The new stack ID collided with an existing record.');
  const created: Item = { id, name: source.name, description: source.description, ...(source.visualDescription !== undefined ? {visualDescription:source.visualDescription} : {}), quantity, ownerId, equipped: false, isContainer: false };
  const items = canon.items.map(item => item.id === itemId ? { ...item, quantity: item.quantity - quantity } : item);
  items.push(created);
  try { validateInventoryState({ ...canon, items }); }
  catch (error) { throw new StoryError(`${error instanceof Error ? error.message : 'Invalid inventory destination.'} No items were split.`); }
  source.quantity -= quantity;
  canon.items.push(created);
  return id;
}
