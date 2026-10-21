import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { zipSync, unzipSync, strFromU8, strToU8 } from 'fflate';
import { StoryRepository } from '../src/lib/server/repository';
import { blankSetupPlan, type SetupDraft } from '../src/lib/setup';
import { decodeSetupArchive, encodeSetupArchive, MAX_SETUP_ARCHIVE_BYTES, MAX_EXPANDED_SETUP_BYTES } from '../src/lib/server/setup-archive';
import { itemRootOwnerId } from '../src/lib/inventory';

const manifest = { kind: 'storyweaver-setup', version: 1, exportedAt: '2026-01-01T00:00:00.000Z' };
const bundle = (draft: unknown, meta: unknown = manifest, extras: Record<string, Uint8Array> = {}) => zipSync({ 'manifest.json': strToU8(JSON.stringify(meta)), 'setup.json': strToU8(JSON.stringify(draft)), ...extras });
function fixture(r: StoryRepository): SetupDraft {
  const draft = r.createSetup({ premise: 'A courier and their crew investigate a vanished delivery.', adultContent: true, narrationStyle: 'Spare maritime prose.', artStyle: 'Film photography.', preferences: { contentNotes: 'Slow mystery; no gore.' } }, randomUUID());
  const plan = blankSetupPlan();
  plan.title = 'The Missing Manifest'; plan.chapterTitle = 'An empty berth';
  plan.canon.characters[0].name = 'Ari'; plan.canon.characters[0].noNsfw = false; plan.canon.characters[0].pinnedAppearance = true;
  plan.canon.items.push({ id: randomUUID(), name: 'Delivery key', description: 'A worn copper key.', quantity: 3, ownerId: plan.canon.characters[0].id, equipped: false });
  plan.context.lore.push({ id: randomUUID(), title: 'Private route', text: 'A concealed route leads under the old port.', keywords: ['route'], relatedIds: [plan.canon.places[0].id], visibility: 'hidden' });
  plan.context.knowledge.push({ id: randomUUID(), fact: 'Ari distrusts the portmaster.', truth: 'belief', knownBy: [plan.canon.characters[0].id], readerRevealed: false, sourcePassageId: null, sourceHash: null });
  return r.saveSetup(draft.id, { expectedRevision: 0, requestId: randomUUID(), input: draft.input, plan });
}

test('setup ZIP is a metadata-only allowlist and repeat imports create independent editable drafts', () => {
  const r = new StoryRepository(':memory:');
  try {
    const saved = fixture(r), zip = r.exportSetup(saved.id), files = unzipSync(zip);
    assert.deepEqual(Object.keys(files).sort(), ['manifest.json', 'setup.json']);
    assert.equal(JSON.parse(strFromU8(files['manifest.json'])).kind, 'storyweaver-setup');
    assert.deepEqual(JSON.parse(strFromU8(files['setup.json'])), saved);
    assert.doesNotMatch(strFromU8(files['setup.json']), /apiKey|baseUrl|generation_receipts|jobId/);
    const first = r.importSetup(zip), second = r.importSetup(zip);
    assert.equal(new Set([saved.id, first.id, second.id]).size, 3);
    for (const imported of [first, second]) {
      assert.equal(imported.revision, 0); assert.equal(imported.storyId, null);
      assert.deepEqual(imported.input, saved.input); assert.deepEqual(imported.plan, saved.plan);
      assert.equal(imported.plan!.canon.characters[0].noNsfw, false); assert.equal(imported.plan!.canon.characters[0].pinnedAppearance, true);
      assert.deepEqual(r.readSetup(imported.id), imported);
    }
    const updated = r.saveSetup(first.id, { expectedRevision: 0, requestId: randomUUID(), input: { ...first.input, premise: 'A revised imported premise.' }, plan: first.plan });
    assert.equal(updated.revision, 1); assert.deepEqual(r.readSetup(saved.id), saved); assert.deepEqual(r.readSetup(second.id), second);
    assert.equal(r.list().length, 0); assert.equal(r.listSetups().length, 3);
  } finally { r.close(); }
});

test('setup ZIP roundtrips nested containers and refuses cyclic or noncontainer storage before inserting',()=>{
  const r=new StoryRepository(':memory:');
  try{
    const original=fixture(r),plan=structuredClone(original.plan)!,bag=randomUUID(),pouch=randomUUID(),key=plan.canon.items[0].id;
    plan.canon.items.push({id:bag,name:'Courier bag',description:'Canvas bag.',quantity:1,ownerId:plan.canon.characters[0].id,equipped:true,isContainer:true},{id:pouch,name:'Key pouch',description:'Inner pouch.',quantity:1,ownerId:bag,equipped:false,isContainer:true});
    plan.canon.items[0].ownerId=pouch;
    const saved=r.saveSetup(original.id,{expectedRevision:original.revision,requestId:randomUUID(),input:original.input,plan}),imported=r.importSetup(r.exportSetup(original.id));
    assert.deepEqual(imported.plan,saved.plan);assert.equal(itemRootOwnerId(imported.plan!.canon,key),plan.canon.characters[0].id);
    for(const mutation of [(draft:SetupDraft)=>{draft.plan!.canon.items.find(item=>item.id===bag)!.ownerId=pouch;},(draft:SetupDraft)=>{draft.plan!.canon.items.find(item=>item.id===pouch)!.isContainer=false;}]){
      const invalid=structuredClone(saved);mutation(invalid);assert.throws(()=>r.importSetup(bundle(invalid)));assert.equal(r.listSetups().length,2);
    }
  }finally{r.close();}
});

test('premise-only setup portability needs no model and missing adult flags retain safe defaults', () => {
  const r = new StoryRepository(':memory:');
  try {
    const saved = r.createSetup({ premise: 'A detective receives an impossible letter.' }, randomUUID());
    const imported = r.importSetup(r.exportSetup(saved.id));
    assert.equal(imported.plan, null); assert.deepEqual(imported.input, saved.input); assert.equal(imported.input.adultContent, false);
    const raw = JSON.parse(JSON.stringify(fixture(r))); delete raw.input.adultContent; delete raw.plan.canon.characters[0].noNsfw;
    const withDefaults = r.importSetup(bundle(raw));
    assert.equal(withDefaults.input.adultContent, false); assert.equal(withDefaults.plan!.canon.characters[0].noNsfw, true);
    assert.equal(r.list().length, 0);
  } finally { r.close(); }
});

test('unwritten setup context keeps planned knowledge and defaults but rejects fabricated history before import or save', () => {
  const r = new StoryRepository(':memory:');
  try {
    const saved = fixture(r), raw = JSON.parse(JSON.stringify(saved));
    delete raw.plan.context.compaction;
    delete raw.plan.context.knowledge[0].sourceHash;
    raw.plan.context.knowledge[0].truth = 'possibility';
    raw.plan.context.knowledge[0].readerRevealed = true;
    const imported = r.importSetup(bundle(raw));
    assert.deepEqual(imported.plan!.context.compaction, { epoch: 0, chapters: [], book: null });
    assert.deepEqual(imported.plan!.context.knowledge[0], { ...saved.plan!.context.knowledge[0], truth: 'possibility', readerRevealed: true });
    const memory = { id: randomUUID(), level: 'chapter' as const, chapter: 1, chapterNumbers: [1], passageIds: ['unwritten-passage'], summary: 'An event that has not happened.', facts: [], openQuestions: [], characterIds: [], locationIds: [], sourceHash: 'a'.repeat(64), createdAt: saved.createdAt };
    const changes: ((draft: SetupDraft) => void)[] = [
      draft => { draft.plan!.context.knowledge[0].sourceHash = 'a'.repeat(64); },
      draft => { draft.plan!.context.compaction.epoch = 1; },
      draft => { draft.plan!.context.compaction.chapters = [memory]; },
      draft => { draft.plan!.context.compaction.book = { ...memory, level: 'book', chapter: null }; }
    ];
    for (const change of changes) {
      const invalid = structuredClone(saved); change(invalid);
      assert.throws(() => r.importSetup(bundle(invalid)), /unwritten story/);
      assert.throws(() => r.saveSetup(saved.id, { expectedRevision: saved.revision, requestId: randomUUID(), input: saved.input, plan: invalid.plan }), /unwritten story/);
      assert.equal(r.listSetups().length, 2);
      assert.deepEqual(r.readSetup(saved.id), saved);
    }
  } finally { r.close(); }
});

test('setup export matches the requested saved revision and rejects changes without mutating the setup', () => {
  const r = new StoryRepository(':memory:');
  try {
    const saved = fixture(r);
    assert.deepEqual(decodeSetupArchive(r.exportSetup(saved.id, saved.revision)), saved);
    const changed = r.saveSetup(saved.id, { expectedRevision: saved.revision, requestId: randomUUID(), input: { ...saved.input, premise: 'Changed in another tab.' }, plan: saved.plan });
    assert.throws(() => r.exportSetup(saved.id, saved.revision), error => error instanceof Error && 'status' in error && error.status === 409 && /changed after saving/.test(error.message));
    assert.deepEqual(decodeSetupArchive(r.exportSetup(saved.id, changed.revision)), changed);
    assert.deepEqual(decodeSetupArchive(r.exportSetup(saved.id)), changed);
    assert.deepEqual(r.readSetup(saved.id), changed);
    for (const revision of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => r.exportSetup(saved.id, revision));
  } finally { r.close(); }
});

test('setup imports reject invalid canonical, opening and context references without inserting anything', () => {
  const r = new StoryRepository(':memory:');
  try {
    const saved = fixture(r), corruptions: ((draft: SetupDraft) => void)[] = [
      d => { d.plan!.canon.items[0].ownerId = 'missing-owner'; },
      d => { d.plan!.canon.characters[0].locationId = 'missing-place'; },
      d => { d.plan!.context.sceneBrief.viewpointId = 'missing-cast'; },
      d => { d.plan!.context.sceneBrief.locationId = 'missing-place'; },
      d => { d.plan!.context.lore[0].relatedIds = ['missing-record']; },
      d => { d.plan!.context.knowledge[0].knownBy = ['missing-cast']; },
      d => { d.plan!.context.knowledge[0].sourcePassageId = 'unwritten-passage'; },
      d => { d.plan!.canon.places[0].parentId = d.plan!.canon.places[0].id; }
    ];
    for (const change of corruptions) { const raw = structuredClone(saved); change(raw); assert.throws(() => r.importSetup(bundle(raw))); assert.equal(r.listSetups().length, 1); }
    assert.deepEqual(r.readSetup(saved.id), saved);
  } finally { r.close(); }
});

test('published setups cannot be exported or imported as unfinished drafts', () => {
  const r = new StoryRepository(':memory:');
  try {
    const saved = fixture(r), published = { ...saved, storyId: randomUUID() };
    assert.throws(() => encodeSetupArchive(published), /already a written story/);
    assert.throws(() => r.importSetup(bundle(published)), /already a written story/);
    r.commitOpening(saved.id, saved.revision, randomUUID(), 'opening-qa', { mode: 'continue', direction: '', draft: { title: 'At the berth', chapterTitle: saved.plan!.chapterTitle, startsChapter: true, endOfChapter: false, viewpointId: saved.plan!.canon.characters[0].id, paragraphs: ['Ari waited beside an empty berth.'] }, effects: [] });
    assert.throws(() => r.exportSetup(saved.id), /already a written story/);
    assert.equal(r.listSetups().length, 0); assert.equal(r.list().length, 1);
  } finally { r.close(); }
});

test('setup archives reject unknown fields instead of carrying credentials, private jobs or media', () => {
  const r = new StoryRepository(':memory:');
  try {
    const saved = fixture(r);
    for (const raw of [
      { ...saved, connections: { apiKey: 'private-value' } },
      { ...saved, jobs: [] },
      { ...saved, input: { ...saved.input, apiKey: 'private-value' } },
      { ...saved, plan: { ...saved.plan, media: [] } },
      { ...saved, plan: { ...saved.plan, context: { ...saved.plan!.context, apiKey: 'private-value' } } }
    ]) assert.throws(() => r.importSetup(bundle(raw)), /Unsupported field/);
    assert.equal(r.listSetups().length, 1);
  } finally { r.close(); }
});

test('setup ZIP validates format, paths, duplicates, entry count, size, JSON and UTF-8 before decoding', () => {
  const r = new StoryRepository(':memory:');
  try {
    const saved = fixture(r);
    for (const meta of [{ ...manifest, kind: 'storyweaver-story' }, { ...manifest, version: 99 }, { ...manifest, apiKey: 'private' }]) assert.throws(() => decodeSetupArchive(bundle(saved, meta)), /Incompatible/);
    for (const extra of ['../setup.json', '/setup.json', 'media/picture.png', 'references/readme.txt']) assert.throws(() => decodeSetupArchive(bundle(saved, manifest, { [extra]: strToU8('unwanted') })), /Unsupported|too many/);
    assert.throws(() => decodeSetupArchive(new Uint8Array([1, 2, 3])), /corrupt|supported|complete/);
    assert.throws(() => decodeSetupArchive(new Uint8Array(MAX_SETUP_ARCHIVE_BYTES + 1)), /5 MB/);
    assert.throws(() => decodeSetupArchive(zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)) })), /complete/);
    assert.throws(() => decodeSetupArchive(zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)), 'setup.json': strToU8('{bad') })), /invalid JSON/);
    assert.throws(() => decodeSetupArchive(zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)), 'setup.json': new Uint8Array([0xc3, 0x28]) })), /invalid JSON/);
    assert.throws(() => decodeSetupArchive(zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)), 'setup.json': new Uint8Array(MAX_EXPANDED_SETUP_BYTES + 1) })), /Expanded setup ZIP/);
    // Rename equal-length local and central names to produce a real duplicate ZIP entry.
    const duplicate = zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)), 'setup.json': strToU8(JSON.stringify(saved)), 'duplicate!': strToU8('{}') });
    const needle = strToU8('duplicate!'), replacement = strToU8('setup.json');
    for (let i = 0; i <= duplicate.length - needle.length; i++) if (needle.every((byte, j) => duplicate[i + j] === byte)) duplicate.set(replacement, i);
    assert.throws(() => decodeSetupArchive(duplicate), /duplicate|too many/);
    assert.equal(r.listSetups().length, 1);
  } finally { r.close(); }
});

test('imported setup persists across repository restarts with no written story or operation replay', () => {
  const folder = mkdtempSync(join(tmpdir(), 'storyweaver-setup-archive-')), path = join(folder, 'library.sqlite');
  let r = new StoryRepository(path);
  try {
    const saved = fixture(r), imported = r.importSetup(r.exportSetup(saved.id));
    r.close(); r = new StoryRepository(path);
    assert.deepEqual(r.readSetup(imported.id), imported); assert.equal(r.list().length, 0);
    assert.equal(r.generatedSetupResult(imported.id, randomUUID(), 'no-receipt'), null);
    assert.equal(r.openingResult(imported.id, randomUUID(), 'no-receipt'), null);
    const files = unzipSync(r.exportSetup(imported.id));
    assert.deepEqual(JSON.parse(strFromU8(files['setup.json'])).plan, saved.plan);
  } finally {
    r.close(); for (const name of readdirSync(folder)) unlinkSync(join(folder, name)); rmdirSync(folder);
  }
});
