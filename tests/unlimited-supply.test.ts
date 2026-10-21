import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSample } from '../src/lib/server/fixture';
import { canonSchema, validateCanonicalState, type Canon } from '../src/lib/story';
import { splitItemStack, itemRootOwnerId } from '../src/lib/inventory';
import { applyStoryEffects } from '../src/lib/story-effects';

const evidence='Elias drew two sugar cubes from his supply and gave them to Mira.';
function inventory():Canon {
  const canon=createSample().canon;
  canon.items.push({id:'sugar',name:'Sugar cubes',description:'Small white cubes for pony treats.',visualDescription:'White sugar cubes.',quantity:1,ownerId:'elias',equipped:false,unlimited:true});
  return canon;
}
const draw={type:'item.draw',ref:'new-cubes',itemId:'sugar',quantity:2,ownerId:'mira',evidence};

test('old inventory and omitted unlimited fields retain counted behavior',()=>{
  const canon=createSample().canon,parsed=canonSchema.parse(canon);
  assert.deepEqual(parsed,canon);
  assert.ok(parsed.items.every(item=>!Object.hasOwn(item,'unlimited')));
  const result=applyStoryEffects(canon,[{type:'item.quantity',itemId:'fob',expectedQuantity:1,quantity:0,evidence}],evidence);
  assert.ok(!result.canon.items.some(item=>item.id==='fob'));
});

test('unlimited supplies are quantity-one noncontainers and cannot be equipped',()=>{
  validateCanonicalState(inventory());
  for(const fields of [{quantity:2},{isContainer:true},{equipped:true}]){
    const canon=inventory();Object.assign(canon.items.find(item=>item.id==='sugar')!,fields);
    assert.throws(()=>validateCanonicalState(canon),/unlimited supply/i);
  }
  const finite=inventory();Object.assign(finite.items.find(item=>item.id==='sugar')!,{unlimited:false,quantity:3,equipped:true});
  validateCanonicalState(finite);
});

test('draw creates a finite portion at its evidenced holder without changing the source',()=>{
  const canon=inventory(),before=structuredClone(canon);
  const result=applyStoryEffects(canon,[draw],evidence,()=>'drawn-cubes');
  assert.deepEqual(canon,before);
  assert.deepEqual(result.canon.items.find(item=>item.id==='sugar'),before.items.find(item=>item.id==='sugar'));
  assert.equal(result.assigned['new-cubes'],'drawn-cubes');
  assert.deepEqual(result.canon.items.find(item=>item.id==='drawn-cubes'),{
    id:'drawn-cubes',name:'Sugar cubes',description:'Small white cubes for pony treats.',visualDescription:'White sugar cubes.',quantity:2,ownerId:'mira',equipped:false,isContainer:false
  });
  assert.equal(itemRootOwnerId(result.canon,'drawn-cubes'),'mira');
  validateCanonicalState(result.canon);
});

test('drawn portions can be consumed or split but cannot supply more unlimited portions',()=>{
  const canon=inventory(),before=structuredClone(canon);
  const consumed=applyStoryEffects(canon,[draw,{type:'item.quantity',itemId:'new-cubes',expectedQuantity:2,quantity:0,evidence}],evidence,()=>'drawn-cubes');
  assert.deepEqual(consumed.canon,canon);
  let next=0;
  const split=applyStoryEffects(canon,[draw,{type:'item.split',ref:'new-second',itemId:'new-cubes',expectedQuantity:2,quantity:1,ownerId:'elias',evidence}],evidence,()=>`portion-${++next}`);
  assert.equal(split.canon.items.find(item=>item.id==='portion-1')!.quantity,1);
  assert.equal(split.canon.items.find(item=>item.id==='portion-2')!.quantity,1);
  assert.throws(()=>applyStoryEffects(canon,[draw,{...draw,ref:'new-more',itemId:'new-cubes'}],evidence),/only be drawn from an unlimited supply/);
  assert.deepEqual(canon,before);
});

test('counted sources cannot be drawn from, and unlimited sources cannot be depleted or split',()=>{
  const canon=inventory(),before=structuredClone(canon);
  for(const effect of [
    {...draw,itemId:'fob'},
    {type:'item.quantity',itemId:'sugar',expectedQuantity:1,quantity:0,evidence},
    {type:'item.quantity',itemId:'sugar',expectedQuantity:1,quantity:20,evidence},
    {type:'item.split',ref:'new-part',itemId:'sugar',expectedQuantity:2,quantity:1,ownerId:'mira',evidence},
    {type:'item.equip',itemId:'sugar',equipped:true,evidence}
  ]){
    assert.throws(()=>applyStoryEffects(canon,[effect],evidence),/unlimited|counted portion/i);
    assert.deepEqual(canon,before);
  }
  assert.throws(()=>splitItemStack(canon,'sugar',1,'mira'),/Unlimited supplies cannot be split/);
  assert.deepEqual(canon,before);
});

test('draws validate quantities, references, evidence and holders before committing',()=>{
  const canon=inventory(),before=structuredClone(canon);
  for(const quantity of [0,-1,1.5,1000001])assert.throws(()=>applyStoryEffects(canon,[{...draw,quantity}],evidence));
  assert.throws(()=>applyStoryEffects(canon,[{...draw,ownerId:'missing'}],evidence),/invalid entity/);
  assert.throws(()=>applyStoryEffects(canon,[draw],'The crew waited.'),/evidence/);
  assert.throws(()=>applyStoryEffects(canon,[draw],evidence,()=>'sugar'),/collided/);
  assert.throws(()=>applyStoryEffects(canon,[draw,{...draw,ref:'new-other'}],evidence,()=>'same-id'),/collided/);
  assert.deepEqual(canon,before);
});

test('moving an unlimited supply changes its holder while leaving its policy intact',()=>{
  const canon=inventory(),result=applyStoryEffects(canon,[{type:'item.transfer',itemId:'sugar',fromOwnerId:'elias',toOwnerId:'mira',evidence}],evidence);
  assert.equal(result.canon.items.find(item=>item.id==='sugar')!.ownerId,'mira');
  assert.equal(result.canon.items.find(item=>item.id==='sugar')!.unlimited,true);
  assert.equal(result.canon.items.find(item=>item.id==='sugar')!.quantity,1);
  assert.equal(canon.items.find(item=>item.id==='sugar')!.ownerId,'elias');
});

test('ordinary creation and update effects cannot enable or remove unlimited supply policy',()=>{
  const canon=inventory();
  assert.throws(()=>applyStoryEffects(canon,[{type:'item.update',itemId:'sugar',unlimited:false,evidence}],evidence));
  assert.throws(()=>applyStoryEffects(canon,[{type:'item.create',ref:'new-stock',name:'Sugar cubes',description:'More cubes.',quantity:1,ownerId:'mira',equipped:false,unlimited:true,evidence}],evidence));
});
