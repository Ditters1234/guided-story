// Run from the project root: node --import tsx exports/red-willow-ranch/generate.ts
// Portable unfinished setup + schematic. No live provider or installed-library access.
import {mkdirSync,writeFileSync,readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,join,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {characterSchema,type Canon} from '../../src/lib/story';
import {emptyContext} from '../../src/lib/context-types';
import {emptyFactPins} from '../../src/lib/fact-pins';
import {setupDraftSchema,setupStoryBase,validateSetupPlan} from '../../src/lib/setup';
import {encodeSetupArchive,decodeSetupArchive} from '../../src/lib/server/setup-archive';
import {openingContext} from '../../src/lib/server/scene-scope';

const folder=resolve('exports/red-willow-ranch');mkdirSync(folder,{recursive:true});
const save=(name:string,value:unknown)=>writeFileSync(join(folder,name),JSON.stringify(value,null,2)+'\n');
const now=new Date().toISOString();
const placeRows:[string,string,string|null,string,string][]=[
 ['ranch','Red Willow Ranch',null,'A small family-run prairie cattle ranch. Farm Yard links the farmhouse, Feed Shed, horse areas and pasture gates; Farm Lane joins the county road.','Gently rolling grassland, shelterbelt trees, gravel tracks and weathered red outbuildings.'],
 ['house','Small Farmhouse','ranch','A modest one-storey home with a kitchen, sitting room, two bedrooms, bathroom and a back mudroom opening toward Farm Yard.','Cream clapboard, green trim, a low shingled roof and a covered front porch.'],
 ['kitchen','Farmhouse Kitchen','house','A lived-in kitchen for breakfast, baking and planning the day. Kitchen Table, Refrigerator and Pantry Cupboard hold the named household supplies.','Pale yellow walls, pine cabinets, a blue checked tablecloth and an east window over the sink.'],
 ['sitting-room','Sitting Room','house','A comfortable room for reading, conversation, mending and resting after chores; reached from the kitchen.','Faded green sofa, low bookshelf, braided rug and a broad west window.'],
 ['main-bedroom','Main Bedroom','house','Alex and Erin share this bedroom; clothes and ordinary personal belongings are kept here.','Patchwork quilt, pine chest of drawers and simple bedside lamps.'],
 ['spare-bedroom','Spare Bedroom','house','A tidy guest room that also serves as a small sewing and paperwork space.','Single bed, sewing desk, gingham curtains and a folded guest quilt.'],
 ['bathroom','Farmhouse Bathroom','house','An ordinary bathroom for washing up after work and getting ready for the day.','White tub, sage-painted cabinet, tiled floor and a small frosted window.'],
 ['mudroom','Back Mudroom','house','The practical entrance between the kitchen and Farm Yard, with space for muddy boots, coats and a laundry basket.','Boot bench, wall pegs, rubber floor mat and a back door with a glass pane.'],
 ['porch','Front Porch','house','A sheltered place for tea, watching the weather and receiving visitors; steps lead toward Kitchen Garden and Farm Lane.','Two wooden chairs, narrow porch boards and a low painted railing.'],
 ['yard','Farm Yard','ranch','The gravel working hub. Feed Shed stands west, Workshop south, North Pasture gate north and Horse Yard east. There is space to park farm machinery.','Compacted gravel, shallow rain-dark patches and open space between low farm buildings.'],
 ['feed-shed','Feed Shed','yard','Dry livestock-feed storage with separate named stock containers. Farm machinery can be loaded outside its broad doors; the specific stock and tools are catalogued separately.','Red plank walls, wide sliding doors, timber rafters and a dry concrete floor.'],
 ['workshop','Workshop','yard','A small repair shop with a workbench and Workshop Toolbox. Suitable for minor repairs and sharpening tools.','Corrugated metal walls, scarred workbench, pegboard and a fluorescent strip light.'],
 ['tractor','Loader Tractor','yard','An operable compact loader tractor, represented as a moving place. Tractor Cab is inside it; Tractor Feed Bin is attached outside. It can travel between Farm Yard, Feed Shed and North Pasture.','Faded green bodywork, black rubber tyres, orange beacon and a square glazed cab.'],
 ['tractor-cab','Tractor Cab','tractor','One driving seat, steering wheel and controls inside Loader Tractor. A driver stays in this cab while the tractor moves, and leaves it when stepping down.','Scuffed black seat, dusty glass, worn steering wheel and a small rear-view mirror.'],
 ['north-pasture','North Pasture','ranch','A fenced grazing field north of Farm Yard. Cattle Feed Trough stands beside the accessible feeding strip, with Pasture Water Trough nearby. The herd can approach the trough.','Short autumn grass, wire fencing, a wide gate and a shallow rise backed by willow trees.'],
 ['hay-meadow','South Hay Meadow','ranch','A quiet grass field south of the yard, already cut for the season. Suitable for a boundary walk or an easy ride when the ground is firm.','Pale stubble, grass margins, a low stone pile and an open southern horizon.'],
 ['horse-yard','Horse Yard','ranch','A separate area east of Farm Yard connecting Small Stable, Horse Paddock and Schooling Ring. Gates lead out toward Creek Loop Trail.','Packed earth, timber rails and a pair of neatly hung gate chains.'],
 ['stable','Small Stable','horse-yard','A two-stall stable used for the riding horses, shelter and grooming; the aisle connects Tack Room and both stalls.','Weathered red siding, dark green doors and a low roof with a ventilation cupola.'],
 ['stable-aisle','Stable Aisle','stable','A broad, uncluttered aisle where the horses can be brought in for grooming or tacking up. Hooks provide storage for feed buckets when not in use.','Swept concrete, straw near stall doors and brass hooks along a timber wall.'],
 ['tack-room','Tack Room','stable','Dry storage for Grooming Kit, saddles, bridles, halters and riding helmets. Tack is put away here when not being used.','Wooden saddle racks, bridle pegs, a narrow bench and a high dusty window.'],
 ['clover-stall','Clover Stall','stable','A bedded stall reserved for Clover, used when shelter or indoor care is wanted.','Fresh straw, a half-height wooden door and a small barred window.'],
 ['pippin-stall','Pippin Stall','stable','A bedded stall reserved for Pippin, used when shelter or indoor care is wanted.','Clean straw, a broad stable door and a wall-mounted tie ring.'],
 ['horse-paddock','Horse Paddock','horse-yard','A secure turnout paddock for Clover and Pippin with grass, shade and Horse Water Trough. A gate opens into Horse Yard.','Timber rails, cropped grass, two shade trees and a muddy patch beside the gate.'],
 ['schooling-ring','Schooling Ring','horse-yard','A small enclosed sand arena for leisurely schooling and rebuilding confidence; it is not a competition yard.','Pale sand, low timber rails and two simple ground poles.'],
 ['garden','Kitchen Garden','ranch','A small garden beside the farmhouse, with late carrots, herbs and an unfinished herb-bed edging project. Garden Basket holds the small tools.','Raised beds, dark soil, rosemary pots and a low woven fence.'],
 ['creek-trail','Creek Loop Trail','ranch','A gentle loop along the shelterbelt and creek, reached through the eastern horse gates or a southern grass track. Ordinary rides take time and return by the same gates.','Willow shade, a shallow creek, grass tracks and a small wooden footbridge beside the riding ford.'],
 ['farm-lane','Farm Lane','ranch','A short gravel lane from Farm Yard past Front Porch to County Road. Walking to the neighboring smallholding takes about fifteen minutes.','Twin wheel tracks, grass verge, mailbox and a simple ranch sign.'],
 ['county-road','County Road',null,'A quiet public gravel road connecting the ranch lane and June Smallholding. Larger shops are a drive away and are not part of the starting scene.','Wide gravel shoulder, utility poles and open fields.'],
 ['june-home','June Smallholding',null,'June lives at this neighboring property beside County Road. A modest house and vegetable patch; visitors must travel here or arrange a visit.','White cottage, blue gate, tall sunflowers and a gravel front path.']
];
const canon:Canon={characters:[],places:placeRows.map(([id,name,parentId,description,visualDescription])=>({id,name,parentId,description,visualDescription})),items:[],relationships:[],threads:[],funds:1500,cargoNotes:'Shared household operating money is 1,500 local dollars. Equipment is household property; item holder/storage records track physical custody, not legal title. No freight or deliveries are currently pending.'};
function person(id:string,name:string,role:string,locationId:string,age:string,gender:string,look:Record<string,string>,personality:string,voice:string,motives:string,history:string,currentState:string,wardrobe:Record<string,string>){
 canon.characters.push(characterSchema.parse({id,name,role,locationId,notes:'An adult resident or friend with ordinary knowledge of this small ranch; no hidden subplot.',noNsfw:true,pinnedAppearance:false,visual:{age,gender,species:'human',...look},persona:{personality,voice,motives,history},currentState,wardrobe}));
}
person('alex','Alex Morrow','Resident rancher','kitchen','38','man',{skin:'Lightly tanned skin',build:'Broad shoulders, practical working build',face:'Square jaw and short brown beard',hair:'Short brown hair',eyes:'Hazel'},'Patient and capable; sometimes overpacks a morning with small jobs.','Plain sentences, dry humour, asks before assuming.','Keep the animals comfortable and make time at home.','Has managed this small ranch with Erin for eight years.','Considering the morning jobs over breakfast; has not begun the feeding round.',{upper_body:'Faded blue work shirt over a grey T-shirt',lower_body:'Worn dark jeans',footwear:'Brown house slippers',accessories:'Plain wedding band'});
person('erin','Erin Morrow','Resident partner and gardener','kitchen','36','woman',{skin:'Fair skin with freckles',build:'Sturdy, medium height',face:'Round face, expressive brows',hair:'Auburn hair in a loose braid',eyes:'Green'},'Warm, direct and inventive about making ordinary days pleasant.','Light teasing followed by specific practical suggestions.','Share farm work fairly, tend the garden and keep the home welcoming.','Grew up in a nearby town; learned ranch routines alongside Alex.','At the kitchen table with Alex, thinking about a quiet ride later.',{upper_body:'Oatmeal knit cardigan over a forest-green shirt',lower_body:'Dark denim trousers',footwear:'Thick grey socks',accessories:'Plain wedding band'});
person('ben','Ben Cooper','Part-time farm hand','stable-aisle','27','man',{skin:'Medium brown skin',build:'Lean and long-limbed',hair:'Short black curls',eyes:'Dark brown',distinctive:'Small dimple in left cheek'},'Conscientious and cheerful, willing to admit what he has not learned.','Quick friendly questions; repeats an unfamiliar instruction once.','Do reliable work and become more confident with the horses.','Helps three mornings a week and lives off the property.','Sweeping the stable aisle; neither horse has been brought indoors.',{upper_body:'Rust-coloured sweatshirt',lower_body:'Olive work trousers',footwear:'Black work boots',accessories:'Plain wristwatch'});
person('june','June Calloway','Neighbor and experienced leisure rider','june-home','56','woman',{skin:'Weathered fair skin',build:'Compact, upright posture',hair:'Grey bob',eyes:'Blue',distinctive:'Narrow laugh lines'},'Observant, sociable and respectful of other people\'s time.','Unhurried observations, practical anecdotes, warm greetings.','Enjoy neighborly company and help make riding relaxed.','Has lived next door for twenty years and often joins a weekend ride.','At her own smallholding; no visit has yet been arranged.',{upper_body:'Burgundy fleece over a cream shirt',lower_body:'Faded blue jeans',footwear:'Brown ankle boots',accessories:'Reading glasses on a cord'});
function animal(id:string,name:string,role:string,locationId:string,age:string,gender:string,species:string,look:Record<string,string>,temperament:string,state:string,notes:string){
 canon.characters.push(characterSchema.parse({id,name,role,locationId,noNsfw:true,pinnedAppearance:false,notes,visual:{age,gender,species,...look},persona:{personality:temperament,voice:'Ordinary animal sounds and body language; no spoken human dialogue.',motives:'Food, water, familiar company and comfortable handling.',history:'A familiar part of the ranch.'},currentState:state,wardrobe:{},outfitNotes:'No human clothing; no riding tack is currently fitted.'}));
}
animal('clover','Clover','Leisure riding mare','horse-paddock','9','mare','horse',{skin:'Chestnut coat',build:'Compact riding horse',face:'Broad white blaze',hair:'Flaxen mane and tail',eyes:'Dark brown',distinctive:'White socks on both hind legs'},'Steady on familiar trails; curious about buckets.','Grazing in Horse Paddock with Pippin; untacked.','Erin usually rides this mare. A character record tracks her location and behaviour; she is not a vehicle or an inventory item.');
animal('pippin','Pippin','Leisure riding gelding','horse-paddock','12','gelding','horse',{skin:'Bay coat with black points',build:'Tall, solid riding horse',face:'Small white star',hair:'Black mane and tail',eyes:'Dark brown'},'Patient and sociable; pauses to inspect puddles.','Grazing beside Clover in Horse Paddock; untacked.','Alex usually rides this gelding; Ben handles him under guidance. A rider and horse each retain their own location records.');
animal('herd','Cattle Herd','Twelve beef cows, tracked as one group','north-pasture','Adult group','cows','cattle',{skin:'Mixed red, brown and black coats',build:'Twelve medium-sized beef cows',hair:'Short coats',eyes:'Dark',distinctive:'Small numbered ear tags'},'Calm familiar livestock; alert to the sound of the feed tractor.','Spread across North Pasture, grazing; the morning supplementary feed has not been delivered.','One group record represents twelve adult cows. Ordinary individual movement does not split the group; introduce individual records only if the story needs them. No calves or bulls are present.');
function item(id:string,name:string,ownerId:string,description:string,visualDescription:string,quantity=1,isContainer=false){canon.items.push({id,name,ownerId,description,visualDescription,quantity,isContainer,equipped:false});}
item('grain-hopper','Grain Hopper','feed-shed','A fixed dry storage hopper used only for Cattle Feed.','Galvanized rectangular hopper with a blue lid.',1,true);
item('cattle-feed','Cattle Feed','grain-hopper','Stored supplementary cattle feed. Quantity is measured in whole level feed scoops, not sacks or kilograms. Loading or pouring moves these units; only actual eating consumes them.','Coarse golden-brown feed pellets.',120);
item('feed-scoop','Level Feed Scoop','feed-shed','A reusable scoop for transferring the tracked whole-scoop feed units.','Dull aluminium scoop with a short red handle.');
item('tractor-bin','Tractor Feed Bin','tractor','An attached open bin outside the cab. Can hold Cattle Feed for the feeding round and moves with Loader Tractor. Capacity is not numerically specified.','Green steel hopper above a rear dispensing chute.',1,true);
item('cattle-trough','Cattle Feed Trough','north-pasture','A fixed trough on the feeding strip. Delivered feed is held here until cows actually eat it.','Long low galvanized trough on metal legs.',1,true);
item('pasture-water','Pasture Water Trough','north-pasture','A fixed float-valve water trough, supplied and usable. Water is not tracked as a counted inventory stack.','Wide dark-green trough with clear water.');
item('pasture-gate','North Pasture Gate','north-pasture','The gate currently closes securely, though its latch catches and could use a small adjustment.','Galvanized five-bar gate and a slightly misaligned black latch.');
item('horse-feed-bin','Horse Feed Bin','feed-shed','A sealed dry bin reserved for Horse Pellets.','Blue lidded plastic drum.',1,true);
item('horse-pellets','Horse Pellets','horse-feed-bin','Horse feed tracked in whole level scoops; suitable portions can be stated in the story without inventing a veterinary feeding schedule.','Small brown feed pellets.',40);
item('hay-rack','Hay Rack','feed-shed','Dry storage for the already separated Hay Flakes.','Broad wooden rack raised above the floor.',1,true);
item('hay-flakes','Hay Flakes','hay-rack','Already separated flakes of hay; one tracked unit is one whole flake. No bale-to-flake conversion is needed.','Compact rectangular flakes of dry meadow hay.',60);
item('clover-bucket','Clover Feed Bucket','stable-aisle','A carryable feed bucket reserved for Clover.','Round burgundy bucket with a black handle.',1,true);
item('pippin-bucket','Pippin Feed Bucket','stable-aisle','A carryable feed bucket reserved for Pippin.','Round navy bucket with a black handle.',1,true);
item('horse-water','Horse Water Trough','horse-paddock','A filled float-valve trough shared by both horses; its water is not a counted stack.','Low black oval water trough.');
item('grooming-kit','Grooming Kit','tack-room','A portable box holding Wooden Grooming Brush, Curry Comb and Hoof Pick.','Cream plastic grooming box with a navy handle.',1,true);
item('grooming-brush','Wooden Grooming Brush','grooming-kit','A single shared brush. A completed handover changes who physically holds it; putting the kit down does not automatically put this brush back inside.','Oval wooden-backed brush with soft brown bristles.');
item('curry-comb','Curry Comb','grooming-kit','A flexible curry comb for routine grooming.','Black oval rubber curry comb.');
item('hoof-pick','Hoof Pick','grooming-kit','A standard hoof pick with a small brush.','Blue curved handle and short steel pick.');
item('clover-saddle','Clover Trail Saddle','tack-room','The saddle normally used for Clover; stored on its rack, not on the horse.','Well-kept brown leather trail saddle.');
item('pippin-saddle','Pippin Riding Saddle','tack-room','The saddle normally used for Pippin; stored on its rack, not on the horse.','Dark brown all-purpose leather saddle.');
item('clover-bridle','Clover Bridle','tack-room','Clover\'s named bridle, hanging on its peg.','Brown leather bridle with plain steel fittings.');
item('pippin-bridle','Pippin Bridle','tack-room','Pippin\'s named bridle, hanging on its peg.','Black leather bridle with plain steel fittings.');
item('clover-halter','Clover Halter and Lead','tack-room','A halter and attached lead kept together as one set.','Burgundy webbing halter and cream lead rope.');
item('pippin-halter','Pippin Halter and Lead','tack-room','A halter and attached lead kept together as one set.','Navy webbing halter and cream lead rope.');
item('erin-helmet','Charcoal Riding Helmet','tack-room','Erin\'s riding helmet, stored on the tack-room shelf.','Matte charcoal riding helmet.');
item('alex-helmet','Green Riding Helmet','tack-room','Alex\'s riding helmet, stored on the tack-room shelf.','Matte dark-green riding helmet.');
item('toolbox','Workshop Toolbox','workshop','A portable toolbox holding Adjustable Spanner and Claw Hammer.','Red metal toolbox with a black handle.',1,true);
item('spanner','Adjustable Spanner','toolbox','A hand tool useful for adjusting the sticky gate latch.','Worn silver adjustable spanner.');
item('hammer','Claw Hammer','toolbox','An ordinary general-purpose workshop hammer.','Steel claw head and scuffed wooden handle.');
item('kitchen-table','Kitchen Table','kitchen','A surface container for the two mugs and Household Notebook.','Scrubbed pine table under a blue checked cloth.',1,true);
item('alex-mug','Alex Blue Mug','kitchen-table','Alex\'s usual mug; it begins on the table, not in his hand. Drinks are not separately counted.','Broad blue ceramic mug.');
item('erin-mug','Erin Cream Mug','kitchen-table','Erin\'s usual mug; it begins on the table.','Cream ceramic mug with a narrow green rim.');
item('household-notebook','Household Notebook','kitchen-table','A shared book for shopping and optional jobs; it contains no record of today\'s chores being completed.','Small lined notebook with a faded floral cover.');
item('fridge','Refrigerator','kitchen','A household refrigerator holding the tracked Eggs; ordinary condiments are background.','White refrigerator with two small magnets.',1,true);
item('eggs','Eggs','fridge','Fresh eggs counted individually; cracking eggs for breakfast reduces this stack by the exact number used.','Brown-shelled eggs in a carton.',10);
item('pantry','Pantry Cupboard','kitchen','A dry cupboard holding the tracked Bread Slices. Tea, flour, salt and other basic staples are background, not a complete grocery ledger.','Narrow cream-painted cupboard.',1,true);
item('bread','Bread Slices','pantry','Sliced bread counted as individual slices, not whole loaves.','Farmhouse bread slices in a paper bag.',12);
item('kettle','Kitchen Kettle','kitchen','An ordinary electric kettle; tap water and electricity are available and not counted.','Brushed steel kettle with a black handle.');
item('recipe-book','Recipe Book','kitchen','A modest collection of familiar soups, bread and baking recipes.','Soft green hardback with flour marks on the spine.');
item('laundry-basket','Laundry Basket','mudroom','A portable basket with a few untracked ordinary work clothes for a domestic afternoon.','Woven wicker laundry basket.',1,true);
item('alex-boots','Alex Work Boots','mudroom','Alex\'s work boots, waiting on the boot mat; his current wardrobe has house slippers until he changes.','Scuffed brown leather work boots.');
item('erin-boots','Erin Yard Boots','mudroom','Erin\'s outdoor boots, waiting on the boot mat.','Dark-green rubber yard boots.');
item('garden-basket','Garden Basket','garden','A basket holding Garden Trowel and Gardening Gloves.','Small willow basket with a bentwood handle.',1,true);
item('trowel','Garden Trowel','garden-basket','A small hand tool for the herb bed.','Blue-painted handle and soil-darkened steel blade.');
item('garden-gloves','Gardening Gloves','garden-basket','One pair of gloves, tracked as a single set.','Green canvas gloves with brown palms.');
item('reading-book','Evening Reading Book','sitting-room','A gentle travel memoir available for an evening at home.','Faded blue paperback with a creased spine.');
canon.relationships=[
 {id:'alex-erin',fromId:'alex',toId:'erin',notes:'Married partners, affectionate and comfortable together; they share decisions and divide chores without keeping score.'},
 {id:'alex-ben',fromId:'alex',toId:'ben',notes:'A patient employer and mentor; trusts Ben with familiar jobs and explains unfamiliar machinery.'},
 {id:'erin-ben',fromId:'erin',toId:'ben',notes:'Friendly working relationship; enjoys helping him build confidence around the horses.'},
 {id:'erin-june',fromId:'erin',toId:'june',notes:'Friends who trade garden cuttings and sometimes plan an easy weekend ride.'},
 {id:'alex-june',fromId:'alex',toId:'june',notes:'Longstanding neighbors, comfortable sharing tea and practical help.'},
 {id:'erin-clover',fromId:'erin',toId:'clover',notes:'Erin is Clover\'s familiar rider and handler; their trust is expressed through ordinary horse behaviour.'},
 {id:'alex-pippin',fromId:'alex',toId:'pippin',notes:'Alex is Pippin\'s familiar rider; neither horse is a possession represented by an item record.'}
];
canon.threads=[
 {id:'gate-job',title:'A small latch adjustment',notes:'The pasture gate closes, but its catch is awkward. A minor repair can be fitted into a calm day; nothing has broken loose.',status:'open'},
 {id:'weekend-ride',title:'An easy ride together',notes:'Erin would like an unhurried creek-loop ride when the ground dries. June could be invited, but no invitation or arrangement has happened.',status:'open'},
 {id:'herb-bed',title:'Finishing the herb bed',notes:'A little edging remains to be chosen for the kitchen garden. Alex and Erin have different ideas and can enjoy working it out.',status:'open'}
];
const context=emptyContext();
context.sceneBrief={viewpointId:'alex',locationId:'kitchen',castIds:['alex','erin'],scope:'next-passage',clearAfterPassage:true,purpose:'Open with Alex and Erin at the kitchen table after light overnight rain. Let a warm breakfast conversation reveal their relationship and leave room to choose one next activity.',tension:'Only the ordinary pull between useful chores and making time for a pleasant day together.',stopAt:'End in the kitchen after a small choice or suggestion, before anyone starts or completes the outdoor chores.'};
function lore(id:string,title:string,text:string,keywords:string[],relatedIds:string[],visibility:'always'|'relevant'='relevant'){context.lore.push({id,title,text,keywords,relatedIds,visibility});}
lore('setting','The scale of the day','Present-day fictional prairie country, early autumn. Overnight drizzle has passed; the morning is cool and brightening. This is a modest ranch with twelve cows and two leisure riding horses, not a large commercial operation. Ordinary meals, chores, conversations and rest are worthwhile scenes. There is no predetermined crisis or hidden mystery.',[],[],'always');
lore('cattle-round','The cattle feeding round','Supplementary cattle feeding uses Cattle Feed from Grain Hopper in Feed Shed. Whole scoops can be loaded into Tractor Feed Bin on Loader Tractor, driven to North Pasture and poured into Cattle Feed Trough. Tractor Cab is inside the tractor. Choose and state any moved whole-scoop count; loading and pouring are transfers, while actual eating consumes feed. This is a possible routine, not an event already completed.', ['cattle','cows','feeding','feed'],['feed-shed','grain-hopper','cattle-feed','feed-scoop','tractor','tractor-cab','tractor-bin','north-pasture','cattle-trough','herd']);
lore('horse-meals','Preparing the horses\' feed','Horse Pellets are in Horse Feed Bin and Hay Flakes in Hay Rack, both in Feed Shed. Clover Feed Bucket and Pippin Feed Bucket start in Stable Aisle. Feed can be carried to the horses or the horses brought in from Horse Paddock. Keep moved whole scoops and hay flakes explicit; no nutritional calculation is required.', ['horse feeding','pellets','hay','buckets'],['horse-feed-bin','horse-pellets','hay-rack','hay-flakes','feed-shed','clover-bucket','pippin-bucket','stable-aisle','horse-paddock','clover','pippin']);
lore('grooming','An unhurried grooming session','Grooming Kit in Tack Room contains Wooden Grooming Brush, Curry Comb and Hoof Pick. Clover and Pippin start in Horse Paddock; they can be brought to Stable Aisle. Taking a brush out, handing it over and putting it away are separate physical actions. The person holding a tool need not be its legal owner.', ['groom','grooming','brush','hoof'],['grooming-kit','grooming-brush','curry-comb','hoof-pick','tack-room','stable-aisle','horse-paddock','clover','pippin']);
lore('leisure-ride','Preparing a leisure ride','Clover uses Clover Halter and Lead, Clover Trail Saddle and Clover Bridle; Pippin uses Pippin Halter and Lead, Pippin Riding Saddle and Pippin Bridle. Charcoal Riding Helmet and Green Riding Helmet are available. The equipment is put away in Tack Room after use. Horse Paddock, Stable Aisle and Creek Loop Trail provide turnout, preparation and a gentle outing. Riding moves each rider and horse to the same destination; horses remain characters, not moving rooms.', ['ride','riding','saddle','tack'],['clover','pippin','clover-halter','clover-saddle','clover-bridle','erin-helmet','pippin-halter','pippin-saddle','pippin-bridle','alex-helmet','tack-room','horse-paddock','stable-aisle','creek-trail']);
lore('breakfast','A simple kitchen breakfast','Kitchen Table holds Alex Blue Mug, Erin Cream Mug and Household Notebook. Refrigerator holds Eggs; Pantry Cupboard holds Bread Slices. Kitchen Kettle and Recipe Book are nearby. Tap water, tea and basic staples are ordinary background. Count only explicitly tracked whole eggs or slices used, rather than inventing a complete ingredient ledger.', ['breakfast','toast','eggs','tea','baking'],['kitchen','kitchen-table','alex-mug','erin-mug','household-notebook','fridge','eggs','pantry','bread','kettle','recipe-book']);
lore('gate-repair','Adjusting the pasture latch','North Pasture Gate closes securely but its latch catches. Adjustable Spanner in Workshop Toolbox at Workshop is available for a small adjustment. A repair is optional; this is not an escaped-cattle emergency.', ['repair','latch','spanner','fix'],['pasture-gate','spanner','toolbox','workshop','north-pasture']);
lore('home-garden','Time around the house','Kitchen Garden has a small unfinished herb bed. Garden Basket there contains Garden Trowel and Gardening Gloves. Front Porch is pleasant for tea; Sitting Room has Evening Reading Book. Laundry Basket waits in Back Mudroom. These are alternatives for a quiet afternoon, not a compulsory checklist.', ['garden','herbs','laundry','reading','porch'],['garden','garden-basket','trowel','garden-gloves','porch','sitting-room','reading-book','laundry-basket','mudroom']);
lore('neighbor','Neighborly visits','June Calloway starts at June Smallholding, a fifteen-minute walk from the farmhouse by Farm Lane and County Road. She can visit or be invited for tea and a future ride, but mentioning her does not make her arrive. No visit is arranged at the opening.', ['june','neighbor','visit','invite'],['june','june-home','farm-lane','county-road','porch']);
const factPins=emptyFactPins();
factPins.rules=[{id:'animal-behaviour',text:'Animals behave as ordinary animals and do not speak human dialogue. Keep narrative viewpoint with an adult human unless the user explicitly changes the story style.'},{id:'tractor-model',text:'Loader Tractor is a moving place with Tractor Cab inside it; Tractor Feed Bin is an item container attached to the tractor. Driving moves the tractor place; the driver stays in the cab until exiting. Do not create a duplicate tractor item.'}];
const draft=setupDraftSchema.parse({id:randomUUID(),revision:0,createdAt:now,updatedAt:now,storyId:null,input:{title:'Red Willow Ranch',premise:'A warm slice-of-life story at a modest fictional prairie cattle ranch. Alex and Erin Morrow share a small farmhouse, twelve beef cows and two leisure riding horses, Clover and Pippin. Ben helps a few mornings a week; their neighbor June is a friend. A morning can include loading supplementary feed in the shed, driving it to the cows, making breakfast, grooming a horse or choosing a quiet ride. Other days leave room for the garden, laundry, small repairs, baking and neighborly tea. Begin at the farmhouse kitchen table after overnight drizzle, before the feeding round. Let relationships and everyday physical actions shape the story; no forced crisis or required sequence of chores.',castSize:7,narrationStyle:'Warm, grounded slice-of-life prose. Close third-person human viewpoint, tactile rural detail, natural dialogue and gentle humour. Give small practical actions room without turning each passage into a task list.',artStyle:'Natural-light rural photography, realistic materials and colours, calm compositions, soft prairie daylight.',adultContent:false,preferences:{tense:'past',person:'third-limited',passageWords:500,chapterWords:2500,writingGuide:'Stay with one human viewpoint per passage. Let each scene do one manageable thing and stop at the requested boundary. Show travel, boarding, exits and handovers when they occur. Use exact whole units for tracked transfers or consumption; do not guess numerical capacity from vague words. Background routines describe possibilities, not completed events. Allow conversation, rest and unfinished chores.',contentNotes:'Adult human cast; family-friendly domestic and farm life. Affection is welcome. No explicit sexual content, cruelty or forced catastrophe.'}},plan:{title:'Red Willow Ranch',chapterTitle:'A Morning at Home',canon,context,factPins}});
validateSetupPlan(draft.plan);
const archive=encodeSetupArchive(draft);assert.deepEqual(decodeSetupArchive(archive),draft);
writeFileSync(join(folder,'red-willow-ranch-setup.zip'),archive);save('setup.json',draft);

// Real import/export path in an in-memory database, then one fully mocked opening.
const testRoot=resolve('test-results');mkdirSync(testRoot,{recursive:true});
const scratch=mkdtempSync(join(testRoot,'red-willow-setup-audit-'));process.env.STORY_DATA_DIR=scratch;
const {StoryRepository}=await import('../../src/lib/server/repository');
const {generatePassage,previewContinuationContext}=await import('../../src/lib/server/story-generation');
const {connectionSchema}=await import('../../src/lib/server/connections');
const {estimateInputTokens}=await import('../../src/lib/server/token-budget');
const {getDiagnostics}=await import('../../src/lib/server/diagnostics');
const {applyStoryEffects}=await import('../../src/lib/story-effects');
const c=connectionSchema.parse(JSON.parse(readFileSync('config/connections.example.json','utf8')));c.text.model='mock-red-willow-audit';
try{
 const repo=new StoryRepository(':memory:');try{
  const imported=repo.importSetup(archive);assert.notEqual(imported.id,draft.id);assert.deepEqual(imported.plan,draft.plan);assert.equal(repo.listSetups().length,1);assert.equal(repo.list().length,0);
  const roundtrip=decodeSetupArchive(repo.exportSetup(imported.id,0));assert.deepEqual(roundtrip.plan,draft.plan);assert.deepEqual(roundtrip.input,draft.input);
 }finally{repo.close();}
 const base=setupStoryBase(draft),initial=structuredClone(base),opening=openingContext(base,''),requests:{stage:string;estimatedInputTokens:number;outputAllowance:number}[]=[];
 assert.deepEqual([...opening.scope.castIds].sort(),['alex','erin']);
 const auditParagraph='Alex listened to the easy rhythm of Erin\'s conversation while morning light spread across the kitchen wall. The room felt pleasantly familiar: the quiet hum near the window, a chair drawn close to the table, the smell of a home waking slowly. He answered her small joke with one of his own. Neither of them needed to hurry the silence that followed. There would be work later, and a dozen ordinary ways to spend the hours around it, but for the moment they were simply glad to be together. He thought about what she had said and waited for her next thought.';
 const proposal=await generatePassage({setup:draft},c,new AbortController().signal,()=>{},async(_url,init)=>{
  const body=JSON.parse(String(init!.body)),system=body.messages[0].content,extract=system.startsWith('Return {effects:'),review=system.startsWith('Review inventory consistency.');
  requests.push({stage:extract?'extraction':review?'inventory-review':'narration',estimatedInputTokens:estimateInputTokens(body.messages,body.response_format?.json_schema?.schema),outputAllowance:body.max_tokens});
  const result=extract?{effects:[],memory:{summary:'Alex and Erin share a quiet conversation in the kitchen. No outdoor chore or item transfer has occurred.',facts:[],openQuestions:[],characterIds:['alex','erin'],locationIds:['kitchen']}}:review?{consistent:true,issues:[]}:{title:'Morning light',chapterTitle:draft.plan!.chapterTitle,viewpointId:'alex',endOfChapter:false,paragraphs:Array.from({length:5},()=>auditParagraph)};
  return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(result)},finish_reason:'stop'}]}));
 });
 assert.equal(proposal.draft.viewpointId,'alex');assert.deepEqual(base,initial);assert.equal(requests.length,2);
 const scope=[];
 for(const [name,direction,requiredItems] of [
  ['cattle','Feed the cows.',['cattle-feed','grain-hopper','tractor-bin','cattle-trough']],
  ['grooming','Groom Pippin with the Wooden Grooming Brush.',['grooming-kit','grooming-brush','hoof-pick']],
  ['breakfast','Make eggs and toast for breakfast.',['eggs','bread','fridge','pantry']],
  ['repair','Repair the sticky pasture gate latch.',['spanner','toolbox','pasture-gate']],
  ['riding','Prepare for an easy ride along Creek Loop Trail.',['clover-saddle','pippin-saddle','clover-bridle','pippin-bridle','alex-helmet','erin-helmet']],
  ['garden','Work on the herb garden.',['garden-basket','trowel','garden-gloves']]
 ] as const){
  const story=structuredClone(base);story.context.sceneBrief={...emptyContext().sceneBrief,viewpointId:'alex'};
  story.passages=[{id:'audit-only',chapter:1,chapterTitle:draft.plan!.chapterTitle,title:'Quiet morning',viewpoint:'Alex Morrow',viewpointId:'alex',paragraphs:['Alex was in the Farmhouse Kitchen.'],direction:'',endOfChapter:false,createdAt:now}];
  const report=previewContinuationContext(story,direction,c);assert.ok(report.runnable,`${name}: ${report.warnings.join('; ')}`);
  const included=story.canon.items.filter(i=>report.sources.some(s=>s.id===i.id&&s.included));
  for(const id of requiredItems)assert.ok(included.some(i=>i.id===id),`${name} missing ${id}`);
  assert.deepEqual(report.warnings,[],`${name}: ${report.warnings.join('; ')}`);
  scope.push({case:name,direction,estimatedInputTokens:report.inputTokens,activeCast:report.selectedCharacterIds,selectedPlaces:report.selectedPlaceIds,items:included.map(i=>({id:i.id,name:i.name,holderId:i.ownerId})),warnings:report.warnings});
 }
 // Exercise the fixture's intended vehicle/holder model without changing the setup.
 const driving=structuredClone(canon);driving.characters.find(p=>p.id==='alex')!.locationId='tractor-cab';
 const moved=applyStoryEffects(driving,[{type:'place.update',placeId:'tractor',parentId:'north-pasture',evidence:'Alex drove Loader Tractor to North Pasture.'}],'Alex drove Loader Tractor to North Pasture.').canon;
 assert.equal(moved.characters.find(p=>p.id==='alex')!.locationId,'tractor-cab');assert.equal(moved.places.find(p=>p.id==='tractor-cab')!.parentId,'tractor');assert.equal(moved.items.find(i=>i.id==='tractor-bin')!.ownerId,'tractor');
 const parked=applyStoryEffects(moved,[{type:'character.move',characterId:'alex',locationId:'north-pasture',evidence:'Alex stepped down from Tractor Cab into North Pasture.'}],'Alex stepped down from Tractor Cab into North Pasture.').canon;
 assert.equal(parked.places.find(p=>p.id==='tractor')!.parentId,'north-pasture');
 const home=applyStoryEffects(parked,[{type:'character.move',characterId:'alex',locationId:'kitchen',evidence:'Alex walked home to Farmhouse Kitchen, leaving the tractor parked in North Pasture.'}],'Alex walked home to Farmhouse Kitchen, leaving the tractor parked in North Pasture.').canon;
 assert.equal(home.characters.find(p=>p.id==='alex')!.locationId,'kitchen');assert.equal(home.places.find(p=>p.id==='tractor')!.parentId,'north-pasture');assert.equal(home.items.find(i=>i.id==='tractor-bin')!.ownerId,'tractor');
 const loadQuote='Alex loaded exactly twelve level scoops of Cattle Feed from Grain Hopper into Tractor Feed Bin.';
 const loaded=applyStoryEffects(canon,[{type:'item.split',ref:'new-loaded-feed',itemId:'cattle-feed',expectedQuantity:120,quantity:12,ownerId:'tractor-bin',evidence:loadQuote}],loadQuote,()=> 'audit-loaded-feed').canon;
 assert.equal(loaded.items.find(i=>i.id==='cattle-feed')!.quantity,108);assert.equal(loaded.items.find(i=>i.id==='audit-loaded-feed')!.quantity,12);
 const pourQuote='Alex poured all twelve scoops from Tractor Feed Bin into Cattle Feed Trough.';
 const poured=applyStoryEffects(loaded,[{type:'item.transfer',itemId:'audit-loaded-feed',fromOwnerId:'tractor-bin',toOwnerId:'cattle-trough',evidence:pourQuote}],pourQuote).canon;
 const eatQuote='The cows ate exactly four of those twelve scoops, leaving eight in the trough.';
 const eaten=applyStoryEffects(poured,[{type:'item.quantity',itemId:'audit-loaded-feed',expectedQuantity:12,quantity:8,evidence:eatQuote}],eatQuote).canon;
 assert.equal(eaten.items.find(i=>i.id==='audit-loaded-feed')!.ownerId,'cattle-trough');assert.equal(eaten.items.find(i=>i.id==='audit-loaded-feed')!.quantity,8);
 assert.equal(eaten.items.filter(i=>i.name==='Cattle Feed').reduce((sum,i)=>sum+i.quantity,0),116);assert.equal(canon.items.find(i=>i.id==='cattle-feed')!.quantity,120);
 save('validation.json',{validatedAt:now,kind:'unfinished story setup',archive:'red-willow-ranch-setup.zip',archiveBytes:archive.length,counts:{humanCharacters:4,horses:2,herdGroups:1,cowsInGroup:12,cast:canon.characters.length,places:canon.places.length,items:canon.items.length,containers:canon.items.filter(i=>i.isContainer).length,lore:context.lore.length,relationships:canon.relationships.length,threads:canon.threads.length},schemaAndGraph:true,archiveRoundtrip:true,inMemoryRepositoryImportExport:true,openingOnlyAlexAndErin:true,movingTractorAndParkedExit:true,feedSplitTransferConsumption:{validated:true,initialStock:120,loaded:12,remainingInHopper:108,consumed:4,remainingInTrough:8,suppliedEffectsOnly:true},realModelCalls:0,networkCalls:0,normalLibraryChanged:false,requestAudit:{contextTokens:c.text.contextTokens,method:'app conservative token estimate; mocked completions, not model-quality evidence',opening:requests,directions:scope},limitations:'The mock opening is diagnostic only and is not in the archive. Supplied-effect checks validate graph and state handling, not live extraction quality. This is a curated starting state, not evidence that a live model will always preserve it. Feeding quantities are story inventory units, not animal-care advice. Physical holder/storage is tracked; legal title is described only in notes.'});
}finally{getDiagnostics().close();assert.ok(scratch.startsWith(testRoot+sep+'red-willow-setup-audit-'));rmSync(scratch,{recursive:true,force:true});}

// A companion diagram, not an image reference or an extra archive entry.
const escape=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const label=(x:number,y:number,lines:string[],size=16,fill='#243d35')=>lines.map((line,i)=>`<text x="${x}" y="${y+i*(size+8)}" font-size="${size}" fill="${fill}">${escape(line)}</text>`).join('');
function box(x:number,y:number,w:number,h:number,title:string,lines:string[],fill='#fbfaf2'){
 return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="13" fill="${fill}" stroke="#849a7b" stroke-width="2"/>${label(x+20,y+30,[title],19)}${label(x+20,y+60,lines,15)}`;
}
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="1150" viewBox="0 0 1500 1150"><defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="none" stroke="#a45a2a" stroke-width="1.5"/></marker></defs><rect width="1500" height="1150" fill="#eff2e7"/><g font-family="Segoe UI,Arial,sans-serif">${label(45,48,['RED WILLOW RANCH'],30)}${label(47,82,['Starting layout · schematic, not to scale · north is up'],17)}
${box(45,115,480,150,'NORTH PASTURE',['12 cows · feed trough initially empty','Water trough · secure gate with a sticky latch','The tractor can park here after the feeding round.'],'#dce8c8')}
${box(555,115,435,150,'HORSE AREA',['Horse Paddock: Clover + Pippin, untacked','Schooling Ring · water trough','Gate to Creek Loop Trail'],'#dce8c8')}
${box(1020,115,435,150,'CREEK LOOP TRAIL',['Willow shade · creek crossing','Quiet riding route back to the horse yard'],'#d5e5cf')}
<path d="M285 425 V282" stroke="#a45a2a" stroke-width="3" stroke-dasharray="9 7" fill="none" marker-end="url(#arrow)"/>${label(302,300,['Optional feeding route'],14,'#955026')}
${box(45,335,200,175,'FEED SHED',['Grain Hopper','  120 feed scoops','Horse bin: 40 scoops','Hay Rack: 60 flakes'])}
${box(275,335,250,175,'FARM YARD',['Loader Tractor [place]','  Tractor Cab [place]','  Feed Bin [container]','Tractor starts parked.'],'#e8dfce')}
${box(555,305,435,205,'SMALL STABLE',['Stable Aisle: Ben + two empty feed buckets','Tack Room: grooming kit, saddles, bridles, helmets','Clover Stall: empty · Pippin Stall: empty','Bring horses in from paddock as needed.'])}
${box(1020,305,435,205,'SOUTH HAY MEADOW',['Cut grass field · boundary walks','Easy riding when the ground is firm','Connected to the yard and creek loop'],'#dce8c8')}
${box(45,540,480,125,'WORKSHOP',['Workshop Toolbox → spanner + hammer','A small repair scene is available, not mandatory.'])}
${box(555,540,435,125,'KITCHEN GARDEN',['Garden Basket → trowel + gloves','Herbs · carrots · unfinished bed edging'],'#dce8c8')}
${box(1020,540,435,125,'LANE + NEIGHBOR',['Farm Lane → County Road → June Smallholding','June starts at home, about 15 minutes away.'])}
<rect x="45" y="700" width="945" height="307" rx="17" fill="#faf6e8" stroke="#849a7b" stroke-width="2"/>${label(65,733,['SMALL FARMHOUSE · ROOM INSET'],20)}
${box(65,754,300,115,'KITCHEN · OPENING',['Alex + Erin at the table','Mugs · notebook · fridge · pantry'],'#fff0c8')}
${box(385,754,260,115,'SITTING ROOM',['Reading · mending · conversation'])}
${box(665,754,305,115,'BACK MUDROOM',['Boots · coats · laundry basket','Back door toward Farm Yard'])}
${box(65,889,200,96,'MAIN BEDROOM',['Alex + Erin'])}
${box(285,889,220,96,'SPARE BEDROOM',['Guest bed · sewing'])}
${box(525,889,200,96,'BATHROOM',['Ordinary home comforts'])}
${box(745,889,225,96,'FRONT PORCH',['Tea · visits · garden view'])}
${box(1020,700,435,307,'HOW THE RECORDS FIT',['Places nest inside places.','Tractor moves; cab and attached bin follow.','Items sit with a person, place or container.','Horses and cows use cast location records.','Feed stacks count whole scoops / flakes.','No reference images are required.'],'#e4eaf1')}
${label(47,1055,['Feed path: Grain Hopper → Tractor Feed Bin → Cattle Feed Trough → consumption only when eaten.'],18)}${label(47,1092,['This map shows the starting state. Travel, handovers, loading and completed chores change canon during play.'],16)}
</g></svg>`;
writeFileSync(join(folder,'ranch-map.svg'),svg);writeFileSync(join(folder,'ranch-map.png'),await sharp(Buffer.from(svg)).png().toBuffer());
console.log(JSON.stringify({archive:join(folder,'red-willow-ranch-setup.zip'),cast:canon.characters.length,places:canon.places.length,items:canon.items.length,validated:true,realModelCalls:0},null,2));
