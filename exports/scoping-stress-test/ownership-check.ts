// Characterizes successful transfers and missing-effect acceptance without an LLM or user library.
// Run from the project root: node --import tsx exports/scoping-stress-test/ownership-check.ts
import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {validateStory} from '../../src/lib/story';
import {preparePassageCommit} from '../../src/lib/server/passage-commit';
import {buildStoryContext} from '../../src/lib/server/context-builder';
import {evidenceSources,resolveEffectEvidence} from '../../src/lib/server/evidence-sources';

const root='exports/scoping-stress-test/';
if(!process.argv.includes('--after'))throw new Error('The original ownership baseline is preserved. Use --after for the structural dry run; tests/scoping-regressions.test.ts exercises guarded generation.');
const initial=validateStory(JSON.parse(readFileSync(root+'story.json','utf8')));
initial.canon.items.push({id:'test-brush',name:'Wooden hairbrush',description:'A single wooden hairbrush.',ownerId:'iris',quantity:1,equipped:false});
const quote='Iris handed the wooden hairbrush to Ren, who took it and held it in his hand.';
const base={mode:'continue' as const,direction:'',draft:{title:'The borrowed brush',startsChapter:false,endOfChapter:false,viewpointId:'iris',paragraphs:[quote]},memory:{summary:'Iris handed the brush to Ren.',facts:['Ren received the brush from Iris.'],openQuestions:[],characterIds:['iris','ren'],locationIds:['chartroom']}};
const omitted=preparePassageCommit(initial,{...base,effects:[]}).story;
const transferred=preparePassageCommit(initial,{...base,effects:[{type:'item.transfer',itemId:'test-brush',fromOwnerId:'iris',toOwnerId:'ren',evidence:quote}]}).story;
const noHandover='Iris put the wooden hairbrush back in her own satchel. Ren kept his hands at his sides.';
const unsupportedEffects=resolveEffectEvidence([{type:'item.transfer',itemId:'test-brush',fromOwnerId:'iris',toOwnerId:'ren',evidenceId:'source-0'}],evidenceSources([noHandover]),[noHandover]);
const unsupported=preparePassageCommit(initial,{...base,draft:{...base.draft,paragraphs:[noHandover]},memory:undefined,effects:unsupportedEffects}).story;
// Existing items are not globally name-unique: recreating a possession can pass graph validation.
const duplicated=preparePassageCommit(initial,{...base,effects:[{type:'item.create',ref:'new-brush',name:'Wooden hairbrush',description:'A single wooden hairbrush.',ownerId:'ren',quantity:1,equipped:false,evidence:quote}]}).story;
assert.equal(omitted.canon.items.find(i=>i.id==='test-brush')!.ownerId,'iris');
assert.equal(transferred.canon.items.find(i=>i.id==='test-brush')!.ownerId,'ren');
assert.equal(initial.canon.items.find(i=>i.id==='test-brush')!.ownerId,'iris');
assert.equal(unsupported.canon.items.find(i=>i.id==='test-brush')!.ownerId,'ren');
assert.equal(duplicated.canon.items.filter(i=>i.name==='Wooden hairbrush').length,2);
assert.equal(omitted.context.memories.at(-1)!.facts[0],'Ren received the brush from Iris.');

function recipientScene(story:typeof initial){
 const variant=structuredClone(story);
 variant.canon.characters.find(c=>c.id==='ren')!.locationId='market';
 variant.context.sceneBrief={scope:'current-scene',clearAfterPassage:false,viewpointId:'ren',locationId:'market',castIds:['ren'],purpose:'Wait beside the message board.',tension:'',stopAt:'A natural pause.'};
 variant.passages=[{id:randomUUID(),chapter:1,chapterTitle:'At the market',title:'Waiting',viewpoint:'Ren',paragraphs:['Ren waited alone beside the market message board.'],direction:'',endOfChapter:false,createdAt:new Date().toISOString()}];
 // This probes current inventory selection only, without historical brush mentions/memory retrieval.
 variant.context.memories=[];variant.recovery=null;
 const report=buildStoryContext(variant,'Continue this quiet moment.',32000,4096);
 return report.sources.some(s=>s.id==='test-brush'&&s.included);
}
const result={
 modelCalls:0,userLibraryChanged:false,
 correctTransfer:{accepted:true,ownerId:'ren',includedInIsolatedRecipientScene:recipientScene(transferred)},
 omittedTransfer:{accepted:true,ownerId:'iris',proseSaysRecipient:'ren',memorySaysRecipient:'ren',includedInIsolatedRecipientScene:recipientScene(omitted)},
 unsupportedTransfer:{accepted:true,ownerId:'ren',sourceAnchorIsVerbatim:true,proseContainsNoHandover:true},
 duplicateInsteadOfTransfer:{accepted:true,matchingItemCount:2,originalOwnerId:'iris',createdItemOwnerId:'ren'},
 conclusion:'Raw structural dry runs still cannot establish semantic completeness. Actual generatePassage now performs targeted verification and one repair before commit; see scoping-regressions tests and live-repair evidence.',
 limitations:'This deliberately bypasses the guarded generation path. It does not identify what the user’s old model returned. Unreferenced, unequipped items are now omitted from a quiet scene for both holders; ownership remains relevant to explicit item records and event retrieval.'
};
assert.equal(result.correctTransfer.includedInIsolatedRecipientScene,false);
assert.equal(result.omittedTransfer.includedInIsolatedRecipientScene,false);
writeFileSync(root+'ownership-after.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
