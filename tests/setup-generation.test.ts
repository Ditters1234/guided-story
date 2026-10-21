import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {StoryRepository} from '../src/lib/server/repository';
import {connectionSchema} from '../src/lib/server/connections';
import {blankSetupPlan,validateSetupPlan,type SetupDraft,type SetupPlan} from '../src/lib/setup';
import {setupDesignRequestSchema,type SetupDesignInput,type SetupDesignKind} from '../src/lib/setup-generation';
import {generateSetupRecord} from '../src/lib/server/setup-generation';

const settings=()=>connectionSchema.parse({...JSON.parse(readFileSync('config/connections.example.json','utf8')),text:{baseUrl:'http://localhost:9999/v1',model:'test-model',apiKey:'test-setup-design-key',maxTokens:4096,contextTokens:65536,temperature:0.8,structuredOutput:'prompt'}});
const input=(kind:SetupDesignKind,extra:Partial<SetupDesignInput>={}):SetupDesignInput=>({kind,mode:'revise',direction:'Make this fit a remote trading station.',...extra});
function completion(value:unknown,finish='stop'){return new Response(JSON.stringify({choices:[{message:{content:typeof value==='string'?value:JSON.stringify(value)},finish_reason:finish}]}));}
function fixture(r:StoryRepository):SetupDraft{
  const draft=r.createSetup({premise:'Two independent space traders uncover a station conspiracy.',castSize:2},randomUUID()),plan=blankSetupPlan();
  const ship=plan.canon.places[0].id,person=plan.canon.characters[0].id,port=randomUUID(),crew=randomUUID();
  plan.title='The Quiet Manifest';plan.chapterTitle='Unlisted cargo';
  plan.canon.characters[0].name='Ava';plan.canon.characters[0].role='Captain';
  plan.canon.characters.push({...structuredClone(plan.canon.characters[0]),id:crew,name:'Leto',role:'Engineer'});
  plan.canon.places[0].name='The Kite';plan.canon.places[0].description='A working freighter.';
  plan.canon.places.push({id:port,name:'Port Nine',description:'An independent station.',parentId:null});
  plan.canon.items.push({id:randomUUID(),name:'Brass key',description:'Opens the cargo locker.',quantity:1,ownerId:person,equipped:false},{id:randomUUID(),name:'Tool roll',description:'Repair tools.',quantity:2,ownerId:ship,equipped:false});
  plan.canon.relationships.push({id:randomUUID(),fromId:person,toId:crew,notes:'Longtime colleagues.'});
  plan.canon.threads.push({id:randomUUID(),title:'The sealed crate',notes:'Who sent the cargo?',status:'open'},{id:randomUUID(),title:'Old debt',notes:'A payment is overdue.',status:'open'});
  plan.canon.funds=120;plan.canon.cargoNotes='One sealed crate.';
  plan.context.sceneBrief.castIds=[person,crew];
  plan.context.lore.push({id:randomUUID(),title:'World foundations',text:'Frontier crews trade between independent stations.',keywords:['trade'],relatedIds:[port],visibility:'always'}, {id:randomUUID(),title:'A private secret',text:'The portmaster owns the missing cargo.',keywords:['cargo'],relatedIds:[port],visibility:'hidden'});
  plan.context.knowledge.push({id:randomUUID(),fact:'Ava owes the portmaster a favor.',truth:'established',knownBy:[person],readerRevealed:false,sourcePassageId:null,sourceHash:null});
  return r.saveSetup(draft.id,{expectedRevision:draft.revision,requestId:randomUUID(),input:draft.input,plan:validateSetupPlan(plan)});
}
function records(plan:SetupPlan,kind:SetupDesignKind):any[]{switch(kind){case'place':return plan.canon.places;case'item':return plan.canon.items;case'relationship':return plan.canon.relationships;case'thread':return plan.canon.threads;default:throw new Error('Not a record kind');}}
function wire(plan:SetupPlan,kind:SetupDesignKind):Record<string,unknown>{const {id,...rest}=records(plan,kind)[0];return rest;}

test('setup design request accepts the supported section/mode combinations and rejects ambiguous or overreaching controls',()=>{
  const base={expectedRevision:0,requestId:randomUUID(),direction:''};
  for(const kind of ['place','item','relationship','thread','lore'] as const){for(const mode of ['revise','full','create'] as const)assert.equal(setupDesignRequestSchema.safeParse({...base,kind,mode,...(mode==='create'?{}:{targetId:randomUUID()})}).success,true);}
  for(const kind of ['place','item','thread','lore'] as const)assert.equal(setupDesignRequestSchema.safeParse({...base,kind,mode:'name',targetId:randomUUID()}).success,true);
  for(const kind of ['world','opening'] as const)assert.equal(setupDesignRequestSchema.safeParse({...base,kind,mode:'revise'}).success,true);
  for(const bad of [{kind:'place',mode:'revise'},{kind:'lore',mode:'revise'},{kind:'lore',mode:'name'},{kind:'lore',mode:'create',targetId:'id'},{kind:'relationship',mode:'name',targetId:'id'},{kind:'world',mode:'create'},{kind:'opening',mode:'name'},{kind:'world',mode:'revise',targetId:'id'},{kind:'item',mode:'create',targetId:'id'},{kind:'item',mode:'revise',targetId:'id',direction:'x'.repeat(2001)},{kind:'place',mode:'revise',targetId:'id',noNsfw:false}])assert.equal(setupDesignRequestSchema.safeParse({...base,...bad}).success,false,JSON.stringify(bad));
});

test('targeted place, possession, relationship and thread designs preserve IDs, unrelated records and all context',async()=>{
  const r=new StoryRepository(':memory:');try{
    const saved=fixture(r),plan=saved.plan!;
    for(const kind of ['place','item','relationship','thread'] as const){
      const current=records(plan,kind)[0],value=wire(plan,kind);if(kind==='place'){value.description='A freighter with a hidden customs berth.';value.parentId=plan.canon.places[1].id;}else if(kind==='item'){value.description='A key bearing the station seal.';value.quantity=3;}else if(kind==='relationship')value.notes='They trust each other with cargo but not money.';else value.notes='The seal belongs to a closed customs office.';
      for(const mode of ['revise','full'] as const){let sent='';const next=await generateSetupRecord(saved,input(kind,{mode,targetId:current.id}),settings(),new AbortController().signal,async(_url,init)=>{sent=String(init!.body);return completion(value);});
        const expected=structuredClone(plan);records(expected,kind)[0]={...current,...value};assert.deepEqual(next,expected,kind+' '+mode);
        assert.ok(sent.includes(saved.input.premise));assert.ok(sent.includes('Ava'));assert.ok(sent.includes(plan.canon.places[1].id));assert.deepEqual(r.readSetup(saved.id),saved);
      }
    }
  }finally{r.close();}
});

test('LLM additions allocate application UUIDs while retaining valid character/place links and all previous setup records',async()=>{
  const r=new StoryRepository(':memory:');try{
    const saved=fixture(r),plan=saved.plan!;
    const values:Record<string,Record<string,unknown>>={place:{name:'Customs berth',description:'An unused loading dock.',parentId:plan.canon.places[1].id},item:{name:'Seal scanner',description:'Checks cargo seals.',quantity:1,ownerId:plan.canon.characters[1].id,equipped:true},relationship:{fromId:plan.canon.characters[1].id,toId:plan.canon.characters[0].id,notes:'They share a customs-office secret.'},thread:{title:'The missing inspector',notes:'Why did the inspector leave?',status:'open'}};
    for(const kind of ['place','item','relationship','thread'] as const){const next=await generateSetupRecord(saved,input(kind,{mode:'create'}),settings(),new AbortController().signal,async()=>completion(values[kind])),rows=records(next,kind),added=rows.at(-1)!;
      assert.equal(rows.length,records(plan,kind).length+1);assert.match(added.id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);assert.deepEqual({...added,id:undefined},{...values[kind],id:undefined});
      const expected=structuredClone(plan);records(expected,kind).push(added);assert.deepEqual(next,expected);validateSetupPlan(next);assert.deepEqual(r.readSetup(saved.id),saved);
      await assert.rejects(()=>generateSetupRecord(saved,input(kind,{mode:'create'}),settings(),new AbortController().signal,async()=>completion({...values[kind],id:'model-assigned-id'})),/invalid|Unrecognized/i);
    }
  }finally{r.close();}
});

test('place, possession and thread name rerolls affect only the name/title and reject duplicate or expanded answers',async()=>{
  const r=new StoryRepository(':memory:');try{
    const saved=fixture(r),plan=saved.plan!;
    for(const kind of ['place','item','thread'] as const){const row=records(plan,kind)[0],key=kind==='thread'?'title':'name',name=kind==='thread'?'The silent inspector':'New '+row.name;let limit=0;
      const next=await generateSetupRecord(saved,input(kind,{mode:'name',targetId:row.id,direction:'Also move everything to the port.'}),settings(),new AbortController().signal,async(_url,init)=>{limit=JSON.parse(String(init!.body)).max_tokens;return completion({[key]:'  '+name+'  '});});
      const expected=structuredClone(plan);records(expected,kind)[0][key]=name;assert.deepEqual(next,expected);assert.ok(limit<=256);
      for(const response of [{[key]:String(row[key]).toUpperCase()},{[key]:records(plan,kind)[1][key]},{[key]:name,description:'A hidden extra edit.'}])await assert.rejects(()=>generateSetupRecord(saved,input(kind,{mode:'name',targetId:row.id}),settings(),new AbortController().signal,async()=>completion(response)),/same|already|invalid|Unrecognized/i);
      assert.deepEqual(r.readSetup(saved.id),saved);
    }
  }finally{r.close();}
});

test('generated graph mistakes and invalid quantities are rejected before any setup mutation',async()=>{
  const r=new StoryRepository(':memory:');try{
    const saved=fixture(r),plan=saved.plan!,[first,second]=plan.canon.places,person=plan.canon.characters[0].id;
    const cyclic=structuredClone(saved);cyclic.plan!.canon.places[1].parentId=first.id;
    const failures:[SetupDraft,SetupDesignKind,Record<string,unknown>][]=[
      [saved,'place',{...wire(plan,'place'),parentId:first.id}], [saved,'place',{...wire(plan,'place'),parentId:'unknown-place'}], [cyclic,'place',{...wire(plan,'place'),parentId:second.id}],
      [saved,'item',{...wire(plan,'item'),ownerId:'unknown-owner'}], [saved,'item',{...wire(plan,'item'),ownerId:first.id,equipped:true}], [saved,'item',{...wire(plan,'item'),quantity:0}], [saved,'item',{...wire(plan,'item'),quantity:1.5}],
      [saved,'relationship',{...wire(plan,'relationship'),fromId:person,toId:person}], [saved,'relationship',{...wire(plan,'relationship'),toId:'unknown-cast'}], [saved,'thread',{...wire(plan,'thread'),status:'resolved'}]
    ];
    for(const[draft,kind,response]of failures){await assert.rejects(()=>generateSetupRecord(draft,input(kind,{targetId:records(plan,kind)[0].id}),settings(),new AbortController().signal,async()=>completion(response)),/invalid|containment|owner|equip|relationship|same|yourself|distinct|different|self|closed|resolved/i,kind+JSON.stringify(response));assert.deepEqual(r.readSetup(saved.id),saved);}
  }finally{r.close();}
});

test('world generation replaces only foundations text, retaining hidden lore, knowledge and foundation metadata',async()=>{
  const r=new StoryRepository(':memory:');try{
    const saved=fixture(r),next=await generateSetupRecord(saved,input('world'),settings(),new AbortController().signal,async()=>completion({text:'The trade stations enforce a fragile cargo quarantine.'})),expected=structuredClone(saved.plan!);
    expected.context.lore[0].text='The trade stations enforce a fragile cargo quarantine.';assert.deepEqual(next,expected);assert.deepEqual(r.readSetup(saved.id),saved);
    const hiddenOnly=structuredClone(saved);hiddenOnly.plan!.context.lore.splice(0,1);const created=await generateSetupRecord(hiddenOnly,input('world'),settings(),new AbortController().signal,async()=>completion({text:'New public foundations.'}));
    assert.deepEqual(created.context.lore[0],hiddenOnly.plan!.context.lore[0]);assert.equal(created.context.lore.length,2);assert.equal(created.context.lore[1].title,'World foundations');assert.equal(created.context.lore[1].visibility,'always');assert.equal(created.context.lore[1].text,'New public foundations.');
    const renamed=structuredClone(saved);renamed.plan!.context.lore[0].title='An unrelated always-included custom';
    const separate=await generateSetupRecord(renamed,input('world'),settings(),new AbortController().signal,async()=>completion({text:'Separate world foundations.'}));
    assert.deepEqual(separate.context.lore.slice(0,2),renamed.plan!.context.lore);assert.equal(separate.context.lore[2].title,'World foundations');
    await assert.rejects(()=>generateSetupRecord(saved,input('world'),settings(),new AbortController().signal,async()=>completion({text:'New public facts.',visibility:'always',knowledge:[]})),/invalid|Unrecognized/i);
  }finally{r.close();}
});

test('background creation uses compact references and only direction-selected full records',async()=>{
  const r=new StoryRepository(':memory:');try{
    const saved=fixture(r),draft=structuredClone(saved),plan=draft.plan!;
    plan.canon.characters[1].notes='UNRELATED_CHARACTER_DETAILS';plan.canon.items[1].description='UNRELATED_ITEM_DETAILS';plan.canon.places[0].description='UNRELATED_PLACE_DETAILS';
    const original=structuredClone(draft),value={title:'Dockside greetings',text:'Crews may share tea before discussing a delivery; the custom is optional.',keywords:['tea','customs','tea'],relatedIds:[plan.canon.characters[0].id,plan.canon.places[1].id,plan.canon.places[1].id]};let payload:any,sent='';
    const next=await generateSetupRecord(draft,input('lore',{mode:'create',direction:'Ava may exchange greetings at Port Nine.'}),settings(),new AbortController().signal,async(_url,init)=>{const body=JSON.parse(String(init!.body));payload=JSON.parse(body.messages[1].content);sent=JSON.stringify(body.messages);assert.match(body.messages[0].content,/preferably under 80 words/);assert.match(body.messages[0].content,/background does not establish what any character knows/);return completion(value);});
    assert.equal(payload.current,null);assert.deepEqual(payload.directory.items,plan.canon.items.map(item=>({id:item.id,name:item.name})));assert.deepEqual(payload.records.characters.map((c:any)=>c.id),[plan.canon.characters[0].id]);assert.deepEqual(payload.records.places.map((p:any)=>p.id),[plan.canon.places[1].id]);assert.deepEqual(payload.records.items,[]);assert.equal(payload.lore,undefined);
    for(const marker of ['UNRELATED_CHARACTER_DETAILS','UNRELATED_ITEM_DETAILS','UNRELATED_PLACE_DETAILS',plan.context.lore[1].text,plan.context.lore[0].text])assert.ok(!sent.includes(marker),marker);
    const added=next.context.lore.at(-1)!;assert.match(added.id,/^[0-9a-f-]{36}$/i);assert.equal(added.visibility,'relevant');assert.deepEqual(added.keywords,['tea','customs']);assert.deepEqual(added.relatedIds,[plan.canon.characters[0].id,plan.canon.places[1].id]);
    const expected=structuredClone(plan);expected.context.lore.push(added);assert.deepEqual(next,expected);assert.deepEqual(draft,original);assert.deepEqual(r.readSetup(saved.id),saved);
  }finally{r.close();}
});

test('background revise and full design preserve selected visibility, IDs, pins and all unrelated state',async()=>{
  const r=new StoryRepository(':memory:');try{
    const saved=fixture(r),draft=structuredClone(saved),plan=draft.plan!;
    plan.factPins={fields:[{kind:'item',recordId:plan.canon.items[0].id,field:'quantity'}],rules:[{id:randomUUID(),text:'Transit between stations takes a week.'}]};
    for(const visibility of ['always','relevant','hidden'] as const)for(const mode of ['revise','full'] as const){
      const working=structuredClone(draft),target=working.plan!.context.lore[1];target.visibility=visibility;
      const value={title:'Optional dockside custom',text:'Crews sometimes share tea before formal introductions.',keywords:['tea'],relatedIds:[plan.canon.items[0].id]};let payload:any;
      const next=await generateSetupRecord(working,input('lore',{mode,targetId:target.id,direction:''}),settings(),new AbortController().signal,async(_url,init)=>{payload=JSON.parse(JSON.parse(String(init!.body)).messages[1].content);return completion(value);});
      assert.deepEqual(payload.current,target);assert.deepEqual(payload.records.places.map((p:any)=>p.id),target.relatedIds);assert.deepEqual(payload.records.characters,[]);assert.deepEqual(payload.records.items,[]);assert.equal(payload.factPins.fields[0].value,1);assert.deepEqual(payload.factPins.rules,plan.factPins.rules);
      const expected=structuredClone(working.plan!);Object.assign(expected.context.lore[1],value);assert.deepEqual(next,expected);assert.equal(next.context.lore[1].id,target.id);assert.equal(next.context.lore[1].visibility,visibility);assert.deepEqual(r.readSetup(saved.id),saved);
    }
  }finally{r.close();}
});

test('background title rerolls change only the title and reject duplicate or expanded responses',async()=>{
  const r=new StoryRepository(':memory:');try{
    const saved=fixture(r),target=saved.plan!.context.lore[1];let limit=0;
    const next=await generateSetupRecord(saved,input('lore',{mode:'name',targetId:target.id,direction:'Also reveal the secret and make every supply unlimited.'}),settings(),new AbortController().signal,async(_url,init)=>{const body=JSON.parse(String(init!.body));limit=body.max_tokens;assert.match(body.messages[0].content,/Return only \{title:string\}/);assert.doesNotMatch(body.messages[0].content,/Return exactly \{title,text,keywords/);return completion({title:'  Station etiquette  '});});
    const expected=structuredClone(saved.plan!);expected.context.lore[1].title='Station etiquette';assert.deepEqual(next,expected);assert.ok(limit<=256);
    for(const value of [{title:target.title.toUpperCase()},{title:saved.plan!.context.lore[0].title},{title:'New title',text:'An unwanted rewrite.'},{name:'Wrong field'}])await assert.rejects(()=>generateSetupRecord(saved,input('lore',{mode:'name',targetId:target.id}),settings(),new AbortController().signal,async()=>completion(value)),/same|already|invalid|Unrecognized/i);
    assert.deepEqual(r.readSetup(saved.id),saved);
  }finally{r.close();}
});

test('background designs reject unknown links and overreaching fields without modifying setup records',async()=>{
  const r=new StoryRepository(':memory:');try{
    const saved=fixture(r),target=saved.plan!.context.lore[1],value={title:'A useful custom',text:'Crews can exchange a greeting before trading.',keywords:['custom'],relatedIds:[saved.plan!.canon.places[1].id]};
    for(const bad of [{...value,relatedIds:['unknown-record']},{...value,id:'model-assigned-id'},{...value,visibility:'always'},{...value,unlimited:true},{...value,canon:saved.plan!.canon},{...value,text:'x'.repeat(10001)},{...value,keywords:Array(31).fill('custom')},{...value,relatedIds:Array(31).fill(saved.plan!.canon.places[1].id)}]){
      await assert.rejects(()=>generateSetupRecord(saved,input('lore',{targetId:target.id}),settings(),new AbortController().signal,async()=>completion(bad)),/invalid|Unrecognized|reference|Too big/i);assert.deepEqual(r.readSetup(saved.id),saved);
    }
    let calls=0;await assert.rejects(()=>generateSetupRecord(saved,input('lore',{targetId:'missing-entry'}),settings(),new AbortController().signal,async()=>{calls++;return completion(value);}),/no longer exists/);assert.equal(calls,0);
  }finally{r.close();}
});

test('possession design preserves reader-selected supply mode and explains its unchanged source quantity',async()=>{
  const r=new StoryRepository(':memory:');try{
    const saved=fixture(r),draft=structuredClone(saved),target=draft.plan!.canon.items[0];target.unlimited=true;
    const {id,unlimited,...value}=target;value.description='A supply source with a useful specific description.';
    for(const mode of ['revise','full'] as const){
      const next=await generateSetupRecord(draft,input('item',{mode,targetId:id,direction:'Improve the description without changing its supply mode.'}),settings(),new AbortController().signal,async(_url,init)=>{const body=JSON.parse(String(init!.body)),prompt=body.messages[0].content;assert.match(prompt,/unlimited flag is reader-controlled/);assert.match(prompt,/keep its quantity 1, noncontainer status and unequipped state unchanged/);assert.match(prompt,/quantity rules apply only to counted stock/);return completion(value);});
      const expected=structuredClone(draft.plan!);expected.canon.items[0].description=String(value.description);assert.deepEqual(next,expected);assert.equal(next.canon.items[0].unlimited,true);
      await assert.rejects(()=>generateSetupRecord(draft,input('item',{mode,targetId:id}),settings(),new AbortController().signal,async()=>completion({...value,unlimited:false})),/invalid|Unrecognized/i);
    }
    assert.deepEqual(r.readSetup(saved.id),saved);
  }finally{r.close();}
});

test('opening generation is an editable scene plan with known references and never writes novel prose',async()=>{
  const r=new StoryRepository(':memory:');try{
    const saved=fixture(r),plan=saved.plan!,opening={viewpointId:plan.canon.characters[1].id,locationId:plan.canon.places[1].id,castIds:plan.canon.characters.map(c=>c.id),purpose:'Meet the missing inspector at the berth.',tension:'The station clock stops.',stopAt:'A choice about entering customs.'};
    const next=await generateSetupRecord(saved,input('opening'),settings(),new AbortController().signal,async()=>completion(opening)),expected=structuredClone(plan);expected.context.sceneBrief={...plan.context.sceneBrief,...opening};assert.deepEqual(next,expected);assert.equal(r.list().length,0);assert.deepEqual(r.readSetup(saved.id),saved);
    for(const response of [{...opening,viewpointId:'unknown-cast'},{...opening,locationId:'unknown-place'},{...opening,castIds:['unknown-cast']},{...opening,paragraphs:['Prose must not be accepted here.']},{...opening,castIds:[]}])await assert.rejects(()=>generateSetupRecord(saved,input('opening'),settings(),new AbortController().signal,async()=>completion(response)),/invalid|reference|known|cast|unknown/i);
  }finally{r.close();}
});

test('bad provider responses, refusal, cancellation and missing context budget keep the saved setup intact',async()=>{
  const r=new StoryRepository(':memory:');try{
    const saved=fixture(r),request=input('place',{targetId:saved.plan!.canon.places[0].id});
    const bad:typeof fetch[]=[async()=>completion('{broken'),async()=>completion('{} {}'),async()=>completion(wire(saved.plan!,'place'),'length'),async()=>new Response(JSON.stringify({choices:[{message:{refusal:'Declined'},finish_reason:'stop'}]})),async()=>new Response('{}',{status:401})];
    for(const fetcher of bad){await assert.rejects(()=>generateSetupRecord(saved,request,settings(),new AbortController().signal,fetcher));assert.deepEqual(r.readSetup(saved.id),saved);}
    const aborted=new AbortController();aborted.abort();let abortedCalls=0;await assert.rejects(()=>generateSetupRecord(saved,request,settings(),aborted.signal,async()=>{abortedCalls++;throw new Error('Aborted');}),/cancel|abort|timed out/i);assert.equal(abortedCalls,0);
    const lateAbort=new AbortController();await assert.rejects(()=>generateSetupRecord(saved,request,settings(),lateAbort.signal,async()=>{lateAbort.abort();return completion({...wire(saved.plan!,'place'),description:'A late result that must never be accepted.'});}),/cancel|abort|timed out/i);assert.deepEqual(r.readSetup(saved.id),saved);
    const tiny=settings();tiny.text.contextTokens=1024;let calls=0;await assert.rejects(()=>generateSetupRecord(saved,request,tiny,new AbortController().signal,async()=>{calls++;return completion(wire(saved.plan!,'place'));}),/context budget/i);assert.equal(calls,0);assert.deepEqual(r.readSetup(saved.id),saved);
    await assert.rejects(()=>generateSetupRecord(saved,input('place',{targetId:'missing'}),settings(),new AbortController().signal,async()=>{calls++;return completion(wire(saved.plan!,'place'));}),/not|exist|unknown/i);assert.equal(calls,0);
  }finally{r.close();}
});
