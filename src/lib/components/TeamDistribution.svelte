<script lang="ts">
  import Icon from './Icon.svelte';
  import { onMount } from 'svelte';
  import type { PlayerRecord } from '#lib/domain/records';
  import { distributePlayers, type TeamFormat } from '#lib/domain/teams';
  import type { LocalRepository } from '#lib/storage/repository';
  import type { TeamRepository } from '#lib/storage/teams';
  import { teamErrorMessage } from '#lib/application/team-errors';
  import { messages } from '#lib/i18n/index';
  import PlayerPicker from './PlayerPicker.svelte';

  let {
    teams,
    players,
    ondismiss,
    onsaved,
    initialMembers = [],
  }: {
    teams: TeamRepository;
    players: LocalRepository;
    ondismiss: () => void;
    onsaved: () => void;
    initialMembers?: readonly PlayerRecord[];
  } = $props();
  let selected = $state<PlayerRecord[]>([]);
  let format = $state<TeamFormat>('petanque_doublette');
  let freeSize = $state(2);
  const teamSize = $derived(format === 'petanque_doublette' ? 2 : freeSize);
  let groups = $state<{ id: string; name: string; playerIds: readonly string[] }[]>([]);
  let saving = $state(false);
  let error = $state('');
  let dialog: HTMLDialogElement;
  const colors = ['#1e5f91', '#a33c4a', '#546a33', '#743c86', '#92501d', '#153e35'];
  onMount(() => {
    selected = [...initialMembers];
    const opener = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  });
  $effect(() => {
    void selected.map((player) => player.id);
    void teamSize;
    groups = [];
    error = '';
  });
  function draw() {
    error = '';
    try {
      const samples = Array.from(
        crypto.getRandomValues(new Uint32Array(Math.max(0, selected.length - 1))),
        (value) => value / 4294967296,
      );
      groups = distributePlayers(
        selected.map((player) => player.id),
        teamSize,
        samples,
      ).map((playerIds, index) => ({
        id: crypto.randomUUID(),
        name: messages.teams.generatedName(index + 1),
        playerIds,
      }));
    } catch (failure) {
      error = teamErrorMessage(failure);
    }
  }
  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (saving || groups.length === 0) return;
    saving = true;
    error = '';
    try {
      const now = new Date().toISOString();
      await teams.createTeams(
        groups.map((group, index) => ({
          team: {
            id: group.id,
            name: group.name,
            color: colors[index % colors.length]!,
            avatar: 'flag',
            format,
            createdAt: now,
            updatedAt: now,
          },
          playerIds: [...group.playerIds],
        })),
      );
      onsaved();
    } catch (failure) {
      error = teamErrorMessage(failure);
    } finally {
      saving = false;
    }
  }
</script>

<dialog
  bind:this={dialog}
  aria-labelledby="team-draw-title"
  onclose={ondismiss}
  oncancel={(event) => {
    if (saving) event.preventDefault();
  }}
>
  <h2 id="team-draw-title">{messages.teams.drawTitle}</h2>
  <form onsubmit={save}>
    <fieldset class="editor-fields" disabled={saving}>
      <label for="draw-format">{messages.teams.format}</label><select
        id="draw-format"
        bind:value={format}
        ><option value="petanque_doublette">{messages.teams.doublette}</option><option value="free"
          >{messages.teams.free}</option
        ></select
      >
      {#if format === 'free'}<label for="team-size">{messages.teams.teamSize}</label><input
          id="team-size"
          type="number"
          min="1"
          max="32"
          step="1"
          bind:value={freeSize}
        />{/if}
      <PlayerPicker repository={players} bind:selected />
      <button class="button secondary" type="button" onclick={draw}
        ><Icon name="shuffle" />{messages.teams.draw}</button
      >
      {#if groups.length}<section aria-label={messages.teams.preview} class="distribution-preview">
          <h3>{messages.teams.preview}</h3>
          {#each groups as group, index (group.id)}<div class="panel distribution-group">
              <label for={`group-${group.id}`}>{messages.teams.generatedLabel(index + 1)}</label
              ><input id={`group-${group.id}`} bind:value={group.name} required maxlength="120" />
              <p>
                {group.playerIds
                  .map((id) => selected.find((player) => player.id === id)?.displayName)
                  .join(' + ')}
              </p>
            </div>{/each}
        </section>{/if}
    </fieldset>
    <p class="error" role="alert">{error}</p>
    <div class="form-actions">
      <button class="button" type="submit" disabled={saving || !groups.length}
        ><Icon name="save" />{saving ? messages.teams.saving : messages.teams.saveBatch}</button
      ><button
        class="button secondary"
        type="button"
        disabled={saving}
        onclick={() => dialog.close()}><Icon name="close" />{messages.players.cancel}</button
      >
    </div>
  </form>
</dialog>
