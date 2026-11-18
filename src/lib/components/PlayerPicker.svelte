<script lang="ts">
  import Icon from '#lib/components/Icon.svelte';
  import { liveQuery } from 'dexie';
  import type { PlayerRecord } from '#lib/domain/records';
  import type { LocalRepository } from '#lib/storage/repository';
  import { playerErrorMessage } from '#lib/application/player-errors';
  import { messages } from '#lib/i18n/index';
  import PlayerAvatar from './PlayerAvatar.svelte';

  let {
    repository,
    selected = $bindable<PlayerRecord[]>([]),
  }: { repository: LocalRepository; selected?: PlayerRecord[] } = $props();
  let search = $state('');
  let pageIndex = $state(0);
  let items = $state<PlayerRecord[]>([]);
  let hasMore = $state(false);
  let loading = $state(true);
  let error = $state('');
  $effect(() => {
    const options = { search, page: pageIndex };
    loading = true;
    error = '';
    const subscription = liveQuery(() => repository.listPlayers(options)).subscribe({
      next(result) {
        items = result.items;
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
  function toggle(player: PlayerRecord, checked: boolean) {
    selected = checked
      ? [...selected.filter((item) => item.id !== player.id), player]
      : selected.filter((item) => item.id !== player.id);
  }
</script>

<fieldset class="player-picker">
  <legend>{messages.teams.members}</legend>
  <label
    >{messages.players.search}<input
      type="search"
      bind:value={search}
      oninput={() => {
        pageIndex = 0;
      }}
    /></label
  >
  {#if loading}<p role="status">{messages.players.loading}</p>{:else if error}<p
      role="alert"
      class="error"
    >
      {error}
    </p>
  {:else if items.length === 0}<p>
      {search || pageIndex > 0 ? messages.players.noResults : messages.teams.noPlayers}
    </p>{:else}
    <div class="picker-options">
      {#each items as player (player.id)}
        <label class="picker-option"
          ><input
            type="checkbox"
            checked={selected.some((item) => item.id === player.id)}
            onchange={(event) => toggle(player, event.currentTarget.checked)}
            aria-label={messages.teams.selectPlayer(player.displayName)}
          /><PlayerAvatar profile={player} /><span
            >{player.displayName}{#if player.isGuest}<small>{messages.players.guestBadge}</small
              >{/if}</span
          ></label
        >
      {/each}
    </div>
  {/if}
  {#if pageIndex > 0 || hasMore}<div class="profile-pagination">
      <button
        class="button secondary"
        type="button"
        disabled={loading || pageIndex === 0}
        onclick={() => {
          pageIndex--;
        }}><Icon name="arrow-left" />{messages.players.previous}</button
      ><span>{messages.players.page(pageIndex + 1)}</span><button
        class="button secondary"
        type="button"
        disabled={loading || !hasMore}
        onclick={() => {
          pageIndex++;
        }}><Icon name="arrow-right" />{messages.players.next}</button
      >
    </div>{/if}
  <h3>{messages.teams.selected} ({selected.length})</h3>
  {#if selected.length === 0}<p>{messages.teams.noneSelected}</p>{:else}<ul
      class="selected-players"
    >
      {#each selected as player (player.id)}<li>
          <span
            >{player.displayName}{#if player.deletedAt || player.archivedAt}<small class="error"
                >{messages.teams.unavailableMember}</small
              >{/if}</span
          ><button
            class="text-button"
            type="button"
            aria-label={messages.teams.removePlayer(player.displayName)}
            onclick={() => toggle(player, false)}><Icon name="close" size={16} /></button
          >
        </li>{/each}
    </ul>{/if}
</fieldset>
