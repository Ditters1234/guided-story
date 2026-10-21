import { passageWorkflowMetadataSchema, type PassageWorkflowMetadata } from '../../passage-checkpoints';
import type { StoryWorkflowStore } from './store';
import type { Connections } from './adapters';

/** Read trusted durable provenance, never a client-supplied graph/settings payload. */
export function checkpointWorkflow(store: StoryWorkflowStore, runId: string, generationRequestId?: string, connections?: Connections): PassageWorkflowMetadata {
  const run=store.read(runId);
  function snapshot(id:string) {
    const current=store.read(id),attempt=store.attempts(id).find(a=>a.nodeId==='prepare');
    const modelRecord=store.metadata(id).find(a=>a.type==='model');
    const model=modelRecord?store.artifact(modelRecord.id).value as {settings?:{text?:unknown}}:undefined;
    const {baseUrl:_address,apiKey:_secret,...settings}=connections?.text??{};
    return {definition:store.definition(id),runId:id,source:current.source,
      configurationFingerprint:attempt!.configurationFingerprint,
      ...(model?.settings?.text?{model:model.settings.text}:connections?{model:settings}:{})};
  }
  const generation=generationRequestId?store.find(run.source.id,generationRequestId):run;
  const acceptance=snapshot(runId);
  return passageWorkflowMetadataSchema.parse({generation:generation?generation.id===runId?acceptance:snapshot(generation.id):null,acceptance});
}
