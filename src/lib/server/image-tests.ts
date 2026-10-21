import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, unlinkSync, statSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { imageSettingsSchema } from '../settings';
import { loadWorkflow, type Workflow } from './workflows';
import { StoryError } from './repository';
import { readBytes } from './http';
import { beginTrace, endTrace, logEvent } from './diagnostics';
import { getJobs } from './jobs';
import { endpointSchema } from '../settings';
import { atomicWriteFile } from './atomic-files';
import { imageProvenanceSchema } from '../media';
import { scrub } from './diagnostics';
import type { IllustrationCapture } from '../illustration';

export const imageTestSchema = z.object({ images: imageSettingsSchema, prompt: z.string().trim().min(1).max(16000), negative: z.string().max(10000).default(''), requestId: z.string().uuid().optional(), template: z.string().max(16000).optional(), variables: z.record(z.string(), z.string().max(40000)).optional() });
type Job = { id: string; storyId?: string; baseUrl: string; promptId: string; trace: string; started: number; finished?: number; timeout: number; outputNode: string; status: 'queued' | 'complete' | 'error'; error?: string; files: { name: string; type: string }[]; checking?: Promise<void>; seed: number | null };
const shared = globalThis as typeof globalThis & { __guidedImageTests?: Map<string, Job> };
const jobs = shared.__guidedImageTests ??= new Map<string, Job>();
const folder = (job?: Pick<Job,'storyId'>) => resolve(process.env.STORY_DATA_DIR || 'data/dev', job?.storyId ? 'illustration-previews' : 'test-images');
for (const id of jobs.keys()) { try { getJobs().read(id); } catch { jobs.delete(id); } }
const savedImageSchema = z.object({ id: z.string().uuid(), storyId: z.string().max(100).optional(), baseUrl: endpointSchema, promptId: z.string().max(200), trace: z.string().max(100), started: z.number(), finished: z.number().optional(), timeout: z.number().min(30000).max(900000), outputNode: z.string().max(100), status: z.enum(['queued','complete','error']), error: z.string().max(3000).optional(), files: z.array(z.object({ name: z.string().regex(/^[a-f0-9-]{36}-\d\.img$/), type: z.enum(['image/png','image/jpeg','image/webp']) })).max(4), seed: z.number().nullable() });
for (const record of getJobs().list(10000).filter(r => ['image-test','story-illustration'].includes(r.kind) && !r.details.discarded)) {
  const parsed = savedImageSchema.safeParse(record.details.image); if (!parsed.success || parsed.data.files.some(f => !f.name.startsWith(parsed.data.id + '-'))) continue;
  const restored: Job = parsed.data;
  if (record.state === 'committing' && restored.status === 'complete') {
    if (restored.files.length && restored.files.every(file => existsSync(resolve(folder(restored), file.name)))) getJobs().transition(record.id, 'complete');
    else { restored.status = 'error'; restored.error = 'The server stopped before preview files were finalized. Check ComfyUI before retrying.'; getJobs().transition(record.id, 'failed', { error: restored.error, details: { image: restored } }); }
  }
  if (['failed','interrupted','cancelled'].includes(record.state)) { restored.status = 'error'; restored.error = record.error || 'Image submission was interrupted. Check ComfyUI before starting a new test.'; }
  if (!jobs.has(restored.id)) jobs.set(restored.id, restored);
}
function persistImage(j: Job, target?: 'validating' | 'committing' | 'complete' | 'failed') {
  const { checking, ...image } = j;
  getJobs().transition(j.id, target || 'generating', { details: { image }, recoverable: Boolean(j.promptId), ...(j.error ? { error: j.error } : {}) });
}
async function providerJson(base: string, path: string, init: RequestInit = {}) {
  let response;
  try { response = await fetch(base.replace(/\/+$/, '') + path, { ...init, redirect: 'error', signal: AbortSignal.timeout(15000) }); }
  catch { throw new StoryError('Could not reach ComfyUI, or its request timed out. Check the connection and retry.', 502); }
  if (!response.ok) { let body = ''; try { body = new TextDecoder().decode(await readBytes(response, 20000)); } catch { /* Preserve status. */ } logEvent('error', 'comfy', 'ComfyUI rejected a request', { path, status: response.status, body }); throw new StoryError(`ComfyUI returned HTTP ${response.status}. See Dev → Console for provider details.`, 502); }
  try { return JSON.parse(new TextDecoder().decode(await readBytes(response, 4_000_000))); } catch { throw new StoryError('ComfyUI returned invalid JSON.', 502); }
}
export function applyImageBindings(graph: Workflow, input: z.infer<typeof imageTestSchema>, purpose = 'tests') {
  const settings = input.images, copy = structuredClone(graph), seed = settings.seed === -1 ? Math.floor(Math.random() * 2147483647) : settings.seed;
  if (!settings.bindings.prompt || !settings.bindings.outputNode) throw new StoryError('Map a positive prompt input and an output node before generating an image.');
  if (input.negative.trim() && !settings.bindings.negative) throw new StoryError('This workflow has no negative-prompt binding. Clear the negative prompt or map a supported input.');
  if (!copy[settings.bindings.outputNode]) throw new StoryError('The selected output node does not exist in this workflow.');
  const values = { prompt: input.prompt, negative: input.negative, seed, width: settings.width, height: settings.height, steps: settings.steps, cfg: settings.cfg };
  const used = new Set<string>();
  for (const [key, value] of Object.entries(values)) {
    const binding = settings.bindings[key as keyof typeof values]; if (!binding) continue;
    if (used.has(binding)) throw new StoryError('Two image controls are mapped to the same workflow input.'); used.add(binding);
    const [nodeId, field] = binding.split('.'), node = copy[nodeId];
    if (!node || !(field in node.inputs) || Array.isArray(node.inputs[field]) || typeof node.inputs[field] !== typeof value) throw new StoryError(`Invalid binding ${binding}. Map an existing scalar input of the appropriate type.`);
    node.inputs[field] = value;
  }
  for (const node of Object.values(copy)) if (typeof node.inputs.filename_prefix === 'string') node.inputs.filename_prefix = 'Storyweaver/' + purpose + '/' + randomUUID();
  return { graph: copy, seed: settings.bindings.seed ? seed : null };
}
export async function startImageTest(value: unknown) {
  return submitImageTest(value);
}
type StoryScope = { storyId: string; revision: number; capture: IllustrationCapture; submissionFingerprint: string };
export function startStoryImage(value: unknown, scope: StoryScope) { return submitImageTest(value, scope); }
async function submitImageTest(value: unknown, scope?: StoryScope) {
  const input = imageTestSchema.parse(value);
  for (const [id, j] of jobs) {
    if (j.status === 'queued' && Date.now() - j.started > j.timeout) { j.status = 'error'; j.error = 'Image test expired. The ComfyUI job may still finish.'; j.finished = Date.now(); persistImage(j, 'failed'); endTrace(j.trace, undefined, j.error); }
    // Ready previews remain addressable until explicitly cleared or copied into a story.
    if (j.status === 'error' && !j.files.length && Date.now() - j.started > 3600000) jobs.delete(id);
  }
  const { graph, seed } = applyImageBindings(loadWorkflow(input.images.workflow), input, scope ? 'illustrations' : 'tests');
  const operation = getJobs().start({ kind: scope ? 'story-illustration' : 'image-test', storyId: scope?.storyId, expectedRevision: scope?.revision, requestId: input.requestId || randomUUID(), lockKey: scope ? `illustrations:${scope.storyId}` : 'image-tests', input: { ...input, requestId: undefined, ...(scope ? { capture: scope.capture } : {}) } });
  if (!operation.fresh) {
    if (operation.job.details.discarded) throw new StoryError('These test previews were cleared. Start a new image request.', 410);
    if (!jobs.has(operation.job.id)) { const restored = savedImageSchema.parse(operation.job.details.image); if (restored.files.some(f => !f.name.startsWith(restored.id + '-'))) throw new StoryError('Invalid stored image metadata.'); jobs.set(restored.id, restored); }
    return readImageJob(operation.job.id);
  }
  const trace = beginTrace(scope ? 'story-illustration' : 'image-test', { endpoint: input.images.baseUrl + '/prompt', workflow: input.images.workflow, graph, seed },scope?.storyId,scope?.revision);
  const job: Job = { id: operation.job.id, storyId: scope?.storyId, promptId: '', baseUrl: input.images.baseUrl, outputNode: input.images.bindings.outputNode, trace, started: Date.now(), timeout: input.images.timeoutSeconds * 1000, status: 'queued', files: [], seed };
  jobs.set(job.id, job); persistImage(job);
  getJobs().transition(job.id, 'generating', { details: { ...(scope ? { illustration: scope.capture, submissionFingerprint: scope.submissionFingerprint } : {}), provenance: imageProvenanceSchema.parse({ kind: 'comfy', prompt: input.prompt, negative: input.negative, seed, workflow: input.images.workflow, graph: scrub(graph), settings: { width: input.images.width, height: input.images.height, steps: input.images.steps, cfg: input.images.cfg, bindings: input.images.bindings }, template: input.template, variables: input.variables, ...(scope ? { composition: {...scope.capture.draft,contentPreferences:scope.capture.contentPreferences} } : {}) }) } });
  try {
    const info = await providerJson(input.images.baseUrl, '/object_info');
    for (const [id, node] of Object.entries(graph)) {
      const spec = info[node.class_type]; if (!spec) throw new StoryError(`ComfyUI is missing node ${node.class_type} (${id}). Install or choose a compatible workflow.`, 502);
      for (const [key, v] of Object.entries(node.inputs)) {
        const options = (spec.input?.required?.[key] || spec.input?.optional?.[key])?.[0];
        if (Array.isArray(options) && !Array.isArray(v) && !options.includes(v)) throw new StoryError(`ComfyUI does not offer ${id}.${key} = ${String(v)}. Update that model/input in your workflow.`, 502);
      }
    }
    const queued = await providerJson(input.images.baseUrl, '/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: graph, client_id: job.id }) });
    if (typeof queued.prompt_id !== 'string') throw new StoryError('ComfyUI did not accept the image prompt.', 502);
    job.promptId = queued.prompt_id; persistImage(job); logEvent('info', 'comfy', scope ? 'Story illustration queued' : 'Settings test image queued', { jobId: job.id, promptId: job.promptId, seed },scope?.storyId); return publicJob(job);
  } catch (e) { job.status = 'error'; job.finished = Date.now(); job.error = e instanceof Error ? e.message : 'Image test failed.'; persistImage(job, 'failed'); endTrace(trace, undefined, job.error); throw e; }
}
function publicJob(j: Job) {
  if (j.status === 'complete' && !j.finished && j.files[0] && existsSync(resolve(folder(j), j.files[0].name))) j.finished = statSync(resolve(folder(j), j.files[0].name)).mtimeMs;
  return { id: j.id, status: j.status, error: j.error, seed: j.seed, durationMs: Math.max(0, (j.finished || Date.now()) - j.started), images: j.files.map((_, index) => j.storyId ? `/api/stories/${encodeURIComponent(j.storyId)}/illustrations/${j.id}/image?index=${index}` : `/api/image-tests/${j.id}/image?index=${index}`) };
}
export async function readImageTest(id: string) {
  if (jobs.get(id)?.storyId) throw new StoryError('Image test not found.',404);
  return readImageJob(id);
}
async function readImageJob(id: string) {
  const j = jobs.get(id); if (!j) throw new StoryError('Image test not found. Check Storage & Dev for retained previews.', 404);
  if (j.status === 'complete') {
    const record = getJobs().read(id);
    if (record.state === 'committing' && j.files.every(f => existsSync(resolve(folder(j), f.name)))) persistImage(j, 'complete');
  }
  if (j.status !== 'queued') return publicJob(j);
  if (!j.promptId) return publicJob(j);
  if (!j.checking) j.checking = (async () => {
    let providerStatus: unknown;
    try {
      if (Date.now() - j.started > j.timeout) throw new StoryError('Image test timed out. Its ComfyUI job may still finish; this does not interrupt other ComfyUI work.', 408);
      const history = await providerJson(j.baseUrl, '/history/' + encodeURIComponent(j.promptId)), result = history[j.promptId];
      if (!result) return;
      if (result.status?.status_str === 'error') { providerStatus = result.status; throw new StoryError('ComfyUI could not execute the workflow. Inspect Dev → Requests or the ComfyUI console.', 502); }
      const images = result.outputs?.[j.outputNode]?.images;
      if (!images?.length) { if (result.status?.completed) throw new StoryError('The workflow completed without images at the mapped output node.'); return; }
      if (getJobs().read(j.id).state === 'generating') persistImage(j, 'validating');
      mkdirSync(folder(j), { recursive: true });
      for (const img of images.slice(0, 4)) {
        if (typeof img.filename !== 'string') continue;
        const query = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder || '', type: img.type || 'output' });
        const response = await fetch(j.baseUrl.replace(/\/+$/, '') + '/view?' + query, { redirect: 'error', signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new StoryError('The image was generated, but could not be downloaded from ComfyUI.', 502);
        const bytes = Buffer.from(await readBytes(response, 20_000_000));
        const type = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png' : bytes[0] === 255 && bytes[1] === 216 ? 'image/jpeg' : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP' ? 'image/webp' : null;
        if (!type) throw new StoryError('ComfyUI returned an unsupported image format. Use PNG, JPEG, or WebP.');
        const name = `${j.id}-${j.files.length}.img`; atomicWriteFile(resolve(folder(j), name), bytes); j.files.push({ name, type });
      }
      if (!j.files.length) throw new StoryError('No usable image was returned.');
      j.status = 'complete'; j.finished = Date.now(); persistImage(j, 'committing'); persistImage(j, 'complete'); endTrace(j.trace, { promptId: j.promptId, seed: j.seed, images: publicJob(j).images });
    } catch (e) { j.status = 'error'; j.finished = Date.now(); j.error = e instanceof Error ? e.message : 'Image test failed.'; persistImage(j, 'failed'); endTrace(j.trace, { promptId: j.promptId, providerStatus }, j.error); }
  })().finally(() => { j.checking = undefined; });
  await j.checking; return publicJob(j);
}
export function imageTestFile(id: string, index: number) {
  if (jobs.get(id)?.storyId) throw new StoryError('Test image not found.',404);
  return imageFile(id,index);
}
function imageFile(id: string, index: number) {
  const file = jobs.get(id)?.files[index]; if (!file) throw new StoryError('Test image not found.', 404);
  if (!existsSync(resolve(folder(jobs.get(id)), file.name))) throw new StoryError('This image preview was removed from local storage.', 404);
  return { bytes: readFileSync(resolve(folder(jobs.get(id)), file.name)), type: file.type };
}
export function completedImageForStory(id: string, index: number) {
  const record = getJobs().read(id), job = jobs.get(id);
  if (record.state !== 'complete' || record.details.discarded || job?.status !== 'complete') throw new StoryError('Choose a completed, retained ComfyUI preview.', 409);
  return { ...imageTestFile(id, index), provenance: imageProvenanceSchema.parse(record.details.provenance || { kind: 'comfy', seed: job.seed }) };
}
export function removeImageTest(id: string) {
  if (jobs.get(id)?.storyId) throw new StoryError('Test image not found.',404);
  return removeImage(id);
}
function removeImage(id: string) {
  const job = jobs.get(id); if (!job) return;
  if (job.status === 'queued') throw new StoryError('Finish the image test before removing its preview.', 409);
  for (const file of job.files) { const path = resolve(folder(job), file.name); if (existsSync(path)) unlinkSync(path); }
  const record = getJobs().read(id); getJobs().transition(id, record.state, { details: { discarded: true } });
  jobs.delete(id);
}
export function testImageStorage(clear = false) {
  if (clear && [...jobs.values()].some(j => !j.storyId && j.status === 'queued')) throw new StoryError('Finish the active image test before clearing previews.', 409);
  const files = existsSync(folder()) ? readdirSync(folder()).filter(n => /^[a-f0-9-]{36}-\d\.img$/.test(n)) : [];
  const staging = existsSync(folder()) ? readdirSync(folder()).filter(n => /^[a-f0-9-]{36}-\d\.img\.[a-f0-9-]{36}\.tmp$/.test(n)) : [];
  const bytes = [...files, ...staging].reduce((sum, n) => sum + statSync(resolve(folder(), n)).size, 0);
  if (clear) { for (const j of [...jobs.values()].filter(j=>!j.storyId)) removeImageTest(j.id); for (const n of [...files, ...staging]) if (existsSync(resolve(folder(), n))) unlinkSync(resolve(folder(), n)); }
  const retained = [...jobs.values()].filter(j=>!j.storyId).sort((a,b) => b.started - a.started), latest = retained[0];
  return { count: clear ? 0 : files.length, bytes: clear ? 0 : bytes, stagingCount: clear ? 0 : staging.length, latest: latest ? publicJob(latest) : null, completed: retained.filter(j => j.status === 'complete').map(publicJob) };
}

function storyImageScope(storyId: string,id: string) {
  const record = getJobs().read(id);
  if (record.kind !== 'story-illustration' || record.storyId !== storyId || record.details.discarded || !jobs.has(id)) throw new StoryError('Story illustration not found.',404);
  return record;
}
export async function readStoryImage(storyId: string,id: string) { storyImageScope(storyId,id); return readImageJob(id); }
export function storyImageFile(storyId: string,id: string,index: number) { storyImageScope(storyId,id); return imageFile(id,index); }
export function listStoryImages(storyId: string) { return [...jobs.values()].filter(j=>j.storyId===storyId).sort((a,b)=>b.started-a.started).slice(0,100).map(j=>({...publicJob(j),capture:getJobs().read(j.id).details.illustration})); }
export function removeStoryImage(storyId: string,id: string) { storyImageScope(storyId,id); removeImage(id); }
export function completedStoryImage(storyId: string,id: string,index: number) {
  const record = storyImageScope(storyId,id);
  if (record.state !== 'complete' || jobs.get(id)?.status !== 'complete') throw new StoryError('Wait for this illustration to finish.',409);
  return {...imageFile(id,index),capture:record.details.illustration,provenance:imageProvenanceSchema.parse({...record.details.provenance as object,generationId:id,outputIndex:index})};
}
