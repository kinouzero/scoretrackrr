<script lang="ts">
  import { resolve } from '$app/paths';
  import { messages } from '#lib/i18n/index';
  import { pwaUpdates } from '#lib/application/pwa-updates';
  import Icon from './Icon.svelte';
</script>

{#if $pwaUpdates.waiting && !$pwaUpdates.dismissed}
  <aside class="update-notice" aria-labelledby="pwa-update-notice-title">
    <div role="status">
      <strong id="pwa-update-notice-title">{messages.pwaUpdate.available}</strong>
      <p>{messages.pwaUpdate.notice}</p>
    </div>
    <div class="form-actions">
      <a class="button secondary" href={resolve('/settings')}
        ><Icon name="replay" />{messages.pwaUpdate.open}</a
      >
      <button class="button secondary" onclick={() => pwaUpdates.dismiss()}
        ><Icon name="clock" />{messages.pwaUpdate.later}</button
      >
    </div>
  </aside>
{/if}

<style>
  .update-notice {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--space-3);
    margin-block-end: var(--space-4);
    padding: var(--panel-padding);
    background: var(--selected);
    border: 1px solid var(--accent);
    border-radius: 16px;
  }
  .update-notice p {
    margin: var(--space-1) 0 0;
    font-size: 0.85rem;
  }
  .form-actions {
    margin: 0;
  }
</style>
