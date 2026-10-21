import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evidenceSources, resolveEffectEvidence, indexedEffectsSchema } from '../src/lib/server/evidence-sources';
test('indexed evidence keeps bounded exact excerpts, including Unicode and very short final tails',()=>{
  const paragraphs=['Elias handed the access fob to Mira.', '😀'.repeat(454)+' last.', 'Word '.repeat(399)];
  const sources=evidenceSources(paragraphs);
  assert.ok(sources.length>=5);assert.equal(new Set(sources.map(s=>s.id)).size,sources.length);
  for(const source of sources){assert.ok(source.text.length>=8&&source.text.length<=1000);assert.ok(paragraphs[source.paragraphIndex].includes(source.text));assert.equal(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(source.text),false);}
  assert.ok(sources.some(s=>s.text.endsWith('last.')));
});
test('source IDs resolve to the original quote and never persist as unverified model aliases',()=>{
  const paragraphs=['Elias handed the access fob to Mira.'],sources=evidenceSources(paragraphs);
  const input={type:'item.transfer',itemId:'fob',fromOwnerId:'elias',toOwnerId:'mira',evidenceId:'source-0'};
  assert.equal(indexedEffectsSchema.safeParse([input]).success,true);
  const effects=resolveEffectEvidence([input],sources,paragraphs);
  assert.equal(effects[0].evidence,paragraphs[0]);assert.equal('evidenceId' in effects[0],false);
});
test('unknown anchors, mixed ID/quote fields, abbreviated quotes and malformed operations are rejected',()=>{
  const paragraphs=['Elias handed the access fob to Mira beside the sealed container.'],sources=evidenceSources(paragraphs);
  const base={type:'item.transfer',itemId:'fob',fromOwnerId:'elias',toOwnerId:'mira'};
  assert.throws(()=>resolveEffectEvidence([{...base,evidenceId:'invented'}],sources,paragraphs),/unknown evidence/);
  assert.throws(()=>resolveEffectEvidence([{...base,evidenceId:'source-0',evidence:paragraphs[0]}],sources,paragraphs),/not both/);
  assert.throws(()=>resolveEffectEvidence([{...base,evidence:'Elias handed the access fob ... sealed container.'}],sources,paragraphs),/nonverbatim/);
  assert.throws(()=>resolveEffectEvidence([{...base,evidenceId:'source-0',unknown:true}],sources,paragraphs));
});
