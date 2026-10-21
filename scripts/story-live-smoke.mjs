// Optional real-model acceptance check. Uses the saved play text connection, isolated saves, and no image generation.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const folder = mkdtempSync(join(tmpdir(),'storyweaver-live-'));
process.env.STORY_DATA_DIR = folder;
try {
  const { StoryRepository } = await import('../src/lib/server/repository.ts');
  const { connectionSchema } = await import('../src/lib/server/connections.ts');
  const { generateSetup, generatePassage, narrationSchema } = await import('../src/lib/server/story-generation.ts');
  const { parseModelObject } = await import('../src/lib/server/model-output.ts');
  const { getDiagnostics } = await import('../src/lib/server/diagnostics.ts');
  const c = connectionSchema.parse(JSON.parse(readFileSync('config/connections.play.local.json','utf8')));
  const r = new StoryRepository(join(folder,'library.sqlite'));
  try {
    const resume = process.argv.includes('--resume-opening'), checkpoint = resume ? JSON.parse(readFileSync('test-results/new-story-live-setup.json','utf8')) : null;
    let draft = r.createSetup(checkpoint?.input || { premise: 'A science-fiction story about a rogue space trader and their two crew members. Their small ship receives a delivery with an incomplete manifest. Keep the cast human adults and the opening fully clothed and nonsexual.', castSize:3, preferences:{passageWords:200} },randomUUID());
    console.log(resume ? 'Reusing the validated real-model setup/opening checkpoint; retesting live continuation.' : 'Generating setup with the saved local model and output limit.');
    const plan = checkpoint?.plan || await generateSetup(draft,c,new AbortController().signal);
    draft = r.commitGeneratedSetup(draft.id,draft.revision,randomUUID(),'live-setup',plan);
    assert.equal(plan.canon.characters.length,3); assert.ok(plan.canon.characters.every(c=>c.noNsfw));
    console.log(`Setup passed: ${plan.canon.characters.length} cast, ${plan.canon.places.length} places, ${plan.canon.items.length} possessions. Writing the opening.`);
    let replay;
    if (resume) {
      const history=JSON.parse(readFileSync('test-results/new-story-live-failure.json','utf8')).traces;
      const opening=history.find(t=>t.kind==='story-opening'&&t.status==='complete');
      const narration=parseModelObject(opening.response.content,narrationSchema,'cached opening');
      const effects=history.find(t=>t.kind==='story-effects'&&JSON.stringify(JSON.parse(t.request.messages[1].content).paragraphs)===JSON.stringify(narration.paragraphs));
      const responses=[opening.response.content,effects.response.content]; let index=0;
      replay=async()=>new Response(JSON.stringify({choices:[{message:{content:responses[index++]},finish_reason:'stop'}]}));
    }
    const proposal = await generatePassage({setup:draft},c,new AbortController().signal,()=>{},replay);
    let story = r.commitOpening(draft.id,draft.revision,randomUUID(),'live-opening',proposal);
    console.log('Opening and evidenced world changes committed. Continuing with the same model.');
    const probe=process.argv.includes('--effects-probe');let fetcher;
    let expectedTransfer;
    if(probe){
      const item=story.canon.items.find(i=>story.canon.characters.some(p=>p.id===i.ownerId));assert.ok(item,'Need one starting possession held by a character.');
      const sender=story.canon.characters.find(p=>p.id===item.ownerId),recipient=story.canon.characters.find(p=>p.id!==sender.id);
      expectedTransfer={itemId:item.id,ownerId:recipient.id};
      const paragraphs=[`${sender.name} handed ${recipient.name} the ${item.name}. ${recipient.name} accepted the ${item.name} and kept it.`, 'For a moment neither spoke. The familiar engine vibration travelled through the deck beneath their boots. The light above the table made every scratch in its surface stand out, and the quiet between them seemed longer than it really was. This was an ordinary exchange between people who knew the weight of small responsibilities. There was no ceremony to it, no reason to raise their voices or turn toward the door. The recipient looked down at the possession, then back at their colleague. Their hands were steady. Around them the ship continued its usual low mechanical hum, as indifferent to the gesture as it was to the conversation that had paused.'];
      fetcher=async(url,init)=>{const body=JSON.parse(String(init.body));if(body.messages[0].content.startsWith('Return {effects:'))return fetch(url,init);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({title:'QA possession handoff',chapterTitle:story.passages[0].chapterTitle,viewpointId:sender.id,endOfChapter:false,paragraphs})},finish_reason:'stop'}]}));};
      console.log('Testing the real extractor on an explicit possession handoff; prose is synthetic for this probe.');
    }
    const continuation = await generatePassage({story,mode:'continue',direction:'Follow the crew as they examine the incomplete manifest without opening the cargo yet.'},c,new AbortController().signal,()=>{},fetcher);
    story = r.commitGeneratedPassage(story.id,{expectedRevision:story.revision,requestId:randomUUID(),proposal:continuation},'live-continuation');
    assert.equal(story.passages.length,2); assert.equal(story.context.memories.length,2);
    if(expectedTransfer)assert.equal(story.canon.items.find(i=>i.id===expectedTransfer.itemId).ownerId,expectedTransfer.ownerId);
    const proof=probe?'test-results/new-story-effects-probe.json':'test-results/new-story-live.json';
    mkdirSync('test-results',{recursive:true}); writeFileSync(proof,JSON.stringify(story,null,2));
    console.log(probe?`PASS: real local extractor produced a valid ownership transfer from synthetic handoff prose; committed atomically. Proof: ${proof}`:`PASS: real local setup, reviewed opening, continuation, ${story.context.memories.length} memories, atomic saves. Story content proof: ${proof}`);
  } finally { r.close(); }
} catch (e) {
  const { getDiagnostics } = await import('../src/lib/server/diagnostics.ts');
  mkdirSync('test-results',{recursive:true}); writeFileSync('test-results/new-story-live-failure.json',JSON.stringify({error:e.message,traces:getDiagnostics().traces()},null,2));
  throw e;
} finally {
  // Diagnostic databases retain an open process-level handle; close it before deleting this isolated folder.
  const { getDiagnostics } = await import('../src/lib/server/diagnostics.ts');
  getDiagnostics().close();
  const target=resolve(folder); if((target.startsWith(resolve(tmpdir())+'\\')||target.startsWith(resolve(tmpdir())+'/'))&&basename(target).startsWith('storyweaver-live-')) rmSync(target,{recursive:true,force:true});
}
