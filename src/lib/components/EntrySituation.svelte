<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { MatchStatus } from '#lib/domain/records';
  import { messages } from '#lib/i18n/index';
  import Icon from './Icon.svelte';
  let { status, children }: { status: MatchStatus; children?: Snippet } = $props();
  const terminal = $derived(status === 'finished' || status === 'cancelled');
</script>

<div class="entry-situation" class:quiet={status !== 'in_progress'} data-status={status}>
  <div class="situation-label">
    <span
      ><Icon name={terminal ? 'flag' : status === 'paused' ? 'pause' : 'play'} size={16} />{messages
        .play.situation}</span
    >
    <span class="situation-state">{messages.play.entryStates[status]}</span>
  </div>
  {#if terminal}<p class="situation-result">{messages.play.entryClosed}</p>
  {/if}
  {#if children}<div class="situation-content">{@render children()}</div>{/if}
</div>
