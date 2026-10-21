// Run from the project root: node --import tsx exports/scoping-stress-test/generate.ts
// Creates portable fixtures only; never opens the user's library or calls a model.
import {mkdirSync,writeFileSync,readFileSync,existsSync,appendFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {zipSync,strToU8,unzipSync,strFromU8} from 'fflate';
import {normalizeCharacterProfile} from '../../src/lib/character-profile';
import {emptyContext} from '../../src/lib/context-types';
import {emptyFactPins} from '../../src/lib/fact-pins';
import {setupDraftSchema,setupStoryBase,validateSetupPlan} from '../../src/lib/setup';
import {validateStory,type Canon,type Story} from '../../src/lib/story';
import {encodeSetupArchive,decodeSetupArchive} from '../../src/lib/server/setup-archive';
import {previewContinuationContext} from '../../src/lib/server/story-generation';
import {connectionSchema} from '../../src/lib/server/connections';

const folder=resolve('exports/scoping-stress-test');mkdirSync(folder,{recursive:true});
const preservingBaseline=existsSync(resolve(folder,'baseline.json'));
const save=(name:string,value:unknown)=>writeFileSync(resolve(folder,name),JSON.stringify(value,null,2)+'\n');
const now=new Date().toISOString();
const title='The Ninth Bell of Brasswater';
const premise='In the tidal city of Brasswater, a municipal tide clock has lost its governor wheel hours before the storm gates must close. Captain Iris Vale and a divided salvage crew investigate from the docked airship Kestrel. Three competing institutions claim the missing wheel. The crew must establish who moved it, preserve evidence and keep ordinary life moving while a storm approaches. Travel takes time; messages and rumours do not move people or possessions. A name mentioned in conversation does not make its owner present.';
const placeRows:[string,string,string|null,string][]=[
 ['brasswater','Brasswater',null,'A tidal city linked by bridges and ferries.'],
 ['docks','Lower Docks','brasswater','The working waterfront; transit to the Archive takes twenty minutes.'],
 ['kestrel','Airship Kestrel','docks','Docked salvage airship. Ship-owned stores are separate from crew possessions.'],
 ['chartroom','Kestrel Chart Room','kestrel','A small table, speaking tube and tide charts; the current scene location.'],
 ['bridge','Kestrel Bridge','kestrel','Flight instruments and a locked helm; one deck above the chart room.'],
 ['engine','Kestrel Engine Room','kestrel','Two idle engines and a service bench.'],
 ['hold','Kestrel Cargo Hold','kestrel','Secured freight bays below the crew deck.'],
 ['locker','Kestrel Supply Locker','hold','Numbered drawers inside the cargo hold.'],
 ['galley','Kestrel Galley','kestrel','A kettle, shared table and dry food bins.'],
 ['cabins','Kestrel Crew Cabins','kestrel','Separate berths reached by a narrow passage.'],
 ['dockoffice','Dockmaster Office','docks','Manifests are signed here; records never automatically follow visitors.'],
 ['warehouse','Bonded Warehouse','docks','Customs storage beside the mooring tower.'],
 ['pier','North Pier','docks','Open waterfront beneath the Kestrel mooring.'],
 ['archive','Municipal Archive','brasswater','Public record institution across the city.'],
 ['reading','Archive Reading Room','archive','Supervised desks and catalogue drawers.'],
 ['vault','Archive Map Vault','archive','Restricted shelves behind a mechanical lock.'],
 ['roof','Archive Roof','archive','A signalling platform reached by stairs.'],
 ['clinic','Saint Orin Clinic','brasswater','A district hospital with an independent stockroom.'],
 ['ward','Clinic Ward','clinic','Six beds and a treatment desk.'],
 ['pharmacy','Clinic Pharmacy','clinic','Locked medicine cupboards; unrelated to the salvage investigation.'],
 ['market','Lantern Market','brasswater','Crowded stalls and a public message board.'],
 ['tea','Copper Cup Tea House','market','A meeting place with a screened private booth.'],
 ['workshop','Neris Repair Shop','market','A civilian repair business, not the Kestrel engine room.'],
 ['hall','Stormgate Hall','brasswater','Municipal gate-control offices.'],
 ['control','Stormgate Control Room','hall','The gate timetable is posted beside manual levers.'],
 ['chamber','Council Chamber','hall','Public hearings take place here.'],
 ['observatory','East Observatory','brasswater','An independent weather station.'],
 ['lens','Observatory Lens Room','observatory','A telescope platform under a copper dome.'],
 ['garden','Observatory Garden','observatory','Weather instruments surround a sheltered courtyard.'],
 ['canal','Old Canal','brasswater','An open-water route; a ferry crossing takes ten minutes.'],
 ['ferry','Canal Ferry Landing','canal','A ticket kiosk and a public gangway.'],
 ['island','Reed Island',null,'A separate settlement two hours away by boat.'],
 ['lighthouse','Reed Lighthouse','island','An isolated signal station, outside city scenes.'],
 ['islandstore','Reed Storehouse','island','Island supplies; never part of ship inventory.']
];
// Each row: ID, name, role, current place, voice, motive, immediate state.
const castRows:[string,string,string,string,string,string,string][]=[
 ['iris','Iris Vale','Kestrel captain','chartroom','Short questions; lets silence do the arguing.','Keep the crew paid without surrendering evidence.','Alert and trying not to accuse the wrong person.'],
 ['tamsin','Tamsin Rook','Kestrel engineer','chartroom','Precise measurements and dry corrections.','Clear her maintenance work of suspicion.','Impatient to inspect the governor housing.'],
 ['ren','Ren','Kestrel courier','chartroom','Fast, informal speech; jokes under pressure.','Deliver a sealed letter without breaking his promise.','Worried that a witness will name him.'],
 ['mara','Mara Vale','Archive registrar','reading','Formal citations and exact dates.','Protect the integrity of the municipal record.','Sorting flood-damaged catalogues; unaware of the chart-room discussion.'],
 ['orin','Orin Pike','Kestrel quartermaster','hold','Counts aloud before agreeing to anything.','Keep bonded cargo separate from ship stores.','Auditing the cargo seals.'],
 ['leena','Leena Moss','Kestrel medic','galley','Gentle instructions and direct follow-up questions.','Get replacement dressings before departure.','Preparing tea while waiting for a clinic reply.'],
 ['sable','Sable Chen','Kestrel pilot','bridge','Low voice; nautical comparisons.','Make the evening departure window.','Watching the crosswind indicators.'],
 ['daro','Daro Bell','Kestrel cook','galley','Expansive anecdotes interrupted by practical questions.','Feed the crew while keeping food accounts balanced.','Annoyed by an unexplained flour shortage.'],
 ['luca','Luca Fen','Dockmaster','dockoffice','Complete sentences with no contractions.','Prevent an unlawful departure.','Reviewing an unsigned cargo entry.'],
 ['ines','Ines Ward','Customs inspector','warehouse','Repeats the exact wording of a claim before challenging it.','Keep disputed freight in customs custody.','Suspicious of altered wax impressions.'],
 ['niko','Niko Ash','Pier rigger','pier','Brief remarks and a habit of asking who benefits.','Finish the mooring inspection safely.','Checking a frayed line, not listening to the crew.'],
 ['vera','Vera Flint','Map-vault keeper','vault','Quiet, deliberate speech with precise spatial directions.','Recover a missing catalogue sleeve.','Counting returned folios.'],
 ['pavel','Pavel Orr','Archive roof messenger','roof','Clipped signal codes followed by plain explanations.','Keep the signalling line open through the storm.','Waiting for a reply from the Observatory.'],
 ['ada','Ada Quill','Clinic physician','ward','Calm statements of what is known and what is uncertain.','Protect patients from disruption.','Finishing a routine examination.'],
 ['bex','Bex Rowan','Clinic pharmacist','pharmacy','Sceptical questions; exact quantities.','Balance the medicine ledger.','Comparing two ordinary supply invoices.'],
 ['soren','Soren Vale','Tea-house proprietor','tea','Warm greetings; carefully avoids promises.','Keep clients from turning the tea house into a battlefield.','Preparing a private booth.'],
 ['neris','Neris Coil','Independent mechanic','workshop','Explains mechanisms through everyday analogies.','Get paid for an honest repair.','Waiting for a replacement spring.'],
 ['jo','Jo','Market errand runner','market','Quick yes-or-no answers, then unexpected detail.','Earn enough for a ferry ticket.','Watching the message board.'],
 ['evelyn','Evelyn March','Stormgate superintendent','control','Commands shaped as clear sequences.','Close the gates on schedule without flooding the docks.','Reviewing a delayed weather signal.'],
 ['quentin','Quentin Rook','Councillor','chamber','Polished rhetoric and indirect requests.','Avoid being blamed for the missing governor.','Drafting a statement; has no knowledge of Tamsin’s current actions.'],
 ['liora','Liora Sen','Weather observer','lens','Observations first, conclusions second.','Publish an accurate storm forecast.','Rechecking an anomalous pressure reading.'],
 ['tem','Tem Glass','Observatory gardener','garden','Unhurried speech and plant metaphors.','Secure fragile instruments before the wind rises.','Tying down a rain gauge.'],
 ['rhea','Rhea Pike','Ferry operator','ferry','Practical questions about destinations and fares.','Complete the last safe crossing.','Counting passengers on the landing.'],
 ['oskar','Oskar Reed','Lighthouse keeper','lighthouse','Slow radio diction; always repeats coordinates.','Keep the island signal visible.','Repairing a lamp shutter two hours from the city.']
];
const canon:Canon={characters:[],places:placeRows.map(([id,name,parentId,description])=>({id,name,parentId,description,visualDescription:'Weathered brass fittings, painted timber and rain-dark stone.'})),items:[],relationships:[],threads:[],funds:684,cargoNotes:'Three sealed freight crates remain in the Kestrel hold. Shared operating funds are 684 crowns; personal money is not shared money.'};
for(const [index,[id,name,role,locationId,voice,motive,currentState]] of castRows.entries()){
 canon.characters.push(normalizeCharacterProfile({id,name,role,locationId,noNsfw:true,pinnedAppearance:false,notes:'Established professional role; no secret knowledge is implied by this record.',visual:{age:String(27+index),gender:index%2?'man':'woman',species:'human',hair:index%3?'brown hair':'grey-streaked black hair',eyes:index%2?'brown':'grey',distinctive:index%2?'small scar on the left knuckle':'ink-stained fingertips'},persona:{personality:index%2?'Observant, cautious about commitments.':'Practical, attentive to contradictions.',voice,motives:motive,history:`Has worked as ${role.toLowerCase()} for ${3+index%8} years.`},currentState,wardrobe:{upper_body:index<8?'Weatherproof navy work jacket':'Charcoal wool coat',lower_body:'Plain dark trousers',footwear:'Worn leather boots',accessories:'A simple brass service badge'},injuries:'',appearanceNotes:'',outfitNotes:''}));
}
function item(id:string,name:string,ownerId:string,description:string,quantity=1,isContainer=false,equipped=false){canon.items.push({id,name,ownerId,description,quantity,isContainer,equipped,visualDescription:'Small practical object with a legible stamped inventory number.'});}
// Four possessions per person: 24 containers, nested contents and directly held badges.
for(const [id,name,role] of castRows){
 item(`${id}-bag`,`${name}’s satchel`,id,`Personal storage belonging to ${name}.`,1,true);
 item(`${id}-notebook`,`${name}’s notebook`,`${id}-bag`,`Routine notes about the work of the ${role.toLowerCase()}; not a clue unless explicitly read.`);
 item(`${id}-ration`,`${name}’s oat biscuits`,`${id}-bag`,'An ordinary sealed packet of food.',3);
 item(`${id}-badge`,`${name}’s service badge`,id,`Identifies ${name}; grants no universal access.`,1,false,true);
}
// Deep nesting makes path inclusion and accidental sibling expansion easy to observe.
item('iris-wallet','Captain’s document wallet','iris-bag','An inner document wallet.',1,true);
item('iris-ferry-ticket','Unused ferry ticket','iris-wallet','One unused crossing ticket.');
item('iris-receipt','Boot repair receipt','iris-wallet','An irrelevant receipt stamped with a cobalt narwhal.');
item('chart-key','Chart cabinet key','iris','Opens only the chart-room cabinet.',1,false,true);
item('tamsin-tools','Engineer’s roll','tamsin-bag','A rolled tool container.',1,true);
item('tamsin-probe','Calibrated brass probe','tamsin-tools','A narrow diagnostic probe.');
item('tamsin-washers','Spare copper washers','tamsin-tools','Routine consumable washers.',12);
item('ren-letter','Sealed registrar’s letter','ren','Addressed to the captain; its contents have not been read.');
item('ren-cord','Blue parcel cord','ren-bag','Ordinary parcel cord; not established as evidence.');
for(let box=1;box<=3;box++){
 const boxId=`freight-${box}`;item(boxId,`Bonded freight crate ${box}`,'hold',`Sealed freight; seal number BW-${410+box}.`,1,true);
 for(let n=1;n<=6;n++)item(`${boxId}-lot-${n}`,`Freight ${box} / component lot ${n}`,boxId,`Routine pump component lot; batch ${box}${n}.`,n+1);
}
item('ship-stores','Kestrel reserve trunk','kestrel','Ship-owned reserve stores; not all contents matter in every room.',1,true);
for(let n=1;n<=10;n++)item(`ship-spare-${n}`,`Reserve fitting ${n}`,'ship-stores',`An unused standard fitting, shelf code K-${n}.`,n+2);
// Location-owned props should not all follow an ancestor such as the city into a scene.
for(const location of ['dockoffice','warehouse','reading','vault','pharmacy','tea','workshop','control','lens','islandstore']){
 item(`${location}-box`,`${canon.places.find(p=>p.id===location)!.name} supply box`,location,'Local supplies that remain here.',1,true);
 for(let n=1;n<=2;n++)item(`${location}-supply-${n}`,`${location} stock packet ${n}`,`${location}-box`,'Routine local consumables; unrelated to the current scene.',4+n);
}
item('governor-wheel','Missing tide governor wheel','islandstore','The world record locates the wheel here; the current viewpoint has not learned this. Do not infer viewpoint knowledge from canonical location.');
item('clinic-amber-vial','Amber glass vial','pharmacy-box','An ordinary pharmacy container; an off-scene relevance marker.');
item('archive-counterweight','Blue enamel counterweight','vault-box','A vault balance weight; not a tide governor.');
const pairs:[string,string,string][]=[
 ['iris','tamsin','Trusts her engineering judgement; disagrees about financial risk.'],['tamsin','iris','Respects the captain but wants authority to inspect the damaged mechanism.'],
 ['iris','ren','Employs him as courier; has not heard the contents of his letter.'],['ren','iris','Wants to honour his delivery promise before answering questions.'],
 ['iris','mara','Sisters who exchange occasional letters; Mara is not aboard.'],['mara','iris','Trusts her sister to keep written evidence intact.'],
 ['iris','soren','Unrelated people sharing a surname; acquaintances through dock trade.'],['tamsin','quentin','Estranged cousins; current intentions are not shared.'],
 ['quentin','tamsin','Worries that a public inquiry will implicate the family.'],['orin','rhea','Siblings with separate jobs and separate possessions.'],
 ['leena','ada','Professional colleagues who share medical updates when contacted.'],['ada','bex','Relies on her stock counts.'],
 ['mara','vera','Registrar and vault keeper; formal chain of custody.'],['pavel','liora','Communicate by roof signal; delivery can be delayed.'],
 ['luca','ines','Overlapping authority; each requires separate signatures.'],['sable','niko','Coordinate departure and mooring safety.'],
 ['daro','jo','Occasional paid market errands.'],['neris','tamsin','Friendly rivals; no automatic knowledge sharing.'],
 ['tem','liora','Maintains the outdoor instruments she reads.'],['rhea','oskar','Carries island supplies only on scheduled crossings.']
];
canon.relationships=pairs.map(([fromId,toId,notes],n)=>({id:`relationship-${n+1}`,fromId,toId,notes}));
canon.threads=[
 ['wheel','The missing governor','Determine how the tide governor left municipal custody.'],
 ['letter','The sealed letter','Ren must deliver the registrar’s sealed letter; contents remain unknown.'],
 ['storm','The gate deadline','The storm gates must close before the evening surge.'],
 ['seals','Altered cargo seals','Customs has questioned one freight impression; no culprit established.'],
 ['catalogue','The missing catalogue sleeve','The map vault has an unaccounted sleeve.'],
 ['forecast','The delayed forecast','The gate office awaits an Observatory signal.'],
 ['flour','The galley shortage','Daro’s flour count is short; no theft has been established.'],
 ['lamp','The island lamp','Oskar needs a shutter repair before dark.']
].map(([id,title,notes])=>({id:`thread-${id}`,title,notes,status:'open' as const}));
const context=emptyContext();
context.sceneBrief={scope:'current-scene',clearAfterPassage:false,viewpointId:'iris',locationId:'chartroom',castIds:['iris','tamsin','ren'],purpose:'Compare the damaged governor sketch with the courier’s account without opening the sealed letter.',tension:'The crew must distinguish a witness report from a proven fact.',stopAt:'A decision about the next interview; nobody travels or opens the letter yet.'};
context.lore=[
 {id:'lore-transit',title:'Transit and communication',text:'The Kestrel is docked. City districts require travel. A radio or written message conveys only its stated content. Physical possessions remain with their recorded owner or container until an evidenced transfer.',keywords:['travel','message','ferry'],relatedIds:[],visibility:'always'},
 {id:'lore-archive',title:'Archive custody',text:'Catalogue sleeves travel separately from original maps. A keeper signs every removal.',keywords:['catalogue','vault'],relatedIds:['archive','mara','vera'],visibility:'relevant'},
 {id:'lore-clinic',title:'Clinic routine',text:'Ordinary amber vials are counted every morning; they have no established connection to the missing mechanism.',keywords:['clinic','pharmacy'],relatedIds:['clinic','bex'],visibility:'relevant'},
 {id:'lore-hidden',title:'Unrevealed island lead',text:'A hidden planning possibility: the island shipment may connect the governor to an old flood inquiry. This is not established history. Hidden marker: violet albatross.',keywords:['island','governor'],relatedIds:['islandstore'],visibility:'hidden'}
];
const factPins=emptyFactPins();
factPins.fields=[{kind:'character',recordId:'iris',field:'visual.age'},{kind:'item',recordId:'chart-key',field:'name'}];
factPins.rules=[{id:'rule-transit',text:'Characters and objects do not teleport. Mentioning an absent person does not make them present or grant them knowledge.'}];
const setup=setupDraftSchema.parse({id:randomUUID(),revision:0,createdAt:now,updatedAt:now,input:{title,premise,castSize:8,narrationStyle:'Close third person, past tense. Clear physical staging, distinct voices, restrained description and grounded causality.',artStyle:'Painterly brass-and-timber maritime fantasy; overcast daylight.',adultContent:false,preferences:{passageWords:600,writingGuide:'Keep the scene focused on the people physically present. Mention background facts only when they affect an immediate action or decision.'}},plan:{title,chapterTitle:'The Letter on the Chart Table',canon,context,factPins},storyId:null});
validateSetupPlan(setup.plan);
const storyBase=setupStoryBase(setup);
const paragraphs=[
 'Rain tapped the chart-room skylight. Iris set the damaged governor sketch between Tamsin and Ren. The engineer had come up from the engine room ten minutes earlier; the courier had been waiting beside the table. Beyond the closed door, a speaking tube carried the pilot’s request for a departure time. Iris left it unanswered.',
 '“The notch is wrong,” Tamsin said, pointing to the pencil outline. “A wheel cut like that would bind before the third turn. Either the drawing is old, or someone has shown us the wrong part.”',
 'Ren kept a sealed letter flat beneath his palm. “The registrar told me to deliver this directly. She did not tell me what it says.”',
 'Iris recognised Mara Vale’s small, square handwriting on the envelope. Her sister was across the city at the Archive, not waiting somewhere aboard the ship. Iris could ask her about the drawing later. For now she had a sketch, a courier’s account and an unopened letter. She refused to treat any of them as proof of a theft.',
 '“Keep the seal intact,” she said. “First, tell us exactly where you collected it.” Tamsin drew a clean sheet from the chart drawer and waited for his answer.'
];
const story=validateStory({...storyBase,passages:[{id:'passage-chartroom-1',chapter:1,chapterTitle:setup.plan!.chapterTitle,title:'Three People and an Unopened Letter',viewpoint:'Iris Vale',paragraphs,direction:'',endOfChapter:false,createdAt:now}],recovery:null});
// Setup starts before the written excerpt. The story copy is ready for continuation now.
const setupBytes=encodeSetupArchive(setup);assert.deepEqual(decodeSetupArchive(setupBytes),setup);
const storyBytes=zipSync({'manifest.json':strToU8(JSON.stringify({format:'guided-story-dev-1',media:[],exportedAt:now})),'story.json':strToU8(JSON.stringify(story))},{level:6});
assert.deepEqual(validateStory(JSON.parse(strFromU8(unzipSync(storyBytes)['story.json']))),story);
writeFileSync(resolve(folder,'brasswater-setup.zip'),setupBytes);writeFileSync(resolve(folder,'brasswater-story.zip'),storyBytes);save('setup.json',setup);save('story.json',story);

const scenarios=[
 {id:'local-conversation',direction:'Continue the conversation at the chart table. Ren explains where he received the letter. Keep the seal intact and stop before anybody leaves.',active:['iris','tamsin','ren'],note:'Mara is mentioned in recent prose but remains off-scene; her possessions should not be treated as available aboard.'},
 {id:'nested-item',direction:'Iris takes her unused ferry ticket from her document wallet, shows its date, then puts it back. Nobody boards a ferry.',active:['iris','tamsin','ren'],note:'The ticket needs the satchel/wallet path; the irrelevant boot receipt and all other stored items should not receive equal attention.'},
 {id:'short-name',direction:'Jo waits at the market message board and asks about a missing parcel.',active:['jo'],location:'market',viewpoint:'jo',cast:['jo'],note:'Short names should work without bringing the ship crew or their equipment to the market.'},
 {id:'remote-pharmacy',direction:'Bex counts the amber glass vial in the pharmacy. Ada enters from the ward to ask for a stock total.',active:['bex','ada'],location:'pharmacy',viewpoint:'bex',cast:['bex','ada'],note:'A remote scene should keep ship cargo and tide-governor speculation out unless actually relevant. Ada’s arrival must be evidenced before her location changes.'},
 {id:'shared-surname',direction:'Iris recalls a polite conversation with Soren Vale at the tea house. Continue the chart-room scene without introducing any arrivals.',active:['iris','tamsin','ren'],note:'Soren and Mara are different people. A shared surname and recollection do not make either one physically present.'}
];
const settings=connectionSchema.parse({text:{baseUrl:'http://127.0.0.1:8888/v1',model:'fixture-only-no-provider-call',temperature:0.8,maxTokens:4096,contextTokens:32000,structuredOutput:'auto',thinking:'off'},images:{baseUrl:'http://127.0.0.1:8188',workflow:'AI/Comfy Workflow/portrait.comfy-desktop.api.json'}});
const reports=scenarios.map(test=>{
 const variant:Story=structuredClone(story);
 if(test.location){variant.context.sceneBrief={...variant.context.sceneBrief,locationId:test.location,viewpointId:test.viewpoint!,castIds:test.cast!,purpose:'A separate local scene.',tension:'',stopAt:'A natural pause.'};variant.passages=[{...variant.passages[0],viewpoint:variant.canon.characters.find(c=>c.id===test.viewpoint)!.name,paragraphs:[test.id==='short-name'?'Jo waited at the Lantern Market message board with an ordinary errand slip.':'Bex stood alone at the pharmacy counter beside the stock ledger.']}];}
 const report=previewContinuationContext(variant,test.direction,settings);
 save(`context-${preservingBaseline?'after-':''}${test.id}.json`,report);
 return {...test,runnable:report.runnable,estimatedInputTokens:report.inputTokens,inputBudget:report.inputBudget,selectedCharacters:report.selectedCharacterIds.map(id=>canon.characters.find(c=>c.id===id)!.name),includedItems:report.sources.filter(s=>s.kind==='item'&&s.included).length,eligibleItems:report.sources.filter(s=>s.kind==='item').length,byKind:Object.fromEntries([...new Set(report.sources.map(s=>s.kind))].map(kind=>[kind,{included:report.sources.filter(s=>s.kind===kind&&s.included).length,tokens:report.sources.filter(s=>s.kind===kind&&s.included).reduce((sum,s)=>sum+s.tokens,0)}]))};
});
const counts={characters:canon.characters.length,places:canon.places.length,items:canon.items.length,containers:canon.items.filter(i=>i.isContainer).length,relationships:canon.relationships.length,threads:canon.threads.length};
save(preservingBaseline?'baseline-after.json':'baseline.json',{counts,modelCalls:0,tokenMethod:'App conservative estimate, not measured provider tokens.',scenarios:reports});
let map='# Brasswater containment map\n\nThis is containment, not a pathfinding graph. Travel times are described in the records.\n\n```text\n';
function branch(parent:string|null,depth:number){for(const p of canon.places.filter(p=>p.parentId===parent)){map+='  '.repeat(depth)+p.name+' ['+p.id+']\n';branch(p.id,depth+1);}}branch(null,0);map+='```\n';
writeFileSync(resolve(folder,'MAP.md'),map);
writeFileSync(resolve(folder,'README.md'),`# ${title}\n\nFictional scoping stress test: ${counts.characters} characters, ${counts.places} places, ${counts.items} items (${counts.containers} containers), ${counts.relationships} directional relationships and ${counts.threads} open threads. All characters are adults.\n\n## Import\n\n- Import **brasswater-story.zip** from Library for a ready-to-continue story with one written scene.\n- Import **brasswater-setup.zip** through the unfinished-setup import flow to inspect/edit the complete plan before generating an opening. The input cast-size control is capped at eight; the existing approved plan contains all ${counts.characters} characters. Regenerating the whole setup may replace it with a smaller cast.\n- JSON files are readable copies. MAP.md shows nested places. These files do not change your current library until you import a ZIP.\n\n## Tests\n\n${scenarios.map(s=>`### ${s.id}\n\nDirection: ${s.direction}\n\nIntended active cast: ${s.active.join(', ')}. ${s.note}\n`).join('\n')}\n## Baseline evidence\n\nbaseline.json and context-*.json record the current application's selection and token estimates, generated without an LLM call. They are observations, not assertions that the current selection is ideal. Remote scenarios replace the recent prose and scene brief in memory; no travel is assumed. Their intended-active lists describe narrative participants, not a strict ban on compact references to absent people.\n\nKnown traps: shared surnames, Ren/Jo short names, a mentioned but absent registrar, city/ship ancestor ownership, nested sibling inventory, unrelated cargo and pharmacy supplies, and hidden lore. The governor's canonical location is deliberately different from viewpoint knowledge. Search model output for unsupported knowledge, arrivals, transfers or unrelated props.\n\nPinned facts/world rules are intentionally small. Image-only visual descriptions should be absent from narration context. The full-world effects-extraction request remains a separate cost; these continuation-context reports do not measure it. No model-quality or latency benchmark has been run.\n\nRegenerate from the project root with: node --import tsx exports/scoping-stress-test/generate.ts\n`);
const guide=readFileSync(resolve(folder,'README.md'),'utf8')
 .replace("baseline.json and context-*.json record the current application's selection and token estimates",'baseline.json and context-*.json retain original selection estimates; baseline-after.json and context-after-*.json record regenerated current results')
 .replace('The full-world effects-extraction request remains a separate cost; these continuation-context reports do not measure it. No model-quality or latency benchmark has been run.','Extraction and targeted inventory verification are separate costs; these narration reports do not measure them. See ../../docs/SCOPING_FIXES.md and request-after.json for complete request-construction and local-model evidence.');
writeFileSync(resolve(folder,'README.md'),guide);
appendFileSync(resolve(folder,'README.md'),'\n## First fixes and current checks\n\nThe original mocked request audit failed full-world extraction at 32k. The first fixes now complete the mocked continuation flow within that budget. Opening and other broad tasks remain separate stress cases. Do not increase saved context solely to hide selection problems.\n\nSee [first fixes](../../docs/SCOPING_FIXES.md) and [historical review](../../docs/SCOPING_REVIEW_ASSESSMENT.md). Run ownership-check.ts --after, review-checks.ts --after and request-audit.ts --after with node --import tsx from the project root for current reports. The ownership helper deliberately bypasses guarded generation to characterize structural dry runs; tests/scoping-regressions.test.ts exercises actual verification/repair. Original baseline JSON files remain intact. These fixture checks need no network or real model calls.\n');
console.log(JSON.stringify({folder,counts,archivesValidated:true,modelCalls:0,scenarios:reports.map(({id,runnable,estimatedInputTokens,includedItems,selectedCharacters})=>({id,runnable,estimatedInputTokens,includedItems,selectedCharacters}))},null,2));
