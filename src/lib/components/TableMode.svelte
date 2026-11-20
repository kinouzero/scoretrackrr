<script lang="ts">
  import Icon from '#lib/components/Icon.svelte';
  import { onMount } from 'svelte';
  import { messages } from '#lib/i18n/index';
  import { readPreference, writePreference } from '#lib/application/local-preferences';
  let { running }: { running: boolean } = $props();
  let enabled = $state(false),
    awake = $state(false),
    visible = $state(true),
    supported = $state(false),
    held = $state(false),
    refused = $state(false);
  onMount(() => {
    enabled =
      readPreference(
        'scoretrackrr.table-mode',
        (value): value is boolean => typeof value === 'boolean',
      ) ?? false;
    supported = 'wakeLock' in navigator;
    const update = () => {
      visible = document.visibilityState === 'visible';
    };
    update();
    document.addEventListener('visibilitychange', update);
    return () => {
      document.removeEventListener('visibilitychange', update);
      delete document.documentElement.dataset.tableMode;
    };
  });
  $effect(() => {
    document.documentElement.dataset.tableMode = String(enabled);
    writePreference('scoretrackrr.table-mode', enabled);
  });
  $effect(() => {
    if (!awake || !running || !visible || !supported) {
      held = false;
      return;
    }
    let active = true;
    let sentinel: WakeLockSentinel | undefined;
    refused = false;
    void navigator.wakeLock
      .request('screen')
      .then(async (lock) => {
        if (!active) {
          await lock.release();
          return;
        }
        sentinel = lock;
        held = !lock.released;
        lock.addEventListener(
          'release',
          () => {
            if (active) held = false;
          },
          { once: true },
        );
      })
      .catch(() => {
        if (active) {
          held = false;
          refused = true;
        }
      });
    return () => {
      active = false;
      held = false;
      void sentinel?.release().catch(() => undefined);
    };
  });
</script>

<div class="table-tools" role="group" aria-label={messages.play.display}>
  <button class="button secondary" onclick={() => (enabled = !enabled)}>
    <Icon name="table" />
    <span class="table-view-label">
      <span>{enabled ? messages.play.normalView : messages.play.tableMode}</span>
      <span aria-hidden="true">{enabled ? messages.play.tableMode : messages.play.normalView}</span>
    </span>
  </button>
  {#if running}
    <button
      class="button secondary"
      disabled={!supported}
      aria-pressed={awake}
      onclick={() => (awake = !awake)}><Icon name="screen" />{messages.play.keepAwake}</button
    >
    <span class="field-hint" role="status"
      >{!supported
        ? messages.play.wakeUnsupported
        : refused
          ? messages.play.wakeRefused
          : held
            ? messages.play.wakeActive
            : awake
              ? messages.play.wakeReleased
              : ''}</span
    >
  {/if}
</div>

<style>
  .table-tools {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 11rem), 1fr));
    align-items: stretch;
  }
  .table-tools > button {
    min-inline-size: 0;
  }
  .field-hint {
    grid-column: 1 / -1;
  }
  .table-view-label {
    display: grid;
  }
  .table-view-label > span {
    grid-area: 1 / 1;
  }
  .table-view-label > [aria-hidden='true'] {
    visibility: hidden;
  }
</style>
