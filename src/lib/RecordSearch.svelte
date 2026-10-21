<script lang="ts">
  let { label, query, count, total, disabled = false, onSearch }: {
    label: string; query: string; count: number; total: number; disabled?: boolean; onSearch: (value: string) => void;
  } = $props();
</script>

<div class="record-search" role="search" aria-label={label}>
  <label>{label}<input type="search" value={query} {disabled} oninput={event => onSearch(event.currentTarget.value)} placeholder="Search names, descriptions or record IDs" /></label>
  <button type="button" onclick={() => onSearch('')} disabled={disabled || !query}>Clear search</button>
  <p class="muted" role="status">{query.trim() ? `${count} of ${total} records match` : `${total} ${total === 1 ? 'record' : 'records'}`}</p>
</div>

<style>
  .record-search{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px 12px;align-items:end;margin:18px 0;min-width:0}
  label{margin:0;min-width:0}.record-search>p{grid-column:1/-1;margin:0;font-size:13px}.record-search>button{margin-bottom:0}
  @media(max-width:480px){.record-search{grid-template-columns:minmax(0,1fr)}.record-search>button{justify-self:start}}
</style>
