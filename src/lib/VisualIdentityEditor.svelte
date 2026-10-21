<script lang="ts">
  import { identityFields, identityLabels, visualIdentitySchema, type VisualIdentity } from './visual-identity';
  let {value,prefix='',onChange}:{value:VisualIdentity|undefined;prefix?:string;onChange:(v:VisualIdentity)=>void}=$props();
</script>
<details class="visual-profile">
  <summary>Visual identity · age, gender, eyes and other features</summary>
  <p class="muted">These facts guide the narrator and every picture. Actual age and gender describe identity; apparent age and presentation describe what is visible. Leave undecided fields blank. Content preferences are set separately.</p>
  <div class="form-grid">{#each identityFields as field}<label>{prefix}{identityLabels[field]}<input value={value?.[field] || ''} maxlength="2000" oninput={e=>onChange({...visualIdentitySchema.parse(value || {}),[field]:e.currentTarget.value})} /></label>{/each}</div>
</details>
<style>.visual-profile{margin:18px 0;padding:14px;border:1px solid var(--line);border-radius:6px}.visual-profile summary{cursor:pointer}</style>
