import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {StoryRepository} from '../src/lib/server/repository';
import {blankSetupPlan, type SetupDraft} from '../src/lib/setup';
import {normalizeCharacterProfile} from '../src/lib/character-profile';
import {connectionSchema} from '../src/lib/server/connections';
import {generatePassage} from '../src/lib/server/story-generation';
import {generateSetupRecord} from '../src/lib/server/setup-generation';
import {generateCorrectionResult, prepareCorrectionResult} from '../src/lib/server/story-corrections';
import {applyCorrectionOperations} from '../src/lib/server/record-editing';
import {applyStoryEffects} from '../src/lib/story-effects';
import {assertFactPinsUnchanged, resolvedFactPins} from '../src/lib/fact-pins';
import {itemRootOwnerId} from '../src/lib/inventory';
import type {CorrectionRequest} from '../src/lib/story-corrections';

const settings=()=>connectionSchema.parse({...JSON.parse(readFileSync('config/connections.example.json','utf8')),text:{baseUrl:'http://localhost:9999/v1',model:'test-model',maxTokens:4096,contextTokens:32000,temperature:0.8,structuredOutput:'prompt'}});
const completion=(value:unknown)=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(value)},finish_reason:'stop'}]}));
const quiet='The morning light fell across the clean stable floor. Alex listened to the wind at the open door while Erin watched him with quiet interest. There was no need to hurry through the familiar morning. He stood beside her for a while, enjoying the soft sounds of the yard and the warmth of her breath. A sparrow settled on the sill, tilting its head toward them before flying away again.';
function fixture(r:StoryRepository):SetupDraft {
  const draft=r.createSetup({premise:'A quiet morning tending a pony.',castSize:2,preferences:{passageWords:100}},randomUUID()),plan=blankSetupPlan();
  plan.canon.places=[{id:'stable',name:'Stable',description:'A clean stable with a grooming shelf.',parentId:null}];
  plan.canon.characters=[normalizeCharacterProfile({...plan.canon.characters[0],id:'alex',name:'Alex',locationId:'stable'}),normalizeCharacterProfile({...plan.canon.characters[0],id:'erin',name:'Erin',locationId:'stable',visual:{species:'horse'}})];
  plan.canon.items=[{id:'tin',name:'Treat tin',description:'A small portable tin.',quantity:1,ownerId:'alex',equipped:false,isContainer:true},{id:'sugar',name:'Sugar cubes',description:'Small white sugar cubes for pony treats.',visualDescription:'White sugar cubes.',quantity:1,ownerId:'tin',equipped:false,unlimited:true}];
  plan.context.sceneBrief={...plan.context.sceneBrief,viewpointId:'alex',locationId:'stable',castIds:['alex','erin'],purpose:'Offer Erin sugar cubes and spend a quiet moment with her.'};
  plan.context.lore=[{id:'treat-routine',title:'Treats',text:'Sugar cubes are an optional reward for Erin. Current inventory governs availability.',visibility:'relevant',keywords:['treats'],relatedIds:['sugar','erin']}];
  return r.saveSetup(draft.id,{expectedRevision:0,requestId:randomUUID(),input:draft.input,plan});
}
function publish(r:StoryRepository,setup:SetupDraft){
  return r.commitOpening(setup.id,setup.revision,randomUUID(),'unlimited-test-opening',{mode:'continue',direction:'',draft:{title:'A quiet morning',chapterTitle:setup.plan!.chapterTitle,startsChapter:true,endOfChapter:false,viewpointId:'alex',paragraphs:[quiet]},effects:[]});
}
function correctionInput(story:ReturnType<typeof publish>,mode:'name'|'revise'):CorrectionRequest {
  return {kind:'record',recordKind:'item',mode,targetId:'sugar',expectedRevision:story.revision,requestId:randomUUID(),passageId:story.passages.at(-1)!.id,direction:mode==='name'?'Use a more specific name.':'Mention the rounded edges.'};
}

test('unlimited supplies retain policy, nested storage and recovery through setup/story archives',async()=>{
  const r=new StoryRepository(':memory:');try{
    const setup=fixture(r),copy=r.importSetup(r.exportSetup(setup.id));
    assert.deepEqual(copy.plan,setup.plan);
    const story=publish(r,copy),imported=await r.import(r.export(story.id));
    assert.deepEqual(imported.canon,story.canon);
    assert.deepEqual(imported.recovery!.canon,story.recovery!.canon);
    assert.equal(imported.canon.items.find(item=>item.id==='sugar')!.unlimited,true);
    assert.equal(itemRootOwnerId(imported.canon,'sugar'),'alex');
    assert.equal(imported.canon.items.find(item=>item.id==='sugar')!.ownerId,'tin');
    assert.deepEqual(imported.context.lore,story.context.lore);
  }finally{r.close();}
});

test('supply policy and source pins survive a finite draw and reject policy changes',()=>{
  const r=new StoryRepository(':memory:');try{
    const story=publish(r,fixture(r));
    story.factPins.fields=[{kind:'item',recordId:'sugar',field:'unlimited'},{kind:'item',recordId:'sugar',field:'quantity'},{kind:'item',recordId:'sugar',field:'ownerId'}];
    assert.equal(resolvedFactPins(story).fields[0].value,true);
    const quote='Alex set two sugar cubes from the treat tin on the grooming shelf.';
    const after=applyStoryEffects(story.canon,[{type:'item.draw',ref:'new-cubes',itemId:'sugar',quantity:2,ownerId:'stable',evidence:quote}],quote).canon;
    assert.doesNotThrow(()=>assertFactPinsUnchanged(story,after));
    const changed=structuredClone(story.canon);changed.items.find(item=>item.id==='sugar')!.unlimited=false;
    assert.throws(()=>assertFactPinsUnchanged(story,changed),/Pinned always available supply/);
    story.factPins.fields=[{kind:'item',recordId:'tin',field:'unlimited'}];
    assert.equal(resolvedFactPins(story).fields[0].value,false);
  }finally{r.close();}
});

test('opening immediate consumption needs no item effects and commits the unlimited source unchanged',async()=>{
  const r=new StoryRepository(':memory:');try{
    const setup=fixture(r),paragraphs=['Alex took two sugar cubes from the treat tin and fed them to Erin. She ate both cubes.',quiet];
    let narrations=0,extractions=0,reviews=0;
    const proposal=await generatePassage({setup},settings(),new AbortController().signal,()=>{},async(_url,init)=>{
      const body=JSON.parse(String(init!.body)),system=body.messages[0].content;
      if(system.startsWith('Review inventory consistency.')){
        reviews++;const data=JSON.parse(body.messages[1].content);
        assert.equal(data.before.items.find((item:any)=>item.id==='sugar').unlimited,true);
        assert.deepEqual(data.after.items,data.before.items);
        assert.deepEqual(data.effects,[]);
        return completion({consistent:true,issues:[]});
      }
      if(system.startsWith('Return {effects:')){
        extractions++;const data=JSON.parse(body.messages[1].content);
        assert.equal(data.directory.items.find((item:any[])=>item[0]==='sugar')[6],true);
        return completion({effects:[],memory:{summary:'Alex fed Erin two sugar cubes.',facts:['Erin ate two sugar cubes.'],openQuestions:[],characterIds:['alex','erin'],locationIds:['stable']}});
      }
      narrations++;assert.equal(JSON.parse(body.messages[1].content).canon.items.find((item:any)=>item.id==='sugar').unlimited,true);
      return completion({title:'A small reward',chapterTitle:setup.plan!.chapterTitle,viewpointId:'alex',endOfChapter:false,paragraphs});
    });
    assert.equal(narrations,1);assert.equal(extractions,1);assert.equal(reviews,1);assert.deepEqual(proposal.effects,[]);
    const story=r.commitOpening(setup.id,setup.revision,randomUUID(),'unlimited-consumption',proposal);
    assert.deepEqual(story.canon,setup.plan!.canon);
    assert.deepEqual(story.context.memories.at(-1)!.facts,['Erin ate two sugar cubes.']);
  }finally{r.close();}
});

test('retained draws are reviewed with source, assigned finite stack and complete storage paths',async()=>{
  const r=new StoryRepository(':memory:');try{
    const setup=fixture(r),paragraphs=['Alex took two sugar cubes from the treat tin and set them on the grooming shelf in the stable.',quiet];
    let reviews=0;
    const proposal=await generatePassage({setup},settings(),new AbortController().signal,()=>{},async(_url,init)=>{
      const body=JSON.parse(String(init!.body)),system=body.messages[0].content;
      if(system.startsWith('Review inventory consistency.')){
        reviews++;const data=JSON.parse(body.messages[1].content),drawnId=data.assignedIds['new-cubes'];
        assert.ok(drawnId);
        assert.deepEqual(data.after.items.find((item:any)=>item.id==='sugar'),data.before.items.find((item:any)=>item.id==='sugar'));
        const portion=data.after.items.find((item:any)=>item.id===drawnId);
        assert.equal(portion.quantity,2);assert.equal(portion.ownerId,'stable');assert.notEqual(portion.unlimited,true);
        assert.ok(data.before.items.some((item:any)=>item.id==='tin'));
        assert.ok(data.containerLocations.some((item:any)=>item.id==='tin'&&item.before.storagePath==='Alex'));
        return completion({consistent:true,issues:[]});
      }
      if(system.startsWith('Return {effects:'))return completion({effects:[{type:'item.draw',ref:'new-cubes',itemId:'sugar',quantity:2,ownerId:'stable',evidenceId:'source-0'}],memory:{summary:'Alex left two sugar cubes on the grooming shelf.',facts:['Two sugar cubes are on the grooming shelf.'],openQuestions:[],characterIds:['alex'],locationIds:['stable']}});
      return completion({title:'Treats for later',chapterTitle:setup.plan!.chapterTitle,viewpointId:'alex',endOfChapter:false,paragraphs});
    });
    assert.equal(reviews,1);assert.equal(proposal.effects[0].type,'item.draw');
    const story=r.commitOpening(setup.id,setup.revision,randomUUID(),'unlimited-draw',proposal),portionId=story.passages.at(-1)!.generation!.assignedIds['new-cubes'];
    assert.deepEqual(story.canon.items.find(item=>item.id==='sugar'),setup.plan!.canon.items.find(item=>item.id==='sugar'));
    assert.equal(story.canon.items.find(item=>item.id===portionId)!.quantity,2);
    assert.notEqual(story.canon.items.find(item=>item.id===portionId)!.unlimited,true);
    const imported=await r.import(r.export(story.id));
    assert.deepEqual(imported.canon,story.canon);assert.deepEqual(imported.passages.at(-1)!.generation,story.passages.at(-1)!.generation);
  }finally{r.close();}
});

test('targeted setup item revisions and names preserve reader-chosen unlimited mode',async()=>{
  const r=new StoryRepository(':memory:');try{
    const setup=fixture(r),source=setup.plan!.canon.items.find(item=>item.id==='sugar')!,{id,unlimited,...wire}=source;
    for(const mode of ['name','revise'] as const){
      const result=await generateSetupRecord(setup,{kind:'item',mode,targetId:id,direction:'Make the details more specific.'},settings(),new AbortController().signal,async()=>completion(mode==='name'?{name:'White sugar cubes'}:{...wire,description:'Small white sugar cubes with rounded edges.'}));
      assert.deepEqual(result.canon.items.find(item=>item.id===id),mode==='name'?{...source,name:'White sugar cubes'}:{...source,description:'Small white sugar cubes with rounded edges.'});
    }
    await assert.rejects(()=>generateSetupRecord(setup,{kind:'item',mode:'revise',targetId:id,direction:'Make it finite.'},settings(),new AbortController().signal,async()=>completion({...wire,unlimited:false})),/unrecognized|invalid/i);
    assert.deepEqual(r.readSetup(setup.id),setup);
  }finally{r.close();}
});

test('story AI names and revisions preserve supply policy and reject reader-only mode conversion',async()=>{
  const r=new StoryRepository(':memory:');try{
    const story=publish(r,fixture(r)),source=story.canon.items.find(item=>item.id==='sugar')!,{id,unlimited,...wire}=source;
    for(const mode of ['name','revise'] as const){
      const input=correctionInput(story,mode),result=await generateCorrectionResult(story,input,settings(),new AbortController().signal,()=>{},async(_url,init)=>{
        const data=JSON.parse(JSON.parse(String(init!.body)).messages[1].content);assert.equal(data.selectedRecord.unlimited,true);
        if(mode==='revise')assert.equal(data.directory.items.find((item:any[])=>item[0]==='sugar')[6],true);
        return completion(mode==='name'?{explanation:'A more specific name.',name:'White sugar cubes'}:{explanation:'Describe the edges.',value:{...wire,description:'Small white sugar cubes with rounded edges.'}});
      });
      const saved=applyCorrectionOperations(story,result.operations),expected=mode==='name'?{...source,name:'White sugar cubes'}:{...source,description:'Small white sugar cubes with rounded edges.'};
      assert.deepEqual(saved.canon.items.find(item=>item.id===id),expected);
      assert.deepEqual(result.changes.map(change=>change.field),[mode==='name'?'name':'description']);
    }
    assert.throws(()=>prepareCorrectionResult(story,correctionInput(story,'revise'),{explanation:'Change the supply mode.',edits:[{kind:'item',value:{...source,unlimited:false}}],world:null}),/unrecognized/i);
    assert.throws(()=>applyCorrectionOperations(story,[{type:'record',create:false,edit:{kind:'item',value:{...source,unlimited:false}}}]),/Only the reader/);
    assert.throws(()=>applyCorrectionOperations(story,[{type:'record',create:true,edit:{kind:'item',value:{...source,id:randomUUID()}}}]),/Only the reader/);
    assert.deepEqual(r.read(story.id),story);
  }finally{r.close();}
});
