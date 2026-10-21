import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { zipSync, unzipSync, strFromU8, strToU8 } from 'fflate';
import { characterSchema, recapSchema, summaryCacheSchema, validateStory, transferItem, type Story, type LibraryEntry } from '../story';
import { rememberPassageViewpoints } from '../entity-scope';
import { createSample, sampleContinuationProposal, sampleReplacementProposal } from './fixture';
import { recapSourceHash, refreshRecapStatus } from './recap-state';
import { contextSchema, contextMemorySchema, memoryCompactionSchema, type ContextMemory, type MemoryCompaction } from '../context-types';
import { memorySourceHash, memoryCurrent, chapterMemoryCurrent, bookMemoryCurrent } from './context-state';
import { editorResultSchema, type EditorResult } from '../editor';
import { validateWording } from './editor-state';
import { beginTrace, endTrace, logEvent } from './diagnostics';
import { storyPreferencesSchema } from '../settings';
import { passageCommitSchema, preparePassageCommit, type PassageCommit } from './passage-commit';
import { mediaAssetSchema, mediaEditSchema, imageProvenanceSchema, type ImageProvenance, type MediaAsset } from '../media';
import { MediaStore, MAX_ARCHIVE_BYTES, passageImageHash } from './media-store';
import { illustrationCaptureSchema, type IllustrationCapture } from '../illustration';
import { setupInputSchema, setupDraftSchema, setupSaveSchema, setupStoryBase, validateSetupPlan, type SetupDraft } from '../setup';
import { decodeSetupArchive, encodeSetupArchive } from './setup-archive';
import { prepareOpening } from './setup-state';
import { passageProposalSchema } from './passage-commit';

import { StoryError } from '../errors';
import { recordEditSchema, recordKinds } from '../record-editing';
import { saveRecord, removeRecord, applyCorrectionOperations } from './record-editing';
import { correctionResultSchema, correctionApplySchema, type CorrectionResult } from '../story-corrections';
import { assertFactPinsUnchanged, emptyFactPins, factPinsSchema } from '../fact-pins';
import { splitItemStack } from '../inventory';
import { scenePreparationProposalSchema, type ScenePreparationProposal } from '../scene-preparation';
import { applyScenePreparation as applyPreparedScene, scenePreparationSourceHash } from './scene-preparation';
import { retainedPassageSchema, recoveryActionSchema, type RetainedPassage, type RecoveryAction, type RecoveryIssue } from '../passage-recovery';
import { passageContentSchema, passageProposalSchema as recoveredProposalSchema, type PassageContent, type PassageProposal } from '../passage-proposal';
import { recoveryHistoryHash, recoverySourceHash, recoveryFacts, recoveryBaseline } from './passage-recovery-state';
import { StoryWorkflowStore } from './story-workflow/store';
export { StoryError } from '../errors';
export type PreparationSourceKind = 'setup' | 'story';
const id = z.string().min(1).max(100);
const preparationApplySchema = z.strictObject({expectedRevision:z.number().int().min(0),requestId:z.string().uuid(),resultId:z.string().uuid()});
export const mediaInputSchema = z.object({ expectedRevision: z.number().int().min(0), requestId: z.string().uuid(), caption: z.string().max(4000), category: mediaAssetSchema.shape.category, subjectIds: mediaAssetSchema.shape.subjectIds, passageId: id.nullable(), parentId: z.string().uuid().nullable(), status: z.enum(['canonical','experimental']) });
export const actionSchema = z.discriminatedUnion('type', [
  z.strictObject({type:z.literal('item-split'),itemId:id,quantity:z.number().int().min(1).max(999999),ownerId:id}),
  z.strictObject({type:z.literal('fact-pins'),factPins:factPinsSchema}),
  z.strictObject({type:z.literal('record-save'),edit:recordEditSchema}),
  z.strictObject({type:z.literal('record-remove'),kind:z.enum(recordKinds),id}),
  z.strictObject({type:z.literal('story-title'),title:z.string().trim().min(1).max(200)}),
  z.object({ type: z.literal('media-remove'), assetId: z.string().uuid() }),
  z.object({ type: z.literal('media-edit'), assetId: z.string().uuid(), edit: mediaEditSchema }),
  z.object({ type: z.literal('media-select'), characterId: id, assetId: z.string().uuid().nullable(), selection: z.enum(['portrait','reference']) }),
  z.object({ type: z.literal('character'), character: characterSchema }),
  z.object({ type: z.literal('world'), funds: z.number().min(0).finite(), cargoNotes: z.string().max(40000) }),
  z.object({ type: z.literal('transfer'), itemId: id, ownerId: id }),
  z.object({ type: z.literal('thread'), threadId: id, notes: z.string().max(40000), status: z.enum(['open', 'resolved']) }),
  z.object({ type: z.literal('preferences'), title: z.string().min(1).max(200), premise: z.string().max(40000), narrationStyle: z.string().max(10000), artStyle: z.string().max(10000), adultContent: z.boolean(), preferences: storyPreferencesSchema.optional() }),
  z.object({ type: z.literal('rename'), passageId: id, title: z.string().min(1).max(200), chapterTitle: z.string().min(1).max(200) }),
  z.object({ type: z.literal('recap'), text: z.string().trim().min(1).max(40000), confirmCurrent: z.boolean() }),
  z.object({ type: z.literal('context'), context: contextSchema }),
  z.object({ type: z.literal('scene-brief'), brief: contextSchema.shape.sceneBrief }),
  z.object({ type: z.literal('sample-continue'), direction: z.string().max(10000) }),
  z.object({ type: z.literal('sample-replace'), passageId: id })
]);
export const mutationSchema = z.object({ expectedRevision: z.number().int().min(0), requestId: z.string().uuid(), action: actionSchema });
export type Mutation = z.infer<typeof mutationSchema>;
const generatedRecapSchema = z.object({ expectedRevision: z.number().int().min(0), requestId: z.string().uuid(), recap: recapSchema, summaryCache: summaryCacheSchema });
type GeneratedRecap = z.infer<typeof generatedRecapSchema>;

export class StoryRepository {
  private db: DatabaseSync;
  readonly mediaStore: MediaStore;
  private workflowStore?: StoryWorkflowStore;
  /** Experimental workflow state is opt-in; ordinary repository use creates no workflow tables. */
  get workflows() { return this.workflowStore ??= new StoryWorkflowStore(this.db); }
  constructor(path: string, seed = false, mediaRoot?: string) {
    this.mediaStore = new MediaStore(mediaRoot || resolve(dirname(path), 'media'));
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS stories (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, updated_at TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS operations (story_id TEXT NOT NULL, request_id TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY (story_id, request_id));
      CREATE TABLE IF NOT EXISTS setups (id TEXT PRIMARY KEY, request_id TEXT UNIQUE NOT NULL, hash TEXT NOT NULL, updated_at TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS setup_operations (setup_id TEXT NOT NULL, request_id TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY(setup_id,request_id));
      CREATE TABLE IF NOT EXISTS generation_receipts (story_id TEXT NOT NULL, request_id TEXT NOT NULL, fingerprint TEXT NOT NULL, PRIMARY KEY(story_id,request_id));
      CREATE TABLE IF NOT EXISTS editor_results (id TEXT PRIMARY KEY,story_id TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,payload TEXT NOT NULL,UNIQUE(story_id,request_id));
      CREATE TABLE IF NOT EXISTS correction_results (id TEXT PRIMARY KEY,story_id TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,payload TEXT NOT NULL,UNIQUE(story_id,request_id));
      CREATE TABLE IF NOT EXISTS scene_preparation_results (id TEXT PRIMARY KEY,source_kind TEXT NOT NULL,source_id TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,payload TEXT NOT NULL,UNIQUE(source_kind,source_id,request_id));
      CREATE TABLE IF NOT EXISTS scene_preparation_applies (source_kind TEXT NOT NULL,source_id TEXT NOT NULL,request_id TEXT NOT NULL,hash TEXT NOT NULL,PRIMARY KEY(source_kind,source_id,request_id));
      CREATE TABLE IF NOT EXISTS retained_passages (id TEXT PRIMARY KEY,source_kind TEXT NOT NULL,source_id TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,payload TEXT NOT NULL,UNIQUE(source_kind,source_id,request_id));
      CREATE TABLE IF NOT EXISTS retained_passage_actions (source_kind TEXT NOT NULL,source_id TEXT NOT NULL,request_id TEXT NOT NULL,hash TEXT NOT NULL,draft_id TEXT NOT NULL,PRIMARY KEY(source_kind,source_id,request_id));
      CREATE TABLE IF NOT EXISTS removals (kind TEXT NOT NULL,id TEXT NOT NULL,request_id TEXT NOT NULL,hash TEXT NOT NULL,PRIMARY KEY(kind,id));`);
    const format = this.db.prepare("SELECT value FROM meta WHERE key = 'format'").get() as { value: string } | undefined;
    if (format && format.value !== 'guided-story-dev-1') { this.db.close(); throw new StoryError('This development save format is incompatible. Move the old data folder aside to start fresh.', 409); }
    this.db.prepare("INSERT OR IGNORE INTO meta VALUES ('format', 'guided-story-dev-1')").run();
    if (seed && !this.db.prepare("SELECT value FROM meta WHERE key = 'seeded'").get()) {
      this.db.exec('BEGIN IMMEDIATE');
      try { this.insert(createSample()); this.db.prepare("INSERT INTO meta VALUES ('seeded', 'yes')").run(); this.db.exec('COMMIT'); }
      catch (e) { this.db.exec('ROLLBACK'); throw e; }
    }
  }
  close() { this.db.close(); }
  private insert(story: Story) {
    const valid = refreshRecapStatus(validateStory(story));
    this.db.prepare('INSERT INTO stories VALUES (?, ?, ?, ?)').run(valid.id, valid.revision, valid.updatedAt, JSON.stringify(valid));
    return valid;
  }
  list(): LibraryEntry[] {
    return (this.db.prepare('SELECT payload FROM stories ORDER BY updated_at DESC').all() as { payload: string }[]).map(row => {
      const s: Story = JSON.parse(row.payload), last = s.passages.at(-1)!;
      return { id: s.id, title: s.title, updatedAt: s.updatedAt, revision: s.revision, chapter: last.chapter, passageTitle: last.title };
    });
  }
  read(id: string): Story {
    const row = this.db.prepare('SELECT payload FROM stories WHERE id = ?').get(id) as { payload: string } | undefined;
    if (!row) throw new StoryError('This story could not be found.', 404);
    return refreshRecapStatus(validateStory(JSON.parse(row.payload)));
  }
  create(title?: string): Story { const story = createSample(); if (title?.trim()) story.title = title.trim(); return this.insert(story); }
  removeFromLibrary(kind:'story'|'setup',id:string,expectedRevision:number,requestId:string) {
    const hash=createHash('sha256').update(JSON.stringify({kind,id,expectedRevision,requestId})).digest('hex');
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const receipt=this.db.prepare('SELECT hash FROM removals WHERE kind=? AND id=?').get(kind,id) as {hash:string}|undefined;
      if(receipt){if(receipt.hash!==hash)throw new StoryError('This record was already removed. Refresh the library.',409);this.db.exec('COMMIT');return;}
      const record=kind==='story'?this.read(id):this.readSetup(id);
      if(record.revision!==expectedRevision)throw new StoryError('This record changed. Reload it before removing it.',409);
      if(kind==='setup' && (record as SetupDraft).storyId)throw new StoryError('This setup is already a written story. Remove the story from Library instead.',409);
      if(kind==='story'){
        for(const table of ['operations','generation_receipts','editor_results','correction_results'])this.db.prepare(`DELETE FROM ${table} WHERE story_id=?`).run(id);
        for(const table of ['scene_preparation_results','scene_preparation_applies'])this.db.prepare(`DELETE FROM ${table} WHERE source_kind='story' AND source_id=?`).run(id);
        this.db.prepare('DELETE FROM stories WHERE id=?').run(id);
      }
      for(const table of ['retained_passages','retained_passage_actions']){if(kind==='story')this.db.prepare(`DELETE FROM ${table} WHERE source_id=?`).run(id);else this.db.prepare(`DELETE FROM ${table} WHERE source_kind='setup' AND source_id=?`).run(id);}
      // Written stories retain their original setup ID. Remove that draft too so it cannot reopen a deleted novel.
      this.db.prepare('DELETE FROM setup_operations WHERE setup_id=?').run(id);
      for(const table of ['scene_preparation_results','scene_preparation_applies'])this.db.prepare(`DELETE FROM ${table} WHERE source_kind='setup' AND source_id=?`).run(id);
      this.db.prepare('DELETE FROM setups WHERE id=?').run(id);
      this.db.prepare('INSERT INTO removals VALUES(?,?,?,?)').run(kind,id,requestId,hash);
      this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  readPreparationSource(kind:PreparationSourceKind,id:string):Story {
    if(kind==='story')return this.read(id);
    if(kind!=='setup')throw new StoryError('Choose a setup or written story for scene preparation.');
    const draft=this.readSetup(id);
    if(draft.storyId)throw new StoryError('This setup is already a written story. Prepare the scene from the story instead.',409);
    if(!draft.plan)throw new StoryError('Create or import a setup plan before preparing a scene.',409);
    const source=setupStoryBase(draft);source.revision=draft.revision;return source;
  }
  private preparationRequestFree(kind:PreparationSourceKind,id:string,requestId:string) {
    z.enum(['setup','story']).parse(kind);z.string().uuid().parse(requestId);
    if(this.db.prepare('SELECT 1 FROM scene_preparation_results WHERE source_id=? AND request_id=?').get(id,requestId)||this.db.prepare('SELECT 1 FROM scene_preparation_applies WHERE source_id=? AND request_id=?').get(id,requestId))throw new StoryError('This request ID belongs to another scene preparation operation.',409);
    if(this.db.prepare('SELECT 1 FROM operations WHERE story_id=? AND request_id=?').get(id,requestId)||this.db.prepare('SELECT 1 FROM setup_operations WHERE setup_id=? AND request_id=?').get(id,requestId)||this.db.prepare('SELECT 1 FROM generation_receipts WHERE story_id=? AND request_id=?').get(id,requestId)||this.db.prepare('SELECT 1 FROM editor_results WHERE story_id=? AND request_id=?').get(id,requestId)||this.db.prepare('SELECT 1 FROM correction_results WHERE story_id=? AND request_id=?').get(id,requestId))throw new StoryError('This request ID belongs to another story or setup operation.',409);
  }
  private reservePreparationRequest(kind:PreparationSourceKind,id:string,requestId:string,hash:string) {
    const table=kind==='setup'?'setup_operations':'operations',column=kind==='setup'?'setup_id':'story_id';
    this.db.prepare(`INSERT INTO ${table}(${column},request_id,hash) VALUES(?,?,?)`).run(id,requestId,hash);
  }
  private writeRetained(record:RetainedPassage) {
    const valid=retainedPassageSchema.parse(record);
    this.db.prepare('UPDATE retained_passages SET payload=? WHERE id=? AND source_kind=? AND source_id=?').run(JSON.stringify(valid),valid.id,valid.sourceKind,valid.sourceId);
    return valid;
  }
  retainedGeneration(kind:PreparationSourceKind,id:string,requestId:string,fingerprint:string):RetainedPassage|null {
    const row=this.db.prepare('SELECT fingerprint,payload FROM retained_passages WHERE source_kind=? AND source_id=? AND request_id=?').get(kind,id,requestId) as {fingerprint:string;payload:string}|undefined;
    if(row&&row.fingerprint!==fingerprint)throw new StoryError('This request ID belongs to different generation inputs.',409);
    return row?retainedPassageSchema.parse(JSON.parse(row.payload)):null;
  }
  readRetained(kind:PreparationSourceKind,id:string,draftId:string):RetainedPassage {
    const row=this.db.prepare('SELECT payload FROM retained_passages WHERE source_kind=? AND source_id=? AND id=?').get(kind,id,draftId) as {payload:string}|undefined;
    if(!row)throw new StoryError('This retained passage is unavailable for this story or setup.',404);
    return retainedPassageSchema.parse(JSON.parse(row.payload));
  }
  listRetained(kind:PreparationSourceKind,id:string):RetainedPassage[] {
    this.readPreparationSource(kind,id);
    return (this.db.prepare("SELECT payload FROM retained_passages WHERE source_kind=? AND source_id=? AND json_extract(payload,'$.status') NOT IN ('saved','discarded') ORDER BY rowid DESC").all(kind,id) as {payload:string}[]).map(row=>retainedPassageSchema.parse(JSON.parse(row.payload)));
  }
  recoveryState(kind:PreparationSourceKind,id:string) {
    // A lost opening response or another tab may have published this setup.
    // Report that state so its editor can open the saved story without retrying generation.
    if(kind==='setup'){
      const draft=this.readSetup(id);
      if(draft.storyId)return {drafts:[] as RetainedPassage[],sourceRevision:draft.revision,publishedStoryId:draft.storyId};
    }
    return {drafts:this.listRetained(kind,id),sourceRevision:this.readPreparationSource(kind,id).revision,publishedStoryId:null};
  }
  retainPassage(kind:PreparationSourceKind,id:string,requestId:string,fingerprint:string,source:Story,value:PassageContent):RetainedPassage {
    const content=passageContentSchema.parse(value),now=new Date().toISOString();
    if(source.id!==id)throw new StoryError('The retained passage source does not match this story or setup.');
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const prior=this.retainedGeneration(kind,id,requestId,fingerprint);if(prior){this.db.exec('COMMIT');return prior;}
      this.preparationRequestFree(kind,id,requestId);
      const record=retainedPassageSchema.parse({id:randomUUID(),sourceKind:kind,sourceId:id,requestId,fingerprint,sourceRevision:source.revision,sourceHash:recoverySourceHash(source),historyHash:recoveryHistoryHash(source),createdAt:now,updatedAt:now,version:0,status:'checking',content,issues:[{category:'interrupted',message:'The generated prose is kept. If checking was interrupted, retry its world updates below.'}],rawEffects:[],facts:recoveryFacts(recoveryBaseline(source,content),content,[]),attempts:1,activeRequestId:requestId,checkedRevision:null,checkedHash:null,proposal:null,savedRevision:null});
      this.db.prepare('INSERT INTO retained_passages VALUES(?,?,?,?,?,?)').run(record.id,kind,id,requestId,fingerprint,JSON.stringify(record));
      this.reservePreparationRequest(kind,id,requestId,'retained-passage:'+fingerprint);
      this.db.exec('COMMIT');return record;
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  updateRetainedEffects(kind:PreparationSourceKind,id:string,draftId:string,requestId:string,source:Story,effects:unknown[]) {
    const record=this.readRetained(kind,id,draftId);
    if(record.status!=='checking'||record.activeRequestId!==requestId)return record;
    record.rawEffects=effects.slice(0,100);record.facts=recoveryFacts(source,record.content,record.rawEffects);record.updatedAt=new Date().toISOString();record.version++;
    return this.writeRetained(record);
  }
  blockRetained(kind:PreparationSourceKind,id:string,draftId:string,requestId:string,issues:RecoveryIssue[]) {
    const record=this.readRetained(kind,id,draftId);
    if(record.status!=='checking'||record.activeRequestId!==requestId)return record;
    record.status='blocked';record.issues=issues;record.activeRequestId=null;record.proposal=null;record.updatedAt=new Date().toISOString();record.version++;
    return this.writeRetained(record);
  }
  private recoveryActionReceipt(kind:PreparationSourceKind,id:string,draftId:string,verb:string,input:RecoveryAction) {
    const hash=createHash('sha256').update(JSON.stringify({draftId,verb,input})).digest('hex');
    const row=this.db.prepare('SELECT hash,draft_id FROM retained_passage_actions WHERE source_kind=? AND source_id=? AND request_id=?').get(kind,id,input.requestId) as {hash:string;draft_id:string}|undefined;
    if(row&&(row.hash!==hash||row.draft_id!==draftId))throw new StoryError('This request ID belongs to different passage recovery inputs.',409);
    return {hash,replay:Boolean(row)};
  }
  private reserveRecoveryAction(kind:PreparationSourceKind,id:string,draftId:string,input:RecoveryAction,hash:string) {
    this.preparationRequestFree(kind,id,input.requestId);
    this.db.prepare('INSERT INTO retained_passage_actions VALUES(?,?,?,?,?)').run(kind,id,input.requestId,hash,draftId);
    this.reservePreparationRequest(kind,id,input.requestId,'passage-recovery:'+hash);
  }
  beginRetainedRetry(kind:PreparationSourceKind,id:string,draftId:string,value:RecoveryAction) {
    const input=recoveryActionSchema.parse(value);
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const receipt=this.recoveryActionReceipt(kind,id,draftId,'retry',input),record=this.readRetained(kind,id,draftId);
      if(receipt.replay){this.db.exec('COMMIT');return {record,replay:true};}
      const source=this.readPreparationSource(kind,id);
      if(record.version!==input.expectedVersion||source.revision!==input.expectedRevision)throw new StoryError('The saved facts or retained draft changed. Reload before rechecking its updates.',409);
      if(record.status==='saved'||record.status==='discarded')throw new StoryError('This retained passage was already saved or discarded.',409);
      if(recoveryHistoryHash(source)!==record.historyHash)throw new StoryError('Written history changed since this prose was generated. Its prose is kept for reading or copying; it cannot be added to this history.',409);
      this.reserveRecoveryAction(kind,id,draftId,input,receipt.hash);
      const previousIssues=record.issues;
      record.status='checking';record.activeRequestId=input.requestId;record.attempts++;record.proposal=null;record.checkedRevision=null;record.checkedHash=null;record.rawEffects=[];record.facts=recoveryFacts(recoveryBaseline(source,record.content),record.content,[]);record.updatedAt=new Date().toISOString();record.version++;
      record.issues=[{category:'interrupted',message:'The prose is kept while its world updates are checked. Retry if this check was interrupted.'}];
      this.writeRetained(record);this.db.exec('COMMIT');return {record,replay:false,source,previousIssues};
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  readyRetained(kind:PreparationSourceKind,id:string,draftId:string,requestId:string,source:Story,value:PassageProposal) {
    const record=this.readRetained(kind,id,draftId),proposal=recoveredProposalSchema.parse(value),{effects,memory,...content}=proposal;
    if(record.status!=='checking'||record.activeRequestId!==requestId)throw new StoryError('This retained passage check is no longer active.',409);
    if(JSON.stringify(content)!==JSON.stringify(record.content))throw new StoryError('A world-update retry cannot change the retained prose.',409);
    const current=this.readPreparationSource(kind,id);
    if(recoverySourceHash(current)!==recoverySourceHash(source))throw new StoryError('The saved facts changed during checking. Retry the updates against the current saved facts.',409);
    // The complete commit must pass, including references, pins, memory and replacement recovery.
    if(kind==='setup')prepareOpening(this.readSetup(id),proposal,record.requestId);else preparePassageCommit(current,proposal,randomUUID,record.requestId);
    record.status='ready';record.proposal=proposal;record.rawEffects=effects;record.checkedRevision=source.revision;record.checkedHash=recoverySourceHash(source);record.issues=[];record.activeRequestId=null;record.version++;record.updatedAt=new Date().toISOString();
    return this.writeRetained(record);
  }
  private markRetainedSaved(kind:PreparationSourceKind,id:string,requestId:string,story:Story) {
    const row=this.db.prepare('SELECT payload FROM retained_passages WHERE source_kind=? AND source_id=? AND request_id=?').get(kind,id,requestId) as {payload:string}|undefined;
    if(!row)return;
    const record=retainedPassageSchema.parse(JSON.parse(row.payload));record.status='saved';record.activeRequestId=null;record.issues=[];record.savedRevision=story.revision;record.version++;record.updatedAt=new Date().toISOString();this.writeRetained(record);
  }
  applyRetained(kind:PreparationSourceKind,id:string,draftId:string,value:RecoveryAction,onCommitted?: (story:Story)=>void):Story {
    const input=recoveryActionSchema.parse(value);
    if(input.notes)throw new StoryError('Submit rechecking guidance with Retry world updates before saving a recovered passage.');
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const receipt=this.recoveryActionReceipt(kind,id,draftId,'apply',input),record=this.readRetained(kind,id,draftId);
      if(receipt.replay){const saved=this.read(kind==='setup'?this.readSetup(id).storyId!:id);this.db.exec('COMMIT');return saved;}
      const source=this.readPreparationSource(kind,id);
      if(record.version!==input.expectedVersion||source.revision!==input.expectedRevision||record.checkedRevision!==source.revision||record.checkedHash!==recoverySourceHash(source))throw new StoryError('Saved facts changed after this check. Retry the retained passage updates before saving.',409);
      if(record.status!=='ready'||!record.proposal)throw new StoryError('Recheck this retained passage successfully before saving it.',409);
      if(record.historyHash!==recoveryHistoryHash(source))throw new StoryError('Written history changed. The retained prose is kept; nothing was saved.',409);
      this.reserveRecoveryAction(kind,id,draftId,input,receipt.hash);
      let saved:Story;
      if(kind==='setup'){
        const draft=this.readSetup(id);saved=this.insert(prepareOpening(draft,record.proposal,record.requestId));
        draft.storyId=saved.id;draft.revision++;draft.updatedAt=new Date().toISOString();
        this.db.prepare('UPDATE setups SET updated_at=?,payload=? WHERE id=?').run(draft.updatedAt,JSON.stringify(draft),id);
        this.db.prepare('UPDATE setup_operations SET hash=? WHERE setup_id=? AND request_id=?').run('opening:'+record.fingerprint,id,record.requestId);
      }else{
        saved=preparePassageCommit(source,record.proposal,randomUUID,record.requestId).story;saved.origin='generated';saved.revision++;saved.updatedAt=new Date().toISOString();saved=refreshRecapStatus(validateStory(saved));
        this.db.prepare('UPDATE stories SET revision=?,updated_at=?,payload=? WHERE id=?').run(saved.revision,saved.updatedAt,JSON.stringify(saved),id);
        const hash=createHash('sha256').update(JSON.stringify({expectedRevision:source.revision,requestId:record.requestId,proposal:record.proposal})).digest('hex');
        this.db.prepare('UPDATE operations SET hash=? WHERE story_id=? AND request_id=?').run(hash,id,record.requestId);
        this.db.prepare('INSERT INTO generation_receipts VALUES(?,?,?)').run(id,record.requestId,record.fingerprint);
      }
      this.markRetainedSaved(kind,id,record.requestId,saved);onCommitted?.(saved);this.db.exec('COMMIT');
      logEvent('info','storage','Saved a recovered passage',{draftId,mode:record.content.mode,sourceKind:kind,sourceRevision:source.revision,revision:saved.revision},saved.id,input.requestId);
      return saved;
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  discardRetained(kind:PreparationSourceKind,id:string,draftId:string,value:RecoveryAction):RetainedPassage {
    const input=recoveryActionSchema.parse(value);this.db.exec('BEGIN IMMEDIATE');
    try{
      const receipt=this.recoveryActionReceipt(kind,id,draftId,'discard',input),record=this.readRetained(kind,id,draftId);
      if(receipt.replay){this.db.exec('COMMIT');return record;}
      const source=this.readPreparationSource(kind,id);
      if(source.revision!==input.expectedRevision||record.version!==input.expectedVersion)throw new StoryError('The retained draft or saved facts changed. Reload before discarding.',409);
      if(record.status==='saved')throw new StoryError('This passage is already part of the story.',409);
      this.reserveRecoveryAction(kind,id,draftId,input,receipt.hash);
      record.status='discarded';record.proposal=null;record.activeRequestId=null;record.version++;record.updatedAt=new Date().toISOString();this.writeRetained(record);this.db.exec('COMMIT');return record;
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  scenePreparationResult(kind:PreparationSourceKind,id:string,requestId:string,fingerprint:string):ScenePreparationProposal|null {
    const row=this.db.prepare('SELECT fingerprint,payload FROM scene_preparation_results WHERE source_kind=? AND source_id=? AND request_id=?').get(kind,id,requestId) as {fingerprint:string;payload:string}|undefined;
    if(row){if(row.fingerprint!==fingerprint)throw new StoryError('This request ID belongs to different scene preparation inputs.',409);return scenePreparationProposalSchema.parse(JSON.parse(row.payload));}
    this.preparationRequestFree(kind,id,requestId);return null;
  }
  listScenePreparations(kind:PreparationSourceKind,id:string):ScenePreparationProposal[] {
    this.readPreparationSource(kind,id);
    return (this.db.prepare('SELECT payload FROM scene_preparation_results WHERE source_kind=? AND source_id=? ORDER BY rowid DESC LIMIT 20').all(kind,id) as {payload:string}[]).map(row=>scenePreparationProposalSchema.parse(JSON.parse(row.payload)));
  }
  readScenePreparation(kind:PreparationSourceKind,id:string,resultId:string):ScenePreparationProposal {
    const row=this.db.prepare('SELECT payload FROM scene_preparation_results WHERE source_kind=? AND source_id=? AND id=?').get(kind,id,resultId) as {payload:string}|undefined;
    if(!row)throw new StoryError('This scene preparation preview is unavailable for this story or setup. Generate a new preview.',404);
    return scenePreparationProposalSchema.parse(JSON.parse(row.payload));
  }
  saveScenePreparation(kind:PreparationSourceKind,id:string,expectedRevision:number,requestId:string,fingerprint:string,value:ScenePreparationProposal):ScenePreparationProposal {
    const result=scenePreparationProposalSchema.parse(value);z.number().int().min(0).parse(expectedRevision);
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const prior=this.scenePreparationResult(kind,id,requestId,fingerprint);if(prior){this.db.exec('COMMIT');return prior;}
      const source=this.readPreparationSource(kind,id);
      if(source.revision!==expectedRevision||result.sourceRevision!==expectedRevision||result.storyId!==id||result.sourceHash!==scenePreparationSourceHash(source)||result.appliedAt!==null||result.appliedRevision!==null)throw new StoryError('The story or setup changed during scene preparation. Generate a fresh preview against the latest saved facts.',409);
      applyPreparedScene(source,result);
      this.db.prepare('INSERT INTO scene_preparation_results VALUES(?,?,?,?,?,?)').run(result.id,kind,id,requestId,fingerprint,JSON.stringify(result));
      this.reservePreparationRequest(kind,id,requestId,'scene-preparation-preview:'+fingerprint);
      this.db.prepare('DELETE FROM scene_preparation_results WHERE source_kind=? AND source_id=? AND id NOT IN (SELECT id FROM scene_preparation_results WHERE source_kind=? AND source_id=? ORDER BY rowid DESC LIMIT 100)').run(kind,id,kind,id);
      this.db.exec('COMMIT');return result;
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  applyScenePreparation(kind:PreparationSourceKind,id:string,value:{expectedRevision:number;requestId:string;resultId:string}):SetupDraft|Story {
    z.enum(['setup','story']).parse(kind);
    const input=preparationApplySchema.parse(value),hash=createHash('sha256').update(JSON.stringify({type:'scene-preparation-apply',kind,id,...input})).digest('hex');
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const receipt=this.db.prepare('SELECT hash FROM scene_preparation_applies WHERE source_kind=? AND source_id=? AND request_id=?').get(kind,id,input.requestId) as {hash:string}|undefined;
      if(receipt){if(receipt.hash!==hash)throw new StoryError('This request ID belongs to different scene preparation apply inputs.',409);const current=kind==='setup'?this.readSetup(id):this.read(id);this.db.exec('COMMIT');return current;}
      this.preparationRequestFree(kind,id,input.requestId);
      const result=this.readScenePreparation(kind,id,input.resultId),source=this.readPreparationSource(kind,id);
      if(result.appliedAt!==null||result.appliedRevision!==null)throw new StoryError('This scene preparation was already applied. Reload the current story or setup.',409);
      if(source.revision!==input.expectedRevision||result.sourceRevision!==input.expectedRevision||result.storyId!==id||result.sourceHash!==scenePreparationSourceHash(source))throw new StoryError('The story or setup changed after this preview. Generate a fresh scene preparation; nothing was applied.',409);
      const staged=applyPreparedScene(source,result),changedCanon=JSON.stringify(staged.canon)!==JSON.stringify(source.canon),now=new Date().toISOString();
      assertFactPinsUnchanged(source,staged.canon);
      let saved:SetupDraft|Story;
      if(kind==='setup'){
        const draft=this.readSetup(id),plan=validateSetupPlan({...draft.plan!,canon:staged.canon,context:staged.context,factPins:staged.factPins});
        saved=setupDraftSchema.parse({...draft,plan,revision:draft.revision+1,updatedAt:now});
        this.db.prepare('UPDATE setups SET updated_at=?,payload=? WHERE id=?').run(saved.updatedAt,JSON.stringify(saved),id);
      }else{
        if(changedCanon&&staged.recovery)staged.recovery.valid=false;
        staged.context.compaction.epoch=source.context.compaction.epoch+Number(changedCanon);
        staged.revision=source.revision+1;staged.updatedAt=now;
        saved=refreshRecapStatus(validateStory(staged));
        this.db.prepare('UPDATE stories SET revision=?,updated_at=?,payload=? WHERE id=?').run(saved.revision,saved.updatedAt,JSON.stringify(saved),id);
      }
      result.appliedAt=saved.updatedAt;result.appliedRevision=saved.revision;
      this.db.prepare('UPDATE scene_preparation_results SET payload=? WHERE id=? AND source_kind=? AND source_id=?').run(JSON.stringify(result),result.id,kind,id);
      this.db.prepare('INSERT INTO scene_preparation_applies VALUES(?,?,?,?)').run(kind,id,input.requestId,hash);
      this.reservePreparationRequest(kind,id,input.requestId,'scene-preparation-apply:'+hash);
      this.db.exec('COMMIT');
      logEvent('info','storage','Applied reviewed scene preparation',{sourceKind:kind,resultId:result.id,revision:saved.revision,changedCanon},id,input.requestId);
      return saved;
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  correctionResult(storyId:string,requestId:string,fingerprint:string):CorrectionResult|null {
    const row=this.db.prepare('SELECT fingerprint,payload FROM correction_results WHERE story_id=? AND request_id=?').get(storyId,requestId) as {fingerprint:string;payload:string}|undefined;
    if(row&&row.fingerprint!==fingerprint)throw new StoryError('This request ID belongs to different correction inputs.',409);
    if(!row&&(this.db.prepare('SELECT 1 FROM operations WHERE story_id=? AND request_id=?').get(storyId,requestId)||this.db.prepare('SELECT 1 FROM editor_results WHERE story_id=? AND request_id=?').get(storyId,requestId)))throw new StoryError('This request ID belongs to another story operation.',409);
    return row?correctionResultSchema.parse(JSON.parse(row.payload)):null;
  }
  listCorrectionResults(storyId:string):CorrectionResult[] {
    this.read(storyId);
    return (this.db.prepare('SELECT payload FROM correction_results WHERE story_id=? ORDER BY rowid DESC LIMIT 20').all(storyId) as {payload:string}[]).map(row=>correctionResultSchema.parse(JSON.parse(row.payload)));
  }
  readCorrectionResult(storyId:string,resultId:string):CorrectionResult {
    const row=this.db.prepare('SELECT payload FROM correction_results WHERE story_id=? AND id=?').get(storyId,resultId) as {payload:string}|undefined;
    if(!row)throw new StoryError('This correction preview is unavailable. Generate a new preview.',404);
    return correctionResultSchema.parse(JSON.parse(row.payload));
  }
  saveCorrectionResult(storyId:string,expectedRevision:number,requestId:string,fingerprint:string,value:CorrectionResult):CorrectionResult {
    const result=correctionResultSchema.parse(value);
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const prior=this.correctionResult(storyId,requestId,fingerprint);if(prior){this.db.exec('COMMIT');return prior;}
      const story=this.read(storyId);
      if(story.revision!==expectedRevision||result.sourceRevision!==expectedRevision||result.storyId!==storyId||result.appliedAt!==null||result.appliedRevision!==null||!story.passages.some(p=>p.id===result.passageId)||result.sourceHash!==memorySourceHash(story,[result.passageId]))throw new StoryError('The story changed during this correction request. Generate a new preview against the latest saved facts.',409);
      const staged=applyCorrectionOperations(story,result.operations);
      if(JSON.stringify(staged.canon)===JSON.stringify(story.canon))throw new StoryError('The model proposed no changes to current records. Nothing was saved.',502);
      this.db.prepare('INSERT INTO correction_results VALUES(?,?,?,?,?)').run(result.id,storyId,requestId,fingerprint,JSON.stringify(result));
      this.db.prepare('DELETE FROM correction_results WHERE story_id=? AND id NOT IN (SELECT id FROM correction_results WHERE story_id=? ORDER BY rowid DESC LIMIT 100)').run(storyId,storyId);
      this.db.exec('COMMIT');return result;
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  applyCorrection(storyId:string,value:{expectedRevision:number;requestId:string;resultId:string}):Story {
    const input=correctionApplySchema.parse(value),hash=createHash('sha256').update(JSON.stringify({type:'apply-correction',...input})).digest('hex');
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const receipt=this.db.prepare('SELECT hash FROM operations WHERE story_id=? AND request_id=?').get(storyId,input.requestId) as {hash:string}|undefined;
      if(receipt){if(receipt.hash!==hash)throw new StoryError('This request ID belongs to another edit.',409);const current=this.read(storyId);this.db.exec('COMMIT');return current;}
      const result=this.readCorrectionResult(storyId,input.resultId),story=this.read(storyId);
      if(result.appliedAt){this.db.exec('COMMIT');return story;}
      if(story.revision!==input.expectedRevision||result.sourceRevision!==input.expectedRevision||!story.passages.some(p=>p.id===result.passageId)||result.sourceHash!==memorySourceHash(story,[result.passageId]))throw new StoryError('The story changed after this correction preview. Generate a fresh preview; nothing was applied.',409);
      const staged=applyCorrectionOperations(story,result.operations);
      if(JSON.stringify(staged.canon)===JSON.stringify(story.canon))throw new StoryError('This preview contains no current-record changes.',409);
      if(staged.recovery)staged.recovery.valid=false;
      staged.context.compaction.epoch++;staged.revision++;staged.updatedAt=new Date().toISOString();
      const saved=refreshRecapStatus(validateStory(staged));result.appliedAt=saved.updatedAt;result.appliedRevision=saved.revision;
      this.db.prepare('UPDATE stories SET revision=?,updated_at=?,payload=? WHERE id=?').run(saved.revision,saved.updatedAt,JSON.stringify(saved),storyId);
      this.db.prepare('UPDATE correction_results SET payload=? WHERE id=? AND story_id=?').run(JSON.stringify(result),result.id,storyId);
      this.db.prepare('INSERT INTO operations VALUES(?,?,?)').run(storyId,input.requestId,hash);
      this.db.exec('COMMIT');
      logEvent('info','storage','Applied reviewed story corrections',{resultId:result.id,sourcePassageId:result.passageId,revision:saved.revision,requestId:input.requestId,changeCount:result.changes.length},storyId,input.requestId);
      return saved;
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  editorResult(storyId: string, requestId: string, fingerprint: string): EditorResult | null {
    const row = this.db.prepare('SELECT fingerprint,payload FROM editor_results WHERE story_id=? AND request_id=?').get(storyId,requestId) as { fingerprint: string; payload: string } | undefined;
    if (row && row.fingerprint !== fingerprint) throw new StoryError('This request ID belongs to different editor inputs.',409);
    if (!row && this.db.prepare('SELECT 1 FROM operations WHERE story_id=? AND request_id=?').get(storyId,requestId)) throw new StoryError('This request ID belongs to a story edit.',409);
    return row ? editorResultSchema.parse(JSON.parse(row.payload)) : null;
  }
  listEditorResults(storyId: string): EditorResult[] {
    this.read(storyId);
    return (this.db.prepare('SELECT payload FROM editor_results WHERE story_id=? ORDER BY rowid DESC LIMIT 20').all(storyId) as {payload:string}[]).map(row => editorResultSchema.parse(JSON.parse(row.payload)));
  }
  readEditorResult(storyId: string, id: string): EditorResult {
    const row = this.db.prepare('SELECT payload FROM editor_results WHERE story_id=? AND id=?').get(storyId,id) as {payload:string} | undefined;
    if (!row) throw new StoryError('This editor result is unavailable in this story. Generate a new preview.',404);
    return editorResultSchema.parse(JSON.parse(row.payload));
  }
  saveEditorResult(storyId: string, expectedRevision: number, requestId: string, fingerprint: string, value: EditorResult): EditorResult {
    const result = editorResultSchema.parse(value);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const prior = this.editorResult(storyId,requestId,fingerprint); if (prior) { this.db.exec('COMMIT'); return prior; }
      const story = this.read(storyId);
      if (story.revision !== expectedRevision || result.sourceRevision !== expectedRevision || result.storyId !== storyId) throw new StoryError('The story changed during this editor request. Reload and try against the latest save.',409);
      const passage = story.passages.find(p => p.id === result.passageId);
      if (!passage) throw new StoryError('The source passage is missing.',409);
      if (result.kind === 'polish') {
        if (result.acceptedAt || result.acceptedRevision !== null || !result.review.equivalent || result.review.issues.length || result.sourceHash !== memorySourceHash(story,[passage.id]) || JSON.stringify(result.original) !== JSON.stringify(passage.paragraphs)) throw new StoryError('The polish preview has invalid source/review data.',409);
        validateWording(story,passage,{paragraphs:result.paragraphs});
      }
      this.db.prepare('INSERT INTO editor_results VALUES(?,?,?,?,?)').run(result.id,storyId,requestId,fingerprint,JSON.stringify(result));
      this.db.prepare('DELETE FROM editor_results WHERE story_id=? AND id NOT IN (SELECT id FROM editor_results WHERE story_id=? ORDER BY rowid DESC LIMIT 100)').run(storyId,storyId);
      this.db.exec('COMMIT'); return result;
    } catch(e) { this.db.exec('ROLLBACK'); throw e; }
  }
  acceptPolish(storyId: string, previewId: string, expectedRevision: number, requestId: string): Story {
    const hash = createHash('sha256').update(JSON.stringify({type:'accept-polish',previewId,expectedRevision})).digest('hex');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const receipt = this.db.prepare('SELECT hash FROM operations WHERE story_id=? AND request_id=?').get(storyId,requestId) as {hash:string}|undefined;
      if (receipt) { if (receipt.hash !== hash) throw new StoryError('This request ID belongs to another edit.',409); const story=this.read(storyId);this.db.exec('COMMIT');return story; }
      const preview = this.readEditorResult(storyId,previewId), story = this.read(storyId);
      if (preview.kind !== 'polish') throw new StoryError('Choose a reviewed wording preview.');
      if (preview.acceptedAt) { this.db.exec('COMMIT'); return story; }
      if (story.revision !== expectedRevision || preview.sourceRevision !== expectedRevision || preview.sourceHash !== memorySourceHash(story,[preview.passageId])) throw new StoryError('The story changed after this preview. Generate a fresh wording preview; nothing was applied.',409);
      if (!preview.review.equivalent || preview.review.issues.length) throw new StoryError('This preview did not pass its wording-only review.',409);
      const passage = story.passages.find(p => p.id === preview.passageId)!;
      validateWording(story,passage,{paragraphs:preview.paragraphs});
      const before = structuredClone(story);
      passage.paragraphs = preview.paragraphs;
      // Rebase only previously current notes after the reviewed equivalent wording change.
      // Stale memories stay stale; higher-level chapter/book hashes still expire.
      for (const m of story.context.memories) if (m.passageIds.includes(passage.id) && memoryCurrent(before,m)) m.sourceHash = memorySourceHash(story,m.passageIds);
      for (const k of story.context.knowledge) if (k.sourcePassageId === passage.id && k.sourceHash === memorySourceHash(before,[passage.id])) k.sourceHash = memorySourceHash(story,[passage.id]);
      story.revision++;story.updatedAt=new Date().toISOString();
      const valid=refreshRecapStatus(validateStory(story));preview.acceptedAt=valid.updatedAt;preview.acceptedRevision=valid.revision;
      this.db.prepare('UPDATE stories SET revision=?,updated_at=?,payload=? WHERE id=?').run(valid.revision,valid.updatedAt,JSON.stringify(valid),storyId);
      this.db.prepare('UPDATE editor_results SET payload=? WHERE id=? AND story_id=?').run(JSON.stringify(preview),preview.id,storyId);
      this.db.prepare('INSERT INTO operations VALUES(?,?,?)').run(storyId,requestId,hash);
      this.db.exec('COMMIT');
      const trace=beginTrace('wording-commit',{previewId,passageId:passage.id,sourceRevision:expectedRevision},storyId,valid.revision);endTrace(trace,{changes:stateChanges(before,valid),worldUnchanged:true});
      return valid;
    } catch(e) { this.db.exec('ROLLBACK');throw e; }
  }
  commitGeneratedPassage(id: string, value: PassageCommit, generationFingerprint?: string, onCommitted?: (story:Story)=>void): Story {
    const input = passageCommitSchema.parse(value);
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const prior = this.db.prepare('SELECT hash FROM operations WHERE story_id=? AND request_id=?').get(id, input.requestId) as { hash: string } | undefined;
      if (prior && prior.hash !== 'retained-passage:'+generationFingerprint) { if (prior.hash !== hash) throw new StoryError('This request ID belongs to a different passage proposal.', 409); const result = this.read(id); this.db.exec('COMMIT'); return result; }
      const before = this.read(id);
      if (before.revision !== input.expectedRevision) throw new StoryError('The story changed while this passage was generating. No prose or world changes were committed.', 409);
      const prepared = preparePassageCommit(before, input.proposal, randomUUID, input.requestId), story = prepared.story;
      if (generationFingerprint) story.origin = 'generated';
      story.revision++; story.updatedAt = new Date().toISOString();
      const valid = refreshRecapStatus(validateStory(story));
      this.db.prepare('UPDATE stories SET revision=?, updated_at=?, payload=? WHERE id=?').run(valid.revision, valid.updatedAt, JSON.stringify(valid), id);
      if(prior)this.db.prepare('UPDATE operations SET hash=? WHERE story_id=? AND request_id=?').run(hash,id,input.requestId);else this.db.prepare('INSERT INTO operations VALUES (?, ?, ?)').run(id,input.requestId,hash);
      this.markRetainedSaved('story',id,input.requestId,valid);
      if (generationFingerprint) this.db.prepare('INSERT INTO generation_receipts VALUES (?, ?, ?)').run(id, input.requestId, generationFingerprint);
      onCommitted?.(valid);
      this.db.exec('COMMIT');
      const trace = beginTrace('passage-commit', { mode: input.proposal.mode, requestId: input.requestId, sourceRevision: input.expectedRevision }, id, input.expectedRevision);
      endTrace(trace, { passageId: prepared.passage.id, revision: valid.revision, assignedIds: prepared.assigned, effects: prepared.effects, changes: stateChanges(before, valid) });
      return valid;
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  generatedPassageResult(id: string, requestId: string, fingerprint: string): Story | null {
    const receipt = this.db.prepare('SELECT fingerprint FROM generation_receipts WHERE story_id=? AND request_id=?').get(id, requestId) as { fingerprint: string } | undefined;
    if (receipt) { if (receipt.fingerprint !== fingerprint) throw new StoryError('This request ID belongs to different generation inputs.', 409); return this.read(id); }
    const reserved=this.db.prepare('SELECT hash FROM operations WHERE story_id=? AND request_id=?').get(id,requestId) as {hash:string}|undefined;
    if(reserved&&reserved.hash!=='retained-passage:'+fingerprint)throw new StoryError('This request ID belongs to another story edit.',409);
    return null;
  }
  listSetups(): SetupDraft[] { return (this.db.prepare('SELECT payload FROM setups ORDER BY updated_at DESC').all() as { payload: string }[]).map(row => setupDraftSchema.parse(JSON.parse(row.payload))).filter(s => !s.storyId); }
  readSetup(id: string): SetupDraft {
    const row = this.db.prepare('SELECT payload FROM setups WHERE id=?').get(id) as { payload: string } | undefined;
    if (!row) throw new StoryError('Setup draft not found.', 404);
    return setupDraftSchema.parse(JSON.parse(row.payload));
  }
  exportSetup(id: string, expectedRevision?: number): Uint8Array {
    if (expectedRevision !== undefined) z.number().int().min(0).parse(expectedRevision);
    const draft = this.readSetup(id);
    if (expectedRevision !== undefined && draft.revision !== expectedRevision) throw new StoryError('This setup changed after saving. Reload the saved setup before exporting again. Your saved draft is kept.', 409);
    return encodeSetupArchive(draft);
  }
  importSetup(bytes: Uint8Array): SetupDraft {
    const original = decodeSetupArchive(bytes), now = new Date().toISOString();
    const draft: SetupDraft = { ...original, id: randomUUID(), revision: 0, createdAt: now, updatedAt: now, storyId: null };
    const payload = JSON.stringify(draft), hash = createHash('sha256').update(payload).digest('hex');
    // A fresh row and request ID make every import a separate editable draft. No
    // setup receipts, generated jobs, story rows or connection settings are imported.
    this.db.prepare('INSERT INTO setups VALUES(?,?,?,?,?)').run(draft.id, randomUUID(), hash, now, payload);
    return draft;
  }
  createSetup(value: unknown, requestId: string): SetupDraft {
    z.string().uuid().parse(requestId); const input = setupInputSchema.parse(value), hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const prior = this.db.prepare('SELECT hash,payload FROM setups WHERE request_id=?').get(requestId) as { hash: string; payload: string } | undefined;
    if (prior) { if (prior.hash !== hash) throw new StoryError('This setup request ID belongs to another premise.', 409); return setupDraftSchema.parse(JSON.parse(prior.payload)); }
    const now = new Date().toISOString(), draft: SetupDraft = { id: randomUUID(), revision: 0, input, plan: null, storyId: null, createdAt: now, updatedAt: now };
    this.db.prepare('INSERT INTO setups VALUES(?,?,?,?,?)').run(draft.id, requestId, hash, now, JSON.stringify(draft)); return draft;
  }
  private setupReceipt(id: string, requestId: string, hash: string): boolean {
    const row = this.db.prepare('SELECT hash FROM setup_operations WHERE setup_id=? AND request_id=?').get(id, requestId) as { hash: string } | undefined;
    if (row && row.hash !== hash) throw new StoryError('This setup request ID belongs to another operation.', 409); return Boolean(row);
  }
  saveSetup(id: string, value: unknown): SetupDraft {
    const input = setupSaveSchema.parse(value), hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    if (input.plan) { try { validateSetupPlan(input.plan); } catch (e) { throw new StoryError(e instanceof Error ? e.message : 'Check the setup references.'); } }
    return this.commitSetup(id, input.expectedRevision, input.requestId, hash, input.input, input.plan);
  }
  generatedSetupResult(id: string, requestId: string, fingerprint: string) { return this.setupReceipt(id, requestId, 'generate:' + fingerprint) ? this.readSetup(id) : null; }
  commitGeneratedSetup(id: string, expectedRevision: number, requestId: string, fingerprint: string, plan: unknown) {
    const prior = this.generatedSetupResult(id, requestId, fingerprint); if (prior) return prior;
    const draft = this.readSetup(id), next = validateSetupPlan(plan), pins = draft.plan?.factPins ?? emptyFactPins();
    if (JSON.stringify(next.factPins) !== JSON.stringify(pins)) throw new StoryError('AI cannot change saved setup pins or world rules. Edit them manually before generating again. The saved setup is kept.', 409);
    if (draft.plan) assertFactPinsUnchanged(draft.plan, next.canon);
    return this.commitSetup(id, expectedRevision, requestId, 'generate:' + fingerprint, draft.input, next);
  }
  private commitSetup(id: string, revision: number, requestId: string, hash: string, input: SetupDraft['input'], plan: SetupDraft['plan']): SetupDraft {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (this.setupReceipt(id, requestId, hash)) { const current = this.readSetup(id); this.db.exec('COMMIT'); return current; }
      const draft = this.readSetup(id);
      if (draft.storyId) throw new StoryError('This setup is already a written story.', 409);
      if (draft.revision !== revision) throw new StoryError('The setup changed in another tab or during generation. Reload before saving; your prior draft is kept.', 409);
      const next = setupDraftSchema.parse({ ...draft, input, plan, revision: revision + 1, updatedAt: new Date().toISOString() });
      this.db.prepare('UPDATE setups SET updated_at=?,payload=? WHERE id=?').run(next.updatedAt, JSON.stringify(next), id);
      this.db.prepare('INSERT INTO setup_operations VALUES(?,?,?)').run(id, requestId, hash); this.db.exec('COMMIT'); return next;
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  openingResult(id: string, requestId: string, fingerprint: string): Story | null {
    const reserved=this.db.prepare('SELECT hash FROM setup_operations WHERE setup_id=? AND request_id=?').get(id,requestId) as {hash:string}|undefined;
    if(reserved?.hash==='retained-passage:'+fingerprint)return null;
    return this.setupReceipt(id, requestId, 'opening:' + fingerprint) ? this.read(this.readSetup(id).storyId!) : null;
  }
  commitOpening(id: string, expectedRevision: number, requestId: string, fingerprint: string, proposal: z.infer<typeof passageProposalSchema>): Story {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const prior = this.openingResult(id, requestId, fingerprint); if (prior) { this.db.exec('COMMIT'); return prior; }
      const draft = this.readSetup(id);
      if (draft.storyId) throw new StoryError('Chapter one is already written. Open the story from Library.', 409);
      if (draft.revision !== expectedRevision) throw new StoryError('The setup changed while the opening was being written. Your saved setup is kept.', 409);
      const story = this.insert(prepareOpening(draft, proposal, requestId));
      draft.storyId = story.id; draft.revision++; draft.updatedAt = new Date().toISOString();
      this.db.prepare('UPDATE setups SET updated_at=?,payload=? WHERE id=?').run(draft.updatedAt, JSON.stringify(draft), id);
      this.db.prepare('INSERT INTO setup_operations VALUES(?,?,?) ON CONFLICT(setup_id,request_id) DO UPDATE SET hash=excluded.hash').run(id,requestId,'opening:'+fingerprint);
      this.markRetainedSaved('setup',id,requestId,story);
      this.db.exec('COMMIT'); return story;
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  generatedMemoryResult(id: string, requestId: string): Story | null {
    const operation = this.db.prepare('SELECT hash FROM operations WHERE story_id = ? AND request_id = ?').get(id, requestId) as { hash: string } | undefined;
    if (operation && operation.hash !== 'memory-generation') throw new StoryError('This request ID belongs to another operation.', 409);
    return operation ? this.read(id) : null;
  }
  compactionResult(id: string, requestId: string): Story | null {
    const row = this.db.prepare('SELECT hash FROM operations WHERE story_id=? AND request_id=?').get(id, requestId) as { hash: string } | undefined;
    if (row && row.hash !== 'memory-compaction') throw new StoryError('This request ID belongs to another operation.', 409);
    return row ? this.read(id) : null;
  }
  commitCompaction(id: string, expectedRevision: number, requestId: string, value: MemoryCompaction): Story {
    const compaction = memoryCompactionSchema.parse(value);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const prior = this.compactionResult(id, requestId); if (prior) { this.db.exec('COMMIT'); return prior; }
      const story = this.read(id);
      if (story.revision !== expectedRevision || story.context.compaction.epoch !== compaction.epoch) throw new StoryError('The story changed during memory maintenance. Existing summaries were kept; rebuild against the latest save.', 409);
      const previous = story.context.compaction; story.context.compaction = compaction;
      for (const m of compaction.chapters) if (JSON.stringify(m) !== JSON.stringify(previous.chapters.find(p => p.id === m.id)) && !chapterMemoryCurrent(story, m)) throw new StoryError('A chapter summary has invalid source coverage.', 409);
      if (JSON.stringify(compaction.book) !== JSON.stringify(previous.book) && compaction.book && !bookMemoryCurrent(story)) throw new StoryError('The book overview has invalid source coverage.', 409);
      story.revision++; story.updatedAt = new Date().toISOString();
      const valid = validateStory(story);
      this.db.prepare('UPDATE stories SET revision=?,updated_at=?,payload=? WHERE id=?').run(valid.revision, valid.updatedAt, JSON.stringify(valid), id);
      this.db.prepare('INSERT INTO operations VALUES(?,?,?)').run(id, requestId, 'memory-compaction');
      this.db.exec('COMMIT'); logEvent('info', 'memory', 'Chapter/book memories saved', { chapters: compaction.chapters.length, book: !!compaction.book, revision: valid.revision }, id, requestId); return valid;
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  commitGeneratedMemory(id: string, expectedRevision: number, requestId: string, value: ContextMemory): Story {
    const memory = contextMemorySchema.parse(value);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.generatedMemoryResult(id, requestId);
      if (existing) { this.db.exec('COMMIT'); return existing; }
      const story = this.read(id);
      if (story.revision !== expectedRevision || memory.sourceHash !== memorySourceHash(story, memory.passageIds)) throw new StoryError('The story changed while memory was generating. Existing memories have been kept.', 409);
      story.context.memories = [...story.context.memories.filter(m => m.id !== memory.id), memory];
      story.revision++; story.updatedAt = new Date().toISOString();
      const valid = refreshRecapStatus(validateStory(story));
      this.db.prepare('UPDATE stories SET revision = ?, updated_at = ?, payload = ? WHERE id = ?').run(valid.revision, valid.updatedAt, JSON.stringify(valid), id);
      this.db.prepare('INSERT INTO operations VALUES (?, ?, ?)').run(id, requestId, 'memory-generation');
      this.db.exec('COMMIT'); logEvent('info', 'memory', 'Continuity memory saved', { memoryId: memory.id, passageIds: memory.passageIds, revision: valid.revision }, id, requestId); return valid;
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  generatedRecapResult(id: string, requestId: string): Story | null {
    const operation = this.db.prepare('SELECT hash FROM operations WHERE story_id = ? AND request_id = ?').get(id, requestId) as { hash: string } | undefined;
    if (operation && operation.hash !== 'recap-generation') throw new StoryError('This request ID belongs to another operation.', 409);
    return operation ? this.read(id) : null;
  }
  commitGeneratedRecap(id: string, value: GeneratedRecap): Story {
    const input = generatedRecapSchema.parse(value);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.generatedRecapResult(id, input.requestId);
      if (existing) { this.db.exec('COMMIT'); return existing; }
      const story = this.read(id);
      if (story.revision !== input.expectedRevision || recapSourceHash(story) !== input.recap.sourceHash) throw new StoryError('The story changed while the recap was generating. Your previous recap is safe; refresh the story before generating again.', 409);
      if (input.recap.passageCount !== story.passages.length || input.recap.throughPassageId !== story.passages.at(-1)!.id || input.recap.source !== 'generated') throw new StoryError('The generated recap has invalid coverage.');
      story.recap = input.recap; story.summaryCache = input.summaryCache;
      story.revision++; story.updatedAt = new Date().toISOString();
      const valid = refreshRecapStatus(validateStory(story));
      this.db.prepare('UPDATE stories SET revision = ?, updated_at = ?, payload = ? WHERE id = ?').run(valid.revision, valid.updatedAt, JSON.stringify(valid), id);
      this.db.prepare('INSERT INTO operations VALUES (?, ?, ?)').run(id, input.requestId, 'recap-generation');
      this.db.exec('COMMIT'); return valid;
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  mutate(id: string, input: Mutation): Story {
    const parsed = mutationSchema.parse(input);
    const hash = createHash('sha256').update(JSON.stringify(parsed)).digest('hex');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const previous = this.db.prepare('SELECT hash FROM operations WHERE story_id = ? AND request_id = ?').get(id, parsed.requestId) as { hash: string } | undefined;
      if (previous) {
        if (previous.hash !== hash) throw new StoryError('This request ID has already been used for a different edit.', 409);
        const current = this.read(id); this.db.exec('COMMIT'); return current;
      }
      const story = this.read(id);
      if (story.revision !== parsed.expectedRevision) throw new StoryError('This story changed in another tab. Reload the latest version before saving. Your unsaved edit is still on screen.', 409);
      const before = structuredClone(story);
      const a = parsed.action;
      let changesCanon = false;
      if(a.type==='fact-pins'){
        story.factPins=a.factPins;
      }else if(a.type==='item-split'){
        splitItemStack(story.canon,a.itemId,a.quantity,a.ownerId,randomUUID);changesCanon=true;
      }else if(a.type==='record-save'){
        saveRecord(story,a.edit);changesCanon=true;
      }else if(a.type==='record-remove'){
        removeRecord(story,a.kind,a.id);changesCanon=true;
        story.factPins.fields=story.factPins.fields.filter(pin=>pin.kind!==a.kind||pin.recordId!==a.id);
      }else if(a.type==='story-title'){
        story.title=a.title;
      }else if (a.type === 'media-remove') {
        if (!story.media.assets.some(i => i.id === a.assetId)) throw new StoryError('Picture does not exist.', 404);
        if (story.media.assets.some(i => i.parentId === a.assetId)) throw new StoryError('This picture has variants. Remove those variants first, or keep the parent as experimental.');
        story.media.assets = story.media.assets.filter(i => i.id !== a.assetId);
        for (const selections of [story.media.portraits, story.media.references]) for (const [person, picture] of Object.entries(selections)) if (picture === a.assetId) delete selections[person];
      } else if (a.type === 'media-select') {
        const selections = a.selection === 'portrait' ? story.media.portraits : story.media.references;
        if (!story.canon.characters.some(c => c.id === a.characterId)) throw new StoryError('Character does not exist.');
        if (a.assetId) {
          const asset = story.media.assets.find(i => i.id === a.assetId);
          if (!asset?.subjectIds.includes(a.characterId)) throw new StoryError('Select a picture depicting this character.');
          selections[a.characterId] = a.assetId;
        } else delete selections[a.characterId];
      } else if (a.type === 'media-edit') {
        const asset = story.media.assets.find(i => i.id === a.assetId);
        if (!asset) throw new StoryError('Picture does not exist.', 404);
        const subjects = [...story.canon.characters, ...story.canon.places, ...story.canon.items];
        if (a.edit.subjectIds.some(id => !subjects.some(s => s.id === id) && !asset.subjectIds.includes(id))) throw new StoryError('Image subject does not exist.');
        // New associations capture current facts; existing historical snapshots are immutable.
        for (const id of a.edit.subjectIds) if (!asset.snapshots.some(s => s.id === id)) {
          const c = story.canon.characters.find(c => c.id === id), s = subjects.find(s => s.id === id)!;
          asset.snapshots.push({ id, name: s.name, appearance: c?.appearance || '', outfit: c?.outfit || '' });
        }
        Object.assign(asset, a.edit, { status: asset.status === 'superseded' ? 'superseded' : a.edit.status });
        for (const selections of [story.media.portraits, story.media.references]) for (const [id, picture] of Object.entries(selections)) if (picture === asset.id && !asset.subjectIds.includes(id)) delete selections[id];
      } else if (a.type === 'character') {
        const index = story.canon.characters.findIndex(c => c.id === a.character.id);
        if (index < 0) throw new StoryError('Character does not exist.');
        if(story.canon.characters[index].name!==a.character.name)rememberPassageViewpoints(story);
        story.canon.characters[index] = a.character; changesCanon = true;
      } else if (a.type === 'world') { story.canon.funds = a.funds; story.canon.cargoNotes = a.cargoNotes; changesCanon = true;
      } else if (a.type === 'transfer') { transferItem(story.canon, a.itemId, a.ownerId); changesCanon = true;
      } else if (a.type === 'thread') {
        const thread = story.canon.threads.find(t => t.id === a.threadId);
        if (!thread) throw new StoryError('Story thread does not exist.');
        thread.notes = a.notes; thread.status = a.status; changesCanon = true;
      } else if (a.type === 'preferences') {
        Object.assign(story, { title: a.title, premise: a.premise, narrationStyle: a.narrationStyle, artStyle: a.artStyle, adultContent: a.adultContent });
        if (a.preferences) story.preferences = a.preferences;
      } else if (a.type === 'recap') {
        const previous = story.recap;
        story.recap = { text: a.text, source: 'manual', updatedAt: new Date().toISOString(),
          sourceHash: a.confirmCurrent ? recapSourceHash(story) : previous?.sourceHash ?? '0'.repeat(64),
          passageCount: a.confirmCurrent || !previous ? story.passages.length : previous.passageCount,
          throughPassageId: a.confirmCurrent || !previous ? story.passages.at(-1)!.id : previous.throughPassageId,
          stale: false };
      } else if (a.type === 'context') {
        const context = a.context;
        // Hiding/removing background also detaches its old planning hint. New
        // invalid resource IDs still reach the ordinary reference validator.
        const detachedLore = new Set(story.context.lore.filter(entry => entry.visibility !== 'hidden' && !context.lore.some(next => next.id === entry.id && next.visibility !== 'hidden')).map(entry => entry.id));
        if (context.sceneBrief.resourceIds) context.sceneBrief.resourceIds = context.sceneBrief.resourceIds.filter(id => !detachedLore.has(id));
        // Derived summaries and correction epochs are server-owned; ordinary editor saves cannot relabel stale sources.
        context.compaction = story.context.compaction;
        for (const m of context.memories) {
          const prior = story.context.memories.find(p => p.id === m.id);
          if (!prior || JSON.stringify([prior.summary, prior.facts, prior.openQuestions, prior.passageIds]) !== JSON.stringify([m.summary, m.facts, m.openQuestions, m.passageIds])) {
            m.sourceHash = memorySourceHash(story, m.passageIds); m.source = 'manual'; m.createdAt = new Date().toISOString();
          } else { m.sourceHash = prior.sourceHash; m.source = prior.source; m.createdAt = prior.createdAt; }
        }
        for (const k of context.knowledge) {
          const prior = story.context.knowledge.find(p => p.id === k.id);
          if (!prior || JSON.stringify([prior.fact, prior.truth, prior.knownBy, prior.readerRevealed, prior.sourcePassageId]) !== JSON.stringify([k.fact, k.truth, k.knownBy, k.readerRevealed, k.sourcePassageId])) k.sourceHash = k.sourcePassageId ? memorySourceHash(story, [k.sourcePassageId]) : null;
          else k.sourceHash = prior.sourceHash;
        }
        story.context = context;
      } else if (a.type === 'scene-brief') {
        story.context.sceneBrief = a.brief;
      } else if (a.type === 'rename') {
        const p = story.passages.find(p => p.id === a.passageId);
        if (!p) throw new StoryError('Passage does not exist.');
        p.title = a.title;
        story.passages.filter(s => s.chapter === p.chapter).forEach(s => s.chapterTitle = a.chapterTitle);
      } else if (a.type === 'sample-continue') {
        if (story.passages.length !== 3) throw new StoryError('You have reached the end of the sample continuation. Live LLM generation is the next build step.');
        Object.assign(story, preparePassageCommit(story, sampleContinuationProposal(a.direction), randomUUID, parsed.requestId).story);
      } else if (a.type === 'sample-replace') {
        Object.assign(story, preparePassageCommit(story, sampleReplacementProposal(story, a.passageId), randomUUID, parsed.requestId).story);
      }
      if (changesCanon && JSON.stringify(before.canon) !== JSON.stringify(story.canon)) {
        if(story.recovery)story.recovery.valid=false;
        story.context.compaction.epoch++;
      }
      story.revision++; story.updatedAt = new Date().toISOString();
      const valid = refreshRecapStatus(validateStory(story));
      this.db.prepare('UPDATE stories SET revision = ?, updated_at = ?, payload = ? WHERE id = ?').run(valid.revision, valid.updatedAt, JSON.stringify(valid), id);
      this.db.prepare('INSERT INTO operations VALUES (?, ?, ?)').run(id, parsed.requestId, hash);
      this.db.exec('COMMIT');
      logEvent('info', 'storage', `Saved ${a.type}`, { revision: valid.revision, requestId: parsed.requestId }, id, parsed.requestId);
      const trace = beginTrace('state-change', { action: a.type, beforeRevision: before.revision, afterRevision: valid.revision, changes: stateChanges(before, valid) }, id, valid.revision);
      endTrace(trace, { committed: true });
      return valid;
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  export(id: string): Uint8Array {
    const story = this.read(id);
    const files: Record<string, Uint8Array> = {};
    let total = 0;
    for (const a of story.media.assets) {
      const name = `media/${a.hash}.original`;
      if (files[name]) continue;
      const bytes = this.mediaStore.original(a); total += bytes.length;
      if (total > 110_000_000) throw new StoryError('This export exceeds the current 110 MB media limit.', 413);
      files[name] = bytes;
    }
    const payload = strToU8(JSON.stringify(story));
    if (payload.length > 10_000_000) throw new StoryError('This story exceeds the current 10 MB metadata export limit.', 413);
    return zipSync({ ...files, 'manifest.json': strToU8(JSON.stringify({ format: 'guided-story-dev-1', media: Object.keys(files), exportedAt: new Date().toISOString() })), 'story.json': payload }, { level: 1 });
  }
  async import(bytes: Uint8Array): Promise<Story> {
    if (bytes.length > MAX_ARCHIVE_BYTES) throw new StoryError('Story archive is too large (128 MB limit).');
    let total = 0; const seen = new Set<string>();
    let files: ReturnType<typeof unzipSync>;
    try { files = unzipSync(bytes, { filter(file) {
      if (seen.has(file.name) || seen.size >= 2002) throw new StoryError('Archive contains duplicate or too many entries.'); seen.add(file.name);
      if (!['manifest.json', 'story.json'].includes(file.name) && !/^media\/[a-f0-9]{64}\.original$/.test(file.name)) throw new StoryError('Unsupported file or unsafe path in this story archive.');
      total += file.originalSize;
      if (total > 128_000_000 || file.originalSize > (file.name.startsWith('media/') ? 20_000_000 : 10_000_000)) throw new StoryError('Expanded story archive is too large.');
      return true;
    } }); } catch (e) { if (e instanceof StoryError) throw e; throw new StoryError('This archive is corrupt or is not a supported story ZIP.'); }
    if (!files['manifest.json'] || !files['story.json']) throw new StoryError('This is not a Guided Story archive.');
    const manifest = JSON.parse(strFromU8(files['manifest.json']));
    if (manifest.format !== 'guided-story-dev-1') throw new StoryError('Incompatible development save format. Old saves do not have migrations.');
    const imported = validateStory(JSON.parse(strFromU8(files['story.json'])));
    const names = [...new Set(imported.media.assets.map(a => `media/${a.hash}.original`))].sort();
    if (JSON.stringify(names) !== JSON.stringify(Object.keys(files).filter(n => n.startsWith('media/')).sort()) || JSON.stringify(names) !== JSON.stringify([...(manifest.media || [])].sort())) throw new StoryError('Archive media manifest does not match the story.');
    // Validate every image before writing anything or inserting a library entry.
    const inspected = new Map<string, Awaited<ReturnType<MediaStore['inspect']>>>();
    for (const a of imported.media.assets) {
      const info = inspected.get(a.hash) || await this.mediaStore.inspect(files[`media/${a.hash}.original`]);
      if (['hash','mime','width','height','bytes'].some(key => info[key as keyof typeof info] !== a[key as keyof MediaAsset])) throw new StoryError('Archive image metadata or checksum does not match its file.');
      inspected.set(a.hash, info);
    }
    for (const [hash, info] of inspected) this.mediaStore.save(files[`media/${hash}.original`], info);
    imported.id = randomUUID(); imported.revision = 0; imported.updatedAt = new Date().toISOString();
    imported.title = imported.title.slice(0, 185) + ' (imported)';
    return this.insert(imported);
  }
  async addMedia(id: string, bytes: Uint8Array, input: { expectedRevision: number; requestId: string; caption: string; category: MediaAsset['category']; subjectIds: string[]; passageId: string | null; parentId: string | null; status: 'canonical' | 'experimental' }, provenance: ImageProvenance = imageProvenanceSchema.parse({ kind: 'upload' }), captured?: IllustrationCapture, portraitFor?: string) {
    input = mediaInputSchema.parse(input); provenance = imageProvenanceSchema.parse(provenance);
    if (captured) { captured = illustrationCaptureSchema.parse(captured); if (captured.storyId !== id || JSON.stringify(captured.subjectIds) !== JSON.stringify(input.subjectIds) || captured.source?.passageId !== (input.passageId || undefined)) throw new StoryError('The illustration capture does not match this story or source.'); }
    const fingerprint = createHash('sha256').update(bytes).update(JSON.stringify(input)).update(JSON.stringify(provenance)).update(JSON.stringify([captured || null,portraitFor || null])).digest('hex');
    const prior = this.db.prepare('SELECT hash FROM operations WHERE story_id=? AND request_id=?').get(id, input.requestId) as { hash: string } | undefined;
    if (prior) { if (prior.hash !== fingerprint) throw new StoryError('This image request ID belongs to different inputs.', 409); return this.read(id); }
    const story = this.read(id);
    if (story.revision !== input.expectedRevision) throw new StoryError('The story changed. Reload before adding this picture.', 409);
    const subjects = [...story.canon.characters, ...story.canon.places, ...story.canon.items];
    if (input.subjectIds.some(id => !subjects.some(s => s.id === id) && !captured?.snapshots.some(s=>s.id===id))) throw new StoryError('Image subject does not exist.');
    const passage = input.passageId ? story.passages.find(p => p.id === input.passageId) : null;
    if (input.passageId && !passage) throw new StoryError('Source passage does not exist.');
    if (input.parentId && !story.media.assets.some(a => a.id === input.parentId)) throw new StoryError('Parent picture does not exist.');
    const info = await this.mediaStore.inspect(bytes);
    const asset = mediaAssetSchema.parse({ ...info, id: randomUUID(), caption: input.caption, category: input.category, subjectIds: input.subjectIds,
      snapshots: captured?.snapshots || input.subjectIds.map(id => { const c = story.canon.characters.find(c => c.id === id); return { id, name: subjects.find(s => s.id === id)!.name, appearance: c?.appearance || '', outfit: c?.outfit || '' }; }),
      createdAt: new Date().toISOString(), source: captured ? captured.source : passage ? { passageId: passage.id, revision: story.revision, hash: passageImageHash(passage), chapter: passage.chapter, title: passage.title } : null,
      status: captured?.source && passage && captured.source.hash !== passageImageHash(passage) ? 'superseded' : input.status, parentId: input.parentId, provenance });
    if (portraitFor && asset.status !== 'superseded') {
      if (!story.canon.characters.some(c=>c.id===portraitFor) || !asset.subjectIds.includes(portraitFor)) throw new StoryError('Choose a depicted current cast member for the portrait.');
      story.media.portraits[portraitFor] = asset.id;
    }
    story.media.assets.push(asset); story.revision++; story.updatedAt = new Date().toISOString();
    const valid = validateStory(story);
    // Files become durable before the short SQLite metadata commit. A crash can leave an unreferenced file, never a ready record pointing at a partial write.
    this.mediaStore.save(bytes, info);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const concurrent = this.db.prepare('SELECT hash FROM operations WHERE story_id=? AND request_id=?').get(id, input.requestId) as { hash: string } | undefined;
      if (concurrent) { if (concurrent.hash !== fingerprint) throw new StoryError('This image request ID belongs to different inputs.', 409); const current = this.read(id); this.db.exec('COMMIT'); return current; }
      if (this.read(id).revision !== input.expectedRevision) throw new StoryError('The story changed while the image was being processed. Reload and retry.', 409);
      this.db.prepare('UPDATE stories SET revision=?, updated_at=?, payload=? WHERE id=?').run(valid.revision, valid.updatedAt, JSON.stringify(valid), id);
      this.db.prepare('INSERT INTO operations VALUES (?, ?, ?)').run(id, input.requestId, fingerprint);
      this.db.exec('COMMIT'); logEvent('info', 'media', 'Picture saved to story library', { assetId: asset.id, hash: asset.hash, width: asset.width, height: asset.height, subjectIds: asset.subjectIds, sourcePassageId: asset.source?.passageId }, id, input.requestId); return valid;
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
}

export function stateChanges(before: unknown, after: unknown) {
  const changes: { path: string; before: unknown; after: unknown }[] = [];
  function compare(a: unknown, b: unknown, path: string) {
    if (changes.length >= 100 || JSON.stringify(a) === JSON.stringify(b)) return;
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
      for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) compare(left[key], right[key], path ? `${path}.${key}` : key);
    } else changes.push({ path, before: a, after: b });
  }
  compare(before, after, ''); return changes;
}

let repository: StoryRepository | undefined;
export function getRepository(): StoryRepository {
  return repository ??= new StoryRepository(resolve(process.env.STORY_DATA_DIR || 'data/dev', 'library.sqlite'), process.env.STORY_SEED_SAMPLE !== '0');
}
