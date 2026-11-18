<script module lang="ts">
  import type { Snippet } from 'svelte';
  export type HeaderRenderer = Snippet<[Snippet, Snippet?]>;
</script>

<script lang="ts">
  import { messages } from '#lib/i18n/index';
  let {
    renderer,
    actions,
    rules,
  }: {
    renderer?: HeaderRenderer;
    actions: Snippet;
    rules: Snippet;
  } = $props();
</script>

{#if renderer}
  {@render renderer(actions, rules)}
{:else}
  <div class="button-row">
    {@render actions()}
  </div>
  <section class="game-rules" aria-label={messages.four21.ruleSummary}>
    {@render rules()}
  </section>
{/if}

<style>
  .button-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
  }
</style>
