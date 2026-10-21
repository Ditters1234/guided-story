import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { StoryRepository } from '../src/lib/server/repository';
import { blankSetupPlan } from '../src/lib/setup';
import { connectionSchema } from '../src/lib/server/connections';
import { generatePassage, generateSetupCharacter } from '../src/lib/server/story-generation';
import { generateSetupRecord } from '../src/lib/server/setup-generation';

const settings = () => connectionSchema.parse({
  ...JSON.parse(readFileSync('config/connections.example.json', 'utf8')),
  text: { baseUrl:'http://localhost:9999/v1', model:'test-model', maxTokens:4096, contextTokens:65536, temperature:0.8, structuredOutput:'prompt' }
});
const completion = (value:unknown) => new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(value)},finish_reason:'stop'}]}));

function fixture(r:StoryRepository) {
  const setup = r.createSetup({premise:'A courier waits at a harbor.',castSize:1,preferences:{passageWords:100,writingGuide:'Keep dialogue concise and avoid repeated gestures.',contentNotes:'Avoid graphic injury.'}},randomUUID());
  const plan = blankSetupPlan();
  plan.canon.characters[0].currentState = 'Worried about the delay; intends to check the manifest.';
  plan.canon.places[0].visualDescription = 'PICTURE ONLY: white pillars and a red tiled floor.';
  plan.canon.items.push({id:randomUUID(),name:'Manifest case',description:'Holds delivery papers.',visualDescription:'PICTURE ONLY: a flat copper box with a blue clasp.',quantity:1,ownerId:plan.canon.characters[0].id,equipped:false});
  return r.saveSetup(setup.id,{expectedRevision:setup.revision,requestId:randomUUID(),input:setup.input,plan});
}

test('new story fields survive setup ZIP, opening, story save and story ZIP without adding generation stages',async()=>{
  const r = new StoryRepository(':memory:');
  try {
    const saved = fixture(r), imported = r.importSetup(r.exportSetup(saved.id));
    assert.deepEqual(imported.input,saved.input);
    assert.deepEqual(imported.plan,saved.plan);
    const plan = imported.plan!, person = plan.canon.characters[0], place = plan.canon.places[0];
    const prose = 'The manifest rested on the desk beside the courier, who listened to the clock. Beyond the window, a line of boats waited beside the harbor wall. The clerk was busy with a ledger, so the courier waited for her to finish the entry. A bell rang somewhere in the building. The clerk paused above the ledger and looked toward the door. Neither of them spoke until the sound faded. Then the courier asked whether the afternoon delivery had arrived, keeping one hand on the closed case.';
    let calls = 0;
    const proposal = await generatePassage({setup:imported},settings(),new AbortController().signal,()=>{},async(_url,init)=>{
      calls++;
      const body = JSON.parse(String(init!.body)), data = JSON.parse(body.messages[1].content);
      assert.doesNotMatch(body.messages[1].content,/PICTURE ONLY/);
      if (body.messages[0].content.startsWith('Return {effects:')) {
        assert.equal(data.before.characters[0].currentState,person.currentState);
        return completion({effects:[],memory:{summary:'The courier asks about a delivery.',facts:[],openQuestions:[],characterIds:[person.id],locationIds:[place.id]}});
      }
      assert.equal(data.preferences.writingGuide,imported.input.preferences.writingGuide);
      assert.equal(data.preferences.contentNotes,imported.input.preferences.contentNotes);
      assert.equal(data.canon.characters[0].currentState,person.currentState);
      return completion({title:'The afternoon delivery',chapterTitle:plan.chapterTitle,viewpointId:person.id,endOfChapter:false,paragraphs:[prose]});
    });
    assert.equal(calls,2,'The additions must not introduce extra model stages.');
    const story = r.commitOpening(imported.id,imported.revision,randomUUID(),'structural-opening',proposal);
    assert.deepEqual(story.canon,plan.canon);
    assert.equal(story.preferences.writingGuide,imported.input.preferences.writingGuide);
    assert.equal(story.context.sceneBrief.purpose,'');
    const restored = await r.import(r.export(story.id));
    assert.deepEqual(restored.canon,story.canon);
    assert.deepEqual(restored.preferences,story.preferences);
  } finally { r.close(); }
});

test('targeted redesigns preserve optional state and visual descriptions when an older model response omits them',async()=>{
  const r = new StoryRepository(':memory:');
  try {
    const saved = fixture(r), current = saved.plan!.canon.characters[0];
    const revised = await generateSetupCharacter(saved,current.id,'Make the voice more direct.',settings(),new AbortController().signal,async()=>completion({name:current.name,role:current.role,notes:current.notes,visual:current.visual,persona:{...current.persona,voice:'Short, direct sentences.'},wardrobe:current.wardrobe,injuries:current.injuries,appearanceNotes:current.appearanceNotes,outfitNotes:current.outfitNotes,locationId:current.locationId}));
    assert.equal(revised.canon.characters[0].currentState,current.currentState);
    for (const kind of ['place','item'] as const) {
      const row = kind==='place' ? saved.plan!.canon.places[0] : saved.plan!.canon.items[0];
      const {id,visualDescription,...response} = row;
      const next = await generateSetupRecord(saved,{kind,mode:'revise',targetId:id,direction:'Clarify the narrative description.'},settings(),new AbortController().signal,async()=>completion({...response,description:'An updated narrative description.'}));
      const result = kind==='place' ? next.canon.places[0] : next.canon.items[0];
      assert.equal(result.visualDescription,visualDescription);
    }
    assert.deepEqual(r.readSetup(saved.id),saved);
  } finally { r.close(); }
});
