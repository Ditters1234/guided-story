<script lang="ts">
  import type { WorkflowInspection } from './server/story-workflow/inspection';
  import { workflowNodeName } from './story-workflow/presentation';
  let {inspection,selected,onSelect}:{inspection:WorkflowInspection;selected:string;onSelect:(id:string)=>void}=$props();
  const main=['source','prepare','preflight','narrate','length','expand','content','retain','extraction-preflight','extract','validate','review','repair-input','repair','revalidate','rereview','acceptance','commit'];
  function position(id:string){const model=inspection.nodes.filter(node=>node.type==='model').findIndex(node=>node.id===id);if(model>=0)return {x:20,y:model*114+22};if(id==='blocked')return {x:530,y:16*114+22};const stage=main.indexOf(id);return stage>=0?{x:255,y:stage*114+22}:{x:530,y:Math.max(0,inspection.nodes.filter(node=>node.type!=='model'&&!main.includes(node.id)&&node.id!=='blocked').findIndex(node=>node.id===id))*114+22};}
  const edgeType=(node:string,port:string)=>inspection.nodes.find(n=>n.id===node)?.outputs[port]?.type??'unknown';
  function path(from:string,to:string){const a=position(from),b=position(to),x=a.x+100,y=a.y+66,xx=b.x+100,yy=b.y;return `M${x},${y} C${x},${y+32} ${xx},${yy-32} ${xx},${yy}`;}
</script>
<!-- svelte-ignore a11y_no_noninteractive_tabindex (The scrollable diagram needs keyboard scrolling; individual stages are buttons.) -->
<div class="graph-scroll" role="region" aria-label="Read-only workflow diagram" tabindex="0">
  <div class="graph">
    <svg viewBox="0 0 770 2080" aria-hidden="true"><defs><marker id="workflow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" /></marker></defs>
      {#each inspection.definition.edges as edge}<path class:connected={edge.from.node===selected||edge.to.node===selected} d={path(edge.from.node,edge.to.node)} marker-end="url(#workflow-arrow)"><title>{edge.from.node}.{edge.from.port} → {edge.to.node}.{edge.to.port} · {edgeType(edge.from.node,edge.from.port)}</title></path>{/each}
    </svg>
    {#each inspection.nodes as node}<button type="button" class:selected={node.id===selected} style:left={`${position(node.id).x}px`} style:top={`${position(node.id).y}px`} aria-pressed={node.id===selected} onclick={()=>onSelect(node.id)}><strong>{workflowNodeName(node.id)}</strong><span>{node.status.replaceAll('-',' ')}</span></button>{/each}
  </div>
</div>
<p class="muted">Select a stage to highlight its connections. Typed input/output connections also appear in the inspector. The diagram is read-only; scroll inside it or use the stage list.</p>
<style>
  .graph-scroll{max-height:510px;overflow:auto;border:1px solid var(--line,#bbb);border-radius:10px;background:var(--paper,#fff)}.graph{width:770px;height:2080px;position:relative}.graph svg{position:absolute;inset:0;width:770px;height:2080px}.graph svg>path{fill:none;stroke:#a6a9a6;stroke-width:1.4;opacity:.35}.graph svg>path.connected{stroke:#385f57;stroke-width:2.7;opacity:1}.graph marker path{fill:#65726d}.graph button{position:absolute;width:200px;min-height:66px;display:grid;text-align:left;gap:4px;font-size:.82rem;background:var(--paper,#fff);border:1px solid #aaa}.graph button.selected{border:2px solid #385f57}.graph span{font-size:.75rem;text-transform:capitalize}
</style>
