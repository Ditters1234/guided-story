import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {estimateTokens,estimateInputTokens,estimateWireTextTokens,splitTextByTokens,packTextsByTokens,tailWithinTokens} from '../src/lib/server/token-budget';
import {buildStoryContext} from '../src/lib/server/context-builder';
import {checkedBudget} from '../src/lib/server/story-generation';
import {createSample} from '../src/lib/server/fixture';
import {connectionSchema} from '../src/lib/server/connections';
import {imageSettingsSchema,promptSettingsSchema} from '../src/lib/settings';
import {loadWorkflow} from '../src/lib/server/workflows';

test('token estimates distinguish prose from bytes and retain conservative Unicode and JSON allowances',()=>{
  const prose='The traveler opened the window and looked across the quiet harbor. '.repeat(100);
  assert.ok(estimateTokens(prose)>0);
  assert.ok(estimateTokens(prose)<Buffer.byteLength(prose));
  const unicode='漢字 🔎 é';
  assert.ok(estimateTokens(unicode)>=Buffer.byteLength(unicode));
  assert.ok(estimateWireTextTokens('"quoted"\n\\escaped')>estimateTokens('quoted escaped'));
  const messages=[{role:'user',content:prose}],schema={type:'object',properties:{answer:{type:'string'}}};
  assert.equal(estimateInputTokens(messages,schema),estimateInputTokens(messages)+estimateTokens(JSON.stringify(schema)));
});

test('token-bounded splitting retains every source character and never breaks Unicode pairs',()=>{
  const source='Mira said, "A possibility, not proof." 🔎 漢字\n'.repeat(80);
  const chunks=splitTextByTokens(source,140);
  assert.ok(chunks.length>1);
  assert.equal(chunks.join(''),source);
  for(const chunk of chunks){assert.ok(estimateWireTextTokens(chunk)<=140);assert.ok(!/[\uD800-\uDBFF]$|^[\uDC00-\uDFFF]/u.test(chunk));}
  const groups=packTextsByTokens(['First source.','Second source.',source],140);
  assert.ok(groups.every(group=>estimateWireTextTokens(group)<=140));
  const ending=tailWithinTokens(source+'Final exact line.',90);
  assert.ok(ending.endsWith('Final exact line.'));
  assert.ok(source.concat('Final exact line.').endsWith(ending));
  assert.ok(estimateWireTextTokens(ending)<=90);
});

test('context reports estimate tokens separately from bytes and reserve schema/output formatting consistently',()=>{
  const report=buildStoryContext(createSample(),'',32000,4096,undefined,undefined,{transportTokens:500});
  assert.equal(report.runnable,true);
  assert.equal(report.budgetMethod,'conservative-estimate');
  assert.ok(report.inputTokens<=report.inputBudget);
  assert.ok(report.inputBytes>report.inputTokens);
  assert.equal(report.inputTokens,report.sources.filter(s=>s.included).reduce((total,s)=>total+s.tokens,0));
  assert.equal(report.taskReserveTokens,500);
  assert.ok(estimateInputTokens(report.messages)+4096+1024+372<=32000);
});

test('generation budgets allow prose that fits the token estimate while rejecting oversized required inputs',()=>{
  const c=connectionSchema.parse(JSON.parse(readFileSync('config/connections.example.json','utf8')));
  c.text.model='test-only';c.text.contextTokens=8192;
  const messages=[{role:'user' as const,content:'An ordinary sentence with familiar words and clear meaning. '.repeat(160)}];
  assert.ok(Buffer.byteLength(JSON.stringify(messages))+1024+c.context.overheadTokens>8192);
  checkedBudget(messages,c,1024);
  assert.throws(()=>checkedBudget([{role:'user',content:'漢'.repeat(5000)}],c,1024),/context budget/);
});

test('factory image/text settings and bundled samplers share the selected model baseline',()=>{
  const c=connectionSchema.parse(JSON.parse(readFileSync('config/connections.example.json','utf8')));
  assert.equal(c.text.contextTokens,32000);assert.equal(c.text.maxTokens,4096);
  assert.equal(c.text.temperature,0.8);assert.equal(c.text.topP,1);assert.equal(c.text.thinking,'off');
  const image=imageSettingsSchema.parse({baseUrl:'http://localhost:8188',workflow:'test'});
  assert.equal(image.width,896);assert.equal(image.height,1152);assert.equal(image.steps,9);assert.equal(image.cfg,1);assert.equal(image.seed,-1);
  assert.equal(image.bindings.negative,'');assert.equal(promptSettingsSchema.parse({}).negative,'');
  assert.match(promptSettingsSchema.parse({}).narratorInstructions,/consistent viewpoint/);
  for(const file of ['portrait.api.json','portrait.comfy-desktop.api.json']){
    const graph=loadWorkflow('AI/Comfy Workflow/'+file);
    assert.equal(graph['7'].inputs.steps,9);assert.equal(graph['7'].inputs.sampler_name,'euler');assert.equal(graph['7'].inputs.scheduler,'beta');
    assert.equal(graph['1'].inputs.unet_name,'Krea 2\\nsfw\\SICK_OLLIE_Krea2_BF16.safetensors');
  }
});
