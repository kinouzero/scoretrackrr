<script lang="ts">
  import { isScoreSheet } from '#lib/domain/games/score-sheets';
  import Icon from '#lib/components/Icon.svelte';
  import { onMount } from 'svelte';
  import GameIcon from '#lib/components/GameIcon.svelte';
  import { gameCatalog } from '#lib/domain/games/catalog';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import type { GameRecord, GameVersionRecord } from '#lib/domain/records';
  import type { LocalDatabase } from '#lib/storage/database';
  import type { CatalogRepository } from '#lib/storage/catalog';
  import { translate } from '#lib/i18n/catalog';
  import { messages, getLocale } from '#lib/i18n/index';
  import { gameName, catalogSearch } from '#lib/i18n/presentation';
  type Entry = GameRecord & { versions: GameVersionRecord[] };
  let catalog = $state.raw<CatalogRepository>();
  let observe = $state<typeof import('dexie').liveQuery>();
  let games = $state<Entry[]>(
    gameCatalog.map((game) => ({ ...game, slug: game.id, versions: [] })),
  );
  let search = $state('');
  $effect(() => {
    const game = gameCatalog.find((item) => item.id === page.url.searchParams.get('game'));
    search = game?.name ?? '';
    pageIndex = 0;
  });
  let favorites = $state(false);
  let pageIndex = $state(0);
  let hasMore = $state(false);
  let loading = $state(true);
  let error = $state('');
  let saving = $state(false);
  let retry = $state(0);
  onMount(() => {
    let active = true;
    let db: LocalDatabase | undefined;
    void (async () => {
      try {
        const [storage, adapter, dexie] = await Promise.all([
          import('#lib/storage/database'),
          import('#lib/storage/catalog'),
          import('dexie'),
        ]);
        if (!active) return;
        db = new storage.LocalDatabase();
        const repository = new adapter.CatalogRepository(db);
        await repository.initialize(new Date().toISOString());
        if (!active) return;
        catalog = repository;
        observe = dexie.liveQuery;
      } catch {
        if (active) {
          error = messages.games.error;
          loading = false;
        }
      }
    })();
    return () => {
      active = false;
      db?.close();
    };
  });
  $effect(() => {
    const adapter = catalog;
    const watch = observe;
    const options = {
      search: catalogSearch(search),
      state: 'all' as const,
      favorites,
      page: pageIndex,
    };
    void retry;
    if (!adapter || !watch) return;
    loading = true;
    const subscription = watch(() => adapter.list(options)).subscribe({
      next(result) {
        games = result.items;
        hasMore = result.hasMore;
        loading = false;
      },
      error() {
        error = messages.games.error;
        loading = false;
      },
    });
    return () => subscription.unsubscribe();
  });
  async function favorite(game: Entry) {
    if (!catalog || saving) return;
    saving = true;
    error = '';
    try {
      await catalog.setFavorite(game.id, !game.favorite);
    } catch {
      error = messages.games.error;
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head><title>{messages.nav.games} · {messages.appName}</title></svelte:head>
<div class="page-heading">
  <p class="eyebrow">{messages.nav.games}</p>
  <h1>{messages.games.title}</h1>
  <p>{messages.games.intro}</p>
</div>
<div class="library-toolbar">
  <div class="library-search">
    <label for="game-search">{messages.games.search}</label><input
      id="game-search"
      type="search"
      bind:value={search}
      maxlength="120"
      placeholder={messages.games.searchHint}
      oninput={() => (pageIndex = 0)}
    />
  </div>
  <label class="check-label favorite-filter"
    ><input
      type="checkbox"
      role="switch"
      bind:checked={favorites}
      onchange={() => (pageIndex = 0)}
    />{messages.games.favorites}</label
  >
</div>
{#if error}<div class="notice error" role="alert">
    <p>{error}</p>
    <button
      class="button secondary"
      onclick={() => {
        error = '';
        retry++;
      }}><Icon name="replay" />{messages.players.retry}</button
    >
  </div>{/if}
{#if loading}<p aria-live="polite">{messages.games.loading}</p>{/if}
{#if !loading && !games.length}<p class="panel no-results">{messages.games.empty}</p>{/if}
<div class="game-grid">
  {#each games as game (game.id)}
    <article
      id={`game-${game.id}`}
      class="game-card panel"
      data-game={game.id}
      aria-label={gameName(game.id, game.name)}
    >
      <div class="game-card-cover">
        <span class="game-art"><GameIcon game={game.id} /></span><span class="game-cover-label"
          >{messages.games.kinds[game.id as keyof typeof messages.games.kinds] ??
            messages.games.custom}</span
        >
        <button
          class="favorite-button"
          aria-pressed={game.favorite ?? false}
          aria-label={messages.games.favorite(gameName(game.id, game.name))}
          disabled={!catalog || loading || saving}
          onclick={() => favorite(game)}
          ><Icon name="star" size={24} filled={game.favorite ?? false} /></button
        >
      </div>
      <div>
        <h2>{gameName(game.id, game.name)}</h2>
        <p>
          {gameCatalog.some((item) => item.id === game.id)
            ? messages.games.descriptions[game.id as keyof typeof messages.games.descriptions]
            : messages.games.custom}
        </p>
      </div>
      <div class="game-state">
        {#if game.state === 'available' && game.id === 'petanque'}<a
            class="button"
            href={resolve('/matches?new=petanque')}><Icon name="play" />{messages.games.play}</a
          >
        {:else if (isScoreSheet(game.id) || ['yams', '421', '5000-10000', 'darts', 'skull-king', 'flip-7', 'molkky', '6-qui-prend', 'times-up'].includes(game.id)) && game.versions[0]}<a
            class="button"
            href={resolve(
              `/matches?new=declarative&version=${encodeURIComponent(game.versions[0].id)}`,
            )}
            ><Icon name="play" />{isScoreSheet(game.id)
              ? translate(getLocale(), 'scoreSheet.play', { name: gameName(game.id, game.name) })
              : game.id === 'times-up'
                ? messages.timesUp.play
                : game.id === '6-qui-prend'
                  ? messages.sixNimmt.play
                  : game.id === 'molkky'
                    ? messages.molkky.play
                    : game.id === 'yams'
                      ? messages.games.playYams
                      : game.id === '421'
                        ? messages.four21.play
                        : game.id === 'darts'
                          ? messages.darts.play
                          : game.id === 'skull-king'
                            ? messages.skull.play
                            : game.id === 'flip-7'
                              ? messages.flip.play
                              : messages.farkle.play}</a
          >
        {:else if game.origin === 'custom' && game.currentVersionId}<a
            class="button"
            href={resolve(
              `/matches?new=declarative&version=${encodeURIComponent(game.currentVersionId)}`,
            )}><Icon name="play" />{messages.games.customPlay}</a
          >
        {:else}<span class="badge"
            >{loading ? messages.games.loading : messages.games.comingSoon}</span
          >{/if}
      </div>
    </article>
  {/each}
</div>
{#if pageIndex || hasMore}<div
    class="profile-pagination"
    role="group"
    aria-label={messages.players.pagination}
  >
    <button
      class="button secondary"
      disabled={loading || pageIndex === 0}
      onclick={() => pageIndex--}><Icon name="arrow-left" />{messages.players.previous}</button
    ><span>{messages.players.page(pageIndex + 1)}</span><button
      class="button secondary"
      disabled={loading || !hasMore}
      onclick={() => pageIndex++}><Icon name="arrow-right" />{messages.players.next}</button
    >
  </div>{/if}
