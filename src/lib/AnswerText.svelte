<script lang="ts">
  let {text}:{text:string}=$props();
  const blocks=$derived(text.split(/\n\s*\n/));
</script>
<div class="answer-text">{#each blocks as block}<p>{#each block.split(/(\*\*[^*\n]+\*\*)/g) as part}{#if part.startsWith('**')&&part.endsWith('**')}<strong>{part.slice(2,-2)}</strong>{:else}{part}{/if}{/each}</p>{/each}</div>
