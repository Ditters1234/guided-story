import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';

const config=JSON.parse(readFileSync('config/connections.play.local.json','utf8'));
const endpoint=config.images.baseUrl.replace(/\/$/,'');
const directory=resolve('test-results/sickollie-settings');
mkdirSync(directory,{recursive:true});
const prompt='A painterly cinematic scene in a quiet railway waiting room. Exactly two adult travelers: on the left, a gray-haired middle-aged man in a navy coat sits holding a closed brown suitcase; on the right, an adult woman with short auburn hair and a dark green jacket stands holding a white paper ticket. Both are fully clothed. Clear faces and hands, distinct clothing, natural proportions. Wooden benches, a tall window, warm afternoon light, muted colors. One coherent moment, no lettering.';
const seed=24601,results=[];
const request=async(path,options={})=>{
  const response=await fetch(endpoint+path,{...options,signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error(`${path}: HTTP ${response.status} ${await response.text()}`);
  return response.json();
};
const queue=await request('/queue');
if(queue.queue_running?.length||queue.queue_pending?.length)throw new Error('ComfyUI has existing work; comparison did not enqueue or interrupt anything.');
for(const candidate of [{label:'8-simple',steps:8,scheduler:'simple'},{label:'9-beta',steps:9,scheduler:'beta'}]){
  const graph=JSON.parse(readFileSync(config.images.workflow,'utf8'));
  graph['4'].inputs.text=prompt;
  Object.assign(graph['6'].inputs,{width:896,height:1152,batch_size:1});
  Object.assign(graph['7'].inputs,{seed,steps:candidate.steps,cfg:1,sampler_name:'euler',scheduler:candidate.scheduler});
  graph['9'].inputs.filename_prefix='Storyweaver/settings-comparison/'+candidate.label;
  const started=Date.now();
  const queued=await request('/prompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:graph,client_id:'storyweaver-settings-comparison'})});
  if(!queued.prompt_id)throw new Error(JSON.stringify(queued));
  console.log('Queued '+candidate.label+' '+queued.prompt_id);
  let history;
  while(Date.now()-started<720000){
    const response=await request('/history/'+encodeURIComponent(queued.prompt_id));
    history=response[queued.prompt_id];
    if(history?.status?.status_str==='error')throw new Error(JSON.stringify(history.status));
    if(history?.outputs?.['9']?.images?.length)break;
    await new Promise(r=>setTimeout(r,2000));
  }
  const output=history?.outputs?.['9']?.images?.[0];
  if(!output)throw new Error('Comparison timed out; inspect ComfyUI history before retrying.');
  const url=new URL(endpoint+'/view');
  for(const key of ['filename','subfolder','type'])if(output[key])url.searchParams.set(key,output[key]);
  const response=await fetch(url,{signal:AbortSignal.timeout(30000)});
  assert.equal(response.ok,true);
  const image=resolve(directory,candidate.label+'.png');
  writeFileSync(image,Buffer.from(await response.arrayBuffer()));
  results.push({...candidate,seed,width:896,height:1152,cfg:1,sampler:'euler',elapsedMs:Date.now()-started,image,promptId:queued.prompt_id});
  writeFileSync(resolve(directory,'comparison.json'),JSON.stringify({prompt,results},null,2)+'\n');
  console.log('Completed '+candidate.label+' in '+results.at(-1).elapsedMs+'ms: '+image);
}
