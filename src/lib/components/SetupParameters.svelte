<script lang="ts">
  import type { GameVersionRecord } from '#lib/domain/records';
  import {
    gameSettings,
    x01StartingScores,
    versionForSetting,
    type GameSetting,
  } from '#lib/application/game-settings';
  import SettingToggle from './SettingToggle.svelte';
  import { messages } from '#lib/i18n/index';
  let {
    version,
    versions,
    onselect,
    x01Start = $bindable(301),
  }: {
    version: GameVersionRecord;
    versions: readonly GameVersionRecord[];
    onselect: (id: string) => void;
    x01Start?: number;
  } = $props();
  let previousX01 = $state(''),
    previousCricket = $state('');
  $effect(() => {
    if (version.gameId === 'darts') {
      if (version.definition.engine === 'cricket') previousCricket = version.id;
      else previousX01 = version.id;
    }
  });
  const settings = $derived(gameSettings(version));
  function settingLabel(key: GameSetting, enabled: boolean) {
    if (key === 'target10000' && !enabled) return messages.parameters.labels.target5000;
    if (key === 'cricket' && !enabled) return messages.parameters.labels.x01;
    return messages.parameters.labels[key];
  }
  function candidate(key: GameSetting, enabled: boolean) {
    if (key === 'cricket') {
      const saved = versions.find(
        (item) => item.id === (enabled ? previousCricket : previousX01) && item.gameId === 'darts',
      );
      if (saved) return saved;
    }
    return versionForSetting(version, versions, key, enabled);
  }
</script>

{#if settings.length}<fieldset class="setup-parameters">
    <legend>{messages.parameters.title}</legend>
    {#each settings as setting (setting.key)}
      <SettingToggle
        label={settingLabel(setting.key, setting.enabled)}
        hint={setting.key === 'target10000' || setting.key === 'cricket'
          ? undefined
          : messages.parameters.hints[setting.key]}
        checked={setting.enabled}
        disabled={!candidate(setting.key, !setting.enabled)}
        onchange={(enabled) => {
          const next = candidate(setting.key, enabled);
          if (next) onselect(next.id);
        }}
      />
    {/each}
    {#if version.gameId === 'darts' && version.definition.engine === 'x01'}
      <div class="game-field">
        <label for="x01-start">{messages.parameters.x01Start}</label>
        <select id="x01-start" bind:value={x01Start} required>
          {#each x01StartingScores as score (score)}
            <option value={score}>{score}</option>
          {/each}
        </select>
        <p class="field-hint">{messages.parameters.x01StartHint}</p>
      </div>
    {/if}
  </fieldset>{/if}
