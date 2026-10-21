import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { StoryError } from '../../errors';
import { jobFingerprint } from '../jobs';
import { presetContentSchema,presetSaveSchema,presetLifecycleSchema,type WorkflowPreset } from '../../story-workflow/presets';

/** Independent versioned definitions. Execution resolves immutable revisions; story archives omit them. */
export class WorkflowPresetStore {
  constructor(private db:DatabaseSync){db.exec(`CREATE TABLE IF NOT EXISTS workflow_presets(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS workflow_preset_versions(id TEXT NOT NULL,revision INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(id,revision));
    CREATE TABLE IF NOT EXISTS workflow_preset_receipts(request_id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS workflow_preset_archives(id TEXT PRIMARY KEY);`);}
  list(includeArchived=false):WorkflowPreset[]{return (this.db.prepare(`SELECT p.id FROM workflow_presets p LEFT JOIN workflow_preset_archives a ON p.id=a.id WHERE (? OR a.id IS NULL) ORDER BY p.rowid DESC LIMIT 200`).all(includeArchived?1:0) as {id:string}[]).map(row=>this.read(row.id));}
  read(id:string):WorkflowPreset {const row=this.db.prepare('SELECT payload FROM workflow_presets WHERE id=?').get(id) as {payload:string}|undefined;if(!row)throw new StoryError('Workflow preset not found.',404);const value:WorkflowPreset=JSON.parse(row.payload);if(this.db.prepare('SELECT 1 FROM workflow_preset_archives WHERE id=?').get(id))value.archived=true;return value;}
  readVersion(id:string,revision:number):WorkflowPreset {const row=this.db.prepare('SELECT payload FROM workflow_preset_versions WHERE id=? AND revision=?').get(id,revision) as {payload:string}|undefined;if(!row)throw new StoryError('Workflow preset revision not found. Refresh the preset library.',404);return JSON.parse(row.payload);}
  revisions(id:string){this.read(id);return (this.db.prepare('SELECT revision,json_extract(payload,\'$.updatedAt\') updatedAt FROM workflow_preset_versions WHERE id=? ORDER BY revision DESC LIMIT 100').all(id) as {revision:number;updatedAt:string}[]);}
  lifecycle(id:string,value:unknown):WorkflowPreset{
    const input=presetLifecycleSchema.parse(value),fingerprint=jobFingerprint({lifecycle:id,input});this.db.exec('BEGIN IMMEDIATE');
    try{
      const receipt=this.db.prepare('SELECT fingerprint,payload FROM workflow_preset_receipts WHERE request_id=?').get(input.requestId) as {fingerprint:string;payload:string}|undefined;
      if(receipt){if(receipt.fingerprint!==fingerprint)throw new StoryError('This preset request ID was already used for different edits.',409);this.db.exec('COMMIT');return JSON.parse(receipt.payload);}
      const previous=this.read(id),archiving=input.action==='archive';
      if(previous.revision!==input.expectedRevision||Boolean(previous.archived)===archiving)throw new StoryError('This preset changed or its archive status changed. Refresh before trying again.',409);
      if(archiving)this.db.prepare('INSERT INTO workflow_preset_archives VALUES(?)').run(id);else this.db.prepare('DELETE FROM workflow_preset_archives WHERE id=?').run(id);
      const saved=this.read(id);this.db.prepare('INSERT INTO workflow_preset_receipts VALUES(?,?,?)').run(input.requestId,fingerprint,JSON.stringify(saved));this.db.exec('COMMIT');return saved;
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  save(id:string|null,value:unknown):WorkflowPreset {
    if(id)z.string().uuid().parse(id);const input=presetSaveSchema.parse(value),fingerprint=jobFingerprint({id,input});
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const receipt=this.db.prepare('SELECT fingerprint,payload FROM workflow_preset_receipts WHERE request_id=?').get(input.requestId) as {fingerprint:string;payload:string}|undefined;
      if(receipt){if(receipt.fingerprint!==fingerprint)throw new StoryError('This preset request ID was already used for different edits.',409);this.db.exec('COMMIT');return JSON.parse(receipt.payload);}
      const previous=id?this.read(id):null;if(input.expectedRevision!==(previous?.revision??0))throw new StoryError('This preset changed in another window. Reload before saving; your draft is kept.',409);
      if(previous?.archived)throw new StoryError('Restore this archived preset before editing it, or save a separate copy.',409);
      const now=new Date().toISOString(),saved:WorkflowPreset={id:id??randomUUID(),revision:(previous?.revision??0)+1,createdAt:previous?.createdAt??now,updatedAt:now,content:presetContentSchema.parse(input.content)};
      saved.content.definition.id=`preset-${saved.id}`;saved.content.definition.version=saved.revision;
      if(!id&&(this.db.prepare('SELECT count(*) count FROM workflow_presets').get() as {count:number}).count>=200)throw new StoryError('The preset library contains 200 drafts including archived versions. Update an existing draft.');
      const payload=JSON.stringify(saved);
      this.db.prepare('INSERT INTO workflow_presets(id,revision,payload) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload').run(saved.id,saved.revision,payload);
      this.db.prepare('INSERT INTO workflow_preset_versions(id,revision,payload) VALUES(?,?,?)').run(saved.id,saved.revision,payload);
      this.db.prepare('INSERT INTO workflow_preset_receipts(request_id,fingerprint,payload) VALUES(?,?,?)').run(input.requestId,fingerprint,payload);
      this.db.exec('COMMIT');return saved;
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
}
