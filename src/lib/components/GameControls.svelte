<script lang="ts">
  import { isScoreSheet } from '#lib/domain/games/score-sheets';
  import Icon from '#lib/components/Icon.svelte';
  import type { HeaderRenderer } from './GameHeader.svelte';
  import type { MatchRecord } from '#lib/domain/records';
  import type { JournalView } from '#lib/domain/journal';
  import type { LocalDatabase } from '#lib/storage/database';
  import type { MatchJournal } from '#lib/storage/journal';
  import { messages } from '#lib/i18n/index';
  let {
    match,
    view,
    database,
    journal,
    selfOnly = false,
    allowedOwnerIds,
    onrematch,
    header,
  }: {
    match: MatchRecord;
    view: JournalView;
    database: LocalDatabase;
    journal: Pick<MatchJournal, 'submit'>;
    selfOnly?: boolean;
    allowedOwnerIds?: readonly string[];
    onrematch?: (id: string) => void;
    header?: HeaderRenderer;
  } = $props();
  const gameId = $derived(match.rulesSnapshot.gameId);
  const loaders = {
    petanque: () => import('./PetanqueControls.svelte'),
    yams: () => import('./YamsControls.svelte'),
    '421': () => import('./Four21Controls.svelte'),
    '5000-10000': () => import('./FarkleControls.svelte'),
    darts: () => import('./DartsControls.svelte'),
    'skull-king': () => import('./SkullControls.svelte'),
    'times-up': () => import('./TimesUpControls.svelte'),
    '6-qui-prend': () => import('./SixNimmtControls.svelte'),
    molkky: () => import('./MolkkyControls.svelte'),
    'flip-7': () => import('./FlipControls.svelte'),
  };
  function load(id: string) {
    if (isScoreSheet(id)) return import('./ScoreSheetControls.svelte');
    return id.startsWith('custom-')
      ? import('./DeclarativeControls.svelte')
      : Object.hasOwn(loaders, id)
        ? loaders[id as keyof typeof loaders]()
        : undefined;
  }
  const component = $derived(load(gameId));
  const controls = $derived({
    match,
    view,
    database,
    journal,
    selfOnly,
    allowedOwnerIds,
    header,
    ...(gameId === 'petanque' ? { onrematch } : {}),
  });
</script>

{#if component}
  {#await component}<p role="status">{messages.matches.loading}</p>
  {:then module}<module.default {...controls} />
  {:catch}
    {#if header}{@render header(empty)}{/if}
    <p class="error" role="alert">{messages.matches.controlsError}</p>
    <button class="button secondary" onclick={() => window.location.reload()}
      ><Icon name="replay" />{messages.players.retry}</button
    >
  {/await}
{:else if header}{@render header(empty)}{/if}
{#snippet empty()}{/snippet}
