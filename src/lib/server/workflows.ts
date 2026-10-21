import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve, relative, isAbsolute, basename } from 'node:path';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { StoryError } from './repository';
const nodeSchema = z.object({ class_type: z.string().min(1).max(200), inputs: z.record(z.string(), z.unknown()) }).passthrough();
export const workflowSchema = z.record(z.string().regex(/^[\w-]+$/), nodeSchema).refine(w => Object.keys(w).length > 0 && Object.keys(w).length <= 500, 'Use an API-format workflow with 1–500 nodes.');
export type Workflow = z.infer<typeof workflowSchema>;
const roots = () => [resolve('AI/Comfy Workflow'), resolve('config/workflows')];
export function loadWorkflow(path: string) {
  const full = resolve(path);
  if (!existsSync(full) || !roots().some(root => { const rel = relative(root, realpathSync(full)); return rel !== '..' && !rel.startsWith('..' + '/') && !rel.startsWith('..\\') && !isAbsolute(rel); })) throw new StoryError('Select a workflow from the workflow folders, or import an API-format JSON file.');
  if (readFileSync(full).byteLength > 1_000_000) throw new StoryError('Workflow files must be smaller than 1 MB.');
  try { return workflowSchema.parse(JSON.parse(readFileSync(full, 'utf8'))); } catch { throw new StoryError('Invalid API workflow. Export API-format JSON from ComfyUI; canvas-format workflows are not supported.'); }
}
export function listWorkflows() {
  return roots().flatMap(root => existsSync(root) ? readdirSync(root).filter(name => name.endsWith('.json')).map(name => ({ name, path: relative(resolve('.'), resolve(root, name)).replaceAll('\\', '/') })) : []);
}
export function importWorkflow(name: string, value: unknown) {
  const graph = workflowSchema.parse(value), root = roots()[1]; mkdirSync(root, { recursive: true });
  const filename = basename(name).replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 70).replace(/\.json$/i, '') + '-' + randomUUID().slice(0, 8) + '.json';
  const path = relative(resolve('.'), resolve(root, filename)).replaceAll('\\', '/'); writeFileSync(resolve(path), JSON.stringify(graph, null, 2), { flag: 'wx' });
  return { name: filename, path };
}
export function describeWorkflow(graph: Workflow) {
  const nodes = Object.entries(graph).map(([id, n]) => ({ id, type: n.class_type, inputs: Object.entries(n.inputs).filter(([, v]) => !Array.isArray(v)).map(([key]) => key) }));
  const find = (type: string, input: string) => { const node = nodes.find(n => n.type === type && n.inputs.includes(input)); return node ? `${node.id}.${input}` : ''; };
  return { nodes, suggested: { prompt: find('CLIPTextEncode', 'text'), negative: '', seed: find('KSampler', 'seed'), width: find('EmptyLatentImage', 'width'), height: find('EmptyLatentImage', 'height'), steps: find('KSampler', 'steps'), cfg: find('KSampler', 'cfg'), outputNode: nodes.find(n => /SaveImage|PreviewImage/.test(n.type))?.id || '' } };
}
