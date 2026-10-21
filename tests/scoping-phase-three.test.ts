import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {generatePassage} from '../src/lib/server/story-generation';
import {generateCorrectionResult} from '../src/lib/server/story-corrections';
import {connectionSchema} from '../src/lib/server/connections';
import {prepareOpening} from '../src/lib/server/setup-state';
import type {SetupDraft} from '../src/lib/setup';
import type {Story} from '../src/lib/story';
import type {CorrectionRequest} from '../src/lib/story-corrections';
import {correctionContext} from '../src/lib/server/correction-context';
import {openingContext} from '../src/lib/server/scene-scope';
import {applyCorrectionOperations} from '../src/lib/server/record-editing';

const load=<T>(name:string):T=>JSON.parse(readFileSync(`exports/scoping-stress-test/${name}.json`,'utf8'));
const settings=()=>connectionSchema.parse({...JSON.parse(readFileSync('config/connections.example.json','utf8')),text:{baseUrl:'http://localhost:9999/v1',model:'mock',contextTokens:32000,maxTokens:4096,temperature:0.8,structuredOutput:'auto'}});
const completion=(value:unknown)=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(value)},finish_reason:'stop'}]}));
const request=(story:Story,extra:Partial<CorrectionRequest>={}):CorrectionRequest=>({kind:'repair',expectedRevision:story.revision,requestId:randomUUID(),passageId:story.passages[0].id,direction:'Correct the description of Iris Vale’s notebook to say its cover is dark green.',...extra});

test('large approved opening fits 32k with scene records while the committed world retains every record',async()=>{
 const setup=load<SetupDraft>('setup'),before=structuredClone(setup);setup.input.preferences.passageWords=100;
 let calls=0;
 const proposal=await generatePassage({setup},settings(),new AbortController().signal,()=>{},async(_url,init)=>{
  calls++;const body=JSON.parse(String(init!.body));
  if(body.messages[0].content.startsWith('Return {effects:'))return completion({effects:[],memory:{summary:'The crew studies the chart.',facts:[],openQuestions:[],characterIds:['iris','tamsin','ren'],locationIds:['chartroom']}});
  const data=JSON.parse(body.messages[1].content);
  assert.equal(data.canon.characters.length,3);assert.ok(data.canon.items.length<20);assert.ok(data.canon.places.length<10);
  assert.ok(!JSON.stringify(data.canon).includes('Reserve fitting 70'));
  assert.ok(data.canon.characters.some((c:{id:string})=>c.id==='iris'));
  return completion({title:'The chart',chapterTitle:setup.plan!.chapterTitle,viewpointId:'iris',endOfChapter:false,paragraphs:['Iris studied the chart while Tamsin checked the pencilled boundary. Ren stood beside the table and waited for an explanation. Rain tapped the roof above them, and the lamp cast a soft circle across the paper. The morning report offered no clear answer. Iris read the final line again, considering how much a witness could have mistaken in the darkness. She asked Tamsin to describe the mark on the margin, then listened carefully while Ren watched the door.']});
 });
 assert.equal(calls,2);
 const committed=prepareOpening(setup,proposal,randomUUID());
 assert.equal(committed.canon.items.length,170);assert.equal(committed.canon.characters.length,24);assert.equal(committed.canon.places.length,34);
 setup.input.preferences.passageWords=before.input.preferences.passageWords;assert.deepEqual(setup,before);
});

test('one-record rename fits 16k without unrelated full records, preserving its other fields',async()=>{
 const story=load<Story>('story'),before=structuredClone(story),c=settings();c.text.contextTokens=16384;
 const input=request(story,{kind:'record',recordKind:'item',targetId:'iris-notebook',mode:'name',direction:'Choose a more distinctive name for this notebook.'});
 const result=await generateCorrectionResult(story,input,c,new AbortController().signal,()=>{},async(_url,init)=>{
  const data=JSON.parse(JSON.parse(String(init!.body)).messages[1].content);
  assert.equal(data.currentCanon,undefined);assert.equal(data.selectedRecord.id,'iris-notebook');
  assert.equal(data.directory.items.length,170);
  return completion({explanation:'Give the selected notebook a distinctive title.',name:'The rain ledger'});
 });
 assert.equal(result.changes.length,1);assert.equal(result.changes[0].field,'name');assert.deepEqual(story,before);
});

test('large-world repair receives full reported records, holder paths and a complete directory at 32k',async()=>{
 const story=load<Story>('story'),before=structuredClone(story);
 const result=await generateCorrectionResult(story,request(story),settings(),new AbortController().signal,()=>{},async(_url,init)=>{
  const data=JSON.parse(JSON.parse(String(init!.body)).messages[1].content);
  assert.ok(data.currentCanon.characters.length<24);assert.ok(data.currentCanon.items.length<30);
  assert.equal(data.directory.characters.length,24);assert.equal(data.directory.items.length,170);
  assert.ok(data.currentCanon.items.some((i:{id:string})=>i.id==='iris-bag'));
  const notebook=data.currentCanon.items.find((i:{id:string})=>i.id==='iris-notebook');assert.ok(notebook);
  assert.equal(notebook.ownerId,'iris-bag');
  return completion({explanation:'Correct only the notebook cover.',world:null,edits:[{kind:'item',value:{...notebook,description:'A dark green covered notebook.'}}]});
 });
 assert.equal(result.changes.length,1);assert.deepEqual(story,before);
});

test('directory lookup cannot authorize rewriting an omitted current record',async()=>{
 const story=load<Story>('story'),before=structuredClone(story),input=request(story);
 const scoped=correctionContext(story,input,story.passages[0].paragraphs.join('\n'));
 const omitted=story.canon.items.find(i=>!scoped.selected.item.has(i.id))!;assert.ok(omitted);
 await assert.rejects(()=>generateCorrectionResult(story,input,settings(),new AbortController().signal,()=>{},async()=>completion({explanation:'Rewrite an unrelated item.',world:null,edits:[{kind:'item',value:{...omitted,description:'Guessed new details.'}}]})),/directory-only record/);
 assert.deepEqual(story,before);
});

test('an explicit selected record retains its holder path without siblings and can move to a valid remote owner',async()=>{
 const story=load<Story>('story'),target=story.canon.items.find(i=>i.id==='iris-notebook')!,input=request(story,{kind:'record',recordKind:'item',mode:'revise',targetId:target.id,direction:'Correct only the description.'});
 const scoped=correctionContext(story,input);
 assert.ok(scoped.selected.item.has('iris-notebook'));assert.ok(scoped.selected.item.has('iris-bag'));assert.ok(!scoped.selected.item.has('iris-ration'));
 const remote=story.canon.characters.find(c=>!scoped.selected.character.has(c.id))!;assert.ok(remote);
 input.direction=`Move this notebook to ${remote.id}; preserve its other details.`;
 const result=await generateCorrectionResult(story,input,settings(),new AbortController().signal,()=>{},async(_url,init)=>{
  const data=JSON.parse(JSON.parse(String(init!.body)).messages[1].content);assert.equal(data.currentCanon.items.length,2);
  return completion({explanation:'Update the immediate holder.',value:{...Object.fromEntries(Object.entries(target).filter(([key])=>key!=='id')),ownerId:remote.id}});
 });
 const applied=applyCorrectionOperations(story,result.operations);assert.equal(applied.canon.items.find(i=>i.id===target.id)!.ownerId,remote.id);assert.equal(applied.canon.items.length,170);
});

test('opening scope keeps absent references compact and excludes unrelated or hidden lore',()=>{
 const story=load<Story>('story');story.passages=[];
 const absent=story.canon.characters.find(c=>!story.context.sceneBrief.castIds.includes(c.id))!;
 story.context.lore.push({id:'always-check',title:'A shared rule',text:'A public constant.',visibility:'always',relatedIds:[],keywords:[]},
  {id:'remote-check',title:'A remote custom',text:'Remote detail.',visibility:'relevant',relatedIds:[absent.id],keywords:['remote-custom']},
  {id:'hidden-check',title:'A hidden plan',text:'Secret plan.',visibility:'hidden',relatedIds:['iris'],keywords:[]});
 const selected=openingContext(story,`Iris recalls ${absent.name}.`);
 assert.ok(!selected.scope.castIds.has(absent.id));assert.ok(selected.referencedCharacters.some(c=>c.id===absent.id));
 assert.ok(!('persona' in selected.referencedCharacters.find(c=>c.id===absent.id)!));
 assert.ok(selected.lore.some(l=>l.id==='always-check'));assert.ok(!selected.lore.some(l=>l.id==='remote-check'||l.id==='hidden-check'));
});

test('distant author constraints survive correction scope and still reject protected changes',async()=>{
 const story=load<Story>('story'),item=story.canon.items.find(i=>i.id==='iris-notebook')!;
 const remote=story.canon.characters.find(c=>!story.context.sceneBrief.castIds.includes(c.id))!;
 story.factPins.fields.push({kind:'character',recordId:remote.id,field:'persona.voice'},{kind:'item',recordId:item.id,field:'ownerId'});
 story.factPins.rules.push({id:'public-rule-check',text:'The city closes its gates at midnight.'});
 await assert.rejects(()=>generateCorrectionResult(story,request(story),settings(),new AbortController().signal,()=>{},async(_url,init)=>{
  const data=JSON.parse(JSON.parse(String(init!.body)).messages[1].content);
  assert.equal(data.factPins.fields.find((p:{recordId:string})=>p.recordId===remote.id).value,remote.persona!.voice);
  assert.ok(data.factPins.rules.some((r:{id:string})=>r.id==='public-rule-check'));
  return completion({explanation:'Try a protected holder change.',world:null,edits:[{kind:'item',value:{...item,ownerId:'ren'}}]});
 }),/pinned|pin/i);
});

test('a replacement description does not turn an exact reported item into every same-noun item',()=>{
 const story=load<Story>('story'),input=request(story,{direction:'Correct only Iris Vale’s notebook (iris-notebook) to exactly: A dark green covered notebook. Preserve its ID, owner, quantity and equipment.'});
 const scoped=correctionContext(story,input,story.passages[0].paragraphs.join('\n'));
 assert.ok(scoped.selected.item.has('iris-notebook'));assert.ok(scoped.selected.item.size<20);
 const generic=correctionContext(story,request(story,{direction:'Correct the notebooks.'}));
 assert.ok(generic.selected.item.size>scoped.selected.item.size);
});
