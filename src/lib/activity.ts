import type { LogEntry, TraceEntry } from './diagnostic-types';
import type { JobRecord } from './job-types';

export type ActivityRequest = Omit<TraceEntry, 'request'|'response'> & { endpoint:string; model?:string; stage?:string };
export type ActivityJob = Pick<JobRecord,'id'|'kind'|'state'|'storyId'|'createdAt'|'updatedAt'|'recoverable'|'error'|'attempt'> & {stage?:string};
export type ActivitySnapshot = {at:string;requests:ActivityRequest[];jobs:ActivityJob[];activeRequests:number;activeJobs:number;errors?:Pick<LogEntry,'id'|'at'|'message'|'source'|'requestId'>[]};
export const activeJobStates = ['queued','generating','validating','committing'];
export function activityName(kind:string){
  const names:Record<string,string>={'connection-models':'Text connection / models','connection-comfy':'ComfyUI connection','text-test':'Text test','image-test':'Test image','story-illustration':'Story illustration','story-opening':'Opening passage','story-narration':'Story narration','story-effects':'World changes','story-question':'Story question','wording-draft':'Wording draft','wording-review':'Wording review','wording-polish':'Wording polish','illustration-preparation':'Illustration details','story-setup':'Cast & world setup','story-character':'Character redesign','story-recap':'Story recap','continuity-memory':'Continuity memory'};
  return names[kind]||kind.replace(/-/g,' ').replace(/^./,s=>s.toUpperCase());
}
export function activityElapsed(at:string,now:number,end?:string){
  const seconds=Math.max(0,Math.floor(((end?Date.parse(end):now)-Date.parse(at))/1000));
  if(!Number.isFinite(seconds))return '—';
  return seconds<60?`${seconds}s`:seconds<3600?`${Math.floor(seconds/60)}m ${seconds%60}s`:`${Math.floor(seconds/3600)}h ${Math.floor(seconds%3600/60)}m`;
}
