<script lang="ts">
  import Icon from '#lib/components/Icon.svelte';
  import { onMount, tick } from 'svelte';
  import type { LocalDatabase } from '#lib/storage/database';
  import type { LocalRepository } from '#lib/storage/repository';
  import type { TeamRepository, TeamRoster } from '#lib/storage/teams';
  import { teamErrorMessage } from '#lib/application/team-errors';
  import TeamEditor from '#lib/components/TeamEditor.svelte';
  import TeamDistribution from '#lib/components/TeamDistribution.svelte';
  import TeamAvatar from '#lib/components/TeamAvatar.svelte';
  import EmptyState from '#lib/components/EmptyState.svelte';
  import { messages } from '#lib/i18n/index';

  let teams = $state.raw<TeamRepository>();
  let players = $state.raw<LocalRepository>();
  let observe = $state<typeof import('dexie').liveQuery>();
  let items = $state<TeamRoster[]>([]);
  let loading = $state(true);
  let search = $state('');
  let pageIndex = $state(0);
  let hasMore = $state(false);
  let retry = $state(0);
  let error = $state('');
  let notice = $state('');
  let editorOpen = $state(false);
  let drawing = $state(false);
  let editing = $state<TeamRoster | null>(null);
  let deleting = $state<TeamRoster | null>(null);
  let saving = $state(false);
  let deleteError = $state('');
  let deleteDialog: HTMLDialogElement;
  let addButton: HTMLButtonElement;
  onMount(() => {
    let active = true;
    let database: LocalDatabase | undefined;
    void (async () => {
      try {
        const [storage, teamModule, playerModule, dexie] = await Promise.all([
          import('#lib/storage/database'),
          import('#lib/storage/teams'),
          import('#lib/storage/repository'),
          import('dexie'),
        ]);
        if (!active) return;
        database = new storage.LocalDatabase();
        observe = dexie.liveQuery;
        teams = new teamModule.TeamRepository(database);
        players = new playerModule.LocalRepository(database);
      } catch (failure) {
        if (active) {
          error = teamErrorMessage(failure);
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
    const repository = teams,
      watch = observe;
    const options = { search, page: pageIndex };
    void retry;
    if (!repository || !watch) return;
    loading = true;
    error = '';
    const subscription = watch(() => repository.listTeams(options)).subscribe({
      next(result) {
        items = result.items;
        hasMore = result.hasMore;
        loading = false;
      },
      error(failure) {
        error = teamErrorMessage(failure);
        loading = false;
      },
    });
    return () => subscription.unsubscribe();
  });
  let returnFocus = $state.raw<HTMLElement>();
  function openEditor(roster: TeamRoster | null, trigger: HTMLElement) {
    returnFocus = trigger;
    editing = roster;
    editorOpen = true;
    notice = '';
  }
  async function confirmDelete(roster: TeamRoster) {
    deleting = roster;
    deleteError = '';
    notice = '';
    await tick();
    deleteDialog.showModal();
  }
  async function removeTeam(roster: TeamRoster) {
    if (!teams || saving) return;
    saving = true;
    error = '';
    notice = '';
    try {
      await teams.deleteTeam(roster.team.id, roster.team.revision ?? 0, new Date().toISOString());
      deleteDialog.close();
      notice = messages.teams.deleted;
      await tick();
      addButton.focus();
    } catch (failure) {
      deleteError = teamErrorMessage(failure);
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head><title>{messages.nav.teams} · {messages.appName}</title></svelte:head>
<div class="page-heading collection-heading">
  <div>
    <p class="eyebrow">{messages.nav.teams}</p>
    <h1>{messages.teams.title}</h1>
    <p>{messages.teams.intro}</p>
  </div>
  <button
    bind:this={addButton}
    class="button"
    disabled={!teams || !players}
    onclick={(event) => openEditor(null, event.currentTarget)}
    ><Icon name="plus" />{messages.teams.add}</button
  >
</div>
<div class="panel collection-filters">
  <div class="filter-field">
    <label for="team-search">{messages.teams.search}</label><input
      id="team-search"
      type="search"
      bind:value={search}
      oninput={() => {
        pageIndex = 0;
      }}
    />
  </div>
  <div class="filter-options">
    <button
      class="button secondary"
      disabled={!teams || !players}
      onclick={() => {
        drawing = true;
        notice = '';
      }}><Icon name="shuffle" />{messages.teams.random}</button
    >
  </div>
</div>
<p class="profile-notice" role="status">{notice}</p>
{#if error}<div class="notice error" role="alert">
    <p>{error}</p>
    <button
      class="button secondary"
      onclick={() => {
        retry++;
      }}><Icon name="replay" />{messages.players.retry}</button
    >
  </div>{/if}
{#if loading}<p role="status">{messages.teams.loading}</p>{:else if !error && items.length === 0}
  {#if search || pageIndex > 0}<p class="panel no-results">
      {messages.teams.noResults}
    </p>{:else}<EmptyState
      icon="teams"
      title={messages.teams.empty}
      detail={messages.teams.detail}
    />{/if}
{:else if !error}<ul class="profile-grid collection-list" aria-label={messages.nav.teams}>
    {#each items as roster (roster.team.id)}<li>
        <article class="panel profile-card" aria-label={roster.team.name}>
          <div class="profile-identity">
            <TeamAvatar team={roster.team} />
            <div>
              <h2>{roster.team.name}</h2>
              <span class="badge"
                >{roster.team.format === 'petanque_doublette'
                  ? messages.teams.doublette
                  : messages.teams.free}</span
              >
            </div>
          </div>
          <ul class="team-members">
            {#each roster.members as member (member.id)}<li>
                {member.displayName}{#if member.isGuest}<small>{messages.players.guestBadge}</small
                  >{/if}{#if member.deletedAt || member.archivedAt}<small class="error"
                    >{messages.players.deletedBadge}</small
                  >{/if}
              </li>{/each}
          </ul>
          {#if roster.members.some((member) => member.deletedAt || member.archivedAt)}<p
              class="field-hint error"
            >
              {messages.teams.unavailableMembers}
            </p>{/if}
          <div class="profile-actions">
            <button
              class="button secondary"
              aria-label={messages.teams.edit(roster.team.name)}
              onclick={(event) => openEditor(roster, event.currentTarget)}
              ><Icon name="edit" />{messages.teams.editTitle}</button
            ><button
              class="button secondary"
              aria-label={messages.teams.delete(roster.team.name)}
              onclick={() => confirmDelete(roster)}
              ><Icon name="trash" />{messages.teams.confirmDelete}</button
            >
          </div>
        </article>
      </li>{/each}
  </ul>{/if}
{#if pageIndex > 0 || hasMore}<div class="profile-pagination">
    <button
      class="button secondary"
      disabled={loading || pageIndex === 0}
      onclick={() => {
        pageIndex--;
      }}><Icon name="arrow-left" />{messages.players.previous}</button
    ><span>{messages.players.page(pageIndex + 1)}</span><button
      class="button secondary"
      disabled={loading || !hasMore}
      onclick={() => {
        pageIndex++;
      }}><Icon name="arrow-right" />{messages.players.next}</button
    >
  </div>{/if}
{#if editorOpen && teams && players}<TeamEditor
    {returnFocus}
    roster={editing}
    {teams}
    {players}
    ondismiss={() => {
      editorOpen = false;
    }}
    onsaved={() => {
      editorOpen = false;
      search = '';
      pageIndex = 0;
      notice = messages.teams.saved;
    }}
  />{/if}
{#if drawing && teams && players}<TeamDistribution
    {teams}
    {players}
    ondismiss={() => {
      drawing = false;
    }}
    onsaved={() => {
      drawing = false;
      search = '';
      pageIndex = 0;
      notice = messages.teams.batchSaved;
    }}
  />{/if}
<dialog
  bind:this={deleteDialog}
  aria-labelledby="team-delete-title"
  onclose={() => {
    deleting = null;
  }}
  oncancel={(event) => {
    if (saving) event.preventDefault();
  }}
>
  <h2 id="team-delete-title">{deleting ? messages.teams.deleteTitle(deleting.team.name) : ''}</h2>
  <p>{messages.teams.deleteDetail}</p>
  <p class="error" role="alert">{deleteError}</p>
  <div class="form-actions">
    <button
      class="button delete-confirm"
      disabled={saving}
      onclick={() => {
        if (deleting) void removeTeam(deleting);
      }}
      ><Icon name="trash" />{saving ? messages.teams.saving : messages.teams.confirmDelete}</button
    ><button class="button secondary" disabled={saving} onclick={() => deleteDialog.close()}
      ><Icon name="close" />{messages.players.cancel}</button
    >
  </div>
</dialog>
