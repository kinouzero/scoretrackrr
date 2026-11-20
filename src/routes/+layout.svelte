<script lang="ts">
  import Icon from '#lib/components/Icon.svelte';
  import PwaInstallButton from '#lib/components/PwaInstallButton.svelte';
  import PwaUpdateNotice from '#lib/components/PwaUpdateNotice.svelte';
  import { pwaUpdates } from '#lib/application/pwa-updates';
  import '../app.css';
  import { page } from '$app/state';
  import { resolve } from '$app/paths';
  import { goto } from '$app/navigation';
  import { messages, getLocale, setLocale, refreshSystemLanguage } from '#lib/i18n/index';
  import { onMount, setContext } from 'svelte';
  import { matchNavigationContext, type MatchNavigation } from '#lib/application/match-navigation';
  import { findActiveMatch } from '#lib/storage/match-navigation';
  import type { LocalDatabase } from '#lib/storage/database';
  import type { MatchRecord } from '#lib/domain/records';
  import { granBoard } from '../lib/application/granboard/session.svelte';
  import { historyGameName } from '#lib/i18n/presentation';

  let navigationDatabase = $state.raw<LocalDatabase>();
  let observe = $state<typeof import('dexie').liveQuery>();
  let activeMatch = $state<MatchRecord>();
  let navigationReady = $state(false);
  let preferredMatchId = $state<string>();
  const preferenceKey = 'scoretrackrr.foreground-match';
  setContext<MatchNavigation>(matchNavigationContext, {
    async returnToList(matchId) {
      activeMatch = undefined;
      preferredMatchId = matchId;
      try {
        sessionStorage.setItem(preferenceKey, matchId);
      } catch {
        /* Session preference is optional. */
      }
      await goto(resolve('/matches'));
    },
    get activeMatch() {
      return activeMatch;
    },
    get ready() {
      return navigationReady;
    },
  });
  const activeMatchHref = $derived(
    activeMatch
      ? (`/matches?match=${encodeURIComponent(activeMatch.id)}` as const)
      : ('/matches' as const),
  );
  const activeMatchDescription = $derived(
    activeMatch ? messages.matches.activeGame(historyGameName(activeMatch)) : undefined,
  );

  $effect(() => {
    const database = navigationDatabase;
    const watch = observe;
    const selectedId =
      page.url.pathname.replace(/\/$/, '') === '/matches'
        ? page.url.searchParams.get('match')
        : undefined;
    const preferredId = preferredMatchId;
    if (!database || !watch) return;
    const subscription = watch(() => findActiveMatch(database, selectedId, preferredId)).subscribe({
      next(match) {
        activeMatch = match;
        navigationReady = true;
        if (match && preferredMatchId !== match.id) {
          preferredMatchId = match.id;
          try {
            sessionStorage.setItem(preferenceKey, match.id);
          } catch {
            /* Navigation also works without session storage. */
          }
        }
      },
      error() {
        activeMatch = undefined;
        navigationReady = true;
      },
    });
    return () => subscription.unsubscribe();
  });
  $effect(() => {
    if (
      navigationReady &&
      activeMatch &&
      page.url.pathname.replace(/\/$/, '') === '/matches' &&
      !page.url.searchParams.has('match') &&
      !page.url.searchParams.has('new')
    ) {
      void goto(resolve(activeMatchHref), { replaceState: true });
    }
  });

  $effect(() => {
    const matchId = granBoard.matchId;
    const database = navigationDatabase;
    const watch = observe;
    if (!matchId || !database || !watch) return;
    const subscription = watch(() => database.matches.get(matchId)).subscribe({
      next(match) {
        if (match?.status === 'finished') {
          granBoard.finish(matchId);
        } else if (!match || match.status === 'cancelled') {
          granBoard.stop(matchId);
        }
      },
    });
    return () => subscription.unsubscribe();
  });

  let { children } = $props();
  const links = $derived([
    { href: '/', label: messages.nav.home, icon: 'home' },
    { href: '/games', label: messages.nav.games, icon: 'games' },
    { href: '/players', label: messages.nav.players, icon: 'player' },
    { href: '/teams', label: messages.nav.teams, icon: 'teams' },
    { href: '/matches', label: messages.nav.matches, icon: 'matches' },
    { href: '/settings', label: messages.nav.settings, icon: 'settings' },
  ] as const);
  $effect(() => {
    document.documentElement.lang = getLocale();
  });
  onMount(() => {
    const stopUpdates = import.meta.env.DEV ? () => {} : pwaUpdates.start();
    refreshSystemLanguage();
    const refreshVisibleLanguage = () => {
      if (document.visibilityState === 'visible') refreshSystemLanguage();
    };
    window.addEventListener('languagechange', refreshSystemLanguage);
    document.addEventListener('visibilitychange', refreshVisibleLanguage);
    try {
      preferredMatchId = sessionStorage.getItem(preferenceKey) || undefined;
    } catch {
      /* Use persisted game status when preferences are unavailable. */
    }
    let active = true;
    let cleanup = () => {};
    void (async () => {
      const [{ LocalDatabase }, { liveQuery }] = await Promise.all([
        import('#lib/storage/database'),
        import('dexie'),
      ]);
      if (!active) return;
      const database = new LocalDatabase();
      navigationDatabase = database;
      observe = liveQuery;
      const subscription = liveQuery(() => database.readTheme()).subscribe({
        next(theme) {
          if (theme === 'system') delete document.documentElement.dataset.theme;
          else document.documentElement.dataset.theme = theme;
        },
        error() {
          /* Preserve system appearance when storage cannot be read. */
        },
      });
      const languageSubscription = liveQuery(() => database.readLanguage()).subscribe({
        next: setLocale,
        error() {
          /* Keep following the device if storage is unavailable. */
        },
      });
      cleanup = () => {
        languageSubscription.unsubscribe();
        subscription.unsubscribe();
        database.close();
      };
    })().catch(() => {
      /* Theme loading must not prevent access to the app. */
      navigationReady = true;
    });
    return () => {
      active = false;
      stopUpdates();
      granBoard.stop();
      window.removeEventListener('languagechange', refreshSystemLanguage);
      document.removeEventListener('visibilitychange', refreshVisibleLanguage);
      cleanup();
    };
  });
</script>

<svelte:head>
  <title>{messages.appName}</title>
  <meta name="description" content={messages.tagline} />
</svelte:head>

<a class="skip-link" href="#main">{messages.skip}</a>
<header class="site-header">
  <a href={resolve('/')} class="brand"
    ><img
      class="brand-mark"
      src="/icons/icon-192.png"
      width="38"
      height="38"
      alt=""
    />{messages.appName}</a
  >
  <PwaInstallButton />
</header>
<div class="app-frame">
  <nav aria-label={messages.navigation}>
    {#each links as link (link.href)}
      <a
        href={resolve(link.href === '/matches' ? activeMatchHref : link.href)}
        aria-describedby={link.href === '/matches' && activeMatch
          ? 'active-match-description'
          : undefined}
        title={link.href === '/matches' ? activeMatchDescription : undefined}
        aria-current={page.url.pathname.replace(/\/$/, '') === link.href.replace(/\/$/, '')
          ? 'page'
          : undefined}
      >
        <span class="nav-symbol" aria-hidden="true"
          ><Icon name={link.icon} size={24} />
          {#if link.href === '/matches' && activeMatch}<span class="nav-running-indicator"
              ><Icon name="play" size={8} /></span
            >{/if}
        </span><span>{link.label}</span>
      </a>
    {/each}
  </nav>
  {#if activeMatch}<span class="sr-only" id="active-match-description"
      >{activeMatchDescription}</span
    >{/if}
  <main id="main">
    <PwaUpdateNotice />
    {@render children()}
  </main>
</div>
