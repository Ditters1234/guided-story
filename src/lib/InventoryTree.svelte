<script lang="ts">
  import type { Canon } from './story';
  import { inventoryPath } from './inventory';
  import RecordSearch from './RecordSearch.svelte';
  let {canon,selectedId='',disabled=false,query=$bindable(''),showSearch=true,onSelect}: {
    canon:Canon;selectedId?:string;disabled?:boolean;query?:string;showSearch?:boolean;onSelect:(id:string)=>unknown;
  }=$props();
  let expanded=$state(true),browserElement:HTMLElement;
  function toggleHolders(open:boolean){expanded=open;browserElement?.querySelectorAll('details').forEach(details=>details.open=open);}
  const matches=$derived.by(()=>{
    const search=query.trim().toLocaleLowerCase();
    return new Set(canon.items.filter(item=>!search||[JSON.stringify(item),inventoryPath(canon,item.ownerId),item.unlimited?'always available unlimited supply':'',item.isContainer?'container':'',item.equipped?'worn equipped':''].join(' ').toLocaleLowerCase().includes(search)).map(item=>item.id));
  });
  const visible=$derived.by(()=>{
    const ids=new Set(matches),items=new Map(canon.items.map(item=>[item.id,item]));
    for(const id of matches){let owner=items.get(id)?.ownerId;const seen=new Set<string>();while(owner&&items.has(owner)&&!seen.has(owner)){seen.add(owner);ids.add(owner);owner=items.get(owner)?.ownerId;}}
    return ids;
  });
  const groups=$derived.by(()=>{
    const children=new Map<string,Canon['items']>();
    for(const item of canon.items){const list=children.get(item.ownerId)||[];list.push(item);children.set(item.ownerId,list);}
    return [...canon.characters,...canon.places].flatMap(holder=>{
      const rootItems=children.get(holder.id);
      if(!rootItems?.length)return [];
      const entries:{item:Canon['items'][number];depth:number;contents:number;path:string}[]=[];
      const stack=rootItems.slice().reverse().map(item=>({item,depth:0})),seen=new Set<string>();
      while(stack.length){
        const entry=stack.pop()!;if(seen.has(entry.item.id))continue;seen.add(entry.item.id);
        const contents=children.get(entry.item.id)||[];
        entries.push({...entry,contents:contents.length,path:inventoryPath(canon,entry.item.ownerId)});
        for(const item of contents.slice().reverse())stack.push({item,depth:entry.depth+1});
      }
      const filtered=entries.filter(entry=>visible.has(entry.item.id));
      return filtered.length?[{id:holder.id,name:holder.name,entries:filtered}]:[];
    });
  });
</script>

<section class="inventory-browser" aria-label="Inventory browser" bind:this={browserElement}>
  <h2>Inventory browser</h2>
  <p class="muted">Saved items, grouped by their holder. Open an item to edit it or move it into a bag, crate or other container.</p>
  {#if showSearch}<RecordSearch label="Search inventory" {query} count={matches.size} total={canon.items.length} {disabled} onSearch={value=>query=value} />{/if}
  {#if canon.items.length}<div class="inventory-actions"><button type="button" {disabled} onclick={()=>toggleHolders(true)}>Expand holders</button><button type="button" {disabled} onclick={()=>toggleHolders(false)}>Collapse holders</button></div>{/if}
  {#if !groups.length}<p class="muted">{query.trim()?'No items match. Search a name, description, holder or storage path, or clear the search.':'No saved items yet. Add an item above to choose its holder and quantity.'}</p>{/if}
  {#if query.trim()&&groups.length}<p class="muted">Matching items and their container paths are shown. Other container contents stay hidden.</p>{/if}
  {#each groups as group (group.id)}
    <details open={Boolean(query.trim())||expanded}>
      <summary>{group.name} <span class="muted">· {group.entries.length} {group.entries.length===1?'record':'records'}</span></summary>
      <ul>
        {#each group.entries as {item,depth,contents,path} (item.id)}
          <li style:padding-inline-start={`${Math.min(depth,6)*14}px`}>
            <button type="button" class:selected={selectedId===item.id} aria-current={selectedId===item.id?'true':undefined} aria-label={`Edit ${item.name}`} title={path} {disabled} onclick={()=>onSelect(item.id)}>
              <span>{depth>0?'↳ ':''}{item.name} <span class="muted">{item.unlimited?'Always available':`× ${item.quantity}`}{item.equipped?' · worn / equipped':''}</span></span>
              {#if item.isContainer}<small>Container · {contents} direct {contents===1?'item':'items'}{query.trim()&&!matches.has(item.id)?' · storage path':''}</small>{/if}
              {#if depth>0}<small>{path}</small>{/if}
            </button>
          </li>
        {/each}
      </ul>
    </details>
  {/each}
</section>

<style>
  .inventory-browser{padding:18px;background:var(--panel);border:1px solid var(--line);border-radius:8px;margin:22px 0;min-width:0}
  h2{font-size:20px;margin:0 0 8px}.inventory-browser>p{margin-bottom:12px}
  details{border-top:1px solid var(--line);padding:10px 0}summary{cursor:pointer;overflow-wrap:anywhere}
  .inventory-actions{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}.inventory-actions button{width:auto}
  ul{list-style:none;margin:8px 0 0;padding:0;max-height:360px;overflow:auto}li{min-width:0}
  button{width:100%;border-color:transparent;text-align:left;padding:7px 9px;overflow-wrap:anywhere;font-size:13px}
  button.selected{background:var(--page);border-color:var(--line);color:var(--accent)}small{display:block;font-size:11px;color:var(--muted)}
  @media(max-width:500px){.inventory-browser{padding:13px}button{padding:8px 6px}}
</style>
