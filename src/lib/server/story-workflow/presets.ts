import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { StoryError } from '../../errors';
import { jobFingerprint } from '../jobs';
import { presetContentSchema,presetSaveSchema,type WorkflowPreset } from '../../story-workflow/presets';

/** Independent draft definitions. Never read by the generation runner or story archive. */
export class WorkflowPresetStore {
  constructor(private db:DatabaseSync){db.exec(`CREATE TABLE IF NOT EXISTS workflow_presets(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS workflow_preset_versions(id TEXT NOT NULL,revision INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(id,revision));
    CREATE TABLE IF NOT EXISTS workflow_preset_receipts(request_id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,payload TEXT NOT NULL);`);}
  list():WorkflowPreset[]{return (this.db.prepare('SELECT payload FROM workflow_presets ORDER BY rowid DESC LIMIT 100').all() as {payload:string}[]).map(row=>JSON.parse(row.payload));}
  read(id:string):WorkflowPreset {const row=this.db.prepare('SELECT payload FROM workflow_presets WHERE id=?').get(id) as {payload:string}|undefined;if(!row)throw new StoryError('Workflow preset not found.',404);return JSON.parse(row.payload);}
  save(id:string|null,value:unknown):WorkflowPreset {
    if(id)z.string().uuid().parse(id);const input=presetSaveSchema.parse(value),fingerprint=jobFingerprint({id,input});
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const receipt=this.db.prepare('SELECT fingerprint,payload FROM workflow_preset_receipts WHERE request_id=?').get(input.requestId) as {fingerprint:string;payload:string}|undefined;
      if(receipt){if(receipt.fingerprint!==fingerprint)throw new StoryError('This preset request ID was already used for different edits.',409);this.db.exec('COMMIT');return JSON.parse(receipt.payload);}
      const previous=id?this.read(id):null;if(input.expectedRevision!==(previous?.revision??0))throw new StoryError('This preset changed in another window. Reload before saving; your draft is kept.',409);
      const now=new Date().toISOString(),saved:WorkflowPreset={id:id??randomUUID(),revision:(previous?.revision??0)+1,createdAt:previous?.createdAt??now,updatedAt:now,content:presetContentSchema.parse(input.content)};
      saved.content.definition.id=`preset-${saved.id}`;saved.content.definition.version=saved.revision;
      if(!id&&(this.db.prepare('SELECT count(*) count FROM workflow_presets').get() as {count:number}).count>=100)throw new StoryError('The preset library contains 100 drafts. Update an existing draft.');
      const payload=JSON.stringify(saved);
      this.db.prepare('INSERT INTO workflow_presets(id,revision,payload) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload').run(saved.id,saved.revision,payload);
      this.db.prepare('INSERT INTO workflow_preset_versions(id,revision,payload) VALUES(?,?,?)').run(saved.id,saved.revision,payload);
      this.db.prepare('INSERT INTO workflow_preset_receipts(request_id,fingerprint,payload) VALUES(?,?,?)').run(input.requestId,fingerprint,payload);
      this.db.exec('COMMIT');return saved;
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
}
