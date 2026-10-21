<script lang="ts">
  import { onMount } from 'svelte';
  import type { WorkflowDefinition } from './story-workflow/contracts';
  import { supportedNode } from './story-workflow/presets';
  import { workflowNodeName } from './story-workflow/presentation';
  import { workflowGroups,nodeGroup,authorNodeHeight,authorPositions,readAuthorLayout,emptyAuthorLayout } from './story-workflow/authoring';
  let {graph,layoutKey,selected,fromNode,fromPort,toNode,toPort,canConnect=false,disabled=false,onSelect,onOutput,onInput,onConnect}:{graph:WorkflowDefinition;layoutKey:string;selected:string;fromNode:string;fromPort:string;toNode:string;toPort:string;canConnect?:boolean;disabled?:boolean;onSelect:(id:string)=>void;onOutput:(id:string,port:string)=>void;onInput:(id:string,port:string)=>void;onConnect:()=>void}=$props();
  let layout=$state(emptyAuthorLayout()),note=$state('');
  const points=$derived(authorPositions(graph,layout));
  const visible=$derived(graph.nodes.filter(n=>!layout.collapsed.includes(nodeGroup(n.type))));
  const width=$derived(Math.max(1340,...visible.map(n=>points.get(n.id)!.x+320))),height=$derived(Math.max(600,...visible.map(n=>points.get(n.id)!.y+authorNodeHeight(n.type)+30)));
  const storageKey=$derived(`guided-story-workflow-author-layout-v1:${layoutKey}`);
  onMount(()=>{try{layout=readAuthorLayout(JSON.parse(localStorage.getItem(storageKey)??'null'),graph);}catch{note='Browser layout unavailable. The typed editor remains available.';}});
  function persist(){try{localStorage.setItem(storageKey,JSON.stringify(layout));note='Workflow layout saved in this browser.';}catch{note='Layout could not be saved. The workflow draft is still available.';}}
  function move(id:string,x:number,y:number,save=true){layout.positions=[...layout.positions.filter(p=>p.id!==id),{id,x:Math.max(0,Math.min(10000,x)),y:Math.max(50,Math.min(30000,y))}];if(save)persist();}
  let drag:{id:string;x:number;y:number;startX:number;startY:number}|null=null;
  function start(event:PointerEvent,id:string){if(event.button!==0||disabled)return;drag={id,...points.get(id)!,startX:event.clientX,startY:event.clientY};(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);event.preventDefault();}
  function moving(event:PointerEvent){if(drag)move(drag.id,drag.x+event.clientX-drag.startX,drag.y+event.clientY-drag.startY,false);}
  function end(){if(drag){drag=null;persist();}}
  function key(event:KeyboardEvent,id:string){const delta=({ArrowLeft:[-20,0],ArrowRight:[20,0],ArrowUp:[0,-20],ArrowDown:[0,20]} as Record<string,number[]>)[event.key];if(!delta||disabled)return;event.preventDefault();const point=points.get(id)!;move(id,point.x+delta[0],point.y+delta[1]);}
  function path(from:string,to:string){const a=points.get(from),b=points.get(to);if(!a||!b)return '';return `M${a.x+290},${a.y+60} C${a.x+320},${a.y+60} ${b.x-25},${b.y+60} ${b.x},${b.y+60}`;}
</script>

<section aria-label="Visual workflow authoring" class="authoring">
  <h2>Workflow canvas</h2><p class="muted">Select a card to configure it below. Choose an output and a compatible input, then connect them. Move buttons support dragging and arrow keys. Presentation groups and positions stay in this browser; the typed node and connection lists remain available below.</p>
  <div class="row">{#each workflowGroups as group}<button type="button" {disabled} aria-expanded={!layout.collapsed.includes(group.id)} onclick={()=>{layout.collapsed=layout.collapsed.includes(group.id)?layout.collapsed.filter(id=>id!==group.id):[...layout.collapsed,group.id];persist();}}>{group.name}</button>{/each}<button type="button" {disabled} onclick={()=>{layout=emptyAuthorLayout();persist();}}>Reset workflow layout</button></div>
  <p role="status">{fromNode&&fromPort?`Output: ${fromNode}.${fromPort}`:'Choose an output'} · {toNode&&toPort?`Input: ${toNode}.${toPort}`:'Choose an input'}</p>
  <button type="button" disabled={disabled||!canConnect} onclick={onConnect}>Connect selected canvas ports</button>
  {#if note}<p class="muted" role="status">{note}</p>{/if}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (the scrollable canvas needs keyboard scrolling) -->
  <div class="viewport" tabindex="0" role="region" aria-label="Editable workflow diagram">
    <div class="plane" style:width={`${width}px`} style:height={`${height}px`}>
      <svg width={width} height={height} aria-hidden="true">{#each graph.edges as edge}{#if visible.some(n=>n.id===edge.from.node)&&visible.some(n=>n.id===edge.to.node)}<path class:chosen={edge.from.node===selected||edge.to.node===selected} d={path(edge.from.node,edge.to.node)}><title>{edge.from.node}.{edge.from.port} → {edge.to.node}.{edge.to.port}</title></path>{/if}{/each}</svg>
      {#each workflowGroups as group,index}<div class="group-label" style:left={`${20+index*330}px`}>{group.name} · {graph.nodes.filter(n=>nodeGroup(n.type)===group.id).length}{layout.collapsed.includes(group.id)?' · collapsed':''}</div>{/each}
      {#each visible as node (node.id)}{@const descriptor=supportedNode(node.type)}{@const point=points.get(node.id)!}
        <div class="card" class:selected={selected===node.id} style:left={`${point.x}px`} style:top={`${point.y}px`} style:height={`${authorNodeHeight(node.type)}px`}>
          <button type="button" class="select" aria-label={`Select workflow node ${node.id}`} aria-pressed={selected===node.id} {disabled} onclick={()=>onSelect(node.id)}><strong>{workflowNodeName(node.type)}</strong><small>{node.id}</small></button>
          <button type="button" class="move" aria-label={`Move workflow node ${node.id}`} {disabled} onpointerdown={event=>start(event,node.id)} onpointermove={moving} onpointerup={end} onpointercancel={end} onlostpointercapture={end} onkeydown={event=>key(event,node.id)}>Move ↔</button>
          {#each Object.entries(descriptor?.inputs??{}) as [port,type]}<button type="button" class="port input" class:chosen={toNode===node.id&&toPort===port} aria-label={`Input ${node.id}.${port}: ${type.type}`} {disabled} onclick={()=>onInput(node.id,port)}>← {port} · {type.type}</button>{/each}
          {#each Object.entries(descriptor?.outputs??{}) as [port,type]}<button type="button" class="port output" class:chosen={fromNode===node.id&&fromPort===port} aria-label={`Output ${node.id}.${port}: ${type.type}`} {disabled} onclick={()=>onOutput(node.id,port)}>{port} · {type.type} →</button>{/each}
        </div>
      {/each}
    </div>
  </div>
</section>

<style>
  .authoring{min-width:0}.viewport{max-height:620px;overflow:auto;border:1px solid var(--line,#aaa);border-radius:10px;margin-top:12px;background:var(--page,#fff)}.plane{position:relative}.plane svg{position:absolute;inset:0;pointer-events:none}.plane path{fill:none;stroke:#7e8d86;stroke-width:1.4;opacity:.45}.plane path.chosen{stroke:#385f57;stroke-width:3;opacity:1}.group-label{position:absolute;top:14px;width:290px;font-size:.85rem;font-weight:600}.card{position:absolute;width:290px;box-sizing:border-box;padding:10px;border:1px solid #88988f;border-radius:9px;background:var(--page,#fff);overflow:hidden}.card.selected{outline:2px solid var(--accent,#385f57)}.card button{box-sizing:border-box;white-space:normal}.select{border:0;background:transparent;display:block;text-align:left;width:100%;padding:0 0 6px;min-height:44px}.select small{display:block;color:var(--muted)}.move{font-size:.7rem;padding:3px 7px;touch-action:none;margin-bottom:6px}.port{display:block;width:100%;height:25px;min-height:25px;font-size:.7rem;padding:2px 5px;text-align:left;border:0;border-radius:3px}.output{text-align:right}.port.chosen{background:var(--panel,#e1ebe4);outline:1px solid var(--accent,#385f57)}
</style>
