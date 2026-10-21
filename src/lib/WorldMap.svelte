<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { Canon } from './story';
  import type { ContextData } from './context-types';
  import { buildWorldMap, emptyWorldLayout, focusExpansion, projectWorldMap, readWorldLayout, sceneFocus, worldPath, type WorldNode } from './world-map';
  let {canon,context,layoutKey,viewpointId,selected='',disabled=false,referenceDisabled=false,onSelect,onReference}: {
    canon:Canon;context:ContextData;layoutKey:string;viewpointId?:string;selected?:string;disabled?:boolean;referenceDisabled?:boolean;
    onSelect:(node:WorldNode)=>void;onReference:(node:WorldNode)=>void;
  }=$props();
  const model=$derived(buildWorldMap(canon,context));
  let layout=$state(emptyWorldLayout()),query=$state(''),focus=$state<string|null>(null),hidden=$state(false),limit=$state(120),referenceLimit=$state(30),note=$state('');
  let viewport=$state<HTMLDivElement>();
  const expanded=$derived(new Set(layout.expanded));
  const projection=$derived(projectWorldMap(model,expanded,{query,focus,hidden,limit}));
  const chosen=$derived(model.nodes.get(selected));
  const related=$derived((chosen?model.related.get(chosen.id)??[]:[]).map(key=>model.nodes.get(key)!).filter(node=>hidden||!node.hidden));
  const references=$derived(query.trim()?projection.referenceMatches:[...model.nodes.values()].filter(node=>!['place','character','item'].includes(node.kind)&&(hidden||!node.hidden)));
  const points=$derived(new Map(projection.rows.map((row,index)=>{const saved=layout.positions.find(p=>p.key===row.node.key);return [row.node.key,{x:saved?.x??row.depth*280+20,y:saved?.y??index*140+20}];})));
  const width=$derived(Math.max(320,...[...points.values()].map(p=>p.x+274))),height=$derived(Math.max(180,...[...points.values()].map(p=>p.y+140)));
  const storageKey=$derived(`guided-story-world-layout-v1:${layoutKey}`);
  onMount(()=>{try{layout=readWorldLayout(JSON.parse(localStorage.getItem(storageKey)??'null'),model);}catch{note='Saved layout is unavailable. The world records are still available.';}});
  function persist(){try{localStorage.setItem(storageKey,JSON.stringify(layout));note='Layout saved in this browser.';}catch{note='Layout could not be saved in this browser. World records are unaffected.';}}
  function toggle(key:string){layout.expanded=expanded.has(key)?layout.expanded.filter(id=>id!==key):[...layout.expanded,key];persist();}
  async function focusScene(){const key=sceneFocus(model,viewpointId);if(!key){note='Choose a saved scene location or viewpoint first.';return;}query='';focus=key;layout.expanded=[...focusExpansion(model,key)];limit=120;persist();await tick();const point=points.get(key);if(point)viewport?.scrollTo({left:Math.max(0,point.x-24),top:Math.max(0,point.y-24)});}
  function move(key:string,x:number,y:number,save=true){const position={key,x:Math.min(50000,Math.max(0,x)),y:Math.min(50000,Math.max(0,y))};layout.positions=[...layout.positions.filter(p=>p.key!==key),position];if(save)persist();}
  let drag:{key:string;startX:number;startY:number;x:number;y:number}|null=null;
  function dragStart(event:PointerEvent,key:string){if(event.button!==0||disabled)return;const point=points.get(key)!;drag={key,startX:event.clientX,startY:event.clientY,...point};event.currentTarget instanceof HTMLElement&&event.currentTarget.setPointerCapture(event.pointerId);event.preventDefault();}
  function dragMove(event:PointerEvent){if(drag)move(drag.key,drag.x+event.clientX-drag.startX,drag.y+event.clientY-drag.startY,false);}
  function dragEnd(){if(drag){drag=null;persist();}}
  function moveKey(event:KeyboardEvent,key:string){const delta=({ArrowLeft:[-20,0],ArrowRight:[20,0],ArrowUp:[0,-20],ArrowDown:[0,20]} as Record<string,number[]>)[event.key];if(!delta)return;event.preventDefault();const point=points.get(key)!;move(key,point.x+delta[0],point.y+delta[1]);}
</script>

<section class="world-map" aria-label="Location-first world map">
  <h2>Saved world map</h2>
  <p class="muted">Expand locations into people, possessions and containers. Lines show physical links; related background and future tasks appear separately. Immediate storage does not establish legal ownership.</p>
  <label>Search saved world<input type="search" bind:value={query} oninput={()=>{limit=120;referenceLimit=30;focus=null;}} placeholder="Name, text, ID or physical path" /></label>
  <div class="map-tools">
    <button type="button" {disabled} onclick={focusScene}>Focus current scene</button>
    <button type="button" {disabled} onclick={()=>{focus=null;query='';layout.expanded=[];limit=120;persist();}}>Show root locations</button>
    <button type="button" aria-pressed={layout.mode==='diagram'} onclick={()=>{layout.mode='diagram';persist();}}>Diagram</button>
    <button type="button" aria-pressed={layout.mode==='list'} onclick={()=>{layout.mode='list';persist();}}>List</button>
    <button type="button" onclick={()=>{layout.positions=[];persist();}}>Reset positions</button>
  </div>
  <label class="check"><input type="checkbox" bind:checked={hidden} />Show hidden author background</label>
  <p class="muted">Inspecting or moving a card makes no model request and changes no world facts. Hidden author background does not establish viewpoint knowledge.</p>
  {#if note}<p class="muted" role="status">{note}</p>{/if}
  {#if focus}<p class="notice">Focused on {model.nodes.get(focus)?.name}. <button type="button" onclick={()=>focus=null}>Show all branches</button></p>{/if}
  <p class="muted">{projection.rows.length} of {projection.total} visible physical records{query.trim()?` · ${projection.matches.length} search matches`:''}. Roots begin collapsed.</p>
  {#if !projection.rows.length}<p class="notice">{query.trim()?'No physical records match. Check the references below or clear the search.':'No saved root locations.'}</p>{/if}
  {#if layout.mode==='diagram'}
    <p class="muted" id="world-layout-help">Drag a card’s Move button, or focus it and use arrow keys to move it. Positions are saved only in this browser. Use List for a compact view.</p>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex (the overflow viewport must support keyboard scrolling) -->
    <div class="map-viewport" bind:this={viewport} tabindex="0" role="region" aria-label="Scrollable world diagram">
      <div class="map-plane" style:width={`${width}px`} style:height={`${height}px`}>
        <svg width={width} height={height} aria-hidden="true">
          {#each projection.rows as row (row.node.key)}
            {@const from=row.node.parent?points.get(row.node.parent):undefined}{@const to=points.get(row.node.key)!}
            {#if from}<path d={`M ${from.x+248} ${from.y+60} H ${from.x+264} V ${to.y+60} H ${to.x}`} class={row.node.kind} />{/if}
          {/each}
        </svg>
        {#each projection.rows as row (row.node.key)}
          {@const point=points.get(row.node.key)!}
          <article class="map-card" class:selected={selected===row.node.key} data-world-key={row.node.key} style:left={`${point.x}px`} style:top={`${point.y}px`}>
            <div class="card-tools"><span>{row.node.kind}</span><button type="button" aria-label={`Move ${row.node.name} layout`} aria-describedby="world-layout-help" {disabled} onpointerdown={event=>dragStart(event,row.node.key)} onpointermove={dragMove} onpointerup={dragEnd} onpointercancel={dragEnd} onkeydown={event=>moveKey(event,row.node.key)}>Move</button></div>
            <button type="button" class="node-name" title={row.path} {disabled} aria-pressed={selected===row.node.key} onclick={()=>onSelect(row.node)}>{row.node.name}</button>
            <div class="connection">{row.node.connection}</div>
            {#if row.hasChildren}<button type="button" class="expand" aria-label={`${row.open?'Collapse':'Expand'} ${row.node.name}`} aria-expanded={row.open} onclick={()=>toggle(row.node.key)}>{row.open?'− Collapse':'+ Expand'} · {model.children.get(row.node.key)?.length}</button>{/if}
          </article>
        {/each}
      </div>
    </div>
  {:else}
    <ul class="map-list" aria-label="Physical world records">
      {#each projection.rows as row (row.node.key)}<li style:padding-left={`${Math.min(row.depth,6)*12}px`} data-world-key={row.node.key}>
        <div class="list-record">{#if row.hasChildren}<button type="button" aria-label={`${row.open?'Collapse':'Expand'} ${row.node.name}`} aria-expanded={row.open} onclick={()=>toggle(row.node.key)}>{row.open?'−':'+'}</button>{/if}<button type="button" class="list-name" {disabled} aria-pressed={selected===row.node.key} onclick={()=>onSelect(row.node)}>{row.node.name}</button></div>
        <small>{row.node.kind} · {row.node.connection}{row.node.parent?` ${model.nodes.get(row.node.parent)?.name}`:''}</small>
      </li>{/each}
    </ul>
  {/if}
  {#if projection.total>limit}<button type="button" onclick={()=>limit+=120}>Show 120 more physical records</button>{/if}
  {#if chosen}<section class="selected-record" aria-label="Selected world record"><h3>{chosen.name}</h3><p>{chosen.connection}{chosen.parent?` ${model.nodes.get(chosen.parent)?.name}`:''}</p><p class="muted">{worldPath(model,chosen.key).map(node=>node.name).join(' / ')}</p><p class="muted">{chosen.tags.join(' · ')}{chosen.hidden?'Hidden author background · excluded from narration':''}</p>
    <button type="button" disabled={disabled||referenceDisabled||chosen.hidden||model.sceneReferences.includes(chosen.key)} onclick={()=>onReference(chosen)}>{model.sceneReferences.includes(chosen.key)?'Already a scene reference':'Add to scene references'}</button>
    <p class="muted">This explicit action adds a bounded context hint. It does not move records, summon cast, supply stock or grant viewpoint knowledge. Remove hints in the scene brief.</p>
    <h3>Related references</h3><ul class="reference-list">{#each related as node (node.key)}<li><button type="button" {disabled} onclick={()=>onSelect(node)}>{node.name}</button><small>{node.connection}{node.hidden?' · Hidden author background':''}</small></li>{:else}<li>No explicit related links.</li>{/each}</ul>
  </section>{/if}
  <details class="reference-section"><summary>Saved scene references · {model.sceneReferences.length}</summary><ul class="reference-list">{#each model.sceneReferences as key (key)}{@const node=model.nodes.get(key)!}{#if hidden||!node.hidden}<li><button type="button" {disabled} onclick={()=>onSelect(node)}>{node.name}</button><small>Scene context hint · {node.kind}</small></li>{/if}{/each}</ul></details>
  <details class="reference-section" open={Boolean(query.trim())}><summary>Background, relationships &amp; future tasks · {references.length}</summary><p class="muted">Explicit author references. These links do not imply physical presence or completed events. Multiple references open the same saved record.</p><ul class="reference-list">
    {#each references.slice(0,referenceLimit) as node (node.key)}<li><button type="button" {disabled} aria-pressed={selected===node.key} onclick={()=>onSelect(node)}>{node.name}</button><small>{node.connection}{node.hidden?' · Hidden author background':''}</small></li>{:else}<li>No matching references.</li>{/each}
    </ul>{#if references.length>referenceLimit}<button type="button" onclick={()=>referenceLimit+=30}>Show 30 more references</button>{/if}</details>
</section>

<style>
  .world-map{min-width:0}.map-tools{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.map-tools button[aria-pressed=true],button[aria-pressed=true]{border-color:var(--accent);background:var(--panel)}
  .map-viewport{max-width:100%;height:520px;overflow:auto;border:1px solid var(--line);border-radius:8px;background:var(--bg);overscroll-behavior:contain}.map-plane{position:relative}.map-plane svg{position:absolute;inset:0;pointer-events:none}.map-plane path{fill:none;stroke:var(--muted);stroke-width:2}.map-plane path.character{stroke-dasharray:7 4}.map-plane path.item{stroke-dasharray:2 4}
  .map-card{position:absolute;width:248px;height:124px;padding:8px 12px;box-sizing:border-box;border:1px solid var(--line);border-radius:8px;background:var(--panel);display:flex;flex-direction:column;gap:2px}.map-card.selected{outline:2px solid var(--accent)}.card-tools{display:flex;align-items:center;justify-content:space-between;font-size:11px;color:var(--muted)}.card-tools button{padding:2px 7px;font-size:11px;touch-action:none;cursor:move}.node-name{padding:0;border:0;text-align:left;font-weight:600;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;flex-shrink:0}.connection{font-size:11px;color:var(--muted)}.expand{font-size:12px;padding:2px 6px;align-self:start}
  .map-list,.reference-list{list-style:none;padding:0;margin:12px 0}.map-list li{padding:8px 0;border-bottom:1px solid var(--line);overflow-wrap:anywhere}.list-record{display:flex;align-items:start;gap:6px}.list-name{min-width:0;text-align:left;overflow-wrap:anywhere}.map-list small,.reference-list small{display:block;color:var(--muted);margin:4px 0}.reference-list li{margin:10px 0;overflow-wrap:anywhere}.reference-list button{max-width:100%;text-align:left;overflow-wrap:anywhere}.selected-record,.reference-section{padding:14px 0;border-top:1px solid var(--line);margin-top:18px;overflow-wrap:anywhere}h3{font-size:16px}summary{cursor:pointer}
  @media(max-width:600px){.map-viewport{height:380px}.map-tools button{flex:1 1 auto}}
</style>
