import type { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { passageSchema, storySchema, validateStory, type Story } from '../story';
import { checkpointHashSchema as hash, checkpointWorkflowSchema, passageWorkflowMetadataSchema, type PassageWorkflowMetadata, type PassageCheckpointInfo } from '../passage-checkpoints';
import { StoryError } from '../errors';
import { mediaSchema, type MediaAsset } from '../media';

const stateSchema = z.strictObject(storySchema.omit({ passages: true }).shape);
const stateFields = z.strictObject(Object.fromEntries(Object.keys(stateSchema.shape).map(key => [key, hash.optional()])));
const nodeSchema = z.strictObject({
  version: z.literal(1), passage: hash, previous: hash.nullable(),
  state: stateFields.optional(), workflow: hash.optional()
});
const workflowRefSchema=checkpointWorkflowSchema.extend({definition:hash});
const storedWorkflowSchema=z.strictObject({generation:workflowRefSchema.nullable(),acceptance:workflowRefSchema});
type Node = z.infer<typeof nodeSchema>;
const archiveSchema = z.strictObject({
  format: z.literal('guided-story-passage-checkpoints'), version: z.literal(1),
  heads: z.record(z.string().min(1).max(100), hash), objects: z.record(hash, z.json())
});
export type CheckpointArchive = z.infer<typeof archiveSchema>;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Immutable, content-addressed history. The ordinary story and all model prompts stay small.
 * Call mutations inside the repository's canonical transaction. Each top-level state field
 * is stored once per distinct value; history nodes share their entire unchanged prefix. */
export class PassageCheckpointStore {
  constructor(private db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS passage_checkpoint_objects(story_id TEXT NOT NULL,hash TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(story_id,hash));
      CREATE TABLE IF NOT EXISTS passage_checkpoints(story_id TEXT NOT NULL,passage_id TEXT NOT NULL,head TEXT NOT NULL,PRIMARY KEY(story_id,passage_id));`);
  }
  private put(storyId: string, value: unknown) {
    const key = digest(value);
    this.db.prepare('INSERT OR IGNORE INTO passage_checkpoint_objects VALUES(?,?,?)').run(storyId,key,JSON.stringify(value));
    return key;
  }
  private get(storyId: string, key: string): unknown {
    const row = this.db.prepare('SELECT payload FROM passage_checkpoint_objects WHERE story_id=? AND hash=?').get(storyId,key) as {payload:string}|undefined;
    if (!row) throw new StoryError('This passage checkpoint is incomplete. Nothing was forked.',409);
    return JSON.parse(row.payload);
  }
  private head(storyId: string, passageId: string) {
    return (this.db.prepare('SELECT head FROM passage_checkpoints WHERE story_id=? AND passage_id=?').get(storyId,passageId) as {head:string}|undefined)?.head;
  }
  private workflow(storyId:string,key:string) {
    const stored=storedWorkflowSchema.parse(this.get(storyId,key));
    const expand=(value:z.infer<typeof workflowRefSchema>)=>({...value,definition:this.get(storyId,value.definition)});
    return passageWorkflowMetadataSchema.parse({generation:stored.generation?expand(stored.generation):null,acceptance:expand(stored.acceptance)});
  }
  private chain(storyId: string, head: string) {
    const nodes: {key:string;node:Node}[] = [], seen = new Set<string>();
    let key: string|null = head;
    while (key) {
      if (seen.has(key) || nodes.length>=10000) throw new StoryError('Invalid passage checkpoint history.');
      seen.add(key); const node = nodeSchema.parse(this.get(storyId,key)); nodes.push({key,node}); key=node.previous;
    }
    return nodes.reverse();
  }
  capture(story: Story, workflow?: PassageWorkflowMetadata) {
    const latest = story.passages.at(-1)!, previousPassage = story.passages.at(-2);
    const oldHead = previousPassage && this.head(story.id,previousPassage.id);
    const oldChain = oldHead ? this.chain(story.id,oldHead) : [];
    let previous: string|null = null;
    for (let index=0;index<story.passages.length-1;index++) {
      const passage = this.put(story.id,story.passages[index]), old = oldChain[index];
      // A later title/wording edit cannot rewrite a historical checkpoint's prose.
      previous = old?.node.passage===passage && old.node.previous===previous ? old.key : this.put(story.id,{version:1,passage,previous});
    }
    const {passages:_history,...state} = story;
    const fields = Object.fromEntries(Object.entries(state).map(([name,value])=>[name,this.put(story.id,value)]));
    const metadata=workflow?passageWorkflowMetadataSchema.parse(workflow):undefined;
    const compact=(value:PassageWorkflowMetadata['acceptance'])=>({...value,definition:this.put(story.id,value.definition)});
    const workflowKey=metadata?this.put(story.id,storedWorkflowSchema.parse({generation:metadata.generation?compact(metadata.generation):null,acceptance:compact(metadata.acceptance)})):undefined;
    const head = this.put(story.id,nodeSchema.parse({version:1,passage:this.put(story.id,latest),previous,state:fields,...(workflowKey?{workflow:workflowKey}:{})}));
    this.db.prepare('INSERT INTO passage_checkpoints VALUES(?,?,?) ON CONFLICT(story_id,passage_id) DO UPDATE SET head=excluded.head').run(story.id,latest.id,head);
    return head;
  }
  restore(storyId: string, passageId: string, expectedHead?: string) {
    const head = this.head(storyId,passageId);
    if (!head) throw new StoryError('No saved world checkpoint is available for this passage. Earlier state cannot be inferred safely.',409);
    if (expectedHead && head!==expectedHead) throw new StoryError('This passage checkpoint changed. Reload it before starting a fork.',409);
    const result=this.restoreHead(storyId,head);
    if(result.story.passages.at(-1)!.id!==passageId)throw new StoryError('The checkpoint does not belong to this passage.');
    return result;
  }
  private restoreHead(storyId:string,head:string) {
    const chain=this.chain(storyId,head), node=chain.at(-1)!.node;
    if (!node.state) throw new StoryError('This passage has no saved world checkpoint.',409);
    const state=stateSchema.parse(Object.fromEntries(Object.entries(node.state).map(([name,key])=>[name,this.get(storyId,key!)])));
    for(const [name,key] of Object.entries(node.state))if(digest(state[name as keyof typeof state])!==key)throw new StoryError('Unsupported checkpoint state fields.');
    const passages=chain.map(({node})=>{const p=passageSchema.parse(this.get(storyId,node.passage));if(digest(p)!==node.passage)throw new StoryError('Unsupported checkpoint passage fields.');return p;});
    return {head,story:validateStory({...state,passages}),chain};
  }
  info(story: Story, passageId: string): PassageCheckpointInfo|null {
    if(!story.passages.some(p=>p.id===passageId))throw new StoryError('Passage not found.',404);
    if(!this.head(story.id,passageId))return null;
    const saved=this.restore(story.id,passageId), last=saved.story.passages.at(-1)!;
    return {checkpoint:saved.head,passageId,title:last.title,capturedAt:saved.story.updatedAt,passageCount:saved.story.passages.length,
      differsFromCurrent:digest(story.passages.slice(0,saved.story.passages.length))!==digest(saved.story.passages),
      workflow:saved.chain.at(-1)!.node.workflow?this.workflow(story.id,saved.chain.at(-1)!.node.workflow!):null};
  }
  /** Only objects reachable from these history heads travel; discarded replacements don't. */
  archive(storyId: string, onlyHead?: string): CheckpointArchive {
    const heads: Record<string,string> = Object.create(null), objects: Record<string,z.infer<ReturnType<typeof z.json>>> = Object.create(null);
    const roots=onlyHead?[{head:onlyHead}] : this.db.prepare('SELECT head FROM passage_checkpoints WHERE story_id=? ORDER BY rowid DESC').all(storyId) as {head:string}[];
    const add=(key:string)=>{if(!Object.hasOwn(objects,key))objects[key]=this.get(storyId,key) as z.infer<ReturnType<typeof z.json>>;};
    const visited=new Set<string>();
    for(const root of roots){let key:string|null=root.head;while(key&&!visited.has(key)){
      visited.add(key);const node=nodeSchema.parse(this.get(storyId,key));
      add(key);add(node.passage);for(const value of Object.values(node.state??{}))if(value)add(value);
      if(node.workflow){add(node.workflow);const metadata=storedWorkflowSchema.parse(this.get(storyId,node.workflow));add(metadata.acceptance.definition);if(metadata.generation)add(metadata.generation.definition);}
      if(node.state){const passage=passageSchema.parse(this.get(storyId,node.passage));if(!Object.hasOwn(heads,passage.id))heads[passage.id]=key;}
      key=node.previous;
    }
    }
    // Current heads win over older versions reachable through other checkpoints.
    if(!onlyHead)for(const row of this.db.prepare('SELECT passage_id,head FROM passage_checkpoints WHERE story_id=?').all(storyId) as {passage_id:string;head:string}[])heads[row.passage_id]=row.head;
    return archiveSchema.parse({format:'guided-story-passage-checkpoints',version:1,heads,objects});
  }
  mediaAssets(archive:CheckpointArchive): MediaAsset[] {
    const assets=new Map<string,MediaAsset>();
    for(const value of Object.values(archive.objects)){
      const node=nodeSchema.safeParse(value);
      if(node.success&&node.data.state?.media)for(const asset of mediaSchema.parse(archive.objects[node.data.state.media]).assets){
        // Validate every distinct file-metadata claim, even when snapshots share bytes.
        const key=JSON.stringify([asset.hash,asset.mime,asset.width,asset.height,asset.bytes]);assets.set(key,asset);
      }
    }
    return [...assets.values()];
  }
  load(storyId: string, archive: CheckpointArchive) {
    for(const [key,value] of Object.entries(archive.objects))this.db.prepare('INSERT OR IGNORE INTO passage_checkpoint_objects VALUES(?,?,?)').run(storyId,key,JSON.stringify(value));
    for(const [passageId,head] of Object.entries(archive.heads))this.db.prepare('INSERT INTO passage_checkpoints VALUES(?,?,?)').run(storyId,passageId,head);
  }
  /** Validate outside the live library, including all restored world/reference invariants. */
  validateArchive(value: unknown, current: Story) {
    const archive=archiveSchema.parse(value);
    if(Object.keys(archive.objects).length>100000||Object.keys(archive.heads).length>10000)throw new StoryError('Too many passage checkpoint objects.');
    for(const [key,object] of Object.entries(archive.objects))if(digest(object)!==key)throw new StoryError('Passage checkpoint checksum does not match.');
    // A temporary namespace validates portable data without modifying a library entry.
    const owner=`checkpoint-validation-${randomUUID()}`;
    try {
      this.load(owner,archive);
      for(const [passageId,head] of Object.entries(archive.heads)) {
        if(!current.passages.some(p=>p.id===passageId))throw new StoryError('Checkpoint references an unwritten passage.');
        this.restore(owner,passageId,head);this.info({...current,id:owner},passageId);
      }
      const reachable=this.archive(owner);
      if(Object.keys(reachable.objects).length!==Object.keys(archive.objects).length)throw new StoryError('Unreferenced passage checkpoint data.');
      for(const value of Object.values(archive.objects)){
        const node=nodeSchema.safeParse(value);
        if(node.success){
          if(node.data.state)this.restoreHead(owner,digest(value));
          if(node.data.workflow)this.workflow(owner,node.data.workflow);
        }
      }
      return archive;
    } finally {this.remove(owner);}
  }
  remove(storyId: string) {
    this.db.prepare('DELETE FROM passage_checkpoints WHERE story_id=?').run(storyId);
    this.db.prepare('DELETE FROM passage_checkpoint_objects WHERE story_id=?').run(storyId);
  }
}
