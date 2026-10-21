import { passageWorkflowMetadataSchema, type PassageWorkflowMetadata } from '../../passage-checkpoints';
import type { StoryWorkflowStore } from './store';
import type { Connections } from './adapters';
import { stageModelNode } from './configuration';

/** Read trusted durable provenance, never a client-supplied graph/settings payload. */
export function checkpointWorkflow(store: StoryWorkflowStore, runId: string, generationRequestId?: string, connections?: Connections): PassageWorkflowMetadata {
  const run=store.read(runId);
  function snapshot(id:string) {
    const current=store.read(id),attempt=store.attempts(id).find(a=>a.nodeId==='prepare');
    const records=store.metadata(id).filter(a=>a.type==='model');
    const models=Object.fromEntries(records.map(record=>{const value=store.artifact(record.id).value as {settings:{text:unknown}};return [record.nodeId,value.settings.text];}));
    const definition=store.definition(id),narrator=stageModelNode(definition,'preflight');
    const {baseUrl:_address,apiKey:_secret,...settings}=connections?.text??{};
    return {definition,runId:id,source:current.source,
      configurationFingerprint:attempt!.configurationFingerprint,
      ...(narrator&&models[narrator]?{model:models[narrator]}:connections?{model:settings}:{}),
      ...(records.length?{models}:{})};
  }
  const generation=generationRequestId?store.find(run.source.id,generationRequestId):run;
  const acceptance=snapshot(runId);
  return passageWorkflowMetadataSchema.parse({generation:generation?generation.id===runId?acceptance:snapshot(generation.id):null,acceptance});
}
