<script lang="ts">
  import { tick } from 'svelte';
  let { entities, value = $bindable([]), legend = 'Depicted subjects', onChange = () => {} }: {
    entities: { id: string; name: string; kind?: string }[];
    value?: string[];
    legend?: string;
    onChange?: () => void;
  } = $props();
  let query = $state('');
  let searchInput = $state<HTMLInputElement>();
  const pickerId = $props.id();
  const selected = $derived(entities.filter(entity => value.includes(entity.id)));
  const available = $derived(entities.filter(entity => !value.includes(entity.id) && entity.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
  async function toggle(id: string, checked: boolean) {
    value = checked ? [...new Set([...value, id])] : value.filter(existing => existing !== id);
    onChange();
    await tick();
    (document.getElementById(pickerId + '-' + id) || searchInput)?.focus({ preventScroll: true });
  }
</script>

<fieldset class="subject-picker">
  <legend>{legend}</legend>
  <label>Find a subject<input bind:this={searchInput} type="search" bind:value={query} placeholder="Search cast, places and items" /></label>
  <div class="row"><span class="muted" role="status">{selected.length} selected · {available.length} available{query.trim() ? ' matches' : ''}</span>{#if query}<button type="button" onclick={() => query = ''}>Clear subject search</button>{/if}</div>
  {#if selected.length}<p class="subject-group-label">Selected · kept visible while searching</p><div class="media-subjects selected-subjects">{#each selected as entity (entity.id)}<label class="check"><input id={pickerId+'-'+entity.id} type="checkbox" aria-label={entity.name} checked onchange={event => toggle(entity.id, event.currentTarget.checked)} /><span>{entity.name}{#if entity.kind}<small aria-hidden="true">{entity.kind}</small>{/if}</span></label>{/each}</div>{/if}
  <div class="media-subjects available-subjects">{#each available as entity (entity.id)}<label class="check"><input id={pickerId+'-'+entity.id} type="checkbox" aria-label={entity.name} onchange={event => toggle(entity.id, event.currentTarget.checked)} /><span>{entity.name}{#if entity.kind}<small aria-hidden="true">{entity.kind}</small>{/if}</span></label>{:else}<p class="muted">{query.trim() ? 'No more subjects match. Selected subjects stay above.' : entities.length ? 'All available subjects are selected.' : 'No cast, places or items have been saved yet.'}</p>{/each}</div>
</fieldset>

<style>
  .subject-picker{min-width:0;margin:20px 0}.subject-picker input[type='search']{width:100%}.subject-picker .row{margin:10px 0;flex-wrap:wrap}.subject-group-label{font-size:.85rem;color:var(--muted);margin:14px 0 8px}.available-subjects{max-height:300px;overflow-y:auto;padding:3px}.selected-subjects{padding:8px;border:1px solid var(--line);border-radius:6px}.subject-picker small{display:block;color:var(--muted);font-size:.75rem}.subject-picker .check{overflow-wrap:anywhere}
</style>
