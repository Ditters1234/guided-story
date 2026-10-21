import { z } from 'zod';
import type { Canon, Story } from './story';
import { StoryError } from './errors';
import { itemRootOwnerId } from './inventory';

export const factPinKinds = ['character','place','item','relationship','thread','world'] as const;
export type FactPinKind = typeof factPinKinds[number];
type Field = { field: string; label: string };
const fields = (values: Record<string,string>): Field[] => Object.entries(values).map(([field,label])=>({field,label}));
export const factPinFields: Record<FactPinKind,Field[]> = {
  character: fields({name:'Name',role:'Role',locationId:'Location',notes:'Supplemental character notes',currentState:'Current feelings / intentions',
    'visual.age':'Actual age','visual.apparentAge':'Apparent age','visual.gender':'Gender','visual.presentation':'Presentation','visual.species':'Species',
    'visual.skin':'Skin','visual.build':'Build','visual.face':'Face','visual.hair':'Hair','visual.eyes':'Eyes','visual.distinctive':'Distinctive features',
    'persona.personality':'Personality','persona.voice':'Voice','persona.motives':'Motives','persona.history':'History',
    'wardrobe.upper_body':'Upper body clothing','wardrobe.lower_body':'Lower body clothing','wardrobe.footwear':'Footwear','wardrobe.accessories':'Accessories',
    injuries:'Injuries',appearanceNotes:'Supplemental appearance notes',outfitNotes:'Supplemental outfit notes'}),
  place: fields({name:'Name',description:'Description',visualDescription:'Visual description',parentId:'Containing place'}),
  item: fields({name:'Name',description:'Description',visualDescription:'Visual description',quantity:'Quantity',ownerId:'Owner / storage',rootOwnerId:'Ultimate owner / location',equipped:'Equipped / worn',isContainer:'Container',unlimited:'Always available supply'}),
  relationship: fields({fromId:'From cast member',toId:'To cast member',notes:'Relationship notes'}),
  thread: fields({title:'Title',notes:'Thread notes',status:'Status'}),
  world: fields({funds:'Shared funds',cargoNotes:'Cargo notes'})
};

export const factPinSchema = z.strictObject({kind:z.enum(factPinKinds),recordId:z.string().min(1).max(100).nullable(),field:z.string().min(1).max(80)})
  .superRefine((pin,ctx)=>{
    if(!factPinFields[pin.kind].some(f=>f.field===pin.field))ctx.addIssue({code:'custom',path:['field'],message:'Choose a supported field for this record type.'});
    if((pin.kind==='world')!==(pin.recordId===null))ctx.addIssue({code:'custom',path:['recordId'],message:'World pins have no record ID; record pins need an ID.'});
  });
export const factPinsSchema = z.strictObject({
  fields:z.array(factPinSchema).max(200).default([]),
  rules:z.array(z.strictObject({id:z.string().min(1).max(100),text:z.string().trim().min(1).max(2000)})).max(50).default([])
}).superRefine((pins,ctx)=>{
  const keys=pins.fields.map(pin=>JSON.stringify([pin.kind,pin.recordId,pin.field]));
  if(new Set(keys).size!==keys.length)ctx.addIssue({code:'custom',path:['fields'],message:'The same field cannot be pinned twice.'});
  if(new Set(pins.rules.map(rule=>rule.id)).size!==pins.rules.length)ctx.addIssue({code:'custom',path:['rules'],message:'World rules need unique IDs.'});
});
export type FactPin = z.infer<typeof factPinSchema>;
export type FactPins = z.infer<typeof factPinsSchema>;
export const emptyFactPins = ():FactPins => ({fields:[],rules:[]});

const collections = {character:'characters',place:'places',item:'items',relationship:'relationships',thread:'threads'} as const;
function record(canon:Canon,kind:FactPinKind,id:string|null):unknown {
  return kind==='world'?canon:canon[collections[kind]].find(row=>row.id===id);
}
function valueAt(row:unknown,path:string):unknown {
  return path.split('.').reduce<unknown>((value,key)=>value&&typeof value==='object'?(value as Record<string,unknown>)[key]:undefined,row);
}
function pinnedValue(canon:Canon,pin:FactPin):unknown {
  if(pin.kind==='item'&&pin.field==='rootOwnerId')return itemRootOwnerId(canon,pin.recordId!);
  const value=valueAt(record(canon,pin.kind,pin.recordId),pin.field);
  if(pin.field==='currentState'||pin.field==='visualDescription')return value??'';
  return pin.kind==='item'&&['isContainer','unlimited'].includes(pin.field)?Boolean(value):value;
}
export function factPinRecords(story:Pick<Story,'canon'>,kind:FactPinKind):{id:string;label:string}[] {
  if(kind==='world')return [];
  return story.canon[collections[kind]].map(row=>({id:row.id,label:'name' in row?row.name:'title' in row?row.title:
    `${story.canon.characters.find(c=>c.id===row.fromId)?.name||row.fromId} → ${story.canon.characters.find(c=>c.id===row.toId)?.name||row.toId}`}));
}
export function validateFactPins(story:Pick<Story,'canon'|'factPins'>):void {
  const pins=factPinsSchema.parse(story.factPins);
  for(const pin of pins.fields){
    const row=record(story.canon,pin.kind,pin.recordId);
    if(!row||pinnedValue(story.canon,pin)===undefined)throw new StoryError('A pinned field refers to a missing record or field. Remove that pin or reload the saved story.');
  }
}
export function resolvedFactPins(story:Pick<Story,'canon'|'factPins'>) {
  return {fields:story.factPins.fields.map(pin=>({...pin,
    recordLabel:pin.kind==='world'?'World':factPinRecords(story,pin.kind).find(row=>row.id===pin.recordId)?.label||pin.recordId||'Missing record',
    label:factPinFields[pin.kind].find(field=>field.field===pin.field)?.label||pin.field,
    value:pinnedValue(story.canon,pin)
  })),rules:story.factPins.rules};
}

/** AI commits compare final canonical values, including deletions and indirect changes.
 * Explicit manual edits may change a pinned value; the pin then protects that saved value. */
export function assertFactPinsUnchanged(story:Pick<Story,'canon'|'factPins'>,after:Canon):void {
  for(const pin of resolvedFactPins(story).fields){
    const next=record(after,pin.kind,pin.recordId);
    if(!next||JSON.stringify(pinnedValue(after,pin))!==JSON.stringify(pin.value))
      throw new StoryError(`Pinned ${pin.label.toLocaleLowerCase()} for ${pin.recordLabel} cannot be changed by AI. Edit it manually or remove its pin first. Nothing was committed.`);
  }
}
