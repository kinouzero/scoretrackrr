<script lang="ts">
  import type { LocalDatabase } from '#lib/storage/database';
  import { messages } from '#lib/i18n/index';
  import { pwaUpdates } from '#lib/application/pwa-updates';
  import Icon from './Icon.svelte';
  let { database, transferBusy = false }: { database?: LocalDatabase; transferBusy?: boolean } =
    $props();
  let checkingGames = $state(false);
  let error = $state<'gameRunning' | 'storage' | ''>('');
  async function apply() {
    if (checkingGames || transferBusy || $pwaUpdates.applying) return;
    error = '';
    if (!database) {
      error = 'storage';
      return;
    }
    checkingGames = true;
    try {
      if (await database.matches.where('status').equals('in_progress').count())
        error = 'gameRunning';
      else if (!transferBusy) pwaUpdates.apply();
    } catch {
      error = 'storage';
    } finally {
      checkingGames = false;
    }
  }
</script>

<section class="panel settings-panel" aria-labelledby="pwa-update-title">
  <h2 id="pwa-update-title">{messages.pwaUpdate.title}</h2>
  <p>{messages.pwaUpdate.help}</p>
  {#if $pwaUpdates.supported}
    <div class="form-actions">
      <button
        class="button secondary"
        disabled={$pwaUpdates.checking || $pwaUpdates.applying || checkingGames}
        onclick={() => pwaUpdates.check()}
        ><Icon name="replay" />{$pwaUpdates.checking
          ? messages.pwaUpdate.checking
          : messages.pwaUpdate.check}</button
      >
      {#if $pwaUpdates.waiting}<button
          class="button"
          disabled={$pwaUpdates.applying ||
            $pwaUpdates.checking ||
            checkingGames ||
            transferBusy ||
            !database}
          onclick={apply}
          ><Icon name="download" />{$pwaUpdates.applying
            ? messages.pwaUpdate.applying
            : messages.pwaUpdate.apply}</button
        >{/if}
    </div>
    <p role="status">
      {$pwaUpdates.applying
        ? messages.pwaUpdate.applying
        : $pwaUpdates.waiting
          ? messages.pwaUpdate.ready
          : $pwaUpdates.checked && !$pwaUpdates.error
            ? messages.pwaUpdate.current
            : ''}
    </p>
    {#if $pwaUpdates.waiting}<p class="field-hint">{messages.pwaUpdate.beforeApply}</p>{/if}
  {:else}<p class="field-hint">{messages.pwaUpdate.unsupported}</p>{/if}
  {#if error}<p class="error" role="alert">{messages.pwaUpdate.errors[error]}</p>{/if}
  {#if $pwaUpdates.error}<p class="error" role="alert">
      {messages.pwaUpdate.errors[$pwaUpdates.error]}
    </p>{/if}
</section>
