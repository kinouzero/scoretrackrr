<script module lang="ts">
  import type { Snippet } from 'svelte';
  export type HeaderRenderer = Snippet<[Snippet, Snippet?]>;
</script>

<script lang="ts">
  let {
    renderer,
    actions,
    scoreboard,
  }: {
    renderer?: HeaderRenderer;
    actions: Snippet;
    scoreboard?: Snippet;
  } = $props();
</script>

{#if renderer}
  {@render renderer(actions, scoreboard)}
{:else}
  <div class="button-row">
    {@render actions()}
  </div>
  {@render scoreboard?.()}
{/if}

<style>
  .button-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
  }
</style>
