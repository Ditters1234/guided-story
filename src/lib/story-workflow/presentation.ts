export const workflowNodeNames:Record<string,string> = {
  source:'Saved source',model:'Text model',prepare:'Prepare passage',preflight:'Narration context and budget',narrate:'Write prose',length:'Check length',expand:'Expand short prose',content:'Complete prose',retain:'Retain prose',
  'extraction-preflight':'World-update context and budget',extract:'Extract world updates',validate:'Validate updates',review:'Review inventory', 'repair-input':'Choose repair branch',repair:'Repair once',revalidate:'Validate repaired updates',rereview:'Review repaired inventory',acceptance:'Acceptance policy',commit:'Atomic save',blocked:'Retain unresolved draft'
};
export const workflowNodeName=(id:string)=>Object.hasOwn(workflowNodeNames,id)?workflowNodeNames[id]:id;
export const workflowModeName=(mode:string)=>mode==='opening'?'Opening':mode==='replace'?'Latest rewrite':'Continuation';
