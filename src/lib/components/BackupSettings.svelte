<script lang="ts">
  import Icon from '#lib/components/Icon.svelte';
  import { onDestroy } from 'svelte';
  import type { LocalDatabase } from '#lib/storage/database';
  import { BackupRepository, MAX_BACKUP_SIZE } from '#lib/storage/backup';
  import { StorageError } from '#lib/storage/errors';
  import { messages } from '#lib/i18n/index';
  let { database, busy = $bindable(false) }: { database: LocalDatabase; busy?: boolean } = $props();
  let error = $state(''),
    notice = $state(''),
    url = $state('');
  let fileInput: HTMLInputElement;
  onDestroy(() => {
    if (url) URL.revokeObjectURL(url);
  });
  async function exportJson() {
    if (busy) return;
    busy = true;
    error = '';
    notice = '';
    try {
      const text = await new BackupRepository(database).export(new Date().toISOString());
      if (url) URL.revokeObjectURL(url);
      url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'scoretrackrr-backup.json';
      link.hidden = true;
      document.body.append(link);
      link.click();
      link.remove();
      notice = messages.backup.exported;
    } catch (failure) {
      error =
        failure instanceof StorageError && failure.code === 'unavailable'
          ? messages.settings.error
          : messages.backup.exportError;
    } finally {
      busy = false;
    }
  }
  async function restore(event: Event) {
    const element = event.currentTarget as HTMLInputElement;
    const file = element.files?.[0];
    if (!file) return;
    busy = true;
    error = '';
    notice = '';
    try {
      if (file.size > MAX_BACKUP_SIZE) throw new Error('FILE_LIMIT');
      const result = await new BackupRepository(database).restore(await file.text());
      notice = messages.backup.restored(result.added, result.duplicates);
    } catch (failure) {
      error =
        failure instanceof StorageError && failure.code === 'conflict'
          ? messages.backup.conflict
          : failure instanceof StorageError && failure.code === 'quota_exceeded'
            ? messages.settings.quota
            : failure instanceof StorageError && failure.code === 'unavailable'
              ? messages.settings.error
              : messages.backup.invalid;
    } finally {
      element.value = '';
      busy = false;
    }
  }
</script>

<section class="panel backup" aria-labelledby="backup-title">
  <h2 id="backup-title">{messages.backup.title}</h2>
  <p>{messages.backup.help}</p>
  <p>{messages.backup.privacy}</p>
  <div class="form-actions">
    <button class="button" type="button" disabled={busy} onclick={exportJson}>
      <Icon name="download" />
      {messages.backup.export}
    </button>
    <button
      class="button secondary"
      type="button"
      disabled={busy}
      onclick={() => fileInput.click()}
    >
      <Icon name="upload" />
      {messages.backup.import}
    </button>
  </div>
  <input
    bind:this={fileInput}
    id="backup-file"
    type="file"
    hidden
    aria-label={messages.backup.file}
    accept=".json,application/json"
    onchange={restore}
    disabled={busy}
  />
  <p role="status">{busy ? messages.backup.working : notice}</p>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</section>

<style>
  .backup {
    padding: var(--panel-padding);
    display: grid;
    gap: var(--space-4);
  }
  .form-actions {
    margin-top: 0;
  }
  .form-actions .button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
  }
</style>
