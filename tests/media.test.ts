import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import sharp from 'sharp';
import { zipSync, unzipSync, strToU8 } from 'fflate';
import { StoryRepository } from '../src/lib/server/repository';
import { imageProvenanceSchema } from '../src/lib/media';
import { sampleContinuationProposal, sampleReplacementProposal } from '../src/lib/server/fixture';

async function fixture() {
  const folder = mkdtempSync(join(tmpdir(), 'story-media-test-'));
  const r = new StoryRepository(join(folder, 'library.sqlite'));
  const image = await sharp({ create: { width: 960, height: 640, channels: 3, background: '#304958' } }).png().toBuffer();
  const metadata = (revision: number, passageId: string | null = null) => ({ expectedRevision: revision, requestId: randomUUID(), caption: 'The crew at Halcyon', category: 'scene' as const, subjectIds: ['elias','mira'], passageId, parentId: null, status: 'canonical' as const });
  return { r, folder, image, metadata, cleanup() { r.close(); const target = resolve(folder); assert.ok(target.startsWith(resolve(tmpdir()) + '\\') || target.startsWith(resolve(tmpdir()) + '/')); assert.ok(target.includes('story-media-test-')); rmSync(target, { recursive: true }); } };
}

test('shared pictures, independent portrait/reference selection, history and thumbnails survive reopen', async () => {
  const f = await fixture();
  try {
    const initial = f.r.create(), input = f.metadata(initial.revision, initial.passages[0].id);
    const added = await f.r.addMedia(initial.id, f.image, input);
    assert.equal(added.media.assets.length, 1); const asset = added.media.assets[0];
    assert.deepEqual(asset.subjectIds, ['elias','mira']); assert.equal(asset.snapshots[0].outfit, initial.canon.characters[0].outfit);
    assert.equal((await f.r.addMedia(initial.id, f.image, input)).revision, added.revision);
    await assert.rejects(() => f.r.addMedia(initial.id, f.image, { ...input, caption: 'conflicting retry' }), /request ID/);
    let s = f.r.mutate(initial.id, { expectedRevision: added.revision, requestId: randomUUID(), action: { type: 'media-select', characterId: 'elias', assetId: asset.id, selection: 'portrait' } });
    assert.equal(s.media.portraits.elias, asset.id); assert.equal(s.media.references.elias, undefined);
    s = f.r.mutate(s.id, { expectedRevision: s.revision, requestId: randomUUID(), action: { type: 'character', character: { ...s.canon.characters[0], outfit: 'A new coat' } } });
    assert.equal(s.media.assets[0].snapshots[0].outfit, initial.canon.characters[0].outfit);
    const second = await f.r.addMedia(s.id, f.image, { ...f.metadata(s.revision), parentId: asset.id });
    s = f.r.mutate(s.id, { expectedRevision: second.revision, requestId: randomUUID(), action: { type: 'media-select', characterId: 'elias', assetId: second.media.assets[1].id, selection: 'portrait' } });
    assert.equal(s.media.assets.length, 2); assert.notEqual(s.media.portraits.elias, asset.id);
    const reopened = new StoryRepository(join(f.folder, 'library.sqlite'));
    try { assert.deepEqual(reopened.read(s.id).media, s.media); assert.deepEqual(reopened.mediaStore.original(asset), f.image); } finally { reopened.close(); }
    const thumb = await f.r.mediaStore.file(asset, true), dimensions = await sharp(thumb.bytes).metadata();
    assert.equal(dimensions.width, 480); assert.equal(dimensions.height, 320);
    unlinkSync(join(f.folder, 'media', asset.hash + '.thumb.webp'));
    assert.deepEqual((await f.r.mediaStore.file(asset, true)).bytes, thumb.bytes);
  } finally { f.cleanup(); }
});

test('media ZIP imports into an isolated library with original bytes, associations and generation provenance', async () => {
  const f = await fixture(), other = await fixture();
  try {
    const s = f.r.create(), provenance = imageProvenanceSchema.parse({ kind: 'comfy', seed: 42, prompt: 'Two crew members', workflow: 'my-workflow.json', graph: { '1': { class_type: 'Example', inputs: { seed: 42 } } }, template: '{{subject.face}}', variables: { 'subject.face': 'weathered' } });
    const added = await f.r.addMedia(s.id, f.image, f.metadata(0, s.passages[0].id), provenance);
    const exported = f.r.export(s.id), entries = unzipSync(exported);
    assert.equal(Object.keys(entries).filter(k => k.startsWith('media/')).length, 1);
    assert.ok(!Object.keys(entries).some(k => k.includes('thumb')));
    const imported = await other.r.import(exported);
    assert.notEqual(imported.id, s.id); assert.deepEqual(imported.media, added.media);
    assert.deepEqual(other.r.mediaStore.original(imported.media.assets[0]), f.image);
  } finally { f.cleanup(); other.cleanup(); }
});

test('malformed images, stale uploads, bad associations and corrupt or unsafe archives never add a story record', async () => {
  const f = await fixture();
  try {
    const s = f.r.create();
    await assert.rejects(() => f.r.addMedia(s.id, Buffer.from('<svg/>'), f.metadata(0)), /valid.*PNG/);
    await assert.rejects(() => f.r.addMedia(s.id, f.image, { ...f.metadata(0), subjectIds: ['missing'] }), /subject/);
    await assert.rejects(() => f.r.addMedia(s.id, f.image, f.metadata(99)), /changed/);
    assert.equal(f.r.read(s.id).media.assets.length, 0);
    const added = await f.r.addMedia(s.id, f.image, f.metadata(0)), entries = unzipSync(f.r.export(s.id));
    const name = Object.keys(entries).find(k => k.startsWith('media/'))!;
    const damaged = { ...entries, [name]: await sharp(f.image).resize(100,100).png().toBuffer() };
    await assert.rejects(() => f.r.import(zipSync(damaged)), /checksum/);
    await assert.rejects(() => f.r.import(zipSync({ ...entries, '../escape.png': f.image })), /unsafe/);
    const missing = { ...entries }; delete missing[name];
    await assert.rejects(() => f.r.import(zipSync(missing)), /manifest/);
    const wrong = structuredClone(added); wrong.media.assets[0].subjectIds.push('orphan');
    await assert.rejects(() => f.r.import(zipSync({ ...entries, 'story.json': strToU8(JSON.stringify(wrong)) })), /subject/);
    assert.equal(f.r.list().length, 1);
  } finally { f.cleanup(); }
});

test('replacing a source passage preserves illustrations as earlier versions without invalidating the replacement baseline', async () => {
  const f = await fixture();
  try {
    const s = f.r.create(), added = await f.r.addMedia(s.id, f.image, f.metadata(0, s.passages.at(-1)!.id));
    assert.equal(added.recovery!.valid, true);
    const replacement = f.r.mutate(s.id, { expectedRevision: added.revision, requestId: randomUUID(), action: { type: 'sample-replace', passageId: s.passages.at(-1)!.id } });
    assert.equal(replacement.media.assets[0].status, 'superseded');
    assert.deepEqual(f.r.mediaStore.original(replacement.media.assets[0]), f.image);
    const edited = f.r.mutate(s.id, { expectedRevision: replacement.revision, requestId: randomUUID(), action: { type: 'media-edit', assetId: replacement.media.assets[0].id, edit: { caption: 'An earlier illustration', category: 'scene', subjectIds: ['mira'], status: 'canonical' } } });
    assert.equal(edited.media.assets[0].status, 'superseded'); assert.equal(edited.media.assets[0].caption, 'An earlier illustration');
  } finally { f.cleanup(); }
});

test('concurrent uploads use a final revision check and repeated requests commit once', async () => {
  const f = await fixture();
  try {
    const s = f.r.create(), request = f.metadata(0);
    const both = await Promise.all([f.r.addMedia(s.id, f.image, request), f.r.addMedia(s.id, f.image, request)]);
    assert.equal(both[0].revision, both[1].revision); assert.equal(f.r.read(s.id).media.assets.length, 1);
    const revision = both[0].revision;
    const raced = await Promise.allSettled([f.r.addMedia(s.id, f.image, f.metadata(revision)), f.r.addMedia(s.id, f.image, f.metadata(revision))]);
    assert.equal(raced.filter(r => r.status === 'fulfilled').length, 1); assert.equal(f.r.read(s.id).media.assets.length, 2);
  } finally { f.cleanup(); }
});

test('explicit removal clears local selections while an imported copy retains its shared original', async () => {
  const f = await fixture();
  try {
    const initial = f.r.create(), added = await f.r.addMedia(initial.id, f.image, f.metadata(0)), asset = added.media.assets[0];
    const imported = await f.r.import(f.r.export(initial.id));
    let s = f.r.mutate(initial.id, { expectedRevision: added.revision, requestId: randomUUID(), action: { type: 'media-select', assetId: asset.id, characterId: 'elias', selection: 'portrait' } });
    s = f.r.mutate(initial.id, { expectedRevision: s.revision, requestId: randomUUID(), action: { type: 'media-remove', assetId: asset.id } });
    assert.equal(s.media.assets.length, 0); assert.equal(s.media.portraits.elias, undefined);
    assert.deepEqual(f.r.mediaStore.original(f.r.read(imported.id).media.assets[0]), f.image);
    assert.equal(f.r.mediaStore.audit(f.r.list().flatMap(s => f.r.read(s.id).media.assets)).unreferenced.length, 0);
  } finally { f.cleanup(); }
});

test('a character removed by latest-passage replacement keeps historical pictures and loses current selections', async () => {
  const f = await fixture();
  try {
    const initial = f.r.create(), proposal = sampleContinuationProposal('');
    const prose = 'Iona joined the crew.'; proposal.draft.paragraphs = [prose]; proposal.effects = [{ type: 'character.create', ref: 'new-iona', name: 'Iona', role: 'Dockmaster', notes: '', appearance: 'Grey hair.', outfit: 'Uniform.', locationId: 'bridge', evidence: prose }];
    let s = f.r.commitGeneratedPassage(initial.id, { expectedRevision: 0, requestId: randomUUID(), proposal });
    const person = s.canon.characters.find(c => c.name === 'Iona')!;
    s = await f.r.addMedia(s.id, f.image, { ...f.metadata(s.revision, s.passages.at(-1)!.id), subjectIds: [person.id] });
    s = f.r.mutate(s.id, { expectedRevision: s.revision, requestId: randomUUID(), action: { type: 'media-select', assetId: s.media.assets[0].id, characterId: person.id, selection: 'portrait' } });
    s = f.r.commitGeneratedPassage(s.id, { expectedRevision: s.revision, requestId: randomUUID(), proposal: sampleReplacementProposal(s, s.passages.at(-1)!.id) });
    assert.ok(!s.canon.characters.some(c => c.id === person.id)); assert.equal(s.media.assets[0].status, 'superseded');
    assert.equal(s.media.assets[0].snapshots[0].name, 'Iona'); assert.equal(s.media.portraits[person.id], undefined);
    assert.equal((await f.r.import(f.r.export(s.id))).media.assets[0].snapshots[0].outfit, 'Uniform.');
  } finally { f.cleanup(); }
});

test('integrity diagnostics distinguish missing, corrupt and unreferenced originals without deleting files', async () => {
  const f = await fixture();
  try {
    const initial = f.r.create(), added = await f.r.addMedia(initial.id, f.image, f.metadata(0)), asset = added.media.assets[0];
    const path = join(f.folder, 'media', asset.hash + '.original');
    writeFileSync(path, 'corrupt image');
    assert.deepEqual(f.r.mediaStore.audit(added.media.assets).corrupt, [asset.hash]);
    assert.throws(() => f.r.export(added.id), /integrity/);
    unlinkSync(path); assert.deepEqual(f.r.mediaStore.audit(added.media.assets).missing, [asset.hash]);
    f.r.mediaStore.save(f.image, await f.r.mediaStore.inspect(f.image));
    assert.deepEqual(f.r.mediaStore.audit(added.media.assets).missing, []);
    assert.deepEqual(f.r.mediaStore.audit([]).unreferenced, [asset.hash]);
    assert.deepEqual(f.r.mediaStore.original(asset), f.image);
  } finally { f.cleanup(); }
});
