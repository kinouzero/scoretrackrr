<script lang="ts">
  import { liveQuery } from 'dexie';
  import type { LocalDatabase } from '#lib/storage/database';
  import { StorageError } from '#lib/storage/errors';
  import type { ThemePreference } from '#lib/domain/settings';
  import { messages } from '#lib/i18n/index';
  let { database }: { database: LocalDatabase } = $props();
  let theme = $state<ThemePreference>('system');
  let loading = $state(true);
  let saving = $state(false);
  let message = $state('');
  let failed = $state(false);
  $effect(() => {
    const subscription = liveQuery(() => database.readTheme()).subscribe({
      next(value) {
        theme = value;
        loading = false;
      },
      error() {
        message = messages.settings.error;
        failed = true;
        loading = false;
      },
    });
    return () => subscription.unsubscribe();
  });
  async function change(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    saving = true;
    message = '';
    failed = false;
    try {
      await database.saveTheme(value);
      message = messages.theme.saved;
    } catch (failure) {
      failed = true;
      message =
        failure instanceof StorageError && failure.code === 'quota_exceeded'
          ? messages.settings.quota
          : messages.settings.error;
    } finally {
      saving = false;
    }
  }
</script>

<section class="panel settings-panel" aria-labelledby="theme-title">
  <h2 id="theme-title">{messages.theme.title}</h2>
  <p>{messages.theme.help}</p>
  <div class="filter-field">
    <label for="theme-choice">{messages.theme.label}</label>
    <select id="theme-choice" value={theme} disabled={loading || saving} onchange={change}>
      <option value="system">{messages.theme.system}</option><option value="light"
        >{messages.theme.light}</option
      ><option value="dark">{messages.theme.dark}</option>
    </select>
  </div>
  <p aria-live="polite" class:error={failed}>{message}</p>
</section>
