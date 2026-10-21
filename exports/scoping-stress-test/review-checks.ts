// Reproduce additional scope failures with no model/provider/library access.
// Run: node --import tsx exports/scoping-stress-test/review-checks.ts
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {validateStory} from '../../src/lib/story';
import {emptyContext} from '../../src/lib/context-types';
import {buildStoryContext} from '../../src/lib/server/context-builder';

const root='exports/scoping-stress-test/';
if(!process.argv.includes('--after'))throw new Error('The original review baseline is preserved. Run with --after for current behavior.');
const fixture=validateStory(JSON.parse(readFileSync(root+'story.json','utf8')));
function inferredViewpoint(name:string){
 const story=structuredClone(fixture);story.context=emptyContext();
 story.passages=[{...story.passages[0],viewpoint:name,paragraphs:['Rain tapped the window while the observer waited alone.']}];
 const report=buildStoryContext(story,'Continue the quiet moment.',32000,4096);
 const identityLines=report.messages[0].content.split('\n').filter(line=>line.startsWith('{"id":')).map(line=>JSON.parse(line));
 return {savedViewpoint:name,inferredId:identityLines.find(record=>record.viewpoint===true)?.id,selectedPlaceIds:report.selectedPlaceIds};
}
const surname=inferredViewpoint('Mara Vale'),shortName=inferredViewpoint('Ren');
assert.equal(surname.inferredId,'mara');assert.equal(surname.selectedPlaceIds.includes('reading'),true);
assert.equal(shortName.inferredId,'ren');

const remote=structuredClone(fixture);remote.context=emptyContext();
remote.context.sceneBrief={...remote.context.sceneBrief,viewpointId:'ren',locationId:'market',castIds:['ren'],purpose:'Wait beside the message board.'};
remote.passages=[{...remote.passages[0],viewpoint:'Ren',paragraphs:['Ren waited beside the message board.']}];
const ticket=buildStoryContext(remote,'Consider the unused ferry ticket.',32000,4096);
assert.equal(ticket.sources.some(s=>s.id==='iris-receipt'&&s.included),false);
assert.equal(ticket.selectedCharacterIds.includes('iris'),false);
// Current place-root ownership is expanded, but a named remote character-owned item's
// holder does not automatically become a compact character reference.
const ownerIdentityIncluded=ticket.sources.some(s=>s.id==='iris:identity'&&s.included);
assert.equal(ownerIdentityIncluded,false);

const result={modelCalls:0,userLibraryChanged:false,viewpointFallback:{sharedSurname:surname,shortName},nestedReference:{item:'iris-ferry-ticket',irrelevantSiblingIncluded:false,ownerFullIdentityIncluded:ownerIdentityIncluded,holderNameAvailableInStoragePath:true},limitations:'Deterministic post-fix checks; the original review-baseline.json is preserved. No model-quality claim is implied.'};
writeFileSync(root+'review-after.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
