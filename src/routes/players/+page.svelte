<script lang="ts">
  import Icon from '#lib/components/Icon.svelte';
  import { onMount, tick } from 'svelte';
  import type { PlayerRecord } from '#lib/domain/records';
  import type { LocalRepository } from '#lib/storage/repository';
  import type { LocalDatabase } from '#lib/storage/database';
  import type { TeamRepository } from '#lib/storage/teams';
  import TeamEditor from '#lib/components/TeamEditor.svelte';
  import TeamDistribution from '#lib/components/TeamDistribution.svelte';
  import PlayerEditor from '#lib/components/PlayerEditor.svelte';
  import PlayerAvatar from '#lib/components/PlayerAvatar.svelte';
  import EmptyState from '#lib/components/EmptyState.svelte';
  import { playerErrorMessage } from '#lib/application/player-errors';
  import { messages } from '#lib/i18n/index';

  let players = $state<PlayerRecord[]>([]);
  let repository = $state.raw<LocalRepository>();
  let teams = $state.raw<TeamRepository>();
  let selecting = $state(false);
  let selected = $state<PlayerRecord[]>([]);
  let teamEditorOpen = $state(false);
  let drawing = $state(false);
  let selectionButton: HTMLButtonElement;
  const selectedIds = $derived(new Set(selected.map((player) => player.id)));
  const pageSelected = $derived(
    players.length > 0 && players.every((player) => selectedIds.has(player.id)),
  );
  const pagePartlySelected = $derived(
    !pageSelected && players.some((player) => selectedIds.has(player.id)),
  );
  const pageSelectionFull = $derived(
    new Set([...selectedIds, ...players.map((player) => player.id)]).size > 256,
  );
  let observe = $state<typeof import('dexie').liveQuery>();
  let loading = $state(true);
  let search = $state('');
  let pageIndex = $state(0);
  let hasMore = $state(false);
  let error = $state('');
  let notice = $state('');
  let retry = $state(0);
  let editorOpen = $state(false);
  let editing = $state<PlayerRecord | null>(null);
  let deleting = $state<PlayerRecord[]>([]);
  let saving = $state(false);
  let deleteError = $state('');
  let deleteDialog: HTMLDialogElement;
  let addButton: HTMLButtonElement;

  onMount(() => {
    let active = true;
    let database: LocalDatabase | undefined;
    void (async () => {
      try {
        const [storage, adapter, dexie, teamAdapter] = await Promise.all([
          import('#lib/storage/database'),
          import('#lib/storage/repository'),
          import('dexie'),
          import('#lib/storage/teams'),
        ]);
        if (!active) return;
        database = new storage.LocalDatabase();
        observe = dexie.liveQuery;
        repository = new adapter.LocalRepository(database);
        teams = new teamAdapter.TeamRepository(database);
      } catch (failure) {
        if (active) {
          error = playerErrorMessage(failure);
          loading = false;
        }
      }
    })();
    return () => {
      active = false;
      database?.close();
    };
  });

  $effect(() => {
    const current = repository;
    const watch = observe;
    const options = { search, page: pageIndex };
    void retry;
    if (!current || !watch) return;
    loading = true;
    error = '';
    const subscription = watch(() => current.listPlayers(options)).subscribe({
      next(result) {
        players = result.items;
        hasMore = result.hasMore;
        loading = false;
      },
      error(failure) {
        error = playerErrorMessage(failure);
        loading = false;
      },
    });
    return () => subscription.unsubscribe();
  });

  let returnFocus = $state.raw<HTMLElement>();
  function openEditor(player: PlayerRecord | null, trigger: HTMLElement) {
    returnFocus = trigger;
    editing = player;
    editorOpen = true;
    notice = '';
  }

  function togglePlayer(player: PlayerRecord, checked: boolean) {
    if (checked) {
      if (!selectedIds.has(player.id) && selected.length < 256) selected = [...selected, player];
    } else selected = selected.filter((item) => item.id !== player.id);
  }

  function selectPage(checked: boolean) {
    if (checked && !pageSelectionFull)
      selected = [...selected, ...players.filter((player) => !selectedIds.has(player.id))];
    else if (!checked) {
      const ids = new Set(players.map((player) => player.id));
      selected = selected.filter((player) => !ids.has(player.id));
    }
  }

  async function confirmDelete(targets: readonly PlayerRecord[]) {
    deleting = [...targets];
    deleteError = '';
    notice = '';
    await tick();
    deleteDialog.showModal();
  }

  async function deletePlayer() {
    if (!repository || !deleting.length || saving) return;
    saving = true;
    try {
      const targets = [...deleting];
      await repository.deletePlayers(
        targets.map((player) => ({ id: player.id, expectedRevision: player.revision ?? 0 })),
        new Date().toISOString(),
      );
      const removed = new Set(targets.map((player) => player.id));
      selected = selected.filter((player) => !removed.has(player.id));
      deleteDialog.close();
      notice =
        targets.length === 1
          ? messages.players.deleted
          : messages.players.deletedMany(targets.length);
      await tick();
      (selecting ? selectionButton : addButton).focus();
    } catch (failure) {
      deleteError = playerErrorMessage(failure);
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head><title>{messages.nav.players} · {messages.appName}</title></svelte:head>
<div class="page-heading collection-heading">
  <div>
    <p class="eyebrow">{messages.nav.players}</p>
    <h1>{messages.players.title}</h1>
    <p>{messages.players.intro}</p>
  </div>
  <button
    bind:this={addButton}
    class="button"
    disabled={!repository}
    onclick={(event) => openEditor(null, event.currentTarget)}
    ><Icon name="plus" />{messages.players.add}</button
  >
</div>
<div class="panel collection-filters players-controls">
  <div class="filter-field">
    <label for="player-search">{messages.players.search}</label><input
      id="player-search"
      type="search"
      bind:value={search}
      oninput={() => {
        loading = true;
        pageIndex = 0;
      }}
      aria-describedby="player-search-hint"
    />
  </div>
  <button
    bind:this={selectionButton}
    class="button secondary selection-toggle"
    aria-pressed={selecting}
    aria-label={selecting ? messages.players.exitSelection : messages.players.selectMode}
    disabled={!repository}
    onclick={() => {
      selecting = !selecting;
      selected = [];
    }}
    ><Icon name={selecting ? 'close' : 'check'} />{selecting
      ? messages.players.exitSelectionShort
      : messages.players.selectModeShort}</button
  >
  <p class="field-hint" id="player-search-hint">{messages.players.searchHint}</p>
  {#if selecting}<div class="selection-options">
      <label class="check-label"
        ><input
          type="checkbox"
          checked={pageSelected}
          indeterminate={pagePartlySelected}
          disabled={loading || !players.length || (!pageSelected && pageSelectionFull)}
          onchange={(event) => selectPage(event.currentTarget.checked)}
        />{messages.players.selectPage}</label
      >
      <details class="selection-help">
        <summary>{messages.players.selectionHelp}</summary>
        <p class="field-hint">{messages.players.selectionHint}</p>
        <p class="field-hint">{messages.players.teamSelectionHint}</p>
      </details>
    </div>{/if}
</div>
{#if selecting}
  <section class="panel player-selection" aria-label={messages.players.selectMode}>
    <div class="filter-options">
      <p role="status">{messages.players.selectedCount(selected.length)}</p>
      <button class="text-button" disabled={!selected.length} onclick={() => (selected = [])}
        ><Icon name="close" />{messages.players.clearSelection}</button
      >
    </div>
    <div class="selection-actions">
      <button
        class="button"
        aria-label={messages.players.createTeam}
        disabled={!teams || !selected.length || selected.length > 32}
        onclick={(event) => {
          returnFocus = event.currentTarget;
          teamEditorOpen = true;
        }}><Icon name="teams" />{messages.players.createTeamShort}</button
      >
      <button
        class="button secondary"
        aria-label={messages.players.distributeTeams}
        disabled={!teams || selected.length < 2}
        onclick={() => (drawing = true)}
        ><Icon name="shuffle" />{messages.players.distributeTeamsShort}</button
      >
      <button
        class="button delete-confirm"
        aria-label={messages.players.deleteSelection}
        disabled={!selected.length}
        onclick={() => confirmDelete(selected)}
        ><Icon name="trash" />{messages.players.deleteSelectionShort}</button
      >
    </div>
  </section>
{/if}
<p class="profile-notice" role="status">{notice}</p>
{#if error}<div class="notice error" role="alert">
    <p>{error}</p>
    <button
      class="button secondary"
      onclick={() => {
        retry += 1;
      }}><Icon name="replay" />{messages.players.retry}</button
    >
  </div>{/if}
{#if loading}<p role="status">{messages.players.loading}</p>
{:else if !error && players.length === 0}
  {#if pageIndex > 0 || search}<p class="panel no-results">
      {messages.players.noResults}
    </p>{:else}<EmptyState
      icon="player"
      title={messages.players.empty}
      detail={messages.players.detail}
    />{/if}
{:else if !error}
  <div class="players-list-heading">
    <h2>{messages.players.list}</h2>
    <span>{messages.players.visibleCount(players.length)}</span>
  </div>
  <ul class="profile-grid collection-list players-list" aria-label={messages.players.list}>
    {#each players as player (player.id)}
      <li>
        <article
          class="panel profile-card player-row"
          class:selected-profile={selecting && selectedIds.has(player.id)}
          aria-label={player.displayName}
        >
          {#if selecting}<label class="check-label player-row-select"
              ><input
                type="checkbox"
                checked={selectedIds.has(player.id)}
                disabled={!selectedIds.has(player.id) && selected.length >= 256}
                onchange={(event) => togglePlayer(player, event.currentTarget.checked)}
              /><span class="sr-only">{messages.players.select(player.displayName)}</span></label
            >{/if}
          <div class="profile-identity player-row-identity">
            <PlayerAvatar profile={player} />
            <div>
              <h2>{player.displayName}</h2>
              <span class="badge"
                >{player.isGuest
                  ? messages.players.guestBadge
                  : messages.players.savedProfile}</span
              >
            </div>
          </div>
          {#if !selecting}<div class="profile-actions player-row-actions">
              <button
                class="player-row-action"
                title={messages.players.editTitle}
                onclick={(event) => openEditor(player, event.currentTarget)}
                aria-label={messages.players.edit(player.displayName)}><Icon name="edit" /></button
              ><button
                class="player-row-action delete-player-action"
                title={messages.players.remove(player.displayName)}
                onclick={() => confirmDelete([player])}
                aria-label={messages.players.remove(player.displayName)}
                ><Icon name="trash" /></button
              >
            </div>{/if}
        </article>
      </li>
    {/each}
  </ul>
{/if}
{#if pageIndex > 0 || hasMore}
  <div class="profile-pagination" role="group" aria-label={messages.players.pagination}>
    <button
      class="button secondary"
      disabled={loading || pageIndex === 0}
      onclick={() => {
        loading = true;
        pageIndex -= 1;
      }}><Icon name="arrow-left" />{messages.players.previous}</button
    ><span>{messages.players.page(pageIndex + 1)}</span><button
      class="button secondary"
      disabled={loading || !hasMore}
      onclick={() => {
        loading = true;
        pageIndex += 1;
      }}><Icon name="arrow-right" />{messages.players.next}</button
    >
  </div>
{/if}
{#if editorOpen && repository}<PlayerEditor
    {returnFocus}
    player={editing}
    {repository}
    ondismiss={() => {
      editorOpen = false;
    }}
    onsaved={(warning) => {
      editorOpen = false;
      notice = warning ? messages.players.gravatarUnavailable : messages.players.saved;
    }}
  />{/if}
{#if teamEditorOpen && teams && repository}<TeamEditor
    roster={null}
    {teams}
    players={repository}
    initialMembers={selected}
    {returnFocus}
    ondismiss={() => (teamEditorOpen = false)}
    onsaved={() => {
      teamEditorOpen = false;
      notice = messages.teams.saved;
    }}
  />{/if}
{#if drawing && teams && repository}<TeamDistribution
    {teams}
    players={repository}
    initialMembers={selected}
    ondismiss={() => (drawing = false)}
    onsaved={() => {
      drawing = false;
      notice = messages.teams.batchSaved;
    }}
  />{/if}
<dialog
  bind:this={deleteDialog}
  aria-labelledby="delete-title"
  onclose={() => {
    deleting = [];
  }}
  oncancel={(event) => {
    if (saving) event.preventDefault();
  }}
>
  <h2 id="delete-title">
    {deleting.length === 1
      ? messages.players.deleteTitle(deleting[0]!.displayName)
      : deleting.length
        ? messages.players.deleteManyTitle(deleting.length)
        : ''}
  </h2>
  <p>{deleting.length > 1 ? messages.players.deleteManyDetail : messages.players.deleteDetail}</p>
  {#if deleting.length > 1}<ul class="deletion-names">
      {#each deleting as player (player.id)}<li>{player.displayName}</li>{/each}
    </ul>{/if}
  <p role="alert" class="error">{deleteError}</p>
  <div class="form-actions">
    <button class="button delete-confirm" disabled={saving} onclick={deletePlayer}
      ><Icon name="trash" />{saving
        ? messages.players.saving
        : deleting.length > 1
          ? messages.players.confirmDeleteMany
          : messages.players.confirmDelete}</button
    ><button class="button secondary" disabled={saving} onclick={() => deleteDialog.close()}
      ><Icon name="close" />{messages.players.cancel}</button
    >
  </div>
</dialog>
