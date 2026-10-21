<script lang="ts">
  import type { Character } from './story';
  import VisualIdentityEditor from './VisualIdentityEditor.svelte';
  import { normalizeCharacterProfile, characterAppearanceSummary, characterOutfitSummary, personaFields, personaLabels, wardrobeFields, wardrobeLabels } from './character-profile';

  type Profile = Pick<Character, 'visual' | 'persona' | 'currentState' | 'wardrobe' | 'injuries' | 'appearanceNotes' | 'outfitNotes' | 'appearance' | 'outfit' | 'notes'>;
  let {value,prefix='',compact=false,onChange}:{value:Profile;prefix?:string;compact?:boolean;onChange:(profile:Profile)=>void}=$props();
  const profile=$derived(normalizeCharacterProfile(value));
  function change(patch:Partial<Profile>){
    const next=normalizeCharacterProfile({...value,...patch});
    onChange({...next,appearance:characterAppearanceSummary(next),outfit:characterOutfitSummary(next)});
  }
</script>

<div class="character-profile" class:compact>
  <p class="muted">One shared profile guides the narrator and pictures. Pose, expression, camera and art style belong to each picture.</p>
  <details class="profile-section">
    <summary>Personality, voice &amp; history</summary>
    <p class="muted">Keep enduring traits and long-term goals here. Temporary feelings and immediate intentions belong in Current state.</p>
    {#each personaFields as field}
      <label>{prefix}{personaLabels[field]}<textarea value={profile.persona[field]} maxlength="4000" oninput={e=>change({persona:{...profile.persona,[field]:e.currentTarget.value}})}></textarea></label>
    {/each}
  </details>
  <VisualIdentityEditor value={profile.visual} {prefix} onChange={visual=>change({visual})} />
  <details class="profile-section">
    <summary>Current state</summary>
    <p class="muted">A short note about what this character feels, wants or intends now. Current clothing and visible condition have their own fields below.</p>
    <label>{prefix}Current feelings &amp; immediate intentions<textarea value={profile.currentState} maxlength="4000" oninput={e=>change({currentState:e.currentTarget.value})}></textarea></label>
  </details>
  <details class="profile-section">
    <summary>Current outfit &amp; worn accessories</summary>
    <p class="muted">Record what this character wears now. Use additional details for clothing facts without a field above. Possessions and ownership stay in the inventory.</p>
    <div class="form-grid">{#each wardrobeFields as field}
      <label>{prefix}{wardrobeLabels[field]}<textarea value={profile.wardrobe[field]} maxlength="2000" oninput={e=>change({wardrobe:{...profile.wardrobe,[field]:e.currentTarget.value}})}></textarea></label>
    {/each}</div>
    <label>{prefix}Additional outfit details<textarea value={profile.outfitNotes} maxlength="40000" oninput={e=>change({outfitNotes:e.currentTarget.value})}></textarea></label>
  </details>
  <details class="profile-section">
    <summary>Current condition &amp; additional notes</summary>
    <p class="muted">Use appearance notes for details without a dedicated field. Change established eyes, hair or other traits in the shared visual identity above.</p>
    <label>{prefix}Current injuries &amp; visible condition<textarea value={profile.injuries} maxlength="4000" oninput={e=>change({injuries:e.currentTarget.value})}></textarea></label>
    <label>{prefix}Additional appearance details<textarea value={profile.appearanceNotes} maxlength="40000" oninput={e=>change({appearanceNotes:e.currentTarget.value})}></textarea></label>
    <label>{prefix}Additional story notes<textarea value={profile.notes} maxlength="40000" oninput={e=>change({notes:e.currentTarget.value})}></textarea></label>
  </details>
  <details class="profile-section profile-summaries">
    <summary>Shared appearance &amp; outfit summaries</summary>
    <p class="muted">These summaries follow the fields above and are shared with story and image generation.</p>
    <h4>Appearance</h4><p>{characterAppearanceSummary(profile) || 'No appearance details yet.'}</p>
    <h4>Current outfit</h4><p>{characterOutfitSummary(profile) || 'No outfit details yet.'}</p>
  </details>
</div>

<style>
  .profile-section{margin:18px 0;padding:14px;border:1px solid var(--line);border-radius:6px}
  .profile-section summary{cursor:pointer}.profile-summaries p{white-space:pre-wrap;overflow-wrap:anywhere}.profile-summaries h4{margin-bottom:6px}
  .compact :global(.form-grid){grid-template-columns:1fr}.compact .profile-section,.compact :global(.visual-profile){padding:10px}
</style>
