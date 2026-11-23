<script lang="ts">
  import { onMount } from 'svelte';
  import { messages } from '#lib/i18n/index';
  import type { LocalDatabase } from '#lib/storage/database';
  import PwaUpdateSettings from '#lib/components/PwaUpdateSettings.svelte';
  import { pwaUpdates } from '#lib/application/pwa-updates';
  import AboutSettings from '#lib/components/AboutSettings.svelte';
  import BackupSettings from '#lib/components/BackupSettings.svelte';
  import LanguageSettings from '#lib/components/LanguageSettings.svelte';
  import ThemeSettings from '#lib/components/ThemeSettings.svelte';
  import SettingToggle from '#lib/components/SettingToggle.svelte';
  import { dartsSoundEnabled, setDartsSoundEnabled } from '#lib/application/darts-audio';

  let database = $state.raw<LocalDatabase>();
  let loading = $state(true);
  let transferBusy = $state(false);
  let error = $state('');
  let dartsSound = $state(true);

  onMount(() => {
    let active = true;
    dartsSound = dartsSoundEnabled();
    void (async () => {
      try {
        const { LocalDatabase } = await import('#lib/storage/database');
        if (!active) return;
        database = new LocalDatabase();
        await database.open();
      } catch {
        if (active) {
          error = messages.settings.error;
        }
      } finally {
        if (active) loading = false;
      }
    })();
    return () => {
      active = false;
      database?.close();
    };
  });
</script>

<svelte:head><title>{messages.nav.settings} · {messages.appName}</title></svelte:head>
<div class="page-heading">
  <p class="eyebrow">{messages.nav.settings}</p>
  <h1>{messages.settings.title}</h1>
  <p>{messages.settings.intro}</p>
</div>
<fieldset
  class="settings-stack settings-content"
  disabled={$pwaUpdates.applying}
  aria-label={messages.settings.title}
>
  {#if loading}<p role="status">{messages.settings.loading}</p>{/if}
  {#if error}<p class="notice error" role="alert">{error}</p>{/if}
  {#if database && !loading}<LanguageSettings {database} /><ThemeSettings {database} />{/if}
  <section class="panel settings-panel" aria-labelledby="sound-title">
    <h2 id="sound-title">{messages.settings.soundTitle}</h2>
    <SettingToggle
      label={messages.settings.dartsSound}
      checked={dartsSound}
      onchange={(enabled) => {
        dartsSound = enabled;
        setDartsSoundEnabled(enabled);
      }}
    />
  </section>
  {#if database && !loading}<BackupSettings {database} bind:busy={transferBusy} />{/if}
  <section class="panel settings-panel">
    <h2>{messages.settings.installTitle}</h2>
    <p>{messages.settings.install}</p>
    <p>{messages.settings.installDetail}</p>
    <p>{messages.settings.updates}</p>
  </section>
  <PwaUpdateSettings {database} {transferBusy} />
  <AboutSettings />
</fieldset>

<style>
  .settings-content {
    min-width: 0;
    border: 0;
    padding: 0;
    margin: 0;
  }
</style>
