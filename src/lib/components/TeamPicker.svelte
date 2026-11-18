<script lang="ts">
  import Icon from '#lib/components/Icon.svelte';
  import { liveQuery } from 'dexie';
  import type { TeamRepository, TeamRoster } from '#lib/storage/teams';
  import { messages } from '#lib/i18n/index';
  let {
    repository,
    selected = $bindable<TeamRoster[]>([]),
  }: { repository: TeamRepository; selected?: TeamRoster[] } = $props();
  let search = $state('');
  let pageIndex = $state(0);
  let items = $state<TeamRoster[]>([]);
  let hasMore = $state(false);
  let error = $state('');
  $effect(() => {
    const options = { search, page: pageIndex };
    const subscription = liveQuery(() => repository.listTeams(options)).subscribe({
      next(result) {
        items = result.items;
        hasMore = result.hasMore;
      },
      error() {
        error = messages.teams.error;
      },
    });
    return () => subscription.unsubscribe();
  });
</script>

<fieldset class="player-picker">
  <legend>{messages.generic.teams}</legend>
  <label
    >{messages.petanque.search}<input
      type="search"
      bind:value={search}
      oninput={() => (pageIndex = 0)}
    /></label
  >
  <p role="alert" class="error">{error}</p>
  <div class="picker-options">
    {#each items as roster (roster.team.id)}<button
        type="button"
        class="text-button"
        disabled={selected.length >= 16 ||
          selected.some((item) => item.team.id === roster.team.id) ||
          roster.members.some(
            (member) =>
              member.deletedAt ||
              member.archivedAt ||
              selected.some((item) => item.members.some((player) => player.id === member.id)),
          )}
        onclick={() => (selected = [...selected, roster])}
        aria-label={messages.petanque.choose(roster.team.name)}
        ><Icon name="teams" />{roster.team.name} — {roster.members
          .map((member) => member.displayName)
          .join(' · ')}</button
      >{/each}
  </div>
  {#if pageIndex || hasMore}<div class="profile-pagination">
      <button
        type="button"
        class="button secondary"
        disabled={pageIndex === 0}
        onclick={() => pageIndex--}><Icon name="arrow-left" />{messages.players.previous}</button
      ><span>{messages.players.page(pageIndex + 1)}</span><button
        type="button"
        class="button secondary"
        disabled={!hasMore}
        onclick={() => pageIndex++}><Icon name="arrow-right" />{messages.players.next}</button
      >
    </div>{/if}
  <ul class="selected-players">
    {#each selected as roster (roster.team.id)}<li>
        <span>{roster.team.name}</span><button
          type="button"
          class="text-button"
          aria-label={messages.petanque.remove(roster.team.name)}
          onclick={() => (selected = selected.filter((item) => item.team.id !== roster.team.id))}
          ><Icon name="close" size={16} /></button
        >
      </li>{/each}
  </ul>
</fieldset>
