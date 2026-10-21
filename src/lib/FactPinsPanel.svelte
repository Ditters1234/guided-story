<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
  import type { Story } from './story';
  import FactPinsEditor from './FactPinsEditor.svelte';

  let { story, busy = false, onMutate, onDirty }: {
    story: Story;
    busy?: boolean;
    onMutate: (action: unknown) => Promise<boolean>;
    onDirty: (dirty: boolean) => void;
  } = $props();

  type Pins = Story['factPins'];
  const copyPins = () => JSON.parse(JSON.stringify(story.factPins)) as Pins;
  let draft = $state<Pins>(untrack(copyPins));
  let baseline = $state(untrack(() => JSON.stringify(draft)));
  let revision = $state(untrack(() => story.revision));
  let note = $state('');
  let conflicted = $state(false);
  const dirty = $derived(JSON.stringify(draft) !== baseline);
  const hasBlankRule = $derived(draft.rules.some(rule => !rule.text.trim()));
  function reset() {
    draft = copyPins(); baseline = JSON.stringify(draft); revision = story.revision; note = ''; conflicted = false;
  }
  async function save() {
    if (busy || !dirty || hasBlankRule || conflicted) return;
    if (story.revision !== revision) {
      conflicted = true;
      note = 'The saved story changed. Your draft is still here to review or copy. Reset changes to load the current configuration before saving pins or rules.';
      return;
    }
    if (await onMutate({ type: 'fact-pins', factPins: $state.snapshot(draft) })) {
      await tick(); reset(); note = 'Fact pins and world rules saved.';
    }
  }
  $effect(() => { onDirty(dirty); });
  onDestroy(() => onDirty(false));
  $effect(() => {
    if (revision !== story.revision) {
      if (!dirty) reset();
      else {
        conflicted = true;
        note = 'The saved story changed. Your draft is still here to review or copy. Reset changes to load the current configuration before saving pins or rules.';
      }
      revision = story.revision;
    }
  });
</script>

<main class="full-view pins-view">
  <div class="eyebrow">{story.title}</div>
  <h1>Fact pins & world rules</h1>
  <p>Keep important facts in every story request. Pinned fields are protected from generated record changes; you can still edit their values yourself in Records. The existing cast appearance & outfit pin also remains available.</p>
  <p class="muted">Pins and rules are required context. If they exceed the model’s context budget, generation stops and asks you to reduce them instead of silently dropping them. Keep them concise and relevant.</p>

  <form aria-label="Fact pins and world rules" onsubmit={event => { event.preventDefault(); save(); }}>
    <fieldset disabled={busy}>
      <FactPinsEditor canon={story.canon} bind:value={draft} disabled={busy} onChange={() => note = ''} />

      <div class="save-pins"><div class="row"><button class="primary" type="submit" disabled={!dirty || hasBlankRule || conflicted}>Save pins & rules</button><button type="button" disabled={!dirty && !conflicted} onclick={reset}>Reset changes</button></div><p class="muted">{conflicted ? 'Saving is paused because the story changed. Review or copy this draft, then reset to the current saved configuration.' : hasBlankRule ? 'Write or remove each empty world rule before saving.' : dirty ? 'Unsaved pins or rules. Save to apply them to future requests.' : 'Saved pins and rules loaded.'}</p></div>
    </fieldset>
  </form>
  {#if note}<p class="muted" role="status">{note}</p>{/if}
</main>

<style>
  .pins-view { max-width: 1050px; }
  fieldset { min-width: 0; margin: 0; padding: 0; border: 0; }
  .row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .save-pins { border-top: 1px solid var(--line); padding-top: 25px; margin-top: 30px; }
  .save-pins p { margin: 12px 0 0; }
</style>
