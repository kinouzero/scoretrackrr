<script lang="ts">
  import type { MatchRecord } from '#lib/domain/records';
  import { matchOptions } from '#lib/application/match-options';
  import { translate } from '#lib/i18n/catalog';
  import { messages, getLocale } from '#lib/i18n/index';
  let { match, compact = false }: { match: MatchRecord; compact?: boolean } = $props();
  const options = $derived(matchOptions(match));
</script>

<div class="match-options" class:compact>
  {#if !compact}<h3>{messages.parameters.title}</h3>{/if}
  <ul aria-label={messages.parameters.title}>
    {#each options as option (option.key)}
      <li class="badge">
        {translate(getLocale(), `matchOptions.${option.key}`, option.values)}
      </li>
    {/each}
  </ul>
</div>

<style>
  .match-options {
    display: grid;
    gap: var(--space-2);
  }
  .compact {
    margin-block-start: var(--space-3);
  }
  h3 {
    margin: 0;
    font-size: 0.75rem;
    font-weight: 650;
    color: var(--muted-text);
  }
  ul {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
</style>
