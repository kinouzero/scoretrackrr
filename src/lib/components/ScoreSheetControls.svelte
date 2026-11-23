<script lang="ts">
  import {
    createScoreSheetGame,
    isScoreSheet,
    scoreSheetSpec,
    skyjoPoints,
    tarotPoints,
    qwixxPoints,
    cleverPoints,
    wondersScience,
  } from '#lib/domain/games/score-sheets';
  import type { MatchRecord } from '#lib/domain/records';
  import type { JournalAction, JournalView } from '#lib/domain/journal';
  import type { LocalDatabase } from '#lib/storage/database';
  import type { MatchJournal } from '#lib/storage/journal';
  import { entryDraft } from '../application/entry-draft.svelte';
  import { scoreSlots } from '#lib/domain/score-slots';
  import { petanqueErrorMessage } from '#lib/application/petanque-errors';
  import { getLocale, messages } from '#lib/i18n/index';
  import { translate } from '#lib/i18n/catalog';
  import Icon from './Icon.svelte';
  import EntrySituation from './EntrySituation.svelte';
  import GameHeader, { type HeaderRenderer } from './GameHeader.svelte';

  let {
    match,
    view,
    database,
    journal,
    selfOnly = false,
    header,
  }: {
    match: MatchRecord;
    view: JournalView;
    database: LocalDatabase;
    journal: Pick<MatchJournal, 'submit'>;
    selfOnly?: boolean;
    header?: HeaderRenderer;
  } = $props();
  const id = $derived.by(() => {
    const value = match.rulesSnapshot.gameId;
    if (!isScoreSheet(value)) throw new Error('Unknown score sheet');
    return value;
  });
  const spec = $derived(scoreSheetSpec(id));
  const game = $derived(createScoreSheetGame(id, match.rulesSnapshot.definition));
  const config = $derived(game.validateConfig(match.settingsSnapshot.engineConfig));
  const round = $derived(view.state.eventCount + 1);
  const status = $derived(view.projection.status);
  const owners = $derived(
    config.ownerIds.map(
      (id) =>
        match.teamsSnapshot.find((team) => team.id === id)?.name ??
        match.playersSnapshot.find((player) => player.id === id)?.displayName ??
        id,
    ),
  );
  const t = (key: string, values = {}) => translate(getLocale(), `scoreSheet.${key}`, values);
  const profiles = {
    'seven-wonders': [
      'wonders',
      'coins',
      'military',
      'civilian',
      'tablet',
      'compass',
      'gear',
      'commerce',
      'guilds',
    ],
    qwixx: ['red', 'yellow', 'green', 'blue', 'penalties'],
    clever: ['yellow', 'blue', 'green', 'orange', 'purple', 'foxes'],
  };
  const categories = $derived(
    id === 'seven-wonders' || id === 'qwixx' || id === 'clever' ? profiles[id] : [],
  );
  let entries = $state<Record<string, number | undefined>>({});
  let selected = $state(-1);
  let partner = $state(-1);
  let bouts = $state(0);
  let multiplier = $state(1);
  let bonuses = $state<number | undefined>(0);
  let cardPoints = $state<number | undefined>();
  let flip = $state(false);
  let end = $state(false);
  let saving = $state(false);
  let error = $state('');
  let confirmation = $state<JournalAction>();
  let confirmationVersion = $state(0);
  let dialog = $state<HTMLDialogElement>();
  const last = $derived(
    scoreSlots(view.audit)
      .filter((slot) => slot.command?.type === 'record')
      .at(-1),
  );
  const handWinner = $derived(id === 'uno' || id === 'rummy' || id === 'dominoes');
  const perTurn = $derived(id === 'scrabble' && !end);
  const data = $derived.by((): (number | undefined)[] => {
    if (id === 'tarot') {
      if (selected < 0 || partner === selected || cardPoints === undefined || bonuses === undefined)
        return [];
      return tarotPoints(owners.length, selected, partner, cardPoints, bouts, multiplier, bonuses);
    }
    if (categories.length)
      return owners.map((_, i) => {
        const row = categories.map((key) => entries[`${i}-${key}`]);
        if (row.some((n) => n === undefined)) return undefined;
        const points = row as number[];
        if (id === 'qwixx') return qwixxPoints(points.slice(0, 4), points[4]!);
        if (id === 'clever') return cleverPoints(points.slice(0, 5), points[5]!);
        {
          const [wonder, coins, military, civilian, tablet, compass, gear, commerce, guilds] =
            points as [number, number, number, number, number, number, number, number, number];
          return (
            wonder +
            Math.floor(coins / 3) +
            military +
            civilian +
            wondersScience([tablet, compass, gear]) +
            commerce +
            guilds
          );
        }
      });
    if (perTurn)
      return selected < 0 ? [] : owners.map((_, i) => (i === selected ? entries.turn : 0));
    const raw = owners.map((_, i) => entries[`${i}`]);
    if (id === 'uno') {
      if (selected < 0 || entries.numbers === undefined) return [];
      const points =
        entries.numbers +
        (entries.actions ?? 0) * 20 +
        (entries.wilds ?? 0) * 50 +
        (flip ? (entries.drawColor ?? 0) * 60 : 0);
      return owners.map((_, i) => (i === selected ? points : 0));
    }
    if (handWinner) {
      if (selected < 0 || raw.some((n, i) => i !== selected && n === undefined)) return [];
      return raw.map((_, i) =>
        i === selected
          ? raw.reduce<number>((a, b, j) => a + (j === selected ? 0 : (b ?? 0)), 0)
          : 0,
      );
    }
    if (id === 'skyjo') {
      if (selected < 0 || raw.some((n) => n === undefined)) return [];
      const lowest = Math.min(...(raw.filter((_, i) => i !== selected) as number[]));
      return raw.map((n, i) => skyjoPoints(n!, lowest, i === selected));
    }
    if (id === 'scrabble' && end && raw.every((n, i) => i === selected || n !== undefined)) {
      const bonus = raw.reduce<number>((a, b, i) => a + (i === selected ? 0 : (b ?? 0)), 0);
      return raw.map((n, i) => (i === selected ? bonus : -n!));
    }
    return raw;
  });
  const ready = $derived(
    data.length === owners.length && data.every((n) => n !== undefined) && !saving,
  );
  const canEnd = $derived(!spec.target && !spec.final);
  $effect(() => {
    // A fresh entry follows a committed turn or a change of match.
    if (match.id && round) {
      entries = {};
      selected = -1;
      partner = -1;
      bouts = 0;
      multiplier = 1;
      bonuses = 0;
      cardPoints = undefined;
      end = false;
    }
  });
  const draft = entryDraft(
    () => `${match.id}:score-sheet`,
    () => `${view.projection.lastEventSequence}:${status}`,
    () => ({ entries, selected, partner, bouts, multiplier, bonuses, cardPoints, flip, end }),
    (value) => {
      entries = value.entries;
      selected = value.selected;
      partner = value.partner;
      bouts = value.bouts;
      multiplier = value.multiplier;
      bonuses = value.bonuses;
      cardPoints = value.cardPoints;
      flip = value.flip;
      end = value.end;
    },
  );
  function changeEnd(value: boolean) {
    end = value;
    if (id === 'scrabble') selected = -1;
  }
  async function act(action: JournalAction, expectedVersion = view.projection.lastEventSequence) {
    if (saving) return false;
    saving = true;
    error = '';
    try {
      const deviceId = await database.readOrCreateDeviceId(crypto.randomUUID());
      await journal.submit({
        matchId: match.id,
        eventId: crypto.randomUUID(),
        commandId: crypto.randomUUID(),
        expectedVersion,
        actorPlayerId: view.authority.playerId,
        deviceId,
        timestamp: new Date().toISOString(),
        action,
      });
      return true;
    } catch (failure) {
      error = petanqueErrorMessage(failure);
      return false;
    } finally {
      saving = false;
    }
  }
  function record(event: SubmitEvent) {
    event.preventDefault();
    if (!ready || status !== 'in_progress' || selfOnly) return;
    void act({
      type: 'record',
      ownerId: config.ownerIds[0]!,
      values: {
        round,
        end: end ? 1 : 0,
        ...Object.fromEntries(data.map((points, i) => [`p${i}`, points!])),
      },
    });
  }
  function confirm(action: JournalAction) {
    confirmation = action;
    confirmationVersion = view.projection.lastEventSequence;
    error = '';
    dialog?.showModal();
  }
</script>

{#snippet actions()}
  {#if !selfOnly}
    {#if status === 'draft'}<button
        class="button"
        disabled={saving}
        onclick={() => act({ type: 'start' })}><Icon name="play" />{messages.matches.start}</button
      >{/if}
    {#if status === 'paused'}<button
        class="button"
        disabled={saving}
        onclick={() => act({ type: 'resume' })}
        ><Icon name="play" />{messages.matches.resume}</button
      >{/if}
    {#if status === 'in_progress'}<button
        class="button secondary"
        disabled={saving}
        onclick={() => act({ type: 'pause' })}><Icon name="pause" />{messages.matches.pause}</button
      >{/if}
    {#if last && status !== 'cancelled'}<button
        class="button secondary"
        disabled={saving}
        onclick={() => confirm({ type: 'undo', targetEventId: last!.revisionId })}
        ><Icon name="undo" />{messages.sixNimmt.undo}</button
      >{/if}
    {#if status !== 'cancelled' && status !== 'finished'}<button
        class="button secondary"
        disabled={saving}
        onclick={() => confirm({ type: 'cancel' })}
        ><Icon name="cancel" />{messages.matches.cancel}</button
      >{/if}
  {/if}
{/snippet}

<GameHeader renderer={header} {actions} />

<section class="game-play-area stack" aria-labelledby="score-sheet-title">
  <h2 id="score-sheet-title">{messages.matches.scoreEntry}</h2>
  {#if status === 'in_progress' && !selfOnly}
    {#if draft.recovered}<p class="draft-notice" role="status">
        {messages.play.draftRecovered}
      </p>{/if}
    <EntrySituation {status}>
      <h3>{spec.final ? t('final') : t(id === 'scrabble' ? 'turn' : 'round', { round })}</h3>
      <p>{t(`${id}.hint`)}</p>
    </EntrySituation>
    <form class="stack" onsubmit={record}>
      <fieldset class="stack" disabled={saving}>
        <legend>{t('entry')}</legend>
        {#if canEnd}
          <label class="check-label"
            ><input
              type="checkbox"
              checked={end}
              onchange={(event) => changeEnd(event.currentTarget.checked)}
            />{t('last')}</label
          >
        {/if}
        {#if id === 'skyjo' || id === 'tarot' || handWinner || id === 'scrabble'}
          <label for="sheet-player"
            >{t(
              id === 'skyjo' ? 'closer' : id === 'tarot' ? 'taker' : perTurn ? 'player' : 'winner',
            )}</label
          >
          <select id="sheet-player" bind:value={selected} required={id !== 'scrabble' || !end}>
            <option value={-1}>{id === 'scrabble' && end ? t('blocked') : t('choose')}</option>
            {#each owners as name, i (config.ownerIds[i])}<option value={i}>{name}</option>{/each}
          </select>
        {/if}
        {#if id === 'tarot'}
          {#if owners.length === 5}
            <label for="sheet-partner">{t('partner')}</label>
            <select id="sheet-partner" bind:value={partner}>
              <option value={-1}>{t('none')}</option>
              {#each owners as name, i (config.ownerIds[i])}
                {#if i !== selected}<option value={i}>{name}</option>{/if}
              {/each}
            </select>
          {/if}
          <label for="sheet-bouts">{t('bouts')}</label>
          <select id="sheet-bouts" bind:value={bouts}>
            {#each [0, 1, 2, 3] as count (count)}<option value={count}>{count}</option>{/each}
          </select>
          <label for="sheet-contract">{t('contract')}</label>
          <select id="sheet-contract" bind:value={multiplier}>
            {#each [1, 2, 4, 6] as value (value)}<option {value}>{t(`contract${value}`)}</option
              >{/each}
          </select>
          <label for="sheet-card-points">{t('cardPoints')}</label>
          <input
            id="sheet-card-points"
            type="number"
            min="0"
            max="91"
            step="0.5"
            bind:value={cardPoints}
            required
          />
          <label for="sheet-bonuses">{t('bonuses')}</label>
          <input
            id="sheet-bonuses"
            type="number"
            min="-1000"
            max="1000"
            bind:value={bonuses}
            required
          />
        {:else if id === 'uno'}
          <label class="check-label"><input type="checkbox" bind:checked={flip} />UNO Flip</label>
          {#each ['numbers', 'actions', 'wilds', ...(flip ? ['drawColor'] : [])] as key (key)}
            <label for={`sheet-${key}`}>{t(key)}</label>
            <input
              id={`sheet-${key}`}
              type="number"
              min="0"
              max={key === 'numbers' ? 900 : 108}
              bind:value={entries[key]}
              required={key === 'numbers'}
            />
          {/each}
        {:else if perTurn}
          <label for="sheet-turn-points">{t('points')}</label>
          <input
            id="sheet-turn-points"
            type="number"
            min="0"
            max="9999"
            bind:value={entries.turn}
            required
          />
        {:else}
          {#each owners as name, i (config.ownerIds[i])}
            {#if (!handWinner && !(id === 'scrabble' && end)) || i !== selected}
              <fieldset class="stack">
                <legend>{name}</legend>
                {#if categories.length}
                  {#each categories as key (key)}
                    <label for={`sheet-${i}-${key}`}>{t(key)}</label>
                    <input
                      id={`sheet-${i}-${key}`}
                      type="number"
                      min={key === 'military' ? -6 : 0}
                      max={id === 'qwixx'
                        ? key === 'penalties'
                          ? 4
                          : 12
                        : key === 'foxes'
                          ? 5
                          : 9999}
                      bind:value={entries[`${i}-${key}`]}
                      required
                    />
                  {/each}
                {:else}
                  <label for={`sheet-${i}`}
                    >{t(handWinner || id === 'scrabble' ? 'remaining' : 'points')}</label
                  >
                  <input
                    id={`sheet-${i}`}
                    type="number"
                    min={id === 'skyjo' ? -24 : 0}
                    max={id === 'skyjo' ? 144 : 9999}
                    bind:value={entries[`${i}`]}
                    required
                  />
                {/if}
              </fieldset>
            {/if}
          {/each}
        {/if}
      </fieldset>
      {#if ready}
        <aside class="score-preview" aria-label={messages.play.preview}>
          <span class="preview-caption">{messages.play.preview}</span>
          {#each owners as name, i (config.ownerIds[i])}
            <p>
              <span>{name}</span><strong
                >{view.state.totals[config.ownerIds[i]!]! + data[i]!}</strong
              ><small>{data[i]! > 0 ? '+' : ''}{data[i]}</small>
            </p>
          {/each}
        </aside>
      {/if}
      <button class="button" disabled={!ready}
        ><Icon name="check" />{t(spec.final || end ? 'saveFinal' : 'save')}</button
      >
    </form>
  {/if}
  {#if error && !dialog?.open}<p class="error" role="alert">{error}</p>{/if}
</section>

<dialog bind:this={dialog} aria-labelledby="sheet-confirm">
  <h2 id="sheet-confirm">{messages.generic.confirm}</h2>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <div class="form-actions">
    <button class="button secondary" disabled={saving} onclick={() => dialog?.close()}
      ><Icon name="close" />{messages.players.cancel}</button
    >
    <button
      class="button"
      disabled={saving}
      onclick={async () => {
        if (confirmation && (await act(confirmation, confirmationVersion))) dialog?.close();
      }}><Icon name="check" />{messages.petanque.confirm}</button
    >
  </div>
</dialog>

<style>
  fieldset {
    min-width: 0;
  }
  .score-preview p {
    display: flex;
    gap: var(--space-3);
    justify-content: space-between;
  }
</style>
