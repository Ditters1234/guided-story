<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import type { PageData } from './$types';
  import type { Character, LibraryEntry, Story } from '#lib/story';
  import DevMenu from '#lib/DevMenu.svelte';
  import SettingsPanel from '#lib/SettingsPanel.svelte';
  import MediaPanel from '#lib/MediaPanel.svelte';
  import { mediaUrl } from '#lib/media';
  import NewStory from '#lib/NewStory.svelte';
  import type { SetupDraft } from '#lib/setup';
  import type { PublicConnections } from '#lib/settings';
  import { captureBrowserConsole } from '#lib/client-console';
  import { countWords, chapterStats } from '#lib/story-length';
  import IllustrationStudio from '#lib/IllustrationStudio.svelte';
  import StoryEditor from '#lib/StoryEditor.svelte';
  import SceneDirection from '#lib/SceneDirection.svelte';
  import ScenePreparation from '#lib/ScenePreparation.svelte';
  import PassageRecovery from '#lib/PassageRecovery.svelte';
  import LoreDevPanel from '#lib/LoreDevPanel.svelte';
  import StoryCorrections from '#lib/StoryCorrections.svelte';
  import RecordEditor from '#lib/RecordEditor.svelte';
  import FactPinsPanel from '#lib/FactPinsPanel.svelte';
  import LibraryControls from '#lib/LibraryControls.svelte';
  import type { RecordKind } from '#lib/record-editing';
  import { APP_VERSION } from '#lib/version';
  import { continuityQuestion } from '#lib/narrative-quality';
  import HelpPanel from '#lib/HelpPanel.svelte';
  import RequestViewer from '#lib/RequestViewer.svelte';
  import CharacterProfileEditor from '#lib/CharacterProfileEditor.svelte';
  import { normalizeCharacterProfile, personaFields, wardrobeFields } from '#lib/character-profile';
  import { identityFields } from '#lib/visual-identity';
  import { reportUiError } from '#lib/ui-feedback';
  import { inventoryHolders, inventoryPath, itemRootOwnerId } from '#lib/inventory';

  let { data }: { data: PageData } = $props();
  let story = $state<Story | null>(untrack(() => data.story));
  let library = $state<LibraryEntry[]>(untrack(() => data.library));
  let setups = $state<SetupDraft[]>(untrack(() => data.setups));
  let setupInitial = $state<SetupDraft | null>(null), setupSession = $state(0), setupDirty = $state(false);
  let recoveryRefresh=$state(0),retainedCount=$state(0),recoveryDirty=$state(false);
  let liveGenerating = $state(false), liveController: AbortController | null = null;
  let liveRequest: { key: string; requestId: string } | null = null;
  function newStory() { if (busy || !leaveEditor()) return; setupInitial = null; setupSession++; view = 'new'; }
  function draftSaved(draft: SetupDraft) { setups = [draft, ...setups.filter(s => s.id !== draft.id)]; localStorage.setItem('guided-story-active-setup', draft.id); }
  function storyCreated(saved: Story, setupId: string) { localStorage.removeItem('guided-story-active-setup'); prepare(saved); updateLibrary(saved); setups = setups.filter(s => s.id !== setupId); view = 'read'; status = 'Opening passage saved · Chapter one is underway'; }
  async function resumeSetup(id: string) {
    if (busy) return; busy = true; error = '';
    try { const draft: SetupDraft = await responseJson(await fetch(`/api/setups/${id}`)); if (draft.storyId) { prepare(await responseJson(await fetch(`/api/stories/${draft.storyId}`))); view = 'read'; } else { setupInitial = draft; setupSession++; view = 'new'; draftSaved(draft); } }
    catch (e) { error = e instanceof Error ? e.message : 'Could not load setup.'; }
    finally { busy = false; }
  }
  let view = $state(untrack(()=>data.story?'read':'library'));
  let recordsKind=$state<RecordKind>('place'),recordsId=$state(''),recordsSession=$state(0),recordsDirty=$state(false);
  let pinsDirty=$state(false);
  let preparationDirty=$state(false),devDirty=$state(false),backgroundDirty=$state(false);
  let librarySearch=$state(''),contentsSearch=$state(''),libraryLoading=$state(false);
  let libraryRenameDrafts=$state<Record<string,boolean>>({});
  const libraryDirty=$derived(Object.values(libraryRenameDrafts).some(Boolean));
  const findText=(query:string,...values:string[])=>values.join('\n').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const visibleSetups=$derived(setups.filter(setup=>findText(librarySearch,setup.plan?.title||setup.input.title||'Untitled setup',setup.input.premise)));
  const visibleBooks=$derived(library.filter(entry=>libraryRenameDrafts[entry.id]||findText(librarySearch,entry.title,entry.passageTitle)));
  let settingsDirty=$state(false),mediaDirty=$state(false),sceneDirty=$state(false),sceneSession=$state(0);
  let showCorrection=$state(false),correctionDirty=$state(false),correctionSession=$state(0);
  let correctionTrigger:HTMLElement|null=null;
  function mayCloseCorrection(){return !correctionDirty||confirm('Discard the unsaved correction request or unapplied preview?');}
  function openCorrection(){if(busy)return;correctionTrigger=document.activeElement instanceof HTMLElement?document.activeElement:null;showEditor=false;showRewrite=false;showCorrection=true;}
  async function closeCorrection(){showCorrection=false;correctionDirty=false;await tick();correctionTrigger?.focus({preventScroll:true});correctionTrigger?.scrollIntoView({block:'nearest'});}
  function correctionSaved(saved:Story){if(story)reconcileNotebook(story,saved);story=saved;refreshCharacterDraft(saved);updateLibrary(saved);if(saved.recap?.stale)recapCurrent=false;status='Reviewed corrections saved to current story records';}
  function leaveEditor(){
    if(view==='prepare'&&preparationDirty)return confirm('Discard the scene preparation draft? Saved previews remain available.');
    if(view==='dev'&&devDirty)return confirm('Discard the unsaved developer context or lore edits? Save them first to keep them.');
    if(view==='background'&&backgroundDirty)return confirm('Discard the unsaved background edits? Use Save background edits first to keep them.');
    if(view==='library'&&libraryDirty)return confirm('Discard the unsaved story title? Use Save title first to keep it.');
    if(view==='records'&&recordsDirty)return confirm('Discard the unsaved changes to this record?');
    if(view==='pins'&&pinsDirty)return confirm('Discard the unsaved fact pins and world rules? Use Save pins & rules first to keep them.');
    if(view==='new'&&setupDirty)return confirm('Discard the unsaved setup edits? Use Save setup draft first to keep them.');
    if(view==='settings'&&settingsDirty)return confirm('Discard the unsaved settings changes? Save each changed section first to keep them.');
    if(view==='gallery'&&mediaDirty)return confirm('Discard the unsaved picture details?');
    if(view==='recap'&&recapDirty){if(!confirm('Discard the unsaved recap changes? Use Save recap to keep them.'))return false;resetRecap();}
    if(view==='read'&&(characterDirty||worldDirty||threadsDirty||titleDirty||sceneDirty||correctionDirty||recoveryDirty)){
      const fields=[characterDirty?'character':null,worldDirty?'world notes':null,threadsDirty?'story threads':null,titleDirty?'titles':null,sceneDirty?'scene direction':null,correctionDirty?'correction request':null,recoveryDirty?'recovery guidance':null].filter(Boolean).join(', ');
      if(!confirm(`Discard the unsaved changes to ${fields}? Save them first to keep them.`))return false;
      if(story){refreshCharacterDraft(story);resetWorld();threadDrafts=threadValues(story);}showRename=false;if(sceneDirty){sceneDirty=false;sceneSession++;}showCorrection=false;correctionDirty=false;correctionSession++;
    }
    return true;
  }
  function editRecords(kind:RecordKind='place',id=''){if(!busy&&leaveEditor()){recordsKind=kind;recordsId=id;recordsSession++;recordsDirty=false;view='records';}}
  function navigate(name:string){
    if(busy&&name!=='dev')return;
    if(name==='records'){if(view!=='records')editRecords();return;}
    if(name==='new'){newStory();return;}
    if(name==='illustrate'){illustrate();return;}
    if(name!==view&&!leaveEditor())return;
    localStorage.removeItem('guided-story-active-setup');if(name==='settings')settingsInitialTab='';view=name;
    error='';
  }
  function openConnections(){if(!busy&&leaveEditor()){settingsInitialTab='text';settingsSession++;view='settings';error='';}}
  async function reloadRecords(){if(!story||busy)return false;busy=true;error='';try{const saved:Story=await responseJson(await fetch(`/api/stories/${story.id}`));reconcileNotebook(story,saved);story=saved;pending=null;refreshCharacterDraft(story!);updateLibrary(story!);status='Loaded saved story records';return true;}catch(e){error=e instanceof Error?e.message:'Could not reload records.';return false;}finally{busy=false;}}
  async function refreshLibrary(){if(libraryLoading)return;libraryLoading=true;try{const [books,drafts]=await Promise.all([fetch('/api/stories').then(responseJson),fetch('/api/setups').then(responseJson)]);library=books;setups=drafts;status='Library refreshed';}catch(e){error=e instanceof Error?e.message:'Could not reload library.';}finally{libraryLoading=false;}}
  function libraryRemoved(id:string,kind:'story'|'setup'){
    if(kind==='story'){directionDrafts.delete(id);try{localStorage.removeItem(directionStorageKey(id));}catch{/* The removed story cannot reopen its draft. */}directionStorageStatus();library=library.filter(s=>s.id!==id);if(story?.id===id){story=null;draft=null;showEditor=false;index=0;}}
    setups=setups.filter(s=>s.id!==id);if(localStorage.getItem('guided-story-active-setup')===id)localStorage.removeItem('guided-story-active-setup');
    view='library';status=kind==='story'?'Story removed from this library':'Setup discarded';
  }
  function libraryRenamed(saved:Story){if(story?.id===saved.id){reconcileNotebook(story,saved);story=saved;}updateLibrary(saved);status='Story title saved';}
  let illustrationPerson=$state(''),illustrationPassage=$state(''),illustrationParent=$state(''),illustrationSession=$state(0);
  function illustrate(person='',passage='',parent=''){if(busy||!leaveEditor())return;illustrationPerson=person;illustrationPassage=passage;illustrationParent=parent;illustrationSession++;view='illustrate';}
  let index = $state(untrack(() => data.story ? data.story.passages.length - 1 : 0));
  let notebook = $state('cast'); let profile = $state('details');
  let notebookSearch=$state(''),notebookItemsExpanded=$state(false);
  let characterId = $state(untrack(() => data.story?.canon.characters[0]?.id || ''));
  let galleryCharacter = $state(''), galleryAsset = $state('');
  function openPhotobook(assetId: string, person: string) { if(busy||!leaveEditor())return;galleryAsset = assetId; galleryCharacter = person; view = 'gallery'; }
  function mediaSaved(saved: Story) { if (story?.id === saved.id) { reconcileNotebook(story,saved);story = saved; refreshCharacterDraft(saved); updateLibrary(saved); status = 'Story and picture records refreshed'; } }
  function mediaJump(id: string) {if(!story||busy)return;const target=story.passages.findIndex(p=>p.id===id);if(target<0){error='This picture belongs to an earlier passage version that is no longer in the current story.';return;}if(leaveEditor()){index=target;view='read';showEditor=false;}}
  let draft = $state<Character | null>(untrack(() => data.story?.canon.characters[0] ? normalizeCharacterProfile(structuredClone(data.story.canon.characters[0])) : null));
  function refreshCharacterDraft(saved:Story){
    const selected=saved.canon.characters.find(c=>c.id===characterId)||saved.canon.characters[0];
    characterId=selected?.id||'';draft=selected?normalizeCharacterProfile(structuredClone($state.snapshot(selected))):null;
  }
  let busy = $state(false); let status = $state('Loaded from local save'); let error = $state('');
  $effect(()=>{if(error)untrack(()=>reportUiError(error,'Storyweaver'));});
  let showEditor = $state(false), editorMode = $state<'ask'|'polish'>('ask'),editorInitialText=$state(''),editorSession=$state(0);
  let editorTrigger:HTMLElement|null=null;
  function openEditor(mode: 'ask'|'polish',initialText='') { if (!busy&&mayCloseCorrection()) { showCorrection=false;correctionDirty=false;editorTrigger=document.activeElement instanceof HTMLElement?document.activeElement:null;showRewrite=false;editorMode = mode; editorInitialText=initialText;editorSession++;showEditor = true; } }
  async function closeEditor(){if(busy)return;showEditor=false;await tick();editorTrigger?.focus({preventScroll:true});editorTrigger?.scrollIntoView({block:'nearest'});}
  function wordingSaved(saved: Story) { if(story)reconcileNotebook(story,saved);story = saved; updateLibrary(saved); if (saved.recap?.stale) recapCurrent = false; status = 'Wording saved locally'; }
  let direction = $state(''); let showRename = $state(false); let passageTitle = $state(''); let chapterTitle = $state('');
  let titleInput=$state<HTMLInputElement>();
  async function editTitles(){if(busy)return;if(showRename){if(titleDirty&&!confirm('Discard the unsaved title changes?'))return;showRename=false;return;}if(!passage||!mayCloseCorrection())return;showCorrection=false;correctionDirty=false;showEditor=false;showRewrite=false;passageTitle=passage.title;chapterTitle=passage.chapterTitle;showRename=true;await tick();titleInput?.scrollIntoView({block:'center'});titleInput?.focus({preventScroll:true});}
  let chapterEnding = $state<'auto'|'keep-open'|'close'>('auto');
  let directionStored = $state(true);
  let directionDraftUnsaved = $state(false);
  const directionDrafts = new Map<string, {text:string;chapterEnding:'auto'|'keep-open'|'close';stored:boolean}>();
  const directionStorageKey = (id:string) => `storyweaver-direction:${id}`;
  function directionStorageStatus() { directionDraftUnsaved=[...directionDrafts.values()].some(saved=>!saved.stored&&(saved.text.length>0||saved.chapterEnding!=='auto')); }
  function restoreDirectionDraft(id:string) {
    let saved=directionDrafts.get(id);
    if(!saved) {
      saved={text:'',chapterEnding:'auto',stored:true};
      try { const value=JSON.parse(localStorage.getItem(directionStorageKey(id))||'null');if(typeof value?.text==='string')saved.text=value.text.slice(0,10000);if(['auto','keep-open','close'].includes(value?.chapterEnding))saved.chapterEnding=value.chapterEnding; }
      catch { saved.stored=false; }
      directionDrafts.set(id,saved);
    }
    direction=saved.text;chapterEnding=saved.chapterEnding;directionStored=saved.stored;directionStorageStatus();
  }
  function rememberDirectionDraft(event?:Event) {
    if(!story)return;
    const field=event?.currentTarget;
    const text=field instanceof HTMLTextAreaElement?field.value:direction;
    const ending=field instanceof HTMLSelectElement?field.value as typeof chapterEnding:chapterEnding;
    const saved={text,chapterEnding:ending,stored:true};
    try { if(text||ending!=='auto')localStorage.setItem(directionStorageKey(story.id),JSON.stringify({text,chapterEnding:ending}));else localStorage.removeItem(directionStorageKey(story.id)); }
    catch { saved.stored=false; }
    directionDrafts.set(story.id,saved);directionStored=saved.stored;directionStorageStatus();
  }
  function clearDirectionDraft() { direction='';chapterEnding='auto';rememberDirectionDraft(); }
  let showRewrite=$state(false),rewriteDirection=$state(''),rewriteChapterEnding=$state<'auto'|'keep-open'|'close'>('auto');
  let rewriteTargetKey='',rewriteTrigger:HTMLElement|null=null;
  let rewriteInput=$state<HTMLTextAreaElement>();
  const rewriteStorageKey=()=>`storyweaver-rewrite:${rewriteTargetKey}`;
  function rememberRewrite(event?:Event){if(!rewriteTargetKey)return;const field=event?.currentTarget,text=field instanceof HTMLTextAreaElement?field.value:rewriteDirection,ending=field instanceof HTMLSelectElement?field.value:rewriteChapterEnding;try{localStorage.setItem(rewriteStorageKey(),JSON.stringify({text,chapterEnding:ending}));}catch{/* A draft remains usable without browser storage. */}}
  async function openRewrite(){
    if(busy||!story||!passage||!isLatest||!story.recovery?.valid)return;
    if(!mayCloseCorrection())return;
    if(titleDirty&&!confirm('Discard the unsaved title changes before opening the rewrite?'))return;
    rewriteTrigger=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const key=`${story.id}:${passage.id}`;
    if(rewriteTargetKey!==key){rewriteTargetKey=key;rewriteDirection='';rewriteChapterEnding='auto';try{const draft=JSON.parse(localStorage.getItem(rewriteStorageKey())||'null');if(typeof draft?.text==='string')rewriteDirection=draft.text.slice(0,10000);if(['auto','keep-open','close'].includes(draft?.chapterEnding))rewriteChapterEnding=draft.chapterEnding;}catch{/* Start a clean local prompt when device storage is unavailable. */}}
    showCorrection=false;correctionDirty=false;showEditor=false;showRename=false;showRewrite=true;await tick();document.getElementById('rewrite-request')?.scrollIntoView({block:'start'});rewriteInput?.focus({preventScroll:true});
  }
  async function closeRewrite(){if(busy)return;rememberRewrite();showRewrite=false;await tick();rewriteTrigger?.focus({preventScroll:true});rewriteTrigger?.scrollIntoView({block:'nearest'});}
  let cargoNotes = $state(untrack(() => data.story?.canon.cargoNotes ?? '')); let funds = $state(untrack(() => data.story?.canon.funds ?? 0));
  function threadValues(saved:Story){return Object.fromEntries(saved.canon.threads.map(t=>[t.id,{notes:t.notes,status:t.status}]));}
  let threadDrafts=$state<Record<string,{notes:string;status:'open'|'resolved'}>>(untrack(()=>data.story?threadValues(data.story):{}));
  function reconcileThreads(before:Story,saved:Story){threadDrafts=Object.fromEntries(saved.canon.threads.map(t=>{const prior=before.canon.threads.find(p=>p.id===t.id),draft=threadDrafts[t.id];return [t.id,draft&&prior&&(draft.notes!==prior.notes||draft.status!==prior.status)?draft:{notes:t.notes,status:t.status}];}));}
  function reconcileNotebook(before:Story,saved:Story){
    if(funds===before.canon.funds)funds=saved.canon.funds;
    if(cargoNotes===before.canon.cargoNotes)cargoNotes=saved.canon.cargoNotes;
    reconcileThreads(before,saved);
  }
  function resetWorld(){if(story){cargoNotes=story.canon.cargoNotes;funds=story.canon.funds;}}
  function resetThread(id:string){const t=story?.canon.threads.find(t=>t.id===id);if(t)threadDrafts[id]={notes:t.notes,status:t.status};}
  function resetRecap(){recapDraft=story?.recap?.text??'';recapCurrent=!story?.recap?.stale;}
  async function returnToLatest(){if(!story||busy||!leaveEditor())return;view='read';await openPassage(story.passages.length-1);}
  let textSize = $state('17'); let readingWidth = $state('660'); let appearance = $state('auto'); let artwork = $state(true);
  let readingFont = $state('serif'), lineSpacing = $state('1.85');
  let connections = $state<PublicConnections | null>(null), settingsInitialTab = $state(''), settingsSession = $state(0);
  let sampleTitle = $state('');
  let recapDraft = $state(untrack(() => data.story?.recap?.text ?? ''));
  let recapCurrent = $state(untrack(() => !data.story?.recap?.stale));
  let generatingRecap = $state(false);
  let recapController: AbortController | null = null;
  let recapRequest: { expectedRevision: number; requestId: string } | null = null;
  let pending: { expectedRevision: number; requestId: string; action: unknown } | null = null;
  const passage = $derived(story?.passages[index]);
  const passageArtwork = $derived(story?.media.assets.filter(a => a.source?.passageId === passage?.id && a.status === 'canonical').at(-1));
  const isLatest = $derived(story !== null && index === story.passages.length - 1);
  const chapters = $derived(story ? [...new Set(story.passages.map(p => p.chapter))] : []);
  const matchingPassages=$derived(story?.passages.filter(p=>findText(contentsSearch,p.title,p.chapterTitle,`Chapter ${p.chapter}`,p.viewpoint))||[]);
  const matchingPassageIds=$derived(new Set(matchingPassages.map(p=>p.id)));
  const visibleChapters=$derived(chapters.filter(chapter=>matchingPassages.some(p=>p.chapter===chapter)));
  const currentChapter = $derived(story && passage ? chapterStats(story.passages, passage.chapter) : null);
  const passageInChapter = $derived(story && passage ? story.passages.slice(0, index + 1).filter(p => p.chapter === passage.chapter).length : 0);
  const previousChapterIndex = $derived(story && passage ? story.passages.findIndex(p => p.chapter === passage.chapter - 1) : -1);
  const nextChapterIndex = $derived(story && passage ? story.passages.findIndex(p => p.chapter === passage.chapter + 1) : -1);
  const recapThrough = $derived(story?.passages.find(p => p.id === story?.recap?.throughPassageId));
  const selected = $derived(story?.canon.characters.find(c => c.id === characterId));
  const notebookPeople=$derived(story?.canon.characters.filter(person=>person.id===characterId||findText(notebookSearch,person.name,person.role))||[]);
  const notebookPlaces=$derived(story?.canon.places.filter(place=>findText(notebookSearch,place.name,place.description))||[]);
  const notebookItems=$derived(story?.canon.items.filter(item=>findText(notebookSearch,item.name,item.description,inventoryPath(story!.canon,item.ownerId)))||[]);
  const shownNotebookItems=$derived(notebookSearch.trim()||notebookItemsExpanded?notebookItems:notebookItems.slice(0,12));
  const notebookThreads=$derived(story?.canon.threads.filter(thread=>findText(notebookSearch,thread.title,thread.notes)||Boolean(threadDrafts[thread.id]&&(threadDrafts[thread.id].notes!==thread.notes||threadDrafts[thread.id].status!==thread.status)))||[]);
  const worldDirty=$derived(Boolean(story&&(funds!==story.canon.funds||cargoNotes!==story.canon.cargoNotes)));
  const threadsDirty=$derived(Boolean(story?.canon.threads.some(t=>threadDrafts[t.id]&&(threadDrafts[t.id].notes!==t.notes||threadDrafts[t.id].status!==t.status))));
  const titleDirty=$derived(Boolean(showRename&&passage&&(passageTitle!==passage.title||chapterTitle!==passage.chapterTitle)));
  const recapDirty=$derived(Boolean(story&&(recapDraft!==(story.recap?.text??'')||recapCurrent!==!story.recap?.stale)));
  function characterEditKey(c:Character){return JSON.stringify([c.name,c.role,c.notes,c.pinnedAppearance,c.noNsfw,c.locationId,identityFields.map(f=>c.visual?.[f]||''),personaFields.map(f=>c.persona?.[f]||''),wardrobeFields.map(f=>c.wardrobe?.[f]||''),c.currentState||'',c.injuries||'',c.appearanceNotes||'',c.outfitNotes||'']);}
  const characterDirty=$derived(Boolean(draft&&selected&&characterEditKey(draft)!==characterEditKey(selected)));
  function selectCharacter(character:Character){if(character.id===characterId)return;if(characterDirty&&!confirm('Discard the unsaved character changes? Use Save character to keep them.'))return;characterId=character.id;draft=normalizeCharacterProfile(structuredClone($state.snapshot(character)));}
  function selectProfile(tab:string){if(tab!==profile&&tab==='photos'&&characterDirty){if(!confirm('Discard the unsaved character changes? Use Save character before opening the photobook to keep them.'))return;if(story)refreshCharacterDraft(story);}profile=tab;}
  const holderName = (id: string) => story?inventoryPath(story.canon,id):id;

  function prepare(s: Story) {
    story = s; index = s.passages.length - 1;
    notebookSearch='';notebookItemsExpanded=false;
    showCorrection=false;correctionDirty=false;correctionSession++;
    restoreDirectionDraft(s.id);showEditor = false;showRewrite=false;rewriteTargetKey='';rewriteDirection='';rewriteChapterEnding='auto';
    galleryCharacter = ''; galleryAsset = '';
    characterId = s.canon.characters[0]?.id ?? '';
    draft = s.canon.characters[0] ? normalizeCharacterProfile(structuredClone(s.canon.characters[0])) : null;
    cargoNotes = s.canon.cargoNotes; funds = s.canon.funds;
    threadDrafts=threadValues(s);
    recapDraft = s.recap?.text ?? ''; recapCurrent = !s.recap?.stale; recapRequest = null;
    pending = null; error = ''; showRename = false;
  }
  async function responseJson(response: Response) { const result = await response.json(); if (!response.ok) throw new Error(result.error || 'The local request failed.'); return result; }
  function updateLibrary(s: Story) {
    const p = s.passages.at(-1)!;
    library = [{ id: s.id, title: s.title, updatedAt: s.updatedAt, revision: s.revision, chapter: p.chapter, passageTitle: p.title }, ...library.filter(e => e.id !== s.id)];
  }
  async function mutate(action: unknown) {
    if (!story || busy) return false;
    const originalIndex = index; busy = true; error = ''; status = 'Saving…';
    if (!pending || JSON.stringify(pending.action) !== JSON.stringify(action)) pending = { expectedRevision: story.revision, requestId: crypto.randomUUID(), action };
    try {
      const saved: Story = await responseJson(await fetch(`/api/stories/${encodeURIComponent(story.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pending) }));
      reconcileNotebook(story,saved);story = saved; index = Math.min(originalIndex, saved.passages.length - 1); pending = null; updateLibrary(saved); status = 'Saved locally';
      if(!saved.canon.characters.some(c=>c.id===characterId))characterId=saved.canon.characters[0]?.id||'';
      if(typeof action==='object'&&action&&'type' in action&&(action.type==='character'||String(action.type).startsWith('record-')))refreshCharacterDraft(saved);
      if (saved.recap?.stale) recapCurrent = false;
      return true;
    } catch (e) { error = e instanceof Error ? e.message : 'Could not confirm the save. Retry your edit.'; status = 'Save not confirmed'; return false; }
    finally { busy = false; }
  }
  async function load(id: string) {
    if (busy||!leaveEditor()) return; busy = true; error = '';
    try { prepare(await responseJson(await fetch(`/api/stories/${encodeURIComponent(id)}`))); view = 'read'; status = 'Loaded latest passage'; }
    catch (e) { error = e instanceof Error ? e.message : 'Could not load story.'; }
    finally { busy = false; }
  }
  async function continueSample() { if (!leaveEditor()) return;if (await mutate({ type: 'sample-continue', direction })) { index = story!.passages.length - 1; clearDirectionDraft();refreshCharacterDraft(story!); } }
  async function generateLive(mode: 'continue'|'replace') {
    if(mode==='replace'&&(!showRewrite||!isLatest||!story?.recovery?.valid||!rewriteDirection.trim()))return;
    if (!story || busy || !leaveEditor()) return;
    if(retainedCount){error='Recover or discard the retained passage below before generating another.';return;}
    if (mode === 'replace' && !confirm('Change the latest passage using its earlier world state? Its old illustrations will remain as earlier versions.')) return;
    const nextDirection=direction,nextEnding=chapterEnding,rewriteKey=rewriteStorageKey();
    const targetId = story.id, body = { expectedRevision: story.revision, mode, direction:mode==='replace'?rewriteDirection.trim():direction, chapterEnding:mode==='replace'?rewriteChapterEnding:chapterEnding }, key = JSON.stringify({ id: targetId, ...body });
    if (liveRequest?.key !== key) liveRequest = { key, requestId: crypto.randomUUID() };
    busy = true; liveGenerating = true; error = ''; status = mode === 'replace' ? 'Rewriting the latest passage…' : 'Writing the next passage…'; liveController = new AbortController();
    try {
      const saved: Story = await responseJson(await fetch(`/api/stories/${targetId}/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, requestId: liveRequest.requestId }), signal: liveController.signal }));
      prepare(saved); updateLibrary(saved);if(mode==='replace'){direction=nextDirection;chapterEnding=nextEnding;try{localStorage.removeItem(rewriteKey);}catch{/* Saved story remains available. */}}else clearDirectionDraft();liveRequest = null; status = 'Passage and world changes saved locally';
    } catch (e) { error = liveController.signal.aborted ? 'Cancellation requested. Reload to confirm the latest saved result before retrying.' : e instanceof Error ? e.message : 'Generation failed. The prior saved passage is kept.'; status = 'Generation not confirmed'; }
    finally { busy = false; liveGenerating = false; liveController = null; recoveryRefresh++; }
  }
  async function cancelLive() { const current = liveController; if (!current) return; try { if (story && liveRequest) await responseJson(await fetch('/api/generation/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storyId: story.id, requestId: liveRequest.requestId }) })); } catch { error = 'Cancellation could not be confirmed. Inspect Dev → Jobs.'; } finally { current.abort(); } }
  async function openPassage(nextIndex: number) {
    if (!story || busy || nextIndex < 0 || nextIndex >= story.passages.length) return;
    const leavingScene=sceneDirty&&nextIndex!==story.passages.length-1;
    if((titleDirty||leavingScene||correctionDirty)&&!confirm(`Discard the unsaved ${[titleDirty?'title changes':null,leavingScene?'scene direction':null,correctionDirty?'correction request':null].filter(Boolean).join(' and ')} before changing passages?`))return;
    if(leavingScene){sceneDirty=false;sceneSession++;}
    index = nextIndex; showRename = false; showEditor = false;showRewrite=false;showCorrection=false;correctionDirty=false;
    await tick(); const heading=document.querySelector<HTMLElement>('.reader h1');heading?.focus({preventScroll:true});document.querySelector('.reader')?.scrollIntoView({ block: 'start', behavior: 'auto' });
  }
  async function saveRecap() {
    if (await mutate({ type: 'recap', text: recapDraft, confirmCurrent: recapCurrent })) recapDraft = story!.recap!.text;
  }
  async function generateStoryRecap() {
    if (!story || busy) return;
    if ((recapDraft.trim() && recapDraft !== story.recap?.text) || story.recap?.source === 'manual') {
      if (!confirm('Generate a new recap to replace the current recap text? Your story passages will not change.')) return;
    }
    busy = true; generatingRecap = true; error = ''; status = 'Generating recap…';
    if (!recapRequest || recapRequest.expectedRevision !== story.revision) recapRequest = { expectedRevision: story.revision, requestId: crypto.randomUUID() };
    recapController = new AbortController();
    try {
      const saved: Story = await responseJson(await fetch(`/api/stories/${encodeURIComponent(story.id)}/recap`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(recapRequest), signal: recapController.signal }));
      reconcileNotebook(story,saved);story = saved; recapDraft = saved.recap!.text; recapCurrent = true; recapRequest = null; updateLibrary(saved); status = 'Recap generated and saved locally';
    } catch (e) {
      if (recapController.signal.aborted) { status = 'Recap request cancelled'; error = 'Generation was cancelled. Existing recap text is kept. If the server had already finished, reloading will show its saved result.'; }
      else { error = e instanceof Error ? e.message : 'Could not generate the recap. Your existing text is kept.'; status = 'Recap generation not confirmed'; }
    } finally { busy = false; generatingRecap = false; recapController = null; }
  }
  async function replaceSample() {
    if (!passage || !leaveEditor() || !confirm('Replace the latest sample passage and restore its earlier world state? This keeps one linear story.')) return;
    if(await mutate({ type: 'sample-replace', passageId: passage.id }))refreshCharacterDraft(story!);
  }
  async function create() {
    busy = true; error = '';
    try { const s: Story = await responseJson(await fetch('/api/stories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: sampleTitle || undefined }) })); prepare(s); updateLibrary(s); view = 'read'; status = 'Sample copy saved'; }
    catch (e) { error = e instanceof Error ? e.message : 'Could not create sample.'; }
    finally { busy = false; }
  }
  async function importFile(event: Event) {
    const input = event.target as HTMLInputElement; const file = input.files?.[0]; if (!file || busy) return;
    if (file.size > 128_000_000) { error = 'Story ZIP files can be up to 128 MB.'; input.value = ''; return; }
    busy = true; error = '';
    try { const s: Story = await responseJson(await fetch('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: file })); prepare(s); updateLibrary(s); view = 'read'; status = 'Imported as a separate story'; }
    catch (e) { error = e instanceof Error ? e.message : 'Could not import story.'; }
    finally { busy = false; input.value = ''; }
  }
  async function importSetupFile(event: Event) {
    const input = event.target as HTMLInputElement, file = input.files?.[0];
    if (!file || busy) return;
    if (file.size > 5_000_000) { error = 'Setup ZIP files can be up to 5 MB.'; input.value = ''; return; }
    if (!leaveEditor()) { input.value = ''; return; }
    busy = true; error = '';
    try {
      const draft: SetupDraft = await responseJson(await fetch('/api/setups/import', { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: file }));
      setupInitial = draft; setupSession++; draftSaved(draft); view = 'new'; status = 'Imported as a separate unfinished setup';
    } catch (e) { error = e instanceof Error ? e.message : 'Could not import setup.'; }
    finally { busy = false; input.value = ''; }
  }
  function preferences() {
    localStorage.setItem('guided-story-reading', JSON.stringify({ textSize, readingWidth, appearance, artwork, readingFont, lineSpacing })); status = 'Reading preferences saved on this device';
  }
  onMount(() => {
    const stopCapture = captureBrowserConsole();
    if(story)restoreDirectionDraft(story.id);
    try { const p = JSON.parse(localStorage.getItem('guided-story-reading') || 'null'); if (p) { if (['17', '19', '21'].includes(p.textSize)) textSize = p.textSize; if (['660', '540'].includes(p.readingWidth)) readingWidth = p.readingWidth; if (['auto', 'light', 'dark'].includes(p.appearance)) appearance = p.appearance; if (typeof p.artwork === 'boolean') artwork = p.artwork; if (['serif', 'sans'].includes(p.readingFont)) readingFont = p.readingFont; if (['1.6', '1.85', '2.1'].includes(p.lineSpacing)) lineSpacing = p.lineSpacing; } } catch { /* Use defaults if preferences are unavailable. */ }
    fetch('/api/connections').then(responseJson).then(result => connections = result).catch(() => { error = 'Connection settings could not be loaded. Story saves are still available.'; });
    const activeSetup = localStorage.getItem('guided-story-active-setup'); if (activeSetup) resumeSetup(activeSetup);
    return stopCapture;
  });
  let lastView=$state(untrack(()=>view));
  $effect(()=>{
    const currentView=view;
    if(currentView===lastView)return;
    lastView=currentView;
    tick().then(()=>{
      const heading=document.querySelector<HTMLElement>('#story-content h1');
      if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});heading.scrollIntoView({block:'start'});}
    });
  });
</script>

<svelte:window onbeforeunload={e=>{if(preparationDirty||devDirty||backgroundDirty||libraryDirty||recordsDirty||pinsDirty||setupDirty||characterDirty||settingsDirty||mediaDirty||sceneDirty||worldDirty||threadsDirty||titleDirty||recapDirty||correctionDirty||recoveryDirty||directionDraftUnsaved){e.preventDefault();e.returnValue='';}}} />

<svelte:head><title>{story?.title || 'Library'} · Storyweaver</title><meta name="description" content="Read, direct and illustrate your own ongoing novel." /></svelte:head>

<div class="app" style:color-scheme={appearance === 'auto' ? 'light dark' : appearance}>
  <a class="skip-link" href="#story-content">Skip to content</a>
  <header>
    <div class="identity"><a class="brand" href="/" onclick={event=>{event.preventDefault();navigate('library');}}>✦ <span>Storyweaver</span></a><span class="book-name">{view === 'new' ? 'New story' : story?.title || 'Your library'}</span><span class="instance">{data.instance === 'play' ? 'Your instance · 5175' : 'Development · 5173'}</span></div>
    <nav class="app-navigation" aria-label="Story navigation">
      <div class="navigation-group" role="group" aria-label="Current story"><span class="navigation-label">Story</span>{#each [['read', 'Read'], ['contents', 'Contents'], ['recap', 'Story so far'], ['records','Records'], ['background','Background'], ['pins','Pins'], ['prepare','Prepare scene'], ['gallery', 'Gallery'], ['illustrate','Illustrations']] as [name, label]}<button class:active={view === name} aria-current={view === name ? 'page' : undefined} onclick={() => navigate(name)} disabled={busy || !story}>{label}</button>{/each}</div>
      <div class="navigation-group workspace-navigation" role="group" aria-label="Workspace"><span class="navigation-label">Workspace</span>{#each [['library', 'Library'], ['new','New story'], ['settings', 'Settings'], ['help','Help'], ['dev', 'Dev']] as [name, label]}<button class:active={view === name} aria-current={view === name ? 'page' : undefined} onclick={() => navigate(name)} disabled={busy && name !== 'dev'}>{label}</button>{/each}</div>
    </nav>
  </header>
  {#if connections&&!connections.text.model.trim()}<div class="build-note"><span>Welcome to Storyweaver</span> Connect your text model in Settings to begin generating. You can explore the sample and edit records now. <button onclick={openConnections} disabled={busy}>Set up connections</button></div>{/if}
  {#if error}<div class="error" role="alert"><p>{error}</p>{#if story}<button onclick={() => load(story!.id)} disabled={busy}>Reload saved story (discards unsaved fields)</button>{/if}</div>{/if}

  <div id="story-content" class="story-content" tabindex="-1">
  {#if view === 'help'}
    <HelpPanel version={APP_VERSION} instance={data.instance} onSettings={openConnections} onNew={newStory} />
  {:else if view === 'new'}
    {#key setupSession}<NewStory initial={setupInitial} canGenerate={Boolean(connections?.text.model.trim())} bind:busy onSaved={draftSaved} onCreated={storyCreated} onDirty={dirty=>setupDirty=dirty} />{/key}
  {:else if view === 'dev'}
    <DevMenu {story} {busy} onDirty={value=>devDirty=value} onReload={reloadRecords} canGenerate={Boolean(connections?.text.model.trim())} bind:direction={() => direction, value => { direction=value;rememberDirectionDraft(); }} onMutate={mutate} onStorySaved={saved => { story = saved; updateLibrary(saved); status = 'Continuity memory saved locally'; }} />
  {:else if view === 'illustrate' && story}
    {#key `${story.id}:${illustrationSession}`}<IllustrationStudio {story} {connections} initialCharacterId={illustrationPerson} initialPassageId={illustrationPassage} initialParentId={illustrationParent} {busy} onSaved={mediaSaved} onOpen={openPhotobook} onBack={()=>view='read'} />{/key}
  {:else if view === 'read' && story && passage}
    <div class="spread">
      <main class="reader"><div class="reader-inner" style:max-width={`${readingWidth}px`}>
        <div class="eyebrow">Chapter {passage.chapter === 1 ? 'one' : passage.chapter === 2 ? 'two' : passage.chapter} · {passage.chapterTitle}</div>
        <h1 id="passage-heading" tabindex="-1">{passage.title}</h1><div class="muted">{passage.viewpoint}’s viewpoint</div>
        <div class="mobile-reader-jumps"><a class="button" href="#story-notebook">Story notebook ↓</a><a class="button" href="#reading-navigation">Reading controls ↓</a></div>
        {#if currentChapter}<p class="reading-progress muted">Passage {passageInChapter} of {currentChapter.passages} · {countWords(passage.paragraphs).toLocaleString()} words<br />Chapter total: {currentChapter.words.toLocaleString()} words · {currentChapter.complete ? 'Complete' : 'In progress'}{story.origin === 'generated' ? ` · Target ~${story.preferences.chapterWords.toLocaleString()}` : ''}</p>{/if}
        {#if story.origin === 'sample'}<div class="notice sample-notice"><p><strong>Short sample story</strong> · These brief passages demonstrate the reader and notebook. Start a new story for a developed opening with your own cast and chapter-length preferences.</p><button onclick={newStory} disabled={busy}>Start your own story ↗</button></div>{/if}
        {#if !isLatest}<div class="notice"><p>You’re reading an earlier passage. The notebook shows current facts.</p><button onclick={() => openPassage(story!.passages.length - 1)}>Return to latest ↗</button></div>{/if}
        {#if artwork}{#if passageArtwork}<figure class="passage-art"><button class="photo-tile" onclick={() => openPhotobook(passageArtwork!.id, '')}><img src={mediaUrl(story.id, passageArtwork.id)} alt={passageArtwork.caption || 'Story illustration'} /></button>{#if passageArtwork.caption}<figcaption class="muted">{passageArtwork.caption}</figcaption>{/if}</figure>{:else if story.origin === 'sample'}<div class="scene-art" role="img" aria-label="Concept illustration of a station ring above a planet"><span>HALCYON STATION · PLACEHOLDER ART</span></div>{/if}{/if}
        <article class="prose" style:font-size={`${textSize}px`} style:font-family={readingFont === 'sans' ? 'system-ui, sans-serif' : 'Georgia, serif'} style:line-height={lineSpacing}>{#each passage.paragraphs as paragraph}<p>{paragraph}</p>{/each}</article>
        {#if passage.endOfChapter}<div class="end-mark">End of chapter {passage.chapter === 1 ? 'one' : passage.chapter}</div>{/if}
        <div class="tools" role="group" aria-label="Passage tools"><button onclick={()=>illustrate('',passage!.id)} disabled={busy}>Illustrate this passage</button><button onclick={editTitles} disabled={busy}>Edit titles</button><button onclick={() => openEditor('ask')} aria-expanded={showEditor&&editorMode==='ask'} disabled={busy}>Ask about the story</button><button onclick={() => openEditor('polish')} aria-expanded={showEditor&&editorMode==='polish'} disabled={busy}>Polish wording</button>{#if story.origin === 'sample'}<button onclick={replaceSample} disabled={busy || !isLatest || !story.recovery?.valid}>Try alternate sample ending</button>{:else}<button onclick={openRewrite} aria-expanded={showRewrite} disabled={busy || !isLatest || !story.recovery?.valid || !connections?.text.model.trim()}>Change what happens</button>{/if}</div>
        {#if showRename}<form class="editor" aria-label="Passage and chapter titles" onsubmit={async e => { e.preventDefault(); if (await mutate({ type: 'rename', passageId: passage!.id, title: passageTitle, chapterTitle })) showRename = false; }}><fieldset class="notebook-character-fields" disabled={busy}><label>Passage title<input bind:this={titleInput} bind:value={passageTitle} required maxlength="200" /></label><label>Chapter title<input bind:value={chapterTitle} required maxlength="200" /></label><p class="muted" role="status">{titleDirty?'Unsaved title changes':'Titles match the saved passage'}</p><div class="row"><button class="primary" disabled={busy||!titleDirty}>Save titles</button><button type="button" onclick={editTitles}>Cancel title edit</button></div></fieldset></form>{/if}
        <div class="reader-secondary"><button onclick={openCorrection} disabled={busy} aria-expanded={showCorrection}>I noticed something needs correction</button><button onclick={()=>openEditor('ask',continuityQuestion(story!,passage!.id))} disabled={busy}>Review continuity</button><a class="button" href={`/api/stories/${story.id}/novel`}>Export novel</a></div>
        {#if showCorrection}{#key `${story.id}:${passage.id}:${correctionSession}`}<StoryCorrections {story} passageId={passage.id} mode="reader" canGenerate={Boolean(connections?.text.model.trim())} disabled={characterDirty||worldDirty||threadsDirty||titleDirty||sceneDirty} blockedReason="Save or reset your other reader edits before asking for corrections, so the preview uses the facts you intend to keep." bind:busy onDirty={dirty=>correctionDirty=dirty} onSaved={correctionSaved} onClose={closeCorrection} />{/key}{/if}
        {#key story.id}<PassageRecovery source={story} kind="story" refreshKey={recoveryRefresh} bind:busy canGenerate={Boolean(connections?.text.model.trim())} disabled={characterDirty||worldDirty||threadsDirty||titleDirty||sceneDirty||correctionDirty} onDirty={value=>recoveryDirty=value} onReload={()=>{void reloadRecords();}} onCount={count=>retainedCount=count} onDiscard={()=>liveRequest=null} onSaved={(saved,draft)=>{prepare(saved);updateLibrary(saved);if(draft.content.mode==='continue')clearDirectionDraft();liveRequest=null;status='Recovered passage and world updates saved locally';}} onEdit={(kind,id)=>{if(!leaveEditor())return;recordsKind=kind;recordsId=id;recordsSession++;view='records';}} />{/key}
        {#if showEditor}{#key `${story.id}:${passage.id}:${editorMode}:${editorSession}`}<StoryEditor {story} passageId={passage.id} mode={editorMode} initialText={editorInitialText} canGenerate={Boolean(connections?.text.model.trim())} bind:busy onSaved={wordingSaved} onJump={id => openPassage(story!.passages.findIndex(p => p.id === id))} onClose={closeEditor} />{/key}{/if}
        {#if showRewrite&&isLatest}<section id="rewrite-request" class="story-editor rewrite-request" aria-label="Change what happens">
          <div class="heading-row"><h2>Change what happens</h2><button onclick={closeRewrite} disabled={busy}>Cancel rewrite</button></div>
          <p class="muted">Chapter {passage.chapter} · {passage.title}. Rewrite this latest passage from its earlier world state. Describe what should change and what should stay. Your next-passage direction is separate.</p>
          <form onsubmit={e=>{e.preventDefault();void generateLive('replace');}}>
            <label for="rewrite-direction">What should happen instead?</label>
            <textarea id="rewrite-direction" bind:this={rewriteInput} bind:value={rewriteDirection} oninput={rememberRewrite} maxlength="10000" rows="6" required disabled={busy} placeholder="For example: keep the key with the captain, let the engineer discover the clue, and end before anyone opens the cargo." aria-describedby="rewrite-request-help"></textarea>
            <p id="rewrite-request-help" class="muted">Nothing is sent until you choose Rewrite latest passage and confirm. This changes events and their tracked world state; older passages stay intact.</p>
            <label for="rewrite-chapter-ending">Chapter ending for this rewrite</label><select id="rewrite-chapter-ending" bind:value={rewriteChapterEnding} onchange={rememberRewrite} disabled={busy}><option value="auto">Natural ending near the chapter target</option><option value="keep-open">Keep this chapter open</option><option value="close">Bring this passage to a chapter ending</option></select>
            <div class="row"><button class="primary" disabled={busy||!rewriteDirection.trim()||!connections?.text.model.trim()||!story.recovery?.valid}>{liveGenerating?'Rewriting passage…':'Rewrite latest passage'}</button>{#if liveGenerating}<button type="button" onclick={cancelLive}>Cancel generation</button>{/if}</div>
          </form>
        </section>{/if}
        {#if isLatest}{#key `${story.id}:${sceneSession}`}<SceneDirection {story} {busy} onMutate={mutate} onPrepare={() => navigate('prepare')} onDirty={dirty=>sceneDirty=dirty} />{/key}<section class="director"><h3>{passage.endOfChapter ? 'Begin the next chapter' : 'What happens next?'}</h3><p class="muted">{story.origin === 'sample' ? 'Try the saved sample continuation, or continue this story with your configured model.' : `Add a passage of about ${story.preferences.passageWords} words${passage.endOfChapter ? ' to the next chapter' : ' to this chapter'}. Guide the story, or leave the direction empty and let the narrator continue.`}</p><label for="direction">{story.origin === 'sample' ? 'Optional direction (saved with the sample passage)' : 'Optional story direction'}</label><textarea id="direction" bind:value={direction} oninput={rememberDirectionDraft} disabled={busy} placeholder="A character to follow, a complication, a change of pace…" maxlength="10000" aria-describedby="direction-draft-help"></textarea>
          <label for="chapter-ending">Chapter ending for AI generation</label><select id="chapter-ending" bind:value={chapterEnding} onchange={rememberDirectionDraft} disabled={busy}><option value="auto">Natural ending near the chapter target</option><option value="keep-open">Keep this chapter open</option><option value="close">Bring this passage to a chapter ending</option></select>
          <div class="row"><button type="button" onclick={clearDirectionDraft} disabled={busy||(!direction&&chapterEnding==='auto')}>Clear direction draft</button><p class="muted" id="direction-draft-help">{directionStored?'Direction and ending drafts stay in this browser for each story until you continue successfully or clear them.':'Browser storage is unavailable. This draft stays while the page is open; copy it before closing.'}</p></div>
          <div class="composer-foot"><span class="muted">{liveGenerating ? 'Writing prose, checking length, then checking continuity…' : story.origin === 'sample' ? story.passages.length === 3 ? 'One sample passage available' : 'You’ve reached the end of the sample' : 'Prose and world changes save together'}</span>{#if story.origin === 'sample'}<button class="primary" onclick={continueSample} disabled={busy || story.passages.length !== 3}>{busy ? 'Saving…' : 'Continue reading ↗'}</button>{/if}<button class:primary={story.origin !== 'sample'} onclick={() => generateLive('continue')} disabled={busy || retainedCount>0 || !connections?.text.model.trim()}>{liveGenerating&&!showRewrite ? 'Generating…' : story.origin === 'sample' ? 'Continue with AI ↗' : 'Continue story ↗'}</button>{#if liveGenerating&&!showRewrite}<button onclick={cancelLive}>Cancel generation</button>{/if}</div>{#if !story.recovery?.valid}<p class="muted">Manual world edits changed the recovery point. Continue forward to start a new one.</p>{/if}</section>{/if}
        <nav id="reading-navigation" class="reading-navigation" aria-label="Passage and chapter navigation">
          <div class="reading-navigation-row">
            {#if index > 0}<button onclick={() => openPassage(index - 1)} disabled={busy}>← Previous passage</button>{/if}
            {#if index < story.passages.length - 1}<button class="next-link" onclick={() => openPassage(index + 1)} disabled={busy}>Next passage →</button>{/if}
          </div>
          {#if previousChapterIndex >= 0 || nextChapterIndex >= 0}<div class="reading-navigation-row chapter-links">
            {#if previousChapterIndex >= 0}<button onclick={() => openPassage(previousChapterIndex)} disabled={busy}>← Previous chapter</button>{/if}
            {#if nextChapterIndex >= 0}<button class="next-link" onclick={() => openPassage(nextChapterIndex)} disabled={busy}>Next chapter →</button>{/if}
          </div>{/if}
        </nav>
      </div></main>
      <aside id="story-notebook" class="notebook" tabindex="-1" aria-label="Story notebook"><div class="notebook-heading"><h2>Story notebook</h2><a class="button mobile-reader-return" href="#passage-heading">Back to passage ↑</a></div><div class="muted">Current facts · Always editable</div><div class="tabs" role="group" aria-label="Notebook sections">{#each ['cast', 'world', 'threads'] as tab}<button class:active={notebook === tab} aria-pressed={notebook === tab} onclick={() => {notebook = tab;notebookSearch='';}}>{tab[0].toUpperCase() + tab.slice(1)}</button>{/each}</div>
        <div class="notebook-search"><label>{notebook==='cast'?'Find a cast member':notebook==='world'?'Find a place or possession':'Find a story thread'}<input type="search" aria-label="Search notebook" bind:value={notebookSearch} /></label>{#if notebookSearch}<button onclick={()=>notebookSearch=''}>Clear notebook search</button>{/if}</div>
        {#if notebook === 'cast'}
          <button onclick={()=>editRecords('character',characterId)} disabled={busy}>Manage cast records</button>
          {#if notebookSearch}<p class="muted">Showing {notebookPeople.length} of {story.canon.characters.length} cast members. The selected profile stays visible.</p>{/if}
          {#each notebookPeople as character}<button class="cast-row" class:selected={characterId === character.id} aria-pressed={characterId === character.id} disabled={busy} onclick={() => selectCharacter(character)}><span class="avatar">{#if story.media.portraits[character.id]}<img class="portrait-avatar" src={mediaUrl(story.id, story.media.portraits[character.id], true)} alt="" />{:else}{character.name.split(' ').map(n => n[0]).slice(0, 2).join('')}{/if}</span><span>{character.name}<small>{character.role}</small></span></button>{/each}
          <div class="tabs" role="group" aria-label="Character profile">{#each ['details', 'photos'] as tab}<button class:active={profile === tab} aria-pressed={profile === tab} onclick={() => selectProfile(tab)}>{tab === 'photos' ? 'Photobook' : 'Details'}</button>{/each}</div>
          {#if profile === 'details' && draft}<form onsubmit={async e => { e.preventDefault(); if (draft) await mutate({ type: 'character', character: normalizeCharacterProfile($state.snapshot(draft)) }); }}>
            <fieldset class="notebook-character-fields" disabled={busy}>
            <label>Name<input bind:value={draft.name} required maxlength="120" /></label><label>Role<input bind:value={draft.role} maxlength="120" /></label>
            <CharacterProfileEditor value={draft} compact onChange={v=>{if(draft)Object.assign(draft,v);}} />
            <label class="check"><input type="checkbox" bind:checked={draft.pinnedAppearance} /><span>Pin appearance & outfit</span></label><label class="check"><input type="checkbox" bind:checked={draft.noNsfw} /><span>No NSFW<small>Exclude this character from sexualized content.</small></span></label><label>Location<select bind:value={draft.locationId}>{#each story.canon.places as place}<option value={place.id}>{place.name}</option>{/each}</select></label>
            <div class="notebook-save"><p class="muted" role="status">{characterDirty ? 'Unsaved character changes' : 'Character matches the saved profile'}</p><div class="row"><button class="primary" disabled={busy || !characterDirty}>Save character</button>{#if characterDirty}<button type="button" disabled={busy} onclick={()=>story&&refreshCharacterDraft(story)}>Reset to saved</button>{/if}</div></div>
            </fieldset>
          </form><div class="possessions"><h3>Carrying</h3>{#each story.canon.items.filter(i => itemRootOwnerId(story!.canon,i.id) === characterId) as item}<p>{item.name}{item.unlimited?' · Always available':` × ${item.quantity}`}{item.equipped ? ' · Equipped' : ''}{#if item.ownerId!==characterId}<small class="muted">&nbsp;· Stored in {inventoryPath(story.canon,item.ownerId)}</small>{/if}</p>{:else}<p class="muted">No recorded items.</p>{/each}</div>
          {:else}{#key `${story.id}:${characterId}`}<MediaPanel {story} {characterId} compact {busy} onMutate={mutate} onSaved={mediaSaved} onJump={mediaJump} onOpen={openPhotobook} onGenerate={(person,parent)=>illustrate(person,'',parent)} />{/key}{/if}
        {:else if notebook === 'world'}
          <div class="row record-links"><button onclick={()=>editRecords('place')} disabled={busy}>Edit places</button><button onclick={()=>editRecords('item')} disabled={busy}>Edit items</button><button onclick={()=>editRecords('relationship')} disabled={busy}>Edit relationships</button><button onclick={()=>navigate('background')} disabled={busy}>Edit background</button></div>
          <p class="muted" role="status">{notebookPlaces.length} places · {notebookItems.length} possessions{notebookSearch.trim()?' match':''}</p>
          <div class="world-places">{#each notebookPlaces as place}<details><summary>{place.name}</summary><p class="muted">{place.description}</p>{#if place.parentId}<p class="muted">Inside: {holderName(place.parentId)}</p>{/if}</details>{:else}<p class="muted">No places match this search.</p>{/each}</div>
          <form aria-label="World notebook notes" onsubmit={async e => { e.preventDefault(); if(await mutate({ type: 'world', funds, cargoNotes }))resetWorld(); }}><fieldset class="notebook-character-fields" disabled={busy}><label>Shared funds<input type="number" min="0" step="0.01" bind:value={funds} required /></label><label>Cargo notes<textarea bind:value={cargoNotes} maxlength="40000"></textarea></label><p class="muted" role="status">{worldDirty?'Unsaved world notes':'World notes match the saved story'}</p><div class="row"><button class="primary" disabled={busy||!worldDirty}>Save world notes</button>{#if worldDirty}<button type="button" onclick={resetWorld}>Reset world notes</button>{/if}</div></fieldset></form>
          <h3 class="section-label">Possessions &amp; storage</h3>{#each shownNotebookItems as item}<label>{item.name}{item.unlimited?' · Always available':` × ${item.quantity}`}{item.isContainer?' · container':''}<select value={item.ownerId} disabled={busy} onchange={e => mutate({ type: 'transfer', itemId: item.id, ownerId: e.currentTarget.value })}>{#each inventoryHolders(story.canon,item.id) as holder}<option value={holder.id}>{holder.name}</option>{/each}</select></label>{:else}<p class="muted">{notebookSearch.trim()?'No possessions match this search.':'No possessions recorded yet.'}</p>{/each}{#if shownNotebookItems.length<notebookItems.length}<p class="muted">Showing {shownNotebookItems.length} of {notebookItems.length} possessions. Search above to find a specific item.</p><button onclick={()=>notebookItemsExpanded=true}>Show all {notebookItems.length} possessions</button>{:else if notebookItemsExpanded&&!notebookSearch.trim()&&notebookItems.length>12}<button onclick={()=>notebookItemsExpanded=false}>Show fewer possessions</button>{/if}<p class="muted">Storage changes save immediately. Moving a container carries its contents. Split stacks and inspect contents in Records → Items.</p>
        {:else}<button onclick={()=>editRecords('thread')} disabled={busy}>Edit story threads</button><p class="muted" role="status">{notebookThreads.length} of {story.canon.threads.length} story threads</p>{#each notebookThreads as thread (thread.id)}{@const threadDirty=threadDrafts[thread.id]&&(threadDrafts[thread.id].notes!==thread.notes||threadDrafts[thread.id].status!==thread.status)}{#if threadDrafts[thread.id]}<form class="thread" aria-label={thread.title} onsubmit={async e => { e.preventDefault(); const values=threadDrafts[thread.id];if(await mutate({ type: 'thread', threadId: thread.id, notes: values.notes, status: values.status }))resetThread(thread.id); }}><fieldset class="notebook-character-fields" disabled={busy}><h3>{thread.title}</h3><label>Notes<textarea bind:value={threadDrafts[thread.id].notes} maxlength="40000"></textarea></label><label>Status<select bind:value={threadDrafts[thread.id].status}><option value="open">Open</option><option value="resolved">Resolved</option></select></label><p class="muted" role="status">{threadDirty?'Unsaved thread changes':'Thread matches the saved story'}</p><div class="row"><button disabled={busy||!threadDirty}>Save thread</button>{#if threadDirty}<button type="button" onclick={()=>resetThread(thread.id)}>Reset thread</button>{/if}</div></fieldset></form>{/if}{:else}<p class="muted">{notebookSearch.trim()?'No story threads match this search.':'No story threads yet. Add a possibility in Records or prepare a scene.'}</p>{/each}<p class="muted">Future possibilities stay separate from events that have happened.</p>{/if}
      </aside>
    </div>
  {:else if view === 'records' && story}
    {#key `${story.id}:${recordsSession}`}<RecordEditor {story} bind:busy canGenerate={Boolean(connections?.text.model.trim())} onSaved={correctionSaved} initialKind={recordsKind} initialId={recordsId} onMutate={mutate} onReload={reloadRecords} onDirty={dirty=>recordsDirty=dirty} />{/key}
  {:else if view === 'background' && story}
    <main class="full-view background-view"><div class="eyebrow">Setting, customs and possibilities</div><h1>Background &amp; lore</h1><div class="row"><button onclick={reloadRecords} disabled={busy}>Load latest saved story</button><button onclick={()=>navigate('prepare')} disabled={busy}>Prepare missing scene details</button></div>{#key story.id}<LoreDevPanel {story} mode="author" {busy} onMutate={mutate} onDirty={dirty=>backgroundDirty=dirty} />{/key}</main>
  {:else if view === 'pins' && story}
    {#key story.id}<FactPinsPanel {story} {busy} onMutate={mutate} onDirty={dirty=>pinsDirty=dirty} />{/key}
  {:else if view === 'contents' && story}
    <main class="full-view contents-view"><div class="eyebrow">{story.title}</div><div class="heading-row"><h1>Contents</h1><button class="primary" onclick={() => { index = story!.passages.length - 1; view = 'read'; showEditor = false; }}>Continue at latest ↗</button></div><p class="muted">Chapters grow across passages. Select a passage to read from that point.</p>
      <div class="collection-search"><label>Find a passage<input type="search" bind:value={contentsSearch} placeholder="Passage, chapter or viewpoint" /></label>{#if contentsSearch}<button onclick={()=>contentsSearch=''}>Clear contents search</button>{/if}</div>
      <p class="collection-count" role="status">{contentsSearch.trim() ? `${matchingPassages.length} of ${story.passages.length} passages match` : `${story.passages.length} passages across ${chapters.length} ${chapters.length===1?'chapter':'chapters'}`}</p>
      {#each visibleChapters as chapter}{@const stats = chapterStats(story.passages, chapter)}<section aria-label={`Chapter ${chapter}`}><div class="toc-chapter"><span class="eyebrow">Chapter {chapter}</span><h2>{story.passages.find(p => p.chapter === chapter)?.chapterTitle}</h2><p class="muted">{stats.words.toLocaleString()} words · {stats.passages} {stats.passages === 1 ? 'passage' : 'passages'} · {stats.complete ? 'Complete' : 'In progress'}</p></div>{#each story.passages as p, i}{#if p.chapter === chapter && matchingPassageIds.has(p.id)}<button class="toc-entry" class:current={i === index} aria-current={i === index ? 'location' : undefined} onclick={() => { index = i; view = 'read'; showRename = false; showEditor = false; }}><span>{p.title}</span><span class="dots"></span><small>{countWords(p.paragraphs)} words · {i === story.passages.length - 1 ? 'Latest passage' : 'Read'}</small></button>{/if}{/each}</section>{:else}<div class="empty-state"><h2>No matching passages</h2><p>Try a different title, chapter number or viewpoint name.</p><button onclick={()=>contentsSearch=''}>Show all passages</button></div>{/each}<p class="muted">The next chapter is still unwritten.</p>
    </main>
  {:else if view === 'recap' && story}
    <main class="full-view"><div class="eyebrow">{story.title}</div><h1>Story so far</h1>
      <div class="recap-actions row"><button class="primary" onclick={generateStoryRecap} disabled={busy || !connections?.text.model.trim()}>{generatingRecap ? 'Generating recap…' : story.recap ? 'Refresh recap' : 'Generate recap'}</button>{#if generatingRecap}<button onclick={() => recapController?.abort()}>Cancel generation</button>{/if}<button onclick={openConnections} disabled={busy}>Text model settings</button></div>
      {#if !connections?.text.model.trim()}<p class="muted">Choose a text Model ID in Settings to enable generation. You can write and save your own recap below.</p>{:else}<p class="muted">Uses your configured text model. Longer stories are summarized in sections, with reusable summaries.</p>{/if}
      <div class="notice"><h3>{story.recap ? story.recap.stale ? 'Needs refresh' : 'Recap up to date' : 'No saved recap yet'}</h3>
        {#if story.recap}<p>Through {recapThrough ? `chapter ${recapThrough.chapter} · ${recapThrough.title}` : 'an earlier story revision'} · {story.recap.passageCount} {story.recap.passageCount === 1 ? 'passage' : 'passages'}.</p><p class="muted">{story.recap.source === 'manual' ? 'Edited by you' : 'Generated'} · Saved {new Date(story.recap.updatedAt).toLocaleString()}{story.recap.stale ? ' · The story has changed since this recap was prepared.' : ''}</p>
        {:else}<p>{story.passages.length} saved passages across {chapters.length} {chapters.length === 1 ? 'chapter' : 'chapters'}.</p>{/if}
      </div>
      <form onsubmit={e => { e.preventDefault(); saveRecap(); }}>
        <label for="recap-text">Your recap</label><textarea id="recap-text" class="recap-editor" bind:value={recapDraft} maxlength="40000" placeholder="Generate a recap, or write one here. You can edit it whenever you like." disabled={busy}></textarea>
        <label class="check"><input type="checkbox" bind:checked={recapCurrent} disabled={busy} /><span>I’ve brought this recap up to date with the latest passage.</span></label>
        <p class="muted" role="status">{recapDirty?'Unsaved recap changes':'Recap matches the saved version'}</p><div class="row"><button class="primary" disabled={busy || !recapDraft.trim()||!recapDirty}>Save recap</button>{#if recapDirty}<button type="button" disabled={busy} onclick={resetRecap}>Reset recap to saved</button>{/if}<button type="button" disabled={busy} onclick={returnToLatest}>Return to latest ↗</button></div>
        <p class="muted">Editing the recap doesn’t change story events or the world notebook.</p>
      </form>
    </main>
  {:else if view === 'gallery'}
    <main class="full-view media-view"><div class="eyebrow">Collected along the way</div><h1>Story gallery</h1><p class="muted">Portraits, places, and moments from your story. Every character’s photobook shares this library.</p>{#if story}{#key `${story.id}:${galleryCharacter}:${galleryAsset}`}<MediaPanel {story} characterId={galleryCharacter} initialAssetId={galleryAsset} {busy} onDirty={dirty=>mediaDirty=dirty} onMutate={mutate} onSaved={mediaSaved} onJump={mediaJump} onOpen={openPhotobook} onGenerate={(person,parent)=>illustrate(person,'',parent)} />{/key}{/if}</main>
  {:else if view === 'library'}
    <main class="full-view library-view"><div class="eyebrow">Your stories</div><h1>Library</h1><p class="muted">Written stories and unfinished setups, saved on this computer. Export a ZIP to keep a backup or move a story.</p>
      <div class="row"><button class="primary" onclick={newStory} disabled={busy}>Begin a new story</button><button onclick={refreshLibrary} disabled={busy||libraryLoading}>{libraryLoading?'Reloading library…':'Reload library'}</button></div>
      {#if library.length||setups.length}<div class="collection-search"><label>Find a story or setup<input type="search" bind:value={librarySearch} placeholder="Title, premise or latest passage" /></label>{#if librarySearch}<button onclick={()=>librarySearch=''}>Clear library search</button>{/if}</div><p class="collection-count" role="status">{visibleBooks.length} of {library.length} written stories · {visibleSetups.length} of {setups.length} unfinished setups{libraryDirty ? ' · Unsaved title edits stay visible' : ''}</p>{/if}
      {#if setups.length}<section class="library-section" aria-label="Unfinished setups"><h2>Unfinished setups</h2>{#each visibleSetups as setup (setup.id)}<section class="book-row" aria-label={setup.plan?.title || setup.input.title || 'Untitled setup'}><div><h3>{setup.plan?.title || setup.input.title || 'Untitled setup'}</h3><p class="muted">{setup.input.premise}</p><small>{setup.plan ? 'Cast & world ready for review' : 'Premise saved'}</small></div><div><button onclick={() => resumeSetup(setup.id)} disabled={busy}>Resume setup ↗</button><LibraryControls id={setup.id} title={setup.plan?.title||setup.input.title||'Untitled setup'} revision={setup.revision} kind="setup" bind:busy onRemoved={libraryRemoved} onRenamed={libraryRenamed} onRefresh={refreshLibrary} /></div></section>{:else}<p class="muted">No unfinished setups match this search.</p>{/each}</section>{/if}
      <section class="library-section" aria-label="Written stories"><h2>Written stories</h2>{#each visibleBooks as entry (entry.id)}<section class="book-row" aria-label={entry.title}><div><h3>{entry.title}</h3><p class="muted">Chapter {entry.chapter} · {entry.passageTitle}</p><small class="muted">Saved {new Date(entry.updatedAt).toLocaleString()}</small></div><div><div class="row"><button class="primary" onclick={() => load(entry.id)} disabled={busy}>Resume story ↗</button><a class="button" href={`/api/stories/${entry.id}/export`}>Export ZIP</a></div><LibraryControls id={entry.id} title={entry.title} revision={entry.revision} kind="story" bind:busy onDirty={dirty=>libraryRenameDrafts[entry.id]=dirty} onRemoved={libraryRemoved} onRenamed={libraryRenamed} onRefresh={refreshLibrary} /></div></section>{:else}<p class="notice">{library.length?'No written stories match this search.':'No written stories yet. Begin a new story or import a saved ZIP.'}</p>{/each}</section>
      {#if librarySearch.trim()&&!visibleBooks.length&&!visibleSetups.length}<div class="empty-state"><h2>No matching stories or setups</h2><p>Try a different title or clear the search to see your library.</p><button onclick={()=>librarySearch=''}>Show the whole library</button></div>{/if}
      <section class="library-section library-imports" aria-label="Import backups"><h2>Import a backup</h2><div class="form-grid"><div><label class="import-label">Import a setup ZIP<input type="file" accept=".zip,application/zip" onchange={importSetupFile} disabled={busy} /></label><p class="muted">An unfinished premise and its editable cast, world and preferences. Opens a separate setup without writing prose or calling AI. ZIP limit: 5 MB.</p></div><div><label class="import-label">Import a story ZIP<input type="file" accept=".zip,application/zip" onchange={importFile} disabled={busy} /></label><p class="muted">Written chapters, world records and accepted pictures. Imports as a separate story. ZIP limit: 128 MB.</p></div></div></section>
      <form class="editor" onsubmit={e => { e.preventDefault(); create(); }}><h3>Explore a sample</h3><p class="muted">Try a short space-trader story to explore the reader and editors. Use New story to begin with your own idea.</p><label>Story title<input bind:value={sampleTitle} placeholder="The Far Side of Fortune" maxlength="200" /></label><button disabled={busy}>Create sample copy</button></form>
    </main>
  {:else if view === 'prepare' && story}
    <main class="full-view"><div class="eyebrow">Plan the next passage</div><h1>Prepare the next scene</h1><ScenePreparation source={story} kind="story" bind:busy canGenerate={Boolean(connections?.text.model.trim())} onDirty={value=>preparationDirty=value} onApplied={saved=>{correctionSaved(saved as Story);sceneSession++;status='Reviewed scene preparation saved';}} /></main>
  {:else if view === 'settings'}
    {#key settingsSession}<SettingsPanel {story} onDirty={dirty=>settingsDirty=dirty} bind:connections bind:busy instance={data.instance} initialTab={settingsInitialTab} bind:textSize bind:readingWidth bind:appearance bind:artwork bind:readingFont bind:lineSpacing onReadingSave={preferences} onMutate={mutate} onOpenGallery={() => openPhotobook('', '')} />{/key}
  {/if}
  </div>
  <footer><span>Storyweaver {APP_VERSION} · {data.instance === 'play' ? 'Your library: data/play' : 'Development library: data/dev'}</span><span role="status" aria-live="polite" aria-atomic="true">{status}</span></footer>
  <RequestViewer {busy} {status} />
</div>

<style>.notebook-character-fields{border:0;padding:0;margin:0;min-width:0}.rewrite-request{scroll-margin-top:20px}.rewrite-request form{padding:16px;background:var(--page);border:1px solid var(--line);border-radius:7px;margin:18px 0}.rewrite-request label{font-size:14px;font-weight:600}.rewrite-request textarea{min-height:150px;font-size:16px;line-height:1.6;border-color:var(--accent)}.rewrite-request .row{margin-top:16px}@media(max-width:650px){.rewrite-request form{padding:12px}.rewrite-request .row>button{width:100%}}</style>
