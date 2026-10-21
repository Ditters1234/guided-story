import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { StoryRepository } from '../src/lib/server/repository';
import { blankSetupPlan } from '../src/lib/setup';
import { connectionSchema } from '../src/lib/server/connections';
import { passageContentSchema } from '../src/lib/passage-proposal';

export const workflowSettings = () => connectionSchema.parse({...JSON.parse(readFileSync('config/connections.example.json','utf8')),text:{baseUrl:'http://localhost:9999/v1',model:'controlled-workflow',temperature:0.8,maxTokens:4096,contextTokens:32000,structuredOutput:'prompt',apiKey:'test-credential-never-persist'}});
export const quiet = Array(12).fill('Alex listened to the rain and considered the quiet morning ahead.').join(' ');
export const scene = (inventory=false) => ({title:'Rain',chapterTitle:'Morning',viewpointId:'alex',endOfChapter:false,paragraphs:[inventory?'Alex gave two Sugar Cubes to the pony. '+quiet:quiet]});
export const memory = {summary:'Alex spent a quiet morning at the stable.',facts:[],openQuestions:[],characterIds:['alex'],locationIds:['stable']};
export function workflowSetupFixture(path=':memory:', quantity=3) {
  const repository=new StoryRepository(path),draft=repository.createSetup({premise:'A quiet morning.',castSize:1,preferences:{passageWords:100}},randomUUID()),plan=blankSetupPlan();
  plan.title='Workflow test';plan.chapterTitle='Morning';plan.canon.places=[{id:'stable',name:'Stable',parentId:null,description:'A quiet stable.'}];
  Object.assign(plan.canon.characters[0],{id:'alex',name:'Alex',locationId:'stable'});
  plan.canon.items=[{id:'sugar',name:'Sugar Cubes',description:'Counted individual cubes in a tin.',ownerId:'alex',quantity,equipped:false}];
  plan.context.sceneBrief={...plan.context.sceneBrief,purpose:'Listen to the rain.',viewpointId:'alex',locationId:'stable',castIds:['alex']};
  const setup=repository.saveSetup(draft.id,{expectedRevision:0,requestId:randomUUID(),input:draft.input,plan});
  return {repository,setup};
}
export function workflowFixture(path=':memory:', quantity=3) {
  const {repository,setup}=workflowSetupFixture(path,quantity);
  const content=passageContentSchema.parse({mode:'continue',direction:'',draft:{...scene(),startsChapter:true}});
  const story=repository.commitOpening(setup.id,setup.revision,randomUUID(),'seed',{...content,effects:[],memory});
  return {repository,story};
}
export function scriptedProvider(options:{inventory?:boolean;short?:boolean;effects?:unknown[];repairedEffects?:unknown[];reviews?:boolean[];malformed?:boolean;before?:(stage:string,body:Record<string,any>)=>void|Promise<void>}={}) {
  const requests:Record<string,any>[]=[],stages:string[]=[];let reviews=0;
  const fetcher:typeof fetch=async(_url,init)=>{
    const body=JSON.parse(String(init!.body)),system=body.messages[0].content;
    const stage=system.startsWith('Review inventory consistency.')?'review':system.startsWith('Return {effects:')?(body.messages.some((m:{content:string})=>m.content.includes('Correct the extracted effects and memory'))?'repair':'extract'):body.messages.some((m:{content:string})=>m.content.startsWith('The draft is only'))?'expand':'narrate';
    requests.push(body);stages.push(stage);await options.before?.(stage,body);
    const value=stage==='review'?{consistent:options.reviews?.[reviews++]??true,issues:options.reviews?.[reviews-1]===false?['The inventory and prose disagree.']:[]}:
      stage==='extract'||stage==='repair'?options.malformed?'{broken effects':{effects:stage==='repair'?(options.repairedEffects??options.effects??[]):(options.effects??[]),memory}:
      stage==='narrate'&&options.short?{...scene(options.inventory),paragraphs:['Alex watched the rain.']}:scene(options.inventory);
    return new Response(JSON.stringify({choices:[{message:{content:typeof value==='string'?value:JSON.stringify(value)},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:40}}));
  };
  return {fetcher,requests,stages};
}
export const generationInput = (revision:number) => ({expectedRevision:revision,requestId:randomUUID(),direction:'Listen to the rain.',chapterEnding:'auto' as const});
export const effect = {type:'item.quantity',itemId:'sugar',expectedQuantity:3,quantity:1,evidenceId:'source-0'};
