import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { parseModelObject, stripReasoningTags } from '../src/lib/server/model-output';
import { completeText } from '../src/lib/server/llm';
const schema = z.strictObject({ fact: z.string() });
test('Corvus-adapted reasoning filter handles attributes, nesting and unfinished tags without answer fallback', () => {
  assert.equal(stripReasoningTags('<THINK mode="plan">private <reasoning>nested</reasoning> end</THINK>Actual story.'), 'Actual story.');
  assert.equal(stripReasoningTags('<thought>Only reasoning.</thought>'), '');
  assert.equal(stripReasoningTags('Visible prose.<think>unfinished'), 'Visible prose.');
  assert.equal(stripReasoningTags('Visible prose.<think mode="unfinished'), 'Visible prose.');
  assert.throws(() => stripReasoningTags('<think><thought>x</think>'), /malformed reasoning tags/);
});
test('structured parsing tolerates harmless wrappers but rejects malformed, multiple, missing or extra-field answers', () => {
  assert.deepEqual(parseModelObject('```json\n{"fact":"braces { } and escaped \\"quote\\""}\n```'.replaceAll('\\"quote\\"','\\"quote\\"'), schema, 'facts'), { fact: 'braces { } and escaped "quote"' });
  assert.deepEqual(parseModelObject('<reasoning>private</reasoning>Result:\n{"fact":"Arrived."}', schema, 'facts'), { fact: 'Arrived.' });
  for (const raw of ['', '{"fact":', '{"fact":"a"} {"fact":"b"}', '[{"fact":"a"}]', '{"fact":"a","ignoreRules":true}', '<think>{"fact":"reasoning only"}</think>']) assert.throws(() => parseModelObject(raw, schema, 'facts'));
});
test('provider reasoning-only fields and tagged reasoning-only content never become a successful completion', async () => {
  const settings = { baseUrl: 'http://127.0.0.1/v1', model: 'qa', maxTokens: 256, contextTokens: 4096 };
  for (const message of [{ content: '<reasoning>private only</reasoning>' }, { reasoning_content: 'private only' }]) {
    await assert.rejects(completeText(settings, [], { outputTokens: 256, signal: new AbortController().signal, kind: 'test' }, async () => new Response(JSON.stringify({ choices: [{ message, finish_reason: 'stop' }] }))), /usable text/);
  }
});
