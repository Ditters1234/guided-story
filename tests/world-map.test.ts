import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { storySchema, validateStory } from '../src/lib/story';
import { setupDraftSchema } from '../src/lib/setup';
import { buildStoryContext } from '../src/lib/server/context-builder';
import { buildWorldMap, emptyWorldLayout, focusExpansion, projectWorldMap, readWorldLayout, sceneFocus, sceneReferenceIds, worldPath, worldSearch } from '../src/lib/world-map';

const brass=()=>storySchema.parse(JSON.parse(readFileSync('exports/scoping-stress-test/story.json','utf8')));
const ranch=()=>setupDraftSchema.parse(JSON.parse(readFileSync('exports/red-willow-ranch/setup.json','utf8'))).plan!;

test('Brasswater and ranch maps begin collapsed at roots without materializing inventory branches',()=>{
  for(const source of [brass(),ranch()]){const before=structuredClone(source),model=buildWorldMap(source.canon,source.context),projection=projectWorldMap(model,new Set());
    assert.deepEqual(projection.rows.map(row=>row.node.id),source.canon.places.filter(p=>!p.parentId).map(p=>p.id));
    assert.ok(projection.rows.length<10);assert.ok(projection.rows.every(row=>!row.open));assert.deepEqual(source,before);
  }
});
test('physical links keep nested storage, character presence and moving location containment distinct',()=>{
  const story=brass(),model=buildWorldMap(story.canon,story.context);
  assert.equal(model.nodes.get('item:iris-notebook')!.parent,'item:iris-bag');
  assert.equal(model.nodes.get('item:iris-bag')!.parent,'character:iris');
  assert.equal(model.nodes.get('character:iris')!.connection,'Currently present at');
  assert.equal(model.nodes.get('place:bridge')!.parent,'place:kestrel');
  assert.deepEqual(worldPath(model,'item:iris-notebook').slice(-3).map(node=>node.id),['iris','iris-bag','iris-notebook']);
  const ids=worldPath(model,'item:iris-notebook').map(node=>node.id);assert.ok(ids.includes('kestrel'));assert.equal(model.nodes.has('item:kestrel'),false);
});
test('search reveals a matching nested resource and its physical path without expanding unrelated stores',()=>{
  const plan=ranch(),model=buildWorldMap(plan.canon,plan.context),projection=projectWorldMap(model,new Set(),{query:'Wooden Grooming Brush'});
  assert.deepEqual(projection.rows.map(row=>row.node.id),['ranch','horse-yard','stable','tack-room','grooming-kit','grooming-brush']);
  assert.equal(projection.rows.some(row=>row.node.id==='cattle-feed'),false);
  const feed=plan.canon.items.find(item=>item.id==='cattle-feed')!;
  assert.ok(model.nodes.get('item:cattle-feed')!.tags.includes(feed.unlimited?'Always available':`Counted quantity ${feed.quantity}`));
});
test('current scene focus expands its ancestor path and immediate neighborhood while containers remain collapsed',()=>{
  const story=brass(),model=buildWorldMap(story.canon,story.context),key=sceneFocus(model)!;
  assert.equal(key,`place:${story.context.sceneBrief.locationId}`);
  const projection=projectWorldMap(model,focusExpansion(model,key),{focus:key});
  assert.ok(projection.rows.some(row=>row.node.key===key));
  assert.ok(!projection.rows.some(row=>row.node.id==='iris-notebook'));
  assert.equal(sceneFocus({...model,brief:{...model.brief,locationId:null,viewpointId:'iris'}}),model.nodes.get('character:iris')!.parent);
});
test('hidden background stays out of search and explicit scene references; related links never become physical children',()=>{
  const story=brass(),model=buildWorldMap(story.canon,story.context),hidden=model.nodes.get('lore:lore-hidden')!;
  assert.deepEqual(worldSearch(model,'Unrevealed island lead'),[]);
  assert.deepEqual(worldSearch(model,'Unrevealed island lead',true).map(node=>node.key),[hidden.key]);
  assert.throws(()=>sceneReferenceIds(story.context,hidden),/Hidden/);
  assert.ok(model.related.get('islandstore')!.includes(hidden.key));
  assert.ok(!model.children.get('place:islandstore')?.some(node=>node.key===hidden.key));
  assert.ok([...model.nodes.values()].filter(node=>node.kind==='thread').every(node=>node.parent===null));
});
test('layout is validated browser state with no authoring fields, unknown nodes or duplicate positions',()=>{
  const source=ranch(),model=buildWorldMap(source.canon,source.context),before=structuredClone(source);
  const input={version:1,mode:'list',expanded:['place:ranch','place:missing'],positions:[{key:'place:ranch',x:45,y:80},{key:'place:missing',x:10,y:20}]};
  assert.deepEqual(readWorldLayout(input,model),{...input,expanded:['place:ranch'],positions:[input.positions[0]]});
  for(const bad of [{...input,canon:source.canon},{...input,positions:[{key:'place:ranch',x:-1,y:0}]},{...input,positions:[input.positions[0],input.positions[0]]},{...input,version:2}])assert.deepEqual(readWorldLayout(bad,model),emptyWorldLayout());
  assert.deepEqual(source,before);
});
test('scene hints are explicit, deduplicated and bounded without moving stock, adding cast or granting knowledge',()=>{
  const story=brass(),before=structuredClone(story),model=buildWorldMap(story.canon,story.context),node=model.nodes.get('item:iris-notebook')!;
  const ids=sceneReferenceIds(story.context,node);assert.ok(ids.includes(node.id));assert.deepEqual(story,before);
  story.context.sceneBrief.resourceIds=ids;assert.deepEqual(sceneReferenceIds(story.context,node),ids);validateStory(story);
  assert.deepEqual(story.canon,before.canon);assert.deepEqual(story.context.knowledge,before.context.knowledge);
  story.context.sceneBrief.resourceIds=Array.from({length:250},(_,i)=>`resource-${i}`);assert.throws(()=>sceneReferenceIds(story.context,node),/250/);
});
test('author map inspection preserves scoped narration context and every authoritative record',()=>{
  const story=brass(),before=structuredClone(story),prompt=buildStoryContext(story,'Iris looks through her notebook.',32000,4096),model=buildWorldMap(story.canon,story.context);
  projectWorldMap(model,new Set(model.physical.map(node=>node.key)),{query:'island',hidden:true});worldSearch(model,'archive',true);
  assert.deepEqual(story,before);assert.deepEqual(buildStoryContext(story,'Iris looks through her notebook.',32000,4096),prompt);
});
test('physical projection is bounded and remains cycle safe for defensive inspection',()=>{
  const source=ranch(),model=buildWorldMap(source.canon,source.context),expanded=new Set(model.physical.map(node=>node.key));
  const projection=projectWorldMap(model,expanded,{limit:5});assert.equal(projection.rows.length,5);assert.equal(projection.total,model.physical.length);
  const root=model.nodes.get('place:ranch')!;root.parent='place:stable';assert.equal(new Set(worldPath(model,root.key).map(node=>node.key)).size,worldPath(model,root.key).length);
});
