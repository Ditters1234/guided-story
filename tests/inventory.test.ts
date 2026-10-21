import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSample } from '../src/lib/server/fixture';
import { validateCanonicalState, transferItem, type Canon } from '../src/lib/story';
import { inventoryHolders, inventoryPath, itemRootOwnerId, splitItemStack, validateInventoryState } from '../src/lib/inventory';
import { applyStoryEffects } from '../src/lib/story-effects';

function inventory(): Canon {
  const canon = createSample().canon;
  canon.items.push(
    { id: 'pack', name: 'Canvas pack', description: 'An old canvas pack.', quantity: 1, ownerId: 'elias', equipped: true, isContainer: true },
    { id: 'pouch', name: 'Drawstring pouch', description: 'A small inner pouch.', quantity: 1, ownerId: 'pack', equipped: false, isContainer: true },
    { id: 'ammunition', name: 'Brass cartridges', description: 'Ten marked brass cartridges.', quantity: 10, ownerId: 'pouch', equipped: false }
  );
  return canon;
}
const evidence = 'Elias put three cartridges in Mira’s pack and handed her the canvas pack.';

test('legacy inventory remains valid and nested holders show ownership paths', () => {
  validateCanonicalState(createSample().canon);
  const canon = inventory();
  validateCanonicalState(canon);
  assert.equal(itemRootOwnerId(canon, 'ammunition'), 'elias');
  assert.equal(inventoryPath(canon, 'pouch'), 'Elias Voss › Canvas pack › Drawstring pouch');
  assert.equal(inventoryPath(canon, 'hold'), 'Cargo hold');
  assert.equal(itemRootOwnerId(canon, 'missing'), null);
  const holders = inventoryHolders(canon);
  assert.ok(holders.some(holder => holder.id === 'pouch' && holder.name === 'Elias Voss › Canvas pack › Drawstring pouch'));
  assert.ok(!holders.some(holder => holder.id === 'ammunition'));
  const movingPack = inventoryHolders(canon, 'pack');
  assert.ok(movingPack.some(holder => holder.id === 'mira'));
  assert.ok(!movingPack.some(holder => ['pack', 'pouch'].includes(holder.id)));
  assert.ok(!inventoryHolders(canon, 'pouch').some(holder => holder.id === 'pouch'));
  assert.ok(inventoryHolders(canon, 'pouch').some(holder => holder.id === 'pack'));
});

test('moving a container carries its nested contents without changing or equipping their records', () => {
  const canon = inventory(), contents = structuredClone(canon.items.filter(item => ['pouch', 'ammunition'].includes(item.id)));
  transferItem(canon, 'pack', 'mira');
  assert.equal(canon.items.find(item => item.id === 'pack')!.equipped, false);
  assert.deepEqual(canon.items.filter(item => ['pouch', 'ammunition'].includes(item.id)), contents);
  assert.equal(itemRootOwnerId(canon, 'ammunition'), 'mira');
  assert.equal(inventoryPath(canon, 'pouch'), 'Mira Sol › Canvas pack › Drawstring pouch');
  transferItem(canon, 'pack', 'hold');
  assert.equal(itemRootOwnerId(canon, 'ammunition'), 'hold');
  validateCanonicalState(canon);
});

test('containment rejects self/cycles, noncontainers, stacked containers and equipped contents', () => {
  for (const mutate of [
    (canon: Canon) => { canon.items.find(item => item.id === 'pack')!.ownerId = 'pack'; },
    (canon: Canon) => { canon.items.find(item => item.id === 'pack')!.ownerId = 'pouch'; },
    (canon: Canon) => { canon.items.find(item => item.id === 'pack')!.isContainer = false; },
    (canon: Canon) => { canon.items.find(item => item.id === 'pack')!.quantity = 2; },
    (canon: Canon) => { canon.items.find(item => item.id === 'ammunition')!.ownerId = 'fob'; },
    (canon: Canon) => { canon.items.find(item => item.id === 'ammunition')!.equipped = true; },
    (canon: Canon) => { canon.items = canon.items.filter(item => item.id !== 'pack'); }
  ]) {
    const canon = inventory(); mutate(canon);
    assert.throws(() => validateCanonicalState(canon), /container|directly held/);
  }
  const canon = inventory(), before = structuredClone(canon);
  assert.throws(() => transferItem(canon, 'pack', 'pouch'), /contain/);
  assert.deepEqual(canon, before);
  canon.items.find(item => item.id === 'pack')!.ownerId = 'pouch';
  assert.equal(itemRootOwnerId(canon, 'ammunition'), null);
  assert.equal(inventoryPath(canon, 'pouch'), 'Invalid container path');
  assert.ok(!inventoryHolders(canon).some(holder => holder.id === 'pouch'));
});

test('a split conserves quantity, preserves exact identity, and starts unequipped in the selected holder', () => {
  const canon = inventory(), source = canon.items.find(item => item.id === 'ammunition')!;
  source.equipped = true; source.ownerId = 'elias';
  const id = splitItemStack(canon, source.id, 3, 'pouch', () => 'split-stack');
  assert.equal(id, 'split-stack');
  assert.equal(source.quantity, 7); assert.equal(source.equipped, true);
  assert.deepEqual(canon.items.find(item => item.id === id), {
    id, name: source.name, description: source.description, quantity: 3, ownerId: 'pouch', equipped: false, isContainer: false
  });
  assert.equal(canon.items.filter(item => item.name === source.name).reduce((sum, item) => sum + item.quantity, 0), 10);
  validateCanonicalState(canon);
});

test('invalid splits never change either inventory, including invalid IDs and destinations', () => {
  for (const quantity of [0, -1, 10, 11, 1.5, Number.NaN]) {
    const canon = inventory(), before = structuredClone(canon);
    assert.throws(() => splitItemStack(canon, 'ammunition', quantity, 'mira'));
    assert.deepEqual(canon, before);
  }
  for (const owner of ['missing', 'fob', 'ammunition']) {
    const canon = inventory(), before = structuredClone(canon);
    assert.throws(() => splitItemStack(canon, 'ammunition', 3, owner), /owner/);
    assert.deepEqual(canon, before);
  }
  for (const id of ['', 'ammunition', 'elias', 'hold', 'crew-trust', 'past', 'a'.repeat(101)]) {
    const canon = inventory(), before = structuredClone(canon);
    assert.throws(() => splitItemStack(canon, 'ammunition', 3, 'mira', () => id), /ID/);
    assert.deepEqual(canon, before);
  }
  const canon = inventory(), before = structuredClone(canon);
  assert.throws(() => splitItemStack(canon, 'missing', 1, 'mira'), /does not exist/);
  assert.throws(() => splitItemStack(canon, 'pack', 1, 'mira'), /cannot be split/);
  assert.deepEqual(canon, before);
});

test('evidenced partial handoffs split atomically using assigned IDs and quantity preconditions', () => {
  const canon = inventory(), before = structuredClone(canon);
  const result = applyStoryEffects(canon, [
    { type: 'item.split', ref: 'new-cartridges', itemId: 'ammunition', expectedQuantity: 10, quantity: 3, ownerId: 'mira', evidence },
    { type: 'item.transfer', itemId: 'pack', fromOwnerId: 'elias', toOwnerId: 'mira', evidence }
  ], evidence, () => 'assigned-stack');
  assert.equal(result.assigned['new-cartridges'], 'assigned-stack');
  assert.equal(result.canon.items.find(item => item.id === 'ammunition')!.quantity, 7);
  assert.equal(result.canon.items.find(item => item.id === 'assigned-stack')!.quantity, 3);
  assert.equal(result.canon.items.find(item => item.id === 'assigned-stack')!.ownerId, 'mira');
  assert.equal(itemRootOwnerId(result.canon, 'ammunition'), 'mira');
  assert.deepEqual(canon, before);
  const split = { type: 'item.split', ref: 'new-cartridges', itemId: 'ammunition', expectedQuantity: 10, quantity: 3, ownerId: 'mira', evidence };
  assert.throws(() => applyStoryEffects(canon, [{ ...split, expectedQuantity: 9 }], evidence), /quantity changed/);
  assert.throws(() => applyStoryEffects(canon, [{ ...split, quantity: 10 }], evidence), /leave at least one/);
  assert.throws(() => applyStoryEffects(canon, [{ ...split, ownerId: 'missing' }], evidence), /invalid entity/);
  assert.throws(() => applyStoryEffects(canon, [split], evidence, () => 'pack'), /collided/);
  assert.throws(() => applyStoryEffects(canon, [split], 'The crew waited.'), /evidence/);
  assert.deepEqual(canon, before);
});

test('generated nested containers resolve new refs and reject full-container deletion or conversion', () => {
  const canon = inventory(), before = structuredClone(canon);
  const created = applyStoryEffects(canon, [
    { type: 'item.create', ref: 'new-inner', name: 'Key case', description: '', quantity: 1, ownerId: 'new-outer', equipped: false, isContainer: true, evidence },
    { type: 'item.create', ref: 'new-outer', name: 'Satchel', description: '', quantity: 1, ownerId: 'mira', equipped: false, isContainer: true, evidence },
    { type: 'item.transfer', itemId: 'fob', fromOwnerId: 'elias', toOwnerId: 'new-inner', evidence }
  ], evidence);
  assert.equal(itemRootOwnerId(created.canon, 'fob'), 'mira');
  assert.equal(created.canon.items.find(item => item.id === 'fob')!.ownerId, created.assigned['new-inner']);
  for (const effect of [
    { type: 'item.quantity', itemId: 'pack', expectedQuantity: 1, quantity: 0, evidence },
    { type: 'item.update', itemId: 'pack', isContainer: false, evidence },
    { type: 'item.transfer', itemId: 'pack', fromOwnerId: 'elias', toOwnerId: 'pouch', evidence },
    { type: 'item.equip', itemId: 'ammunition', equipped: true, evidence }
  ]) assert.throws(() => applyStoryEffects(canon, [effect], evidence), /invalid entity/);
  assert.deepEqual(canon, before);
});

test('effect batches validate the final inventory graph after rehoming contents and splitting', () => {
  const canon = inventory();
  const result = applyStoryEffects(canon, [
    { type: 'item.update', itemId: 'pack', isContainer: false, evidence },
    { type: 'item.transfer', itemId: 'pouch', fromOwnerId: 'pack', toOwnerId: 'mira', evidence },
    { type: 'item.quantity', itemId: 'pack', expectedQuantity: 1, quantity: 0, evidence },
    { type: 'item.create', ref: 'new-bag', name: 'New bag', description: '', quantity: 1, ownerId: 'mira', equipped: false, evidence },
    { type: 'item.split', ref: 'new-cartridges', itemId: 'ammunition', expectedQuantity: 10, quantity: 3, ownerId: 'new-bag', evidence },
    { type: 'item.update', itemId: 'new-bag', isContainer: true, evidence }
  ], evidence);
  assert.ok(!result.canon.items.some(item => item.id === 'pack'));
  assert.equal(result.canon.items.find(item => item.id === result.assigned['new-cartridges'])!.ownerId, result.assigned['new-bag']);
  assert.equal(itemRootOwnerId(result.canon, 'ammunition'), 'mira');
  validateInventoryState(result.canon);
});
