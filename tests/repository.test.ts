import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate';
import { StoryRepository, type Mutation } from '../src/lib/server/repository';
import { validateStory } from '../src/lib/story';

function request(revision: number, action: Mutation['action']): Mutation { return { expectedRevision: revision, requestId: randomUUID(), action }; }

test('a disk save survives closing and reopening, and libraries remain isolated', () => {
  const folder = mkdtempSync(join(tmpdir(), 'guided-story-test-'));
  const path = join(folder, 'library.sqlite'); let r = new StoryRepository(path);
  try {
    const s = r.create();
    r.mutate(s.id, request(0, { type: 'world', funds: 907, cargoNotes: 'Saved cargo notes.' }));
    r.close(); r = new StoryRepository(path);
    assert.equal(r.read(s.id).canon.funds, 907);
    assert.equal(r.read(s.id).canon.cargoNotes, 'Saved cargo notes.');
    const other = new StoryRepository(':memory:');
    try { assert.equal(other.list().length, 0); assert.throws(() => other.read(s.id), /could not be found/); } finally { other.close(); }
  } finally {
    r.close();
    for (const name of readdirSync(folder)) unlinkSync(join(folder, name));
    rmdirSync(folder);
  }
});

test('latest replacement restores item ownership; earlier passage changes are rejected', () => {
  const r = new StoryRepository(':memory:');
  try {
    const s = r.create();
    const next = r.mutate(s.id, request(0, { type: 'sample-continue', direction: 'Focus on Ren.' }));
    assert.equal(next.passages.length, 4); assert.equal(next.passages.at(-1)!.direction, 'Focus on Ren.');
    assert.equal(next.canon.items.find(i => i.id === 'fob')!.ownerId, 'ren');
    assert.throws(() => r.mutate(s.id, request(1, { type: 'sample-replace', passageId: next.passages[0].id })), /Only the latest/);
    const alternate = r.mutate(s.id, request(1, { type: 'sample-replace', passageId: next.passages.at(-1)!.id }));
    assert.equal(alternate.passages.length, 4);
    assert.equal(alternate.canon.items.find(i => i.id === 'fob')!.ownerId, 'elias');
    assert.equal(alternate.passages.at(-1)!.title, 'No one goes alone');
  } finally { r.close(); }
});

test('duplicate requests are idempotent and stale or conflicting edits do not commit', () => {
  const r = new StoryRepository(':memory:');
  try {
    const s = r.create(); const input = request(0, { type: 'sample-continue', direction: '' });
    const a = r.mutate(s.id, input), b = r.mutate(s.id, input);
    assert.equal(a.revision, b.revision); assert.equal(b.passages.length, 4);
    assert.throws(() => r.mutate(s.id, request(0, { type: 'world', funds: 1, cargoNotes: '' })), /changed in another tab/);
    assert.throws(() => r.mutate(s.id, { ...input, action: { type: 'world', funds: 1, cargoNotes: '' } }), /request ID/);
    assert.equal(r.read(s.id).canon.funds, 840);
  } finally { r.close(); }
});

test('failed domain validation rolls back the whole mutation and a manual edit invalidates recovery', () => {
  const r = new StoryRepository(':memory:');
  try {
    const s = r.create();
    assert.throws(() => r.mutate(s.id, request(0, { type: 'character', character: { ...s.canon.characters[0], name: 'Should not save', locationId: 'missing' } })), /location does not exist/);
    assert.equal(r.read(s.id).revision, 0); assert.equal(r.read(s.id).canon.characters[0].name, 'Elias Voss');
    const saved = r.mutate(s.id, request(0, { type: 'transfer', itemId: 'fob', ownerId: 'mira' }));
    assert.equal(saved.recovery!.valid, false);
    assert.throws(() => r.mutate(s.id, request(1, { type: 'sample-replace', passageId: saved.passages.at(-1)!.id })), /recovery baseline/);
  } finally { r.close(); }
});

test('ZIP roundtrip preserves world, latest recovery, and per-character preferences without overwriting originals', async () => {
  const r = new StoryRepository(':memory:');
  try {
    const s = r.create(); assert.ok(s.canon.characters.every(c => c.noNsfw));
    const saved = r.mutate(s.id, request(0, { type: 'character', character: { ...s.canon.characters[0], noNsfw: false } }));
    const archive = r.export(s.id), files = unzipSync(archive);
    assert.deepEqual(Object.keys(files).sort(), ['manifest.json', 'story.json']);
    assert.ok(!strFromU8(files['story.json']).includes('apiKey'));
    const imported = await r.import(archive);
    assert.notEqual(imported.id, s.id); assert.deepEqual(imported.canon, saved.canon);
    assert.deepEqual(imported.recovery, saved.recovery); assert.equal(r.list().length, 2);
    assert.equal(r.read(s.id).title, s.title);
  } finally { r.close(); }
});

test('imports reject invalid formats, corrupt files and dangling references; absent NSFW flags default on', async () => {
  const r = new StoryRepository(':memory:');
  try {
    const s = r.create(); const raw = JSON.parse(JSON.stringify(s)); delete raw.canon.characters[0].noNsfw;
    assert.equal(validateStory(raw).canon.characters[0].noNsfw, true);
    await assert.rejects(() => r.import(new Uint8Array([1, 2, 3])), /corrupt|ZIP/);
    const bundle = (format: string, value: unknown) => zipSync({ 'manifest.json': strToU8(JSON.stringify({ format })), 'story.json': strToU8(JSON.stringify(value)) });
    await assert.rejects(() => r.import(bundle('old-save', s)), /Incompatible/);
    raw.canon.items[0].ownerId = 'missing';
    await assert.rejects(() => r.import(bundle('guided-story-dev-1', raw)), /owner does not exist/);
    assert.equal(r.list().length, 1);
  } finally { r.close(); }
});

test('thread edits cannot be lost by restoring an older latest-passage baseline', () => {
  const r = new StoryRepository(':memory:');
  try {
    const s = r.create();
    const saved = r.mutate(s.id, request(0, { type: 'thread', threadId: 'past', notes: 'Keep this manually edited direction.', status: 'open' }));
    assert.equal(saved.recovery!.valid, false);
    assert.throws(() => r.mutate(s.id, request(1, { type: 'sample-replace', passageId: saved.passages.at(-1)!.id })), /recovery baseline/);
    assert.equal(r.read(s.id).canon.threads.find(t => t.id === 'past')!.notes, 'Keep this manually edited direction.');
  } finally { r.close(); }
});
