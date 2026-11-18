<script lang="ts">
  import { skullCounterLimits, type SkullResultDraft } from '#lib/application/skull-counters';
  import EntrySituation from './EntrySituation.svelte';
  import { entryDraft } from '../application/entry-draft.svelte';
  import GameRules from './GameRules.svelte';
  import Icon from './Icon.svelte';
  import GameHeader, { type HeaderRenderer } from './GameHeader.svelte';
  import type { MatchRecord } from '#lib/domain/records';
  import type { JournalAction, JournalView } from '#lib/domain/journal';
  import type { LocalDatabase } from '#lib/storage/database';
  import type { MatchJournal } from '#lib/storage/journal';
  import { createSkullKingGame, skullCards } from '#lib/domain/games/skull-king';
  import { submitSkullBids } from '#lib/storage/skull-bids';
  import { scoreSlots } from '#lib/domain/score-slots';
  import { petanqueErrorMessage } from '#lib/application/petanque-errors';
  import { EngineError } from '#lib/domain/engine/types';
  import { messages } from '#lib/i18n/index';
  import SkullPlayerCard from './SkullPlayerCard.svelte';
  let {
    match,
    view,
    database,
    journal,
    selfOnly = false,
    allowedOwnerIds,
    header,
  }: {
    match: MatchRecord;
    view: JournalView;
    database: LocalDatabase;
    journal: Pick<MatchJournal, 'submit'>;
    selfOnly?: boolean;
    allowedOwnerIds?: readonly string[];
    header?: HeaderRenderer;
  } = $props();
  const game = $derived(createSkullKingGame(match.rulesSnapshot.definition));
  const config = $derived(game.validateConfig(match.settingsSnapshot.engineConfig));
  const position = $derived(game.inspect(view.state, config));
  const complete = $derived(config.ownerIds.every((id) => position.entries[id]!.won !== null));
  const bidding = $derived(config.ownerIds.some((id) => position.entries[id]!.bid === null));
  const current = $derived(
    config.ownerIds.find((id) =>
      bidding ? position.entries[id]!.bid === null : position.entries[id]!.won === null,
    ) ?? config.ownerIds[0]!,
  );
  const cards = $derived(skullCards(position.round, config.ownerIds.length, game.options));
  const discarded = $derived(
    cards - Object.values(position.entries).reduce((sum, row) => sum + (row.won ?? 0), 0),
  );
  const last = $derived(
    scoreSlots(view.audit)
      .filter((slot) => slot.command)
      .at(-1),
  );
  const status = $derived(view.projection.status);
  let resultDrafts = $state<Record<string, SkullResultDraft>>({});
  function reportResultDraft(id: string, value: SkullResultDraft) {
    resultDrafts[id] = value;
  }
  let bids = $state<Record<string, number | ''>>({});
  let bidRound = $state('');
  let focusResults = $state(false);
  let openBonuses = $state<string | null>(null);
  const pendingBids = $derived(
    config.ownerIds.filter(
      (id) => position.entries[id]!.bid === null && (!selfOnly || allowedOwnerIds?.includes(id)),
    ),
  );
  let saving = $state(false);
  let notice = $state('');
  let error = $state('');
  let prompt = $state<JournalAction | null>(null);
  let promptVersion = $state(0);
  let dialog: HTMLDialogElement;
  $effect(() => {
    const key = `${match.id}:${position.round}`;
    if (bidRound !== key) {
      bidRound = key;
      resultDrafts = {};
      focusResults = false;
      openBonuses = null;
      bids = Object.fromEntries(config.ownerIds.map((id) => [id, '']));
    } else {
      const next = { ...bids };
      let changed = false;
      for (const id of config.ownerIds) {
        if (position.entries[id]!.bid !== null && Object.hasOwn(next, id)) {
          delete next[id];
          changed = true;
        } else if (position.entries[id]!.bid === null && !Object.hasOwn(next, id)) {
          next[id] = '';
          changed = true;
        }
      }
      if (changed) bids = next;
    }
  });
  async function recordBids(event: SubmitEvent) {
    event.preventDefault();
    if (saving || status !== 'in_progress' || !bidding || !pendingBids.length) return;
    const rows: { ownerId: string; bid: number }[] = [];
    for (const ownerId of pendingBids) {
      const value = bids[ownerId];
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        error = messages.skull.invalid;
        return;
      }
      rows.push({ ownerId, bid: value });
    }
    const round = position.round,
      expectedVersion = view.projection.lastEventSequence,
      actorPlayerId = view.authority.playerId;
    saving = true;
    error = '';
    notice = '';
    try {
      const deviceId = await database.readOrCreateDeviceId(crypto.randomUUID());
      await submitSkullBids(database, journal, {
        matchId: match.id,
        round,
        expectedVersion,
        actorPlayerId,
        deviceId,
        timestamp: new Date().toISOString(),
        bids: rows,
      });
      notice = '';
      if (!selfOnly) focusResults = true;
    } catch (failure) {
      error =
        failure instanceof EngineError ? messages.skull.invalid : petanqueErrorMessage(failure);
      return false;
    } finally {
      saving = false;
    }
  }
  function owner(id: string) {
    return (
      match.teamsSnapshot.find((t) => t.id === id)?.name ??
      match.playersSnapshot.find((p) => p.id === id)?.displayName ??
      id
    );
  }
  async function act(action: JournalAction, version = view.projection.lastEventSequence) {
    if (saving) return;
    saving = true;
    error = '';
    notice = '';
    try {
      const deviceId = await database.readOrCreateDeviceId(crypto.randomUUID());
      await journal.submit({
        matchId: match.id,
        eventId: crypto.randomUUID(),
        commandId: crypto.randomUUID(),
        expectedVersion: version,
        actorPlayerId: view.authority.playerId,
        deviceId,
        timestamp: new Date().toISOString(),
        action,
      });
      notice = '';
      if (dialog?.open) dialog.close();
      return true;
    } catch (failure) {
      error =
        failure instanceof EngineError ? messages.skull.invalid : petanqueErrorMessage(failure);
      return false;
    } finally {
      saving = false;
    }
  }
  function confirm(action: JournalAction) {
    prompt = action;
    promptVersion = view.projection.lastEventSequence;
    dialog.showModal();
  }
  async function record(ownerId: string, values: Record<string, number>) {
    if (
      await act({ type: 'record', ownerId, values: { round: position.round, kind: 1, ...values } })
    ) {
      if (openBonuses === ownerId) openBonuses = null;
    }
  }
  const draft = entryDraft(
    () => `${match.id}:skull`,
    () => `${view.projection.lastEventSequence}:${view.projection.status}`,
    () => ({ bids, openBonuses }),
    (data) => {
      bids = data.bids;
      openBonuses = data.openBonuses;
    },
  );
</script>

{#if status === 'in_progress' && draft.recovered}<p class="draft-notice" role="status">
    {messages.play.draftRecovered}
  </p>{/if}

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
    {#if last && status !== 'cancelled'}<button
        class="button secondary"
        disabled={saving}
        onclick={() => confirm({ type: 'undo', targetEventId: last!.revisionId })}
        ><Icon name="undo" />{messages.four21.undo}</button
      >{/if}
    {#if status === 'in_progress'}<button
        class="button secondary"
        disabled={saving}
        onclick={() => act({ type: 'pause' })}><Icon name="pause" />{messages.matches.pause}</button
      >{/if}
    {#if status !== 'cancelled' && status !== 'finished'}<button
        class="button secondary"
        disabled={saving}
        onclick={() => confirm({ type: 'cancel' })}
        ><Icon name="cancel" />{messages.matches.cancel}</button
      >{/if}
  {/if}
{/snippet}

{#snippet rules()}
  <GameRules {match} />
{/snippet}

<GameHeader renderer={header} {actions} {rules} />

<section class="game-play-area stack" aria-labelledby="skull-title">
  <h2 id="skull-title">{header ? messages.matches.scoreEntry : messages.skull.title}</h2>

  <EntrySituation {status}>
    <h3>{messages.skull.round(position.round, cards)}</h3>

    <div class="round-phase">
      {bidding
        ? messages.skull.bidPhase
        : complete
          ? messages.skull.complete
          : messages.skull.resultPhase}
    </div>
  </EntrySituation>
  {#if game.options.advancedCards || game.options.expansion}<p class="field-hint">
      {messages.skull.discardedHint(discarded)}
    </p>{/if}
  <div class="player-cards stack" role="group" aria-label={messages.skull.grid}>
    {#each config.ownerIds as id (`${match.id}:${position.round}:${id}`)}
      <SkullPlayerCard
        options={game.options}
        limits={skullCounterLimits(position.entries, resultDrafts, id, cards, game.captureCaps)}
        onupdate={reportResultDraft}
        draftId={match.id}
        draftScope={`${match.id}:${view.projection.lastEventSequence}`}
        {id}
        name={owner(id)}
        profile={match.playersSnapshot.find((player) => player.id === id)}
        entry={position.entries[id]!}
        {cards}
        {bidding}
        bind:bid={bids[id]}
        disabled={saving ||
          status !== 'in_progress' ||
          view.projection.lastEventSequence >= 1000 ||
          (selfOnly && !allowedOwnerIds?.includes(id))}
        open={openBonuses === id}
        ontoggle={() => {
          openBonuses = openBonuses === id ? null : id;
        }}
        onrecord={(values) => {
          void record(id, values);
        }}
        focusRequested={focusResults && current === id}
        onfocused={() => {
          focusResults = false;
        }}
      />
    {/each}
  </div>
  {#if bidding}
    <form id="skull-bids" aria-label={messages.skull.grid} onsubmit={recordBids}>
      {#if status === 'in_progress' && pendingBids.length}
        <button class="button" disabled={saving || view.projection.lastEventSequence >= 1000}
          ><Icon name="check" />{messages.skull.recordBids}</button
        >
      {/if}
    </form>
  {/if}
  {#if status === 'in_progress' && complete}
    <p>{position.round >= 10 ? messages.skull.overtime : messages.skull.complete}</p>
    {#if !selfOnly}
      <button
        class="button"
        disabled={saving || view.projection.lastEventSequence >= 1000}
        onclick={() =>
          act({
            type: 'record',
            ownerId: config.ownerIds[0]!,
            values: { round: position.round, nextRound: 1 },
          })}><Icon name="arrow-right" />{messages.skull.next}</button
      >
    {/if}
  {/if}
  {#if notice}<p role="status">{notice}</p>{/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</section>
<dialog
  bind:this={dialog}
  onclose={() => {
    prompt = null;
  }}
  aria-labelledby="skull-confirm"
>
  <h2 id="skull-confirm">{messages.four21.confirm}</h2>
  <p>{messages.four21.confirmHint}</p>
  <div class="button-row">
    <button class="button secondary" disabled={saving} onclick={() => dialog.close()}
      ><Icon name="close" />{messages.players.cancel}</button
    ><button class="button" disabled={saving} onclick={() => prompt && act(prompt, promptVersion)}
      ><Icon name="check" />{messages.petanque.confirm}</button
    >
  </div>
</dialog>

<style>
  dialog {
    padding: var(--panel-padding);
  }
  .stack {
    display: grid;
    gap: var(--space-4);
  }
  .round-phase {
    padding: var(--space-4);
    border-radius: 12px;
    background: var(--selected);
    font-weight: 700;
  }
</style>
