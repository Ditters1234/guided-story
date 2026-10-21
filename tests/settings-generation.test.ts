import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveImagePrompt, imageVariables, defaultFullBodyTemplate, type ImageVariables } from '../src/lib/image-prompts';
import { contextSettingsSchema, imageSettingsSchema, promptSettingsSchema } from '../src/lib/settings';
import { connectionSchema, mergeConnectionSettings } from '../src/lib/server/connections';
import { loadWorkflow, importWorkflow, describeWorkflow, workflowSchema } from '../src/lib/server/workflows';
import { applyImageBindings, imageTestSchema } from '../src/lib/server/image-tests';
import { createSample } from '../src/lib/server/fixture';
import { buildStoryContext } from '../src/lib/server/context-builder';
import { completeText } from '../src/lib/server/llm';

test('the saved former stock full-body template becomes neutral without changing user-authored templates or style',()=>{
  const legacy=defaultFullBodyTemplate.replace('Full-body view','Full-body illustration'),values=Object.fromEntries(imageVariables.map(k=>[k,''])) as ImageVariables;
  values['art.style']='Photorealistic photography';values['subject.name']='the captain';
  assert.equal(promptSettingsSchema.parse({fullbody:legacy}).fullbody,defaultFullBodyTemplate);
  const rendered=resolveImagePrompt(legacy,values,'fullbody').text;assert.ok(rendered.includes('Full-body view of the captain'));assert.ok(rendered.includes(values['art.style']));assert.doesNotMatch(rendered,/\billustration\b/i);
  const custom='{{art.style}}. An editorial illustration of {{subject.name}}.';assert.equal(promptSettingsSchema.parse({fullbody:custom}).fullbody,custom);assert.ok(resolveImagePrompt(custom,values,'fullbody').text.includes('editorial illustration'));
});

test('portrait variables omit lower-body and footwear details, reject unknown variables, and retain nonsexual instructions', () => {
  const values = Object.fromEntries(imageVariables.map(k => [k, k])) as ImageVariables;
  const template = '{{subject.face}} {{subject.lower_body}} {{subject.footwear}}';
  const portrait = resolveImagePrompt(template, values, 'portrait');
  assert.ok(portrait.text.includes('subject.face')); assert.ok(!portrait.text.includes('subject.footwear')); assert.ok(!portrait.text.includes('subject.lower_body')); assert.ok(portrait.text.includes('Nonsexual'));
  assert.ok(resolveImagePrompt(template, values, 'fullbody', false).text.includes('subject.footwear'));
  assert.throws(() => resolveImagePrompt('{{subject.whole_biography}}', values, 'portrait'), /Unknown prompt variables/);
});

test('workflow binding applies only explicit scalar fields, retains original graph, and refuses invalid mappings', () => {
  const graph = loadWorkflow('AI/Comfy Workflow/portrait.comfy-desktop.api.json');
  const input = imageTestSchema.parse({ images: { baseUrl: 'http://127.0.0.1:8188', workflow: 'test', seed: 123, width: 512 }, prompt: 'A fully clothed adult portrait.' });
  const result = applyImageBindings(graph, input);
  assert.equal(result.graph['4'].inputs.text, input.prompt); assert.equal(result.graph['7'].inputs.seed, 123); assert.equal(result.graph['6'].inputs.width, 512);
  assert.notEqual(graph['4'].inputs.text, input.prompt); assert.equal(graph['7'].inputs.seed, 42);
  assert.throws(() => applyImageBindings(graph, { ...input, negative: 'unmapped negative' }), /no negative-prompt binding/);
  const bad = structuredClone(input); bad.images.bindings.prompt = '2.clip_name_missing';
  assert.throws(() => applyImageBindings(graph, bad), /Invalid binding/);
  assert.equal(describeWorkflow(graph).suggested.outputNode, '9');
  const unmapped = structuredClone(input); unmapped.images.bindings.seed=''; const fixed=applyImageBindings(graph,unmapped);
  assert.equal(fixed.seed,null); assert.equal(fixed.graph['7'].inputs.seed,graph['7'].inputs.seed);
});

test('workflow imports validate API graphs, use unique paths, and refuse paths outside managed workflow folders', () => {
  assert.throws(() => workflowSchema.parse({ nodes: [] }));
  assert.throws(() => loadWorkflow('config/connections.example.json'), /Select a workflow/);
  const graph = JSON.parse(readFileSync('AI/Comfy Workflow/portrait.api.json', 'utf8'));
  const imported = importWorkflow('../../qa-test.json', graph);
  try { assert.ok(imported.path.startsWith('config/workflows/')); assert.deepEqual(loadWorkflow(imported.path), graph); }
  finally { unlinkSync(resolve(imported.path)); }
});

test('saving one settings section does not reset custom prompts or context defaults', () => {
  const saved = connectionSchema.parse(JSON.parse(readFileSync('config/connections.example.json', 'utf8')));
  saved.prompts.narratorInstructions = 'Retain this custom narrator.'; saved.context.recentPassages = 7;
  const changed = mergeConnectionSettings(saved, { images: { ...saved.images, seed: 77 } });
  assert.deepEqual(changed.prompts, saved.prompts); assert.deepEqual(changed.context, saved.context);
  assert.throws(() => imageSettingsSchema.parse({ ...saved.images, width: 513 }));
});

test('context controls and narrator preferences affect the assembled messages', () => {
  const story = createSample(); story.preferences.tense = 'present';
  const report = buildStoryContext(story, '', 16384, 1536, contextSettingsSchema.parse({ includeThreads: false, includeRelationships: false, recentPassages: 1 }), promptSettingsSchema.parse({ narratorInstructions: 'QA craft instruction.' }));
  const text = JSON.stringify(report.messages);
  assert.ok(text.includes('QA craft instruction.')); assert.ok(text.includes('present'));
  assert.ok(!report.sources.some(s => s.kind === 'thread' || s.kind === 'relationship'));
});

test('text generation passes requested sampling and structured-output options to the provider', async () => {
  await completeText({ baseUrl: 'http://127.0.0.1/v1', model: 'qa', maxTokens: 256, contextTokens: 4096, topP: 0.8, structuredOutput: 'json' }, [{ role: 'user', content: 'Test' }], { outputTokens: 256, temperature: 0.7, kind: 'test', signal: new AbortController().signal, jsonSchema: {} }, async (_, init) => {
    const body = JSON.parse(String(init?.body)); assert.equal(body.temperature, 0.7); assert.equal(body.top_p, 0.8); assert.deepEqual(body.response_format, { type: 'json_object' });
    return new Response(JSON.stringify({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] }));
  });
});

test('Unsloth thinking control is opt-in on the wire and can explicitly disable reasoning', async () => {
  for (const thinking of ['provider','off','on'] as const) await completeText({ baseUrl:'http://localhost/v1',model:'qa',maxTokens:256,contextTokens:4096,thinking },[{role:'user',content:'Test'}],{outputTokens:256,kind:'test',signal:new AbortController().signal},async(_,init)=>{
    const body=JSON.parse(String(init!.body));assert.equal(body.enable_thinking,thinking==='provider'?undefined:thinking==='on');
    return new Response(JSON.stringify({choices:[{message:{content:'Ready.'},finish_reason:'stop'}]}));
  });
});
test('Auto requests JSON-object output for structured tasks while prose tests and Prompt only stay unformatted',async()=>{
  for(const mode of ['auto','prompt'] as const)for(const structured of [false,true]){
    await completeText({baseUrl:'http://localhost/v1',model:'qa',maxTokens:256,contextTokens:4096,structuredOutput:mode},[{role:'user',content:'Return JSON when asked.'}],{outputTokens:256,kind:'format-check',signal:new AbortController().signal,...(structured?{jsonSchema:{type:'object'}}:{})},async(_,init)=>{
      const body=JSON.parse(String(init!.body));assert.deepEqual(body.response_format,mode==='auto'&&structured?{type:'json_object'}:undefined);
      return new Response(JSON.stringify({choices:[{message:{content:'{}'},finish_reason:'stop'}]}));
    });
  }
});
