<script lang="ts">
  import type { Story } from './story';
  import type { ContextData } from './context-types';
  let { canon, lore, ids = $bindable(undefined), saveLabel = 'Save scene direction', disabled = false }: {
    canon: Story['canon']; lore: ContextData['lore']; ids?: string[]; saveLabel?: string; disabled?: boolean;
  } = $props();
  function resourceName(id: string) {
    const record = [...canon.characters, ...canon.places, ...canon.items, ...canon.relationships, ...canon.threads, ...lore].find(record => record.id === id);
    if (!record) return id;
    if ('name' in record) return record.name;
    if ('title' in record) return record.title;
    return `${canon.characters.find(person => person.id === record.fromId)?.name || record.fromId} → ${canon.characters.find(person => person.id === record.toId)?.name || record.toId}`;
  }
</script>

{#if ids?.length}<section class="prepared-resources" aria-label="Prepared scene resources"><h3>Prepared resources</h3>
  <p class="muted">These records supply context for this brief. They do not place anyone in the scene or establish viewpoint knowledge. Remove hints that no longer belong in the plan, then choose {saveLabel}.</p>
  <ul>{#each ids as id}<li><span>{resourceName(id)}</span><button type="button" aria-label={`Remove prepared resource ${resourceName(id)}`} {disabled} onclick={() => ids = ids?.filter(value => value !== id)}>Remove hint</button></li>{/each}</ul>
  <button type="button" {disabled} onclick={() => ids = []}>Clear prepared resource hints</button>
</section>{/if}

<style>
  .prepared-resources{min-width:0;margin:18px 0}.prepared-resources ul{padding-left:20px}.prepared-resources li{margin:8px 0;overflow-wrap:anywhere}.prepared-resources li button{margin-left:8px}
  @media(max-width:550px){.prepared-resources li button{display:block;margin:5px 0}}
</style>
