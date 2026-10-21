<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
  import type { Character, Story } from './story';
  import CharacterProfileEditor from './CharacterProfileEditor.svelte';
  import StoryCorrections from './StoryCorrections.svelte';
  import InventoryTree from './InventoryTree.svelte';
  import RecordSearch from './RecordSearch.svelte';
  import { inventoryHolders, inventoryPath, itemRootOwnerId } from './inventory';
  import { normalizeCharacterProfile } from './character-profile';
  import { recordCollections, type RecordKind } from './record-editing';
  let {story,busy=$bindable(false),initialKind='place',initialId='',canGenerate=false,onSaved=()=>{},onMutate,onReload,onDirty}: {
    story:Story;busy?:boolean;initialKind?:RecordKind;initialId?:string;canGenerate?:boolean;onSaved?:(story:Story)=>void;
    onMutate:(action:unknown)=>Promise<boolean>;onReload:()=>Promise<boolean>;onDirty:(dirty:boolean)=>void;
  }=$props();
  const labels={character:'Cast',place:'Places',item:'Items',relationship:'Relationships',thread:'Threads'};
  type Draft={id:string|null;name:string;role:string;notes:string;appearance:string;outfit:string;locationId:string;noNsfw:boolean;pinnedAppearance:boolean;description:string;visualDescription:string;parentId:string|null;quantity:number;ownerId:string;equipped:boolean;isContainer:boolean;fromId:string;toId:string;title:string;status:'open'|'resolved'} & {unlimited:boolean} & Pick<Character,'visual'|'persona'|'currentState'|'wardrobe'|'injuries'|'appearanceNotes'|'outfitNotes'>;
  let kind=$state<RecordKind>(untrack(()=>initialKind)),selectedId=$state(untrack(()=>initialId));
  let draft=$state<Draft>(untrack(()=>makeDraft(initialKind,initialId))),baseline=$state(untrack(()=>JSON.stringify(draft)));
  let revision=$state(untrack(()=>story.revision)),note=$state('');
  let aiDirty=$state(false),aiSession=$state(0);
  let splitOpen=$state(false),splitQuantity=$state<number>(1),splitOwnerId=$state('');
  let recordSearch=$state('');
  const rows=$derived(story.canon[recordCollections[kind]]),holders=$derived(inventoryHolders(story.canon,draft.id||undefined));
  const visibleRows=$derived(rows.filter(row=>!recordSearch.trim()||[label(row),JSON.stringify(row),kind==='item'?inventoryPath(story.canon,'ownerId' in row?row.ownerId:''):'','unlimited' in row&&row.unlimited?'always available unlimited supply':'','isContainer' in row&&row.isContainer?'container':'','equipped' in row&&row.equipped?'worn equipped':''].join(' ').toLocaleLowerCase().includes(recordSearch.trim().toLocaleLowerCase())));
  const selectionOutsideSearch=$derived(!!selectedId&&!visibleRows.some(row=>row.id===selectedId));
  const selectedRow=$derived(rows.find(row=>row.id===selectedId));
  const dirty=$derived(JSON.stringify(draft)!==baseline),isNew=$derived(!draft.id);
  const ownerIsPerson=$derived(story.canon.characters.some(c=>c.id===draft.ownerId));
  const savedItem=$derived(kind==='item'?story.canon.items.find(item=>item.id===draft.id):undefined);
  const contents=$derived(kind==='item'&&draft.id?story.canon.items.filter(item=>item.ownerId===draft.id):[]);
  const rootOwner=$derived(savedItem?itemRootOwnerId(story.canon,savedItem.id):'');
  const canSplit=$derived(!!savedItem&&!savedItem.isContainer&&!savedItem.unlimited&&savedItem.quantity>1);
  function makeDraft(type:RecordKind,id:string):Draft {
    const row=story.canon[recordCollections[type]].find(r=>r.id===id);
    const values={id:null,name:'',role:'',notes:'',appearance:'',outfit:'',locationId:story.canon.places[0]?.id||'',noNsfw:true,pinnedAppearance:false,description:'',visualDescription:'',parentId:null,quantity:1,ownerId:story.canon.characters[0]?.id||'',equipped:false,isContainer:false,unlimited:false,fromId:story.canon.characters[0]?.id||'',toId:story.canon.characters[1]?.id||'',title:'',status:'open',...row};
    return JSON.parse(JSON.stringify(type==='character'?normalizeCharacterProfile(values):values));
  }
  function label(row:typeof rows[number]) {return 'title' in row?row.title:'name' in row?row.name:`${story.canon.characters.find(c=>c.id===row.fromId)?.name||row.fromId} → ${story.canon.characters.find(c=>c.id===row.toId)?.name||row.toId}`;}
  function reset(id=selectedId,clearAi=true){selectedId=id;draft=makeDraft(kind,id);baseline=JSON.stringify(draft);note='';splitOpen=false;splitQuantity=1;splitOwnerId=draft.ownerId;if(clearAi){aiDirty=false;aiSession++;}}
  function mayLeave(){return !(dirty||aiDirty||splitOpen)||confirm(`Discard the unsaved ${splitOpen?'stack split':dirty&&aiDirty?'record fields and AI correction draft':dirty?'changes to this record':'AI correction draft'}?`);}
  function changeKind(next:RecordKind){if(next===kind)return;if(mayLeave()){kind=next;recordSearch='';reset('');}}
  function select(id:string){if(mayLeave()){reset(id);return true;}return false;}
  $effect(()=>{onDirty(dirty||aiDirty||splitOpen);});onDestroy(()=>onDirty(false));
  $effect(()=>{if(revision!==story.revision){if(!dirty&&!splitOpen)reset(selectedId,false);else note='The saved story changed. Your unsaved fields are still here.';revision=story.revision;}});
  async function reload(){if(mayLeave()&&await onReload()){reset();revision=story.revision;}}
  function value(){
    const d=$state.snapshot(draft),id=d.id;
    switch(kind){
      case 'character':return normalizeCharacterProfile({id,name:d.name,role:d.role,notes:d.notes,appearance:d.appearance,outfit:d.outfit,visual:d.visual,persona:d.persona,currentState:d.currentState,wardrobe:d.wardrobe,injuries:d.injuries,appearanceNotes:d.appearanceNotes,outfitNotes:d.outfitNotes,locationId:d.locationId,noNsfw:d.noNsfw,pinnedAppearance:d.pinnedAppearance});
      case 'place':return {id,name:d.name,description:d.description,visualDescription:d.visualDescription,parentId:d.parentId};
      case 'item':return {id,name:d.name,description:d.description,visualDescription:d.visualDescription,quantity:d.quantity,ownerId:d.ownerId,equipped:d.equipped,isContainer:d.isContainer,...(d.unlimited||savedItem?.unlimited!==undefined?{unlimited:d.unlimited}:{})};
      case 'relationship':return {id,fromId:d.fromId,toId:d.toId,notes:d.notes};
      case 'thread':return {id,title:d.title,notes:d.notes,status:d.status};
    }
  }
  async function save(){
    const oldIds=new Set(rows.map(r=>r.id)),id=draft.id;
    if(await onMutate({type:'record-save',edit:{kind,value:value()}})){
      const savedId=id||story.canon[recordCollections[kind]].find(r=>!oldIds.has(r.id))?.id||'';reset(savedId,false);note='Record saved.';
    }
  }
  async function correctionsSaved(saved:Story){
    const oldIds=new Set(rows.map(row=>row.id));
    const savedId=draft.id||saved.canon[recordCollections[kind]].find(row=>!oldIds.has(row.id))?.id||'';
    onSaved(saved);await tick();revision=saved.revision;reset(savedId);
    note='AI corrections applied. Saved record loaded.';
  }
  async function remove(){
    if(!draft.id||!confirm(`Remove this ${kind} from current story records?${aiDirty?' Its unsaved AI correction draft will also be discarded.':''} Written passages and picture history remain. This cannot be undone.`))return;
    if(await onMutate({type:'record-remove',kind,id:draft.id})){reset('');note='Record removed. Historical passages and pictures were kept.';}
  }
  function openSplit(){
    if(busy||dirty||aiDirty||!canSplit||!savedItem)return;
    splitQuantity=1;splitOwnerId=savedItem.ownerId;splitOpen=true;note='';
  }
  async function split(){
    if(busy||dirty||aiDirty||!splitOpen||!savedItem||!canSplit)return;
    const source={...savedItem},quantity=splitQuantity,oldIds=new Set(story.canon.items.map(item=>item.id));
    if(!Number.isInteger(quantity)||quantity<1||quantity>=source.quantity)return;
    if(await onMutate({type:'item-split',itemId:source.id,quantity,ownerId:splitOwnerId})){
      const created=story.canon.items.find(item=>!oldIds.has(item.id));
      const remaining=story.canon.items.find(item=>item.id===source.id);
      reset(created?.id||source.id);
      note=created&&remaining?`Stack split: ${created.quantity} at ${inventoryPath(story.canon,created.ownerId)}; ${remaining.quantity} remain in the original stack. Total preserved: ${source.quantity}.`:'Stack split and saved.';
    }
  }
</script>

<main class="full-view records-view">
  <div class="eyebrow">{story.title}</div><h1>Story records</h1>
  <p class="muted">Correct current facts or add something the story needs. Saving a record does not narrate an event. Canon edits refresh memory coverage and pause latest-passage event replacement until the story continues.</p>
  <div class="tabs" role="group" aria-label="Record sections">{#each Object.entries(labels) as [key,title]}<button class:active={kind===key} aria-pressed={kind===key} disabled={busy} onclick={()=>changeKind(key as RecordKind)}>{title}</button>{/each}</div>
  <RecordSearch label={`Search ${labels[kind].toLowerCase()}`} query={recordSearch} count={visibleRows.length} total={rows.length} disabled={busy} onSearch={value=>recordSearch=value} />
  {#if recordSearch.trim()&&!visibleRows.length}<p class="notice">No saved {labels[kind].toLowerCase()} match this search. Clear the search to see all records. Your editor stays open.</p>{/if}
  <div class="record-picker"><label>Saved {labels[kind].toLowerCase()}<select value={selectedId} disabled={busy} onchange={e=>{if(!select(e.currentTarget.value))e.currentTarget.value=selectedId;}}><option value="">New {kind}</option>{#if selectionOutsideSearch&&selectedRow}<option value={selectedId}>Editing: {label(selectedRow)} (outside search)</option>{/if}{#each visibleRows as row}<option value={row.id}>{label(row)}</option>{/each}</select></label><button disabled={busy} onclick={()=>select('')}>Add {kind}</button></div>
  {#if kind==='item'}<InventoryTree canon={story.canon} {selectedId} disabled={busy} query={recordSearch} showSearch={false} onSelect={select} />{/if}
  <form aria-label={`${kind} editor`} onsubmit={e=>{e.preventDefault();save();}}><fieldset disabled={busy||splitOpen}>
    <h2>{isNew?`New ${kind}`:`Edit ${kind}`}</h2>
    {#if kind==='character'}
      <div class="form-grid"><label>Name<input bind:value={draft.name} required maxlength="120" /></label><label>Role<input bind:value={draft.role} maxlength="120" /></label></div>
      <CharacterProfileEditor value={draft} onChange={v=>Object.assign(draft,v)} />
      <label>Location<select bind:value={draft.locationId}>{#each story.canon.places as p}<option value={p.id}>{p.name}</option>{/each}</select></label>
      <label class="check"><input type="checkbox" bind:checked={draft.pinnedAppearance} />Pin appearance & outfit</label><label class="check"><input type="checkbox" bind:checked={draft.noNsfw} />No NSFW</label>
    {:else if kind==='place'}
      <label>Name<input bind:value={draft.name} required maxlength="200" /></label><label>Description<textarea bind:value={draft.description} maxlength="40000"></textarea></label>
      <label>Visual description<textarea bind:value={draft.visualDescription} maxlength="4000" placeholder="Layout, materials, colors and recurring visible details"></textarea></label><p class="muted">Optional picture details, separate from the place’s history or narrative role.</p>
      <label>Inside / located at<select bind:value={draft.parentId}><option value={null}>Independent place</option>{#each story.canon.places.filter(p=>p.id!==draft.id) as p}<option value={p.id}>{p.name}</option>{/each}</select></label>
      <p class="muted">Ships can contain rooms and move between destinations. Moving a parent carries its rooms; circular containment is refused.</p>
    {:else if kind==='item'}
      <label>Name<input bind:value={draft.name} required maxlength="200" /></label><label>Description<textarea bind:value={draft.description} maxlength="40000"></textarea></label>
      <label>Visual description<textarea bind:value={draft.visualDescription} maxlength="4000" placeholder="Shape, materials, colors, scale and distinguishing details"></textarea></label><p class="muted">Optional picture details, separate from the item’s purpose or history.</p>
      <label class="check"><input type="checkbox" bind:checked={draft.isContainer} disabled={draft.unlimited||contents.length>0||draft.quantity!==1} />Container</label>
      <label class="check"><input type="checkbox" checked={draft.unlimited} disabled={draft.isContainer||contents.length>0} onchange={event=>{draft.unlimited=event.currentTarget.checked;if(draft.unlimited){draft.quantity=1;draft.equipped=false;}}} />Always available (unlimited supply)</label>
      <p class="muted">An always available supply does not run out through ordinary use. Its holder and location still apply; portions taken elsewhere are counted items. This option is saved explicitly and is never enabled by narration or AI corrections.</p>
      <p class="muted">Bags, crates and other containers hold items and can fit inside another container. Each container is a single item; moving it carries its contents.</p>
      {#if draft.quantity!==1}<p class="muted">Containers have quantity 1. Split a saved stack first, or set a new record’s quantity to 1.</p>{/if}
      <div class="form-grid"><label>Quantity<input type="number" min="1" max="1000000" step="1" bind:value={draft.quantity} disabled={draft.isContainer||draft.unlimited} required /></label><label>Owner / storage<select aria-label="Owner / storage" bind:value={draft.ownerId} onchange={()=>draft.equipped=false}>{#each holders as h}<option value={h.id}>{h.name}</option>{/each}</select></label></div>
      <label class="check"><input type="checkbox" bind:checked={draft.equipped} disabled={!ownerIsPerson||draft.unlimited} />Equipped / worn</label><p class="muted">Quantities count whole items. Only items held directly by a cast member can be equipped. Stored items stay with their container.</p>
      {#if savedItem}<p class="muted">Saved location: {inventoryPath(story.canon,savedItem.ownerId)}{#if rootOwner&&rootOwner!==savedItem.ownerId}. Held by {inventoryPath(story.canon,rootOwner)}{/if}.</p>{/if}
      {#if draft.isContainer||contents.length}
        <div class="container-contents" aria-label="Container contents"><h3>Contents</h3>{#if contents.length}<ul>{#each contents as item (item.id)}<li><button type="button" onclick={()=>select(item.id)}>{item.name}{item.unlimited?' · Always available':` × ${item.quantity}`}{item.isContainer?' · container':''}</button></li>{/each}</ul><p class="muted">Move these items before removing this container or turning off Container.</p>{:else}<p class="muted">Empty. To put something here, open that item and choose this container under Owner / storage.</p>{/if}</div>
      {/if}
    {:else if kind==='relationship'}
      {#if story.canon.characters.length<2}<p class="notice">Add a second cast member before creating a relationship.</p>{/if}
      <div class="form-grid"><label>From<select bind:value={draft.fromId} onchange={event=>{if(event.currentTarget.value===draft.toId)draft.toId='';}} required>{#each story.canon.characters as c}<option value={c.id}>{c.name}</option>{/each}</select></label><label>To<select bind:value={draft.toId} required><option value="">Choose a cast member</option>{#each story.canon.characters.filter(c=>c.id!==draft.fromId) as c}<option value={c.id}>{c.name}</option>{/each}</select></label></div>
      <label>Relationship notes<textarea bind:value={draft.notes} maxlength="40000"></textarea></label><p class="muted">Relationships are directional: “A trusts B” does not automatically mean B trusts A.</p>
    {:else}
      <label>Title<input bind:value={draft.title} required maxlength="200" /></label><label>Thread notes<textarea bind:value={draft.notes} maxlength="40000"></textarea></label><label>Status<select bind:value={draft.status}><option value="open">Open</option><option value="resolved">Resolved</option></select></label>
    {/if}
    <div class="row"><button class="primary" disabled={!dirty||(kind==='relationship'&&story.canon.characters.length<2)}>{isNew?'Create record':'Save record'}</button><button type="button" onclick={reload}>Reload saved record</button>{#if !isNew}<button class="danger" type="button" onclick={remove}>Remove record</button>{/if}</div>
    <p class="muted">{dirty?'Unsaved record changes.':isNew?'Fill in the new record.':'Saved record loaded.'}</p>
  </fieldset></form>
  {#if kind==='item'&&savedItem}
    <section class="split-stack" aria-label="Split stack">
      <h2>Split stack</h2>
      {#if splitOpen}
        <p class="muted">Split {savedItem.name} into two records with the same name and description. The new stack will be unequipped. {savedItem.quantity} items are currently in the saved stack.</p>
        <form aria-label="Split item stack" onsubmit={e=>{e.preventDefault();split();}}><fieldset disabled={busy}>
          <div class="form-grid"><label>Quantity to split<input type="number" min="1" max={savedItem.quantity-1} step="1" bind:value={splitQuantity} required /></label><label>Destination<select aria-label="Destination" bind:value={splitOwnerId} required>{#each holders as holder}<option value={holder.id}>{holder.name}</option>{/each}</select></label></div>
          <p class="muted">{Number.isInteger(splitQuantity)&&splitQuantity>0&&splitQuantity<savedItem.quantity?`${savedItem.quantity-splitQuantity} will remain in the original stack.`:'Choose a whole quantity that leaves at least one item in the original stack.'}</p>
          <div class="row"><button class="primary" disabled={dirty||aiDirty||!Number.isInteger(splitQuantity)||splitQuantity<1||splitQuantity>=savedItem.quantity}>Split and save</button><button type="button" onclick={()=>{splitOpen=false;splitQuantity=1;splitOwnerId=savedItem?.ownerId||'';}}>Discard split</button></div>
        </fieldset></form>
      {:else}
        <p class="muted">{savedItem.unlimited?'Always available supplies do not need splitting.':savedItem.isContainer?'Containers cannot be split. Create another container and move items into it.':savedItem.quantity<2?'This stack needs at least two items before it can be split.':dirty||aiDirty?'Save or discard the record fields and AI correction draft before splitting.':'Move part of this stack to a cast member, place or container while preserving its total quantity.'}</p>
        <button type="button" disabled={busy||dirty||aiDirty||!canSplit} onclick={openSplit}>Split this stack</button>
      {/if}
    </section>
  {/if}
  {#if note}<p role="status" class="muted">{note}</p>{/if}
  {#key `${kind}:${selectedId}:${aiSession}`}<StoryCorrections {story} passageId={story.passages.at(-1)!.id} mode="record" recordKind={kind} targetId={selectedId} {canGenerate} bind:busy disabled={dirty||splitOpen} blockedReason="Save or reload the record fields, and finish or discard any stack split, before requesting AI changes. AI works from saved records and will not silently save manual edits." onSaved={correctionsSaved} onDirty={value=>aiDirty=value} />{/key}
</main>

<style>
  .container-contents{margin:18px 0;padding:16px;background:var(--panel);border-radius:6px;overflow-wrap:anywhere}.container-contents ul{list-style:none;padding:0;margin:8px 0}.container-contents button{text-align:left;margin:3px 0}.container-contents p{margin:8px 0 0}
  .split-stack{margin:24px 0;padding:20px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}.split-stack h2{font-size:23px}.split-stack fieldset{margin-bottom:0}.split-stack p{overflow-wrap:anywhere}
</style>
