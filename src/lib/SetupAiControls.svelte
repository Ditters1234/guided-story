<script lang="ts">
  import type { SetupDesignMode } from './setup-generation';
  let { label, direction = '', placeholder = '', hint = '', actions, canGenerate, onDirection, onGenerate }: {
    label: string;
    direction?: string;
    placeholder?: string;
    hint?: string;
    actions: { mode: SetupDesignMode; label: string }[];
    canGenerate: boolean;
    onDirection: (value: string) => void;
    onGenerate: (mode: SetupDesignMode) => void;
  } = $props();
</script>

<fieldset class="setup-ai-controls" aria-label={`${label} AI options`}>
  <legend>AI options · {label}</legend>
  <label>{label} direction
    <textarea value={direction} oninput={e => onDirection(e.currentTarget.value)} maxlength="2000" rows="2" {placeholder}></textarea>
  </label>
  <div class="row">
    {#each actions as action}<button type="button" disabled={!canGenerate} onclick={() => onGenerate(action.mode)}>{action.label}</button>{/each}
    {#if direction.trim()}<button type="button" onclick={() => onDirection('')}>Clear direction</button>{/if}
  </div>
  {#if hint}<p class="muted">{hint}</p>{/if}
</fieldset>

<style>
  .setup-ai-controls { margin: 18px 0 12px; padding: 14px; border: 1px solid var(--line); border-radius: 8px; min-width: 0; }
  legend { padding: 0 6px; font-size: .8rem; color: var(--muted); }
  textarea { resize: vertical; min-height: 70px; }
  .row { flex-wrap: wrap; }
  .muted { margin: 10px 0 0; font-size: .8rem; }
  @media (max-width: 480px) { .setup-ai-controls { padding: 10px; } .row button { flex: 1 1 140px; } }
</style>
