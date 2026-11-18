<script lang="ts">
  import { messages, getLanguagePreference, setLocale, locales } from '#lib/i18n/index';
  import type { LocalDatabase } from '#lib/storage/database';
  import { StorageError } from '#lib/storage/errors';
  let { database }: { database: LocalDatabase } = $props();
  let saving = $state(false);
  let status = $state<'saved' | 'error' | 'quota' | ''>('');
  async function change(event: Event) {
    const select = event.currentTarget as HTMLSelectElement;
    const value = select.value;
    saving = true;
    status = '';
    try {
      await database.saveLanguage(value);
      setLocale(value);
      status = 'saved';
    } catch (failure) {
      status =
        failure instanceof StorageError && failure.code === 'quota_exceeded' ? 'quota' : 'error';
    } finally {
      select.value = getLanguagePreference();
      saving = false;
    }
  }
</script>

<section class="panel settings-panel" aria-labelledby="language-title">
  <h2 id="language-title">{messages.language.title}</h2>
  <p>{messages.language.help}</p>
  <div class="filter-field">
    <label for="language-choice">{messages.language.label}</label>
    <select
      id="language-choice"
      value={getLanguagePreference()}
      disabled={saving}
      onchange={change}
    >
      <option value="system">{messages.language.system}</option>
      {#each locales as locale (locale.code)}<option value={locale.code} lang={locale.code}
          >{locale.name}</option
        >{/each}
    </select>
  </div>
  <p aria-live="polite" class:error={status === 'error' || status === 'quota'}>
    {status === 'saved' ? messages.language.saved : status ? messages.settings[status] : ''}
  </p>
</section>
