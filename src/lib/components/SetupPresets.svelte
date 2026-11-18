<script lang="ts">
  import Icon from '#lib/components/Icon.svelte';
  import { onMount } from 'svelte';
  import { messages } from '#lib/i18n/index';
  import { readPresets, savePresets, type SetupPreset } from '#lib/application/setup-presets';
  let {
    gameId,
    capture,
    apply,
    disabled = false,
    busy = $bindable(false),
  }: {
    disabled?: boolean;
    busy?: boolean;
    gameId: string;
    capture: () => Record<string, unknown>;
    apply: (options: Record<string, unknown>) => Promise<void>;
  } = $props();
  let items = $state<SetupPreset[]>([]),
    name = $state(''),
    selected = $state(''),
    notice = $state('');
  const choices = $derived(items.filter((item) => item.gameId === gameId));
  onMount(() => {
    items = readPresets();
  });
  function save() {
    if (disabled || busy) return;
    notice = '';
    const title = name.trim();
    if (!title || items.length >= 40) {
      notice = messages.play.presetLimit;
      return;
    }
    const preset = { id: crypto.randomUUID(), name: title, gameId, options: capture() };
    const next = [...items, preset];
    if (!savePresets(next)) {
      notice = messages.play.storageError;
      return;
    }
    items = next;
    selected = preset.id;
    name = '';
    notice = messages.play.presetSaved;
  }
  async function load() {
    const preset = choices.find((item) => item.id === selected);
    if (!preset || busy || disabled) return;
    busy = true;
    notice = '';
    try {
      await apply(preset.options);
      notice = messages.play.presetApplied;
    } catch {
      notice = messages.play.presetUnavailable;
    } finally {
      busy = false;
    }
  }
  function remove() {
    if (disabled || busy) return;
    const next = items.filter((item) => item.id !== selected);
    if (!savePresets(next)) {
      notice = messages.play.storageError;
      return;
    }
    items = next;
    selected = '';
    notice = '';
  }
</script>

<details class="setup-presets">
  <summary>{messages.play.presets}</summary>
  <div class="stack">
    <p class="field-hint">{messages.play.presetHint}</p>
    {#if choices.length}
      <label for={`preset-choice-${gameId}`}>{messages.play.presetChoose}</label>
      <select id={`preset-choice-${gameId}`} bind:value={selected} disabled={disabled || busy}
        ><option value="">—</option>{#each choices as preset (preset.id)}<option value={preset.id}
            >{preset.name}</option
          >{/each}</select
      >
      <div class="form-actions">
        <button
          type="button"
          class="button secondary"
          disabled={disabled || !selected || busy}
          onclick={load}><Icon name="check" />{messages.play.apply}</button
        ><button
          type="button"
          class="button secondary"
          disabled={disabled || !selected || busy}
          onclick={remove}><Icon name="trash" />{messages.matches.delete}</button
        >
      </div>
    {/if}
    <label>{messages.play.presetName}<input bind:value={name} maxlength="60" /></label>
    <button
      class="button secondary"
      type="button"
      disabled={disabled || !name.trim() || busy || items.length >= 40}
      onclick={save}><Icon name="save" />{messages.play.savePreset}</button
    >
    {#if notice}<p role="status">{notice}</p>{/if}
  </div>
</details>
