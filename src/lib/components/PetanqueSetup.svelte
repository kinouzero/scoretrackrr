<script lang="ts">
  import Icon from '#lib/components/Icon.svelte';
  import SetupPresets from './SetupPresets.svelte';
  import ParticipantOrder from './ParticipantOrder.svelte';
  import { presetParticipants } from '#lib/storage/preset-participants';
  import { onMount } from 'svelte';
  import { liveQuery } from 'dexie';
  import { resolve } from '$app/paths';
  import type { PlayerRecord } from '#lib/domain/records';
  import { LocalRepository } from '#lib/storage/repository';
  import PlayerPicker from './PlayerPicker.svelte';
  import type { LocalDatabase } from '#lib/storage/database';
  import { TeamRepository, type TeamRoster } from '#lib/storage/teams';
  import { PetanqueRepository } from '#lib/storage/petanque';
  import { petanqueErrorMessage } from '#lib/application/petanque-errors';
  import { messages } from '#lib/i18n/index';
  import SettingToggle from './SettingToggle.svelte';
  import TeamAvatar from './TeamAvatar.svelte';

  let {
    database,
    initialMode,
    initialTarget,
    ondismiss,
    oncreated,
  }: {
    database: LocalDatabase;
    initialMode?: 'individual' | 'teams';
    initialTarget?: 11 | 13;
    ondismiss: () => void;
    oncreated: (id: string) => void;
  } = $props();
  const teams = $derived(new TeamRepository(database));
  const matches = $derived(new PetanqueRepository(database));
  let dialog: HTMLDialogElement;
  let search = $state('');
  let pageIndex = $state(0);
  let items = $state<TeamRoster[]>([]);
  let chosen = $state<TeamRoster[]>([]);
  let loading = $state(true);
  let hasMore = $state(false);
  let error = $state('');
  let saving = $state(false);
  let presetBusy = $state(false);
  let target = $state<11 | 13>(13);
  let mode = $state<'individual' | 'teams'>('individual');
  let boulesPerPlayer = $state<2 | 3>(3);
  let selectedPlayers = $state<PlayerRecord[]>([]);
  const profiles = $derived(new LocalRepository(database));
  let firstThrowOwnerId = $state('');
  const players = $derived(
    mode === 'individual' ? selectedPlayers : chosen.flatMap((roster) => roster.members),
  );
  const organizerPlayerId = $derived(players[0]?.id ?? '');
  const sides = $derived(
    mode === 'individual'
      ? selectedPlayers.map((player) => ({ id: player.id, name: player.displayName }))
      : chosen.map((roster) => roster.team),
  );
  onMount(() => {
    mode = initialMode ?? 'individual';
    target = initialTarget ?? 13;
    dialog.showModal();
  });
  $effect(() => {
    const options = { search, page: pageIndex };
    loading = true;
    const subscription = liveQuery(() => teams.listTeams(options)).subscribe({
      next(result) {
        items = result.items;
        hasMore = result.hasMore;
        loading = false;
      },
      error(failure) {
        error = petanqueErrorMessage(failure, true);
        loading = false;
      },
    });
    return () => subscription.unsubscribe();
  });
  function select(roster: TeamRoster) {
    chosen = [...chosen, roster];
    firstThrowOwnerId = '';
  }
  function capturePreset() {
    return {
      mode,
      target,
      boulesPerPlayer,
      playerIds: mode === 'individual' ? selectedPlayers.map((player) => player.id) : [],
      teamIds: mode === 'teams' ? chosen.map((roster) => roster.team.id) : [],
    };
  }
  async function applyPreset(options: Record<string, unknown>) {
    if (
      !['individual', 'teams'].includes(String(options.mode)) ||
      ![11, 13].includes(Number(options.target)) ||
      ![2, 3].includes(Number(options.boulesPerPlayer))
    )
      throw new Error('Invalid preset');
    const restored = await presetParticipants(database, options.playerIds, options.teamIds);
    mode = options.mode as typeof mode;
    target = options.target as 11 | 13;
    boulesPerPlayer = options.boulesPerPlayer as 2 | 3;
    selectedPlayers = restored.players;
    chosen = restored.rosters;
    firstThrowOwnerId = '';
  }
  function reorder(ids: string[]) {
    if (mode === 'teams') chosen = ids.map((id) => chosen.find((roster) => roster.team.id === id)!);
    else selectedPlayers = ids.map((id) => selectedPlayers.find((player) => player.id === id)!);
  }
  async function create(event: SubmitEvent) {
    event.preventDefault();
    if (saving || presetBusy) return;
    error = '';
    if (
      sides.length < 2 ||
      sides.length > 16 ||
      !players.some((player) => player.id === organizerPlayerId) ||
      !sides.some((side) => side.id === firstThrowOwnerId)
    ) {
      error = messages.petanque.invalidSetup;
      return;
    }
    saving = true;
    try {
      const match = await matches.create({
        id: crypto.randomUUID(),
        target,
        organizerPlayerId,
        firstThrowOwnerId,
        mode,
        boulesPerPlayer,
        playerIds: mode === 'individual' ? players.map((player) => player.id) : [],
        teams: (mode === 'teams' ? chosen : []).map((roster) => ({
          id: roster.team.id,
          revision: roster.team.revision ?? 0,
        })),
        createdAt: new Date().toISOString(),
      });
      oncreated(match.id);
    } catch (failure) {
      error = petanqueErrorMessage(failure, true);
    } finally {
      saving = false;
    }
  }
</script>

<dialog
  bind:this={dialog}
  aria-labelledby="petanque-setup-title"
  onclose={ondismiss}
  oncancel={(event) => {
    if (saving) event.preventDefault();
  }}
>
  <h2 id="petanque-setup-title">{messages.petanque.setup}</h2>
  <a class="text-button" href={resolve('/teams')}
    ><Icon name="teams" />{messages.petanque.manageTeams}</a
  >
  <form onsubmit={create}>
    <SetupPresets
      disabled={saving}
      bind:busy={presetBusy}
      gameId="petanque"
      capture={capturePreset}
      apply={applyPreset}
    />
    <fieldset class="editor-fields" disabled={saving || presetBusy}>
      <fieldset class="setup-parameters">
        <legend>{messages.parameters.title}</legend>
        <SettingToggle
          label={messages.parameters.petanqueShort}
          hint={messages.parameters.petanqueHint}
          checked={target === 11}
          onchange={(enabled) => (target = enabled ? 11 : 13)}
        />
      </fieldset>
      <SettingToggle
        label={messages.parameters.teamPlay}
        checked={mode === 'teams'}
        onchange={(enabled) => {
          mode = enabled ? 'teams' : 'individual';
          firstThrowOwnerId = '';
        }}
      />
      {#if mode === 'individual'}<PlayerPicker
          repository={profiles}
          bind:selected={selectedPlayers}
        />
      {:else}<label for="petanque-team-search">{messages.petanque.search}</label>
        <input
          id="petanque-team-search"
          type="search"
          bind:value={search}
          oninput={() => (pageIndex = 0)}
        />
        <p class="field-hint">{messages.petanque.rosterHint}</p>
        {#if loading}<p role="status">{messages.teams.loading}</p>{:else if items.length === 0}<p>
            {messages.petanque.noTeams}
          </p>{/if}
        <div class="picker-options">
          {#each items as roster (roster.team.id)}
            <button
              type="button"
              class="picker-option team-choice"
              aria-label={messages.petanque.choose(roster.team.name)}
              disabled={chosen.length >= 16 ||
                chosen.some((value) => value.team.id === roster.team.id) ||
                roster.members.length < 1 ||
                roster.members.some(
                  (member) =>
                    member.deletedAt ||
                    member.archivedAt ||
                    players.some((player) => player.id === member.id),
                )}
              onclick={() => select(roster)}
              ><Icon name="check" /><TeamAvatar team={roster.team} /><span
                >{roster.team.name}<small
                  >{roster.members.map((member) => member.displayName).join(' · ')}</small
                ></span
              >
            </button>
          {/each}
        </div>
        {#if pageIndex > 0 || hasMore}<div class="profile-pagination">
            <button
              type="button"
              class="button secondary"
              disabled={pageIndex === 0 || loading}
              onclick={() => pageIndex--}
              ><Icon name="arrow-left" />{messages.players.previous}</button
            >
            <span>{messages.players.page(pageIndex + 1)}</span><button
              type="button"
              class="button secondary"
              disabled={!hasMore || loading}
              onclick={() => pageIndex++}><Icon name="arrow-right" />{messages.players.next}</button
            >
          </div>{/if}
        <h3>{messages.petanque.selected} ({chosen.length}/16)</h3>
        <ul class="selected-players">
          {#each chosen as roster (roster.team.id)}<li>
              <span
                >{roster.team.name} — {roster.members
                  .map((member) => member.displayName)
                  .join(' · ')}</span
              >
              <button
                type="button"
                class="text-button"
                aria-label={messages.petanque.remove(roster.team.name)}
                onclick={() => {
                  chosen = chosen.filter((value) => value.team.id !== roster.team.id);
                  firstThrowOwnerId = '';
                }}><Icon name="close" size={16} /></button
              >
            </li>{/each}
        </ul>
      {/if}
      <ParticipantOrder
        items={sides.map((side) => ({ id: side.id, name: side.name }))}
        onchange={reorder}
      />
      {#if sides.length > 2}<p class="field-hint">{messages.petanque.freePlay}</p>{/if}
      <label for="petanque-boules">{messages.petanque.boules}</label><select
        id="petanque-boules"
        bind:value={boulesPerPlayer}
      >
        <option value={3}>3</option><option value={2}>2</option>
      </select>
      <label for="petanque-first">{messages.petanque.firstThrow}</label><select
        id="petanque-first"
        bind:value={firstThrowOwnerId}
        required
      >
        <option value="">{messages.petanque.chooseOption}</option
        >{#each sides as side (side.id)}<option value={side.id}>{side.name}</option>{/each}
      </select>
    </fieldset>
    <p class="error" role="alert">{error}</p>
    <div class="form-actions">
      <button
        class="button"
        disabled={saving || presetBusy || sides.length < 2 || sides.length > 16}
        ><Icon name="plus" />{saving
          ? messages.petanque.saving
          : messages.petanque.createDraft}</button
      >
      <button
        class="button secondary"
        type="button"
        disabled={saving || presetBusy}
        onclick={() => dialog.close()}><Icon name="close" />{messages.players.cancel}</button
      >
    </div>
  </form>
</dialog>

<style>
  .team-choice {
    width: 100%;
    border: 1px solid var(--border);
    background: var(--surface);
    text-align: left;
  }
  .team-choice span {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .team-choice small {
    display: block;
  }
</style>
