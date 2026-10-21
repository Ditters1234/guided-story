<script lang="ts">
  import { tick, untrack } from 'svelte';
  import type { Canon } from './story';
  import { factPinFields, factPinRecords, resolvedFactPins, type FactPinKind, type FactPins } from './fact-pins';
  import { inventoryPath } from './inventory';

  let { canon, value = $bindable(), disabled = false, idPrefix = 'fact-pins', appearanceHelp = 'Manage those in Records → Cast.', onChange = () => {} }: {
    canon: Canon;
    value: FactPins;
    disabled?: boolean;
    idPrefix?: string;
    appearanceHelp?: string;
    onChange?: () => void;
  } = $props();
  const kinds: { kind: FactPinKind; label: string }[] = [
    { kind: 'character', label: 'Cast' }, { kind: 'place', label: 'Places' },
    { kind: 'item', label: 'Items' }, { kind: 'relationship', label: 'Relationships' },
    { kind: 'thread', label: 'Threads' }, { kind: 'world', label: 'World' }
  ];
  let kind = $state<FactPinKind>('character');
  let recordId = $state(untrack(() => factPinRecords({ canon }, 'character')[0]?.id || ''));
  let field = $state(factPinFields.character[0]?.field || '');
  let addRuleButton = $state<HTMLButtonElement>();
  const records = $derived(factPinRecords({ canon }, kind));
  const fields = $derived(factPinFields[kind]);
  const preview = $derived(resolvedFactPins({ canon, factPins: value }));
  const selectedPin = $derived({ kind, recordId: kind === 'world' ? null : recordId, field });
  const duplicate = $derived(value.fields.some(pin => pinKey(pin) === pinKey(selectedPin)));
  const canAdd = $derived(Boolean(field && (kind === 'world' || records.some(record => record.id === recordId)) && !duplicate && value.fields.length < 200));
  const appearancePinned = $derived(canon.characters.filter(person => person.pinnedAppearance).map(person => person.name));

  function pinKey(pin: FactPins['fields'][number]) { return JSON.stringify([pin.kind, pin.recordId, pin.field]); }
  function chooseKind(next: FactPinKind) {
    kind = next;
    recordId = next === 'world' ? '' : factPinRecords({ canon }, next)[0]?.id || '';
    field = factPinFields[next][0]?.field || '';
  }
  function addPin() {
    if (!canAdd || disabled) return;
    value.fields.push({ ...selectedPin }); onChange();
  }
  async function addRule() {
    if (disabled || value.rules.length >= 50) return;
    const id = crypto.randomUUID(); value.rules.push({ id, text: '' }); onChange();
    await tick(); document.getElementById(`${idPrefix}-rule-${id}`)?.focus();
  }
  async function removeRule(id: string) {
    const index = value.rules.findIndex(rule => rule.id === id);
    value.rules = value.rules.filter(rule => rule.id !== id); onChange();
    await tick();
    const next = value.rules[Math.min(index, value.rules.length - 1)];
    if (next) document.getElementById(`${idPrefix}-rule-${next.id}`)?.focus(); else addRuleButton?.focus();
  }
  function display(pin: { field: string; value: unknown }) {
    const current = pin.value;
    if (typeof current === 'string' && ['ownerId', 'rootOwnerId'].includes(pin.field)) return inventoryPath(canon, current);
    if (typeof current === 'string' && ['locationId', 'parentId', 'fromId', 'toId'].includes(pin.field)) {
      const named = [...canon.characters, ...canon.places].find(record => record.id === current);
      if (named) return named.name;
    }
    if (typeof current === 'string') return current || '(empty)';
    if (current === null || current === undefined) return '(none)';
    if (typeof current === 'boolean') return current ? 'Yes' : 'No';
    return typeof current === 'object' ? JSON.stringify(current, null, 2) : String(current);
  }
</script>

<fieldset {disabled} class="pin-controls">
  <section aria-labelledby={`${idPrefix}-fields-heading`}>
    <h2 id={`${idPrefix}-fields-heading`}>Pinned fields</h2>
    <p class="muted">Choose a record and the field to protect. A pin follows its current saved value; it does not restore an earlier version after a manual edit.</p>
    <p class="muted">Pinning an empty field keeps it empty during generated edits. Pins on ownership, location or quantity can block trades, movement or other events that would change those values. Unpin the field first when you want those changes to happen.</p>
    {#if appearancePinned.length}<p class="muted">Appearance &amp; outfit pins are also enabled for {appearancePinned.join(', ')}. {appearanceHelp}</p>{/if}
    <div class="pin-picker">
      <label>Record type<select aria-label="Record type" value={kind} onchange={event => chooseKind(event.currentTarget.value as FactPinKind)}>{#each kinds as option}<option value={option.kind}>{option.label}</option>{/each}</select></label>
      {#if kind !== 'world'}<label>Record<select aria-label="Record" bind:value={recordId}>{#if !records.length}<option value="">No records available</option>{/if}{#each records as record}<option value={record.id}>{record.label}</option>{/each}</select></label>{/if}
      <label>Field<select aria-label="Field" bind:value={field}>{#each fields as option}<option value={option.field}>{option.label}</option>{/each}</select></label>
    </div>
    <div class="row"><button type="button" onclick={addPin} disabled={!canAdd}>{duplicate ? 'Already pinned' : 'Pin selected field'}</button><span class="muted">{value.fields.length} / 200 field pins</span></div>
    {#if value.fields.length}
      <div class="pin-list">
        {#each preview.fields as pin (pinKey(pin))}
          <article class="pin-card">
            <div class="pin-heading"><h3>{pin.recordLabel} · {pin.label}</h3><button type="button" aria-label={`Unpin ${pin.recordLabel}: ${pin.label}`} onclick={() => { value.fields = value.fields.filter(current => pinKey(current) !== pinKey(pin)); onChange(); }}>Unpin</button></div>
            <pre class="pin-value">{display(pin)}</pre>
          </article>
        {/each}
      </div>
    {:else}<p class="muted empty-state">No individual fields pinned yet.</p>{/if}
  </section>
  <section class="rules-section" aria-labelledby={`${idPrefix}-rules-heading`}>
    <h2 id={`${idPrefix}-rules-heading`}>World rules</h2>
    <p>Established, reader-visible constraints the narrator should respect, such as “Travel between star systems takes at least a week.” These are facts the reader can know, rather than future plot wishes or hidden secrets.</p>
    <p class="muted">Rules guide the model’s writing. They cannot guarantee that every sentence follows them; review generated prose and correct mistakes when needed.</p>
    {#each value.rules as rule, index (rule.id)}
      <div class="rule-card">
        <label>World rule {index + 1}<textarea id={`${idPrefix}-rule-${rule.id}`} bind:value={rule.text} oninput={onChange} required maxlength="2000" placeholder="One clear, established constraint…"></textarea></label>
        <div class="pin-heading"><span class="muted">{rule.text.length} / 2000 characters</span><button type="button" aria-label={`Remove world rule ${index + 1}`} onclick={() => removeRule(rule.id)}>Remove rule</button></div>
      </div>
    {/each}
    <div class="row"><button bind:this={addRuleButton} type="button" onclick={addRule} disabled={value.rules.length >= 50}>Add world rule</button><span class="muted">{value.rules.length} / 50 rules</span></div>
  </section>
</fieldset>

<style>
  fieldset { min-width: 0; margin: 0; padding: 0; border: 0; }
  section { margin-top: 30px; }
  .pin-picker { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 16px; }
  .pin-picker label { min-width: 0; }
  .row, .pin-heading { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .pin-list { margin-top: 20px; }
  .pin-card, .rule-card { min-width: 0; background: var(--panel); border: 1px solid var(--line); border-radius: 7px; padding: 18px; margin: 14px 0; }
  .pin-heading { justify-content: space-between; }
  .pin-heading h3 { flex: 1; margin: 0; min-width: 120px; overflow-wrap: anywhere; }
  .pin-heading button { font-size: 12px; }
  .pin-value { margin: 14px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; font: 13px/1.7 system-ui,sans-serif; max-height: 240px; overflow-y: auto; }
  .empty-state { margin-top: 18px; }
  .rules-section { border-top: 1px solid var(--line); padding-top: 25px; margin-top: 30px; }
  .rule-card label { margin-top: 0; }
  @media(max-width: 650px) { .pin-picker { grid-template-columns: 1fr; gap: 0; } .pin-card, .rule-card { padding: 13px; } }
</style>
