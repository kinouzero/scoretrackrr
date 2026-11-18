<script lang="ts">
  import Icon from '#lib/components/Icon.svelte';
  import { onMount } from 'svelte';
  import { SvelteDate } from 'svelte/reactivity';
  import { goto } from '$app/navigation';
  import { resumePausedMatch } from '#lib/application/resume-match';
  import { petanqueErrorMessage } from '#lib/application/petanque-errors';
  import type { LocalDatabase } from '#lib/storage/database';
  import { resolve } from '$app/paths';
  import GameIcon from '#lib/components/GameIcon.svelte';
  import { gameCatalog } from '#lib/domain/games/catalog';
  import { historyGameName, gameName } from '#lib/i18n/presentation';
  import type { MatchRecord } from '#lib/domain/records';
  import { messages, getLocale } from '#lib/i18n/index';

  let database = $state.raw<LocalDatabase>();
  let resuming = $state('');
  let resumeError = $state('');
  async function resume(match: MatchRecord) {
    if (!database || resuming) return;
    resuming = match.id;
    resumeError = '';
    try {
      const { MatchJournal } = await import('#lib/storage/journal');
      const deviceId = await database.readOrCreateDeviceId(crypto.randomUUID());
      await resumePausedMatch(new MatchJournal(database), match, deviceId);
      await goto(resolve(`/matches?match=${encodeURIComponent(match.id)}`));
    } catch (failure) {
      resumeError = petanqueErrorMessage(failure);
    } finally {
      resuming = '';
    }
  }

  let recent = $state<MatchRecord[]>([]);
  let loading = $state(true);
  let error = $state(false);
  const date = $derived(new Intl.DateTimeFormat(getLocale(), { day: 'numeric', month: 'short' }));
  onMount(() => {
    let active = true;
    let cleanup = () => {};
    void (async () => {
      const [{ LocalDatabase }, { liveQuery }] = await Promise.all([
        import('#lib/storage/database'),
        import('dexie'),
      ]);
      if (!active) return;
      const db = new LocalDatabase();
      database = db;
      cleanup = () => db.close();
      await db.open();
      if (!active) {
        db.close();
        return;
      }
      const subscription = liveQuery(() =>
        db.matches.orderBy('updatedAt').reverse().limit(3).toArray(),
      ).subscribe({
        next(matches) {
          recent = matches;
          loading = false;
        },
        error() {
          error = true;
          loading = false;
        },
      });
      cleanup = () => {
        subscription.unsubscribe();
        db.close();
      };
    })().catch(() => {
      cleanup();
      if (active) {
        error = true;
        loading = false;
      }
    });
    return () => {
      active = false;
      cleanup();
    };
  });
</script>

<svelte:head><title>{messages.nav.home} · {messages.appName}</title></svelte:head>
<section class="home-welcome">
  <div>
    <p class="eyebrow">{messages.home.eyebrow}</p>
    <h1>{messages.home.title}</h1>
    <p class="hero-intro">{messages.home.intro}</p>
    <a class="button" href={resolve('/games')}>{messages.home.action}<Icon name="arrow-right" /></a>
  </div>
  <div class="welcome-stamp" aria-hidden="true">
    <span>{gameCatalog.length}</span>
    <p>{messages.home.stamp}</p>
  </div>
</section>

<section class="home-library" aria-labelledby="home-games-title">
  <div class="section-heading">
    <div>
      <p class="eyebrow">{messages.home.libraryEyebrow}</p>
      <h2 id="home-games-title">{messages.home.libraryTitle}</h2>
    </div>
    <span class="library-caption">{messages.home.libraryHint}</span>
  </div>
  <div class="quick-game-grid">
    {#each gameCatalog as game (game.id)}
      <a
        class="quick-game"
        data-game={game.id}
        href={resolve(
          `/games?game=${encodeURIComponent(game.id)}#game-${encodeURIComponent(game.id)}`,
        )}
      >
        <span class="game-art"><GameIcon game={game.id} /></span>
        <strong>{gameName(game.id, game.name)}</strong><span class="game-kind"
          >{messages.games.kinds[game.id]}</span
        >
        <span class="tile-arrow"><Icon name="arrow-right" size={18} /></span>
      </a>
    {/each}
  </div>
</section>

<section class="home-recent" aria-labelledby="recent-title">
  <div class="section-heading">
    <div>
      <p class="eyebrow">{messages.home.recentEyebrow}</p>
      <h2 id="recent-title">{messages.home.recentTitle}</h2>
    </div>
    <a class="text-button" href={resolve('/matches')}
      >{messages.home.allMatches}<Icon name="arrow-right" /></a
    >
  </div>
  {#if resumeError}<p class="notice error" role="alert">{resumeError}</p>{/if}
  {#if error}<p class="notice" role="status">{messages.matches.error}</p>
  {:else if loading}<p aria-live="polite">{messages.matches.loading}</p>
  {:else if recent.length}
    <div class="recent-list">
      {#each recent as match (match.id)}
        {#if match.status === 'paused'}
          <button
            type="button"
            class="recent-match"
            disabled={!!resuming}
            onclick={() => resume(match)}>{@render recentMatchContent(match)}</button
          >
        {:else}
          <a class="recent-match" href={resolve(`/matches?match=${encodeURIComponent(match.id)}`)}
            >{@render recentMatchContent(match)}</a
          >
        {/if}
      {/each}
    </div>
  {:else}
    <div class="home-empty">
      <Icon name="player" size={28} />
      <div>
        <h3>{messages.home.emptyTitle}</h3>
        <p>{messages.home.emptyBody}</p>
      </div>
      <a class="button secondary" href={resolve('/players')}
        ><Icon name="player" />{messages.home.preparePlayers}</a
      >
    </div>
  {/if}
</section>

{#snippet recentMatchContent(match: MatchRecord)}
  <span class="recent-game-icon" data-game={String(match.rulesSnapshot.definition.id)}
    ><GameIcon game={String(match.rulesSnapshot.definition.id)} /></span
  >
  <span class="recent-match-info"
    ><strong>{historyGameName(match)}</strong><span
      >{match.playersSnapshot.map((player) => player.displayName).join(' · ')}</span
    ></span
  >
  <span class="recent-match-meta"
    ><span class="badge match-status" data-status={match.status}
      >{messages.matches.statuses[match.status]}</span
    ><time datetime={match.updatedAt}>{date.format(new SvelteDate(match.updatedAt))}</time></span
  >
  <span class="recent-action"
    >{['draft', 'in_progress', 'paused'].includes(match.status)
      ? messages.home.resume
      : messages.home.review}<Icon
      name={['draft', 'in_progress', 'paused'].includes(match.status) ? 'play' : 'eye'}
      size={18}
    /></span
  >
{/snippet}
