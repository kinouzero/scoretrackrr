<script lang="ts">
  import GranBoardControls from './GranBoardControls.svelte';
  import type { BoardHit } from '#lib/application/granboard/protocol';
  import EntrySituation from './EntrySituation.svelte';
  import ScorePreview from './ScorePreview.svelte';
  import { entryDraft } from '../application/entry-draft.svelte';
  import GameRules from './GameRules.svelte';
  import Icon from './Icon.svelte';
  import GameHeader, { type HeaderRenderer } from './GameHeader.svelte';
  import type { MatchRecord } from '#lib/domain/records';
  import { MAX_JOURNAL_EVENTS, type JournalAction, type JournalView } from '#lib/domain/journal';
  import type { LocalDatabase } from '#lib/storage/database';
  import type { MatchJournal } from '#lib/storage/journal';
  import { createDartsMatchGame } from '#lib/domain/games/darts-match';
  import { createCricketGame, cricketTargets } from '#lib/domain/games/cricket';
  import { x01Checkouts, type CheckoutDart } from '#lib/domain/games/checkouts';
  import { createX01Game, dartScore } from '#lib/domain/games/darts';
  import { activeTeamPlayer } from '#lib/domain/team-turn';
  import { scoreSlots } from '#lib/domain/score-slots';
  import { petanqueErrorMessage } from '#lib/application/petanque-errors';
  import { EngineError } from '#lib/domain/engine/types';
  import { messages } from '#lib/i18n/index';
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
  const isCricket = $derived(match.rulesSnapshot.definition.engine === 'cricket');
  const game = $derived(
    isCricket
      ? createCricketGame(match.rulesSnapshot.definition)
      : createX01Game(match.rulesSnapshot.definition),
  );
  const series = $derived(
    match.settingsSnapshot.dartsMatch === undefined
      ? undefined
      : createDartsMatchGame(match.rulesSnapshot.definition, match.settingsSnapshot.dartsMatch),
  );
  const seriesConfig = $derived(game.validateConfig(match.settingsSnapshot.engineConfig));
  const config = $derived(series?.getLegConfig(view.state, seriesConfig) ?? seriesConfig);
  const position = $derived(
    game.inspect(series ? series.inspect(view.state, seriesConfig).legState : view.state, config),
  );
  const progress = $derived(series?.getProgress(view.state, seriesConfig));
  const current = $derived(config.ownerIds[position.turn]!);
  const activePlayer = $derived(activeTeamPlayer(match, view.audit, current));
  let checkoutPage = $state(0);
  const checkouts = $derived(
    !isCricket
      ? x01Checkouts(
          position.totals[current]!,
          3 - position.dartsUsed,
          match.rulesSnapshot.definition.doubleOut === true,
        )
      : [],
  );
  $effect(() => {
    void position.eventCount;
    checkoutPage = 0;
  });
  function checkoutLabel(dart: CheckoutDart) {
    return dart.sector === 25
      ? dart.multiplier === 2
        ? messages.darts.innerBull
        : messages.darts.outerBull
      : `${messages.darts.shortMultipliers[dart.multiplier - 1]}${dart.sector}`;
  }
  const last = $derived(
    scoreSlots(view.audit)
      .filter((slot) => slot.command)
      .at(-1),
  );
  const status = $derived(view.projection.status);
  let entryMode = $state<'dart' | 'visit'>('dart');
  let visitTotal = $state(0);
  let doubleFinish = $state(false);
  $effect(() => {
    void position.eventCount;
    visitTotal = 0;
    doubleFinish = false;
  });
  const needsDouble = $derived(
    !isCricket &&
      match.rulesSnapshot.definition.doubleOut === true &&
      visitTotal === position.totals[current],
  );
  let sector = $state(20);
  let multiplier = $state(1);
  let saving = $state(false);
  let connected = $state(false);
  let armed = $state(false);
  let boardVersion = 0;
  let boardMatchId = '';
  let remaining = 0;
  let pending: BoardHit[] = [];
  let draining = $state(false);

  function disarm() {
    armed = false;
    pending = [];
    remaining = 0;
  }
  function boardConnection(value: boolean) {
    disarm();
    connected = value;
    if (value) entryMode = 'dart';
  }
  function armBoard() {
    if (!canArm || document.hidden) return;
    boardMatchId = match.id;
    boardVersion = view.projection.lastEventSequence;
    remaining = 3 - position.dartsUsed;
    armed = true;
  }
  const canArm = $derived(
    connected &&
      !saving &&
      !draining &&
      !progress?.nextStarterId &&
      status === 'in_progress' &&
      view.projection.lastEventSequence < MAX_JOURNAL_EVENTS,
  );
  async function boardHit(hit: BoardHit) {
    if (
      !armed ||
      status !== 'in_progress' ||
      document.hidden ||
      boardMatchId !== match.id ||
      remaining <= 0
    )
      return;
    remaining--;
    pending.push(hit);
    if (draining) return;
    draining = true;
    try {
      // The journal version prevents a stale UI or another tab from advancing this visit.
      const ownerId = current;
      while (armed && pending.length > 0) {
        const result = await act(
          { type: 'record', ownerId, values: pending.shift()! },
          boardVersion,
          true,
        );
        if (
          !armed ||
          !result ||
          result.projection.status !== 'in_progress' ||
          series?.getProgress(result.state, seriesConfig).nextStarterId
        ) {
          disarm();
          break;
        }
        const leg = series ? series.inspect(result.state, seriesConfig).legState : result.state;
        const legConfig = series?.getLegConfig(result.state, seriesConfig) ?? seriesConfig;
        const next = game.inspect(leg, legConfig);
        if (
          next.dartsUsed === 0 ||
          legConfig.ownerIds[next.turn] !== ownerId ||
          result.projection.lastEventSequence >= MAX_JOURNAL_EVENTS
        ) {
          disarm();
          break;
        }
        boardVersion = result.projection.lastEventSequence;
      }
    } finally {
      draining = false;
    }
  }
  let notice = $state('');
  let error = $state('');
  let prompt = $state<JournalAction | null>(null);
  let promptVersion = $state(0);
  let dialog: HTMLDialogElement;
  function owner(id: string) {
    return (
      match.teamsSnapshot.find((t) => t.id === id)?.name ??
      match.playersSnapshot.find((p) => p.id === id)?.displayName ??
      id
    );
  }
  async function act(
    action: JournalAction,
    version = view.projection.lastEventSequence,
    fromBoard = false,
  ) {
    if (!fromBoard) disarm();
    if (saving) return;
    saving = true;
    error = '';
    notice = '';
    const matchId = match.id;
    const actorPlayerId = view.authority.playerId;
    try {
      const deviceId = await database.readOrCreateDeviceId(crypto.randomUUID());
      if (fromBoard && (!armed || match.id !== matchId)) return;
      const result = await journal.submit({
        matchId,
        eventId: crypto.randomUUID(),
        commandId: crypto.randomUUID(),
        expectedVersion: version,
        actorPlayerId,
        deviceId,
        timestamp: new Date().toISOString(),
        action,
      });
      notice = '';
      if (dialog?.open) dialog.close();
      return result;
    } catch (failure) {
      error =
        failure instanceof EngineError ? messages.darts.invalid : petanqueErrorMessage(failure);
    } finally {
      saving = false;
    }
  }
  function confirm(action: JournalAction) {
    disarm();
    prompt = action;
    promptVersion = view.projection.lastEventSequence;
    dialog.showModal();
  }
  function record(event: SubmitEvent) {
    event.preventDefault();
    void act({
      type: 'record',
      ownerId: current,
      values:
        !isCricket && !connected && entryMode === 'visit'
          ? { total: visitTotal, checkout: needsDouble && doubleFinish ? 1 : 0 }
          : { sector, multiplier },
    });
  }
  const draft = entryDraft(
    () => `${match.id}:darts`,
    () => `${view.projection.lastEventSequence}:${view.projection.status}`,
    () => ({ entryMode, visitTotal, doubleFinish, sector, multiplier }),
    (data) => {
      entryMode = data.entryMode;
      visitTotal = data.visitTotal;
      doubleFinish = data.doubleFinish;
      sector = data.sector;
      multiplier = data.multiplier;
    },
  );
</script>

<svelte:document
  onvisibilitychange={() => {
    if (document.hidden) disarm();
  }}
/>

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

<section class="game-play-area stack" aria-labelledby="darts-title">
  <h2 id="darts-title">
    {header
      ? messages.matches.scoreEntry
      : isCricket
        ? messages.cricket.title
        : messages.darts.title}
  </h2>

  <EntrySituation {status}>
    <div class="situation-player situation-active">
      <h3>{messages.four21.turn(owner(current))}</h3>
      {#if activePlayer}<p role="status">
          <strong>{messages.generic.activeTeamPlayer(activePlayer.displayName)}</strong>
        </p>{/if}
      <p aria-live="polite">
        {'visitStart' in position
          ? messages.darts.visit(position.dartsUsed + 1, position.visitStart)
          : messages.cricket.visit(position.dartsUsed + 1)}
      </p>
    </div>
    <div class="situation-phase">
      {#if progress && series}<section class="legs-summary" aria-labelledby="legs-title">
          <h3 id="legs-title">{messages.dartsMatch.title}</h3>
          <p>{messages.dartsMatch.format(series.options.legsToWin, progress.number)}</p>
          <p>
            {series.options.startingRule === 'alternate'
              ? messages.dartsMatch.alternate
              : messages.dartsMatch.loser}
          </p>
          <ul>
            {#each seriesConfig.ownerIds as id (id)}<li>
                {messages.dartsMatch.score(owner(id), progress.wins[id]!)}
              </li>{/each}
          </ul>
          {#if progress.legWinnerId}<p role="status">
              {messages.dartsMatch.legWinner(owner(progress.legWinnerId))}
            </p>{/if}
          {#if progress.nextStarterId}<p>
              {messages.dartsMatch.nextStarter(owner(progress.nextStarterId))}
            </p>
            {#if status === 'in_progress' && !selfOnly}<button
                class="button"
                disabled={saving || view.projection.lastEventSequence >= MAX_JOURNAL_EVENTS}
                onclick={() =>
                  act({
                    type: 'record',
                    ownerId: progress!.nextStarterId!,
                    values: { nextLeg: 1 },
                  })}
                ><Icon name="arrow-right" />{messages.dartsMatch.nextLeg(
                  progress.number + 1,
                )}</button
              >{/if}{/if}
        </section>{/if}
    </div>
  </EntrySituation>
  {#if 'marks' in position}<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div class="grid-scroll" role="region" aria-label={messages.cricket.grid} tabindex="0">
      <table>
        <caption>{messages.cricket.grid}</caption><thead
          ><tr
            ><th scope="col">{messages.cricket.target}</th>{#each config.ownerIds as id (id)}<th
                scope="col">{owner(id)}</th
              >{/each}</tr
          ></thead
        ><tbody>
          {#each cricketTargets as target, index (target)}<tr
              ><th scope="row">{target === 25 ? messages.darts.bull : target}</th
              >{#each config.ownerIds as id (id)}<td
                  aria-label={messages.cricket.cell(owner(id), target, position.marks[id]![index]!)}
                  >{messages.cricket.marks[position.marks[id]![index]!]}</td
                >{/each}</tr
            >{/each}
        </tbody>
      </table>
    </div>{/if}
  {#if 'bust' in position && position.bust}<p role="status">{messages.darts.bust}</p>{/if}
  {#if status === 'in_progress' && !selfOnly}
    {#key match.id}
      <GranBoardControls
        matchId={match.id}
        onhit={boardHit}
        onconnection={boardConnection}
        onarm={armBoard}
        {armed}
        {canArm}
      />
    {/key}
  {/if}
  {#if status === 'in_progress' && !progress?.nextStarterId}
    {#if !isCricket}<aside
        class="checkout-panel"
        aria-labelledby="checkouts-title"
        aria-live="polite"
      >
        <h4 id="checkouts-title">{messages.darts.checkouts(3 - position.dartsUsed)}</h4>
        {#if checkouts.length}<p>{messages.darts.checkoutHint}</p>
          <ul>
            {#each checkouts.slice(checkoutPage * 8, (checkoutPage + 1) * 8) as route (route
              .map((d) => `${d.sector}-${d.multiplier}`)
              .join(','))}<li>{route.map(checkoutLabel).join(' → ')}</li>{/each}
          </ul>
          {#if checkouts.length > 8}<p>
              {messages.darts.checkoutCount(
                checkoutPage + 1,
                Math.ceil(checkouts.length / 8),
                checkouts.length,
              )}
            </p>
            <div class="button-row">
              <button
                type="button"
                class="button secondary"
                disabled={checkoutPage === 0}
                onclick={() => checkoutPage--}
                ><Icon name="arrow-left" />{messages.darts.previousCheckouts}</button
              ><button
                type="button"
                class="button secondary"
                disabled={(checkoutPage + 1) * 8 >= checkouts.length}
                onclick={() => checkoutPage++}
                ><Icon name="arrow-right" />{messages.darts.nextCheckouts}</button
              >
            </div>{/if}
        {:else}<p>{messages.darts.noCheckout}</p>{/if}
      </aside>{/if}
    {#if !isCricket && !connected}<div class="game-field">
        <label for="dart-entry-mode">{messages.darts.entryMode}</label><select
          id="dart-entry-mode"
          bind:value={entryMode}
          ><option value="dart">{messages.darts.perDart}</option><option value="visit"
            >{messages.darts.perVisit}</option
          ></select
        >
      </div>{/if}
    {#if !selfOnly || allowedOwnerIds?.includes(current)}
      <form class="stack" onsubmit={record}>
        {#if !isCricket && !connected && entryMode === 'visit'}
          <div class="game-field">
            <label for="visit-total">{messages.darts.visitTotal(3 - position.dartsUsed)}</label
            ><input
              id="visit-total"
              type="number"
              inputmode="numeric"
              min="0"
              max={(3 - position.dartsUsed) * 60}
              step="1"
              bind:value={visitTotal}
              required
            />
          </div>
          <p>{messages.darts.visitHelp}</p>
          {#if needsDouble}<label class="double-finish"
              ><input type="checkbox" bind:checked={doubleFinish} />{messages.darts
                .doubleFinish}</label
            >
            <p>{messages.darts.doubleFinishHint}</p>{/if}
        {:else}
          <div class="game-field">
            <label for="dart-sector">{messages.darts.sector}</label><select
              id="dart-sector"
              bind:value={sector}
              onchange={() => {
                if (sector === 0) multiplier = 1;
                else if (sector === 25 && multiplier === 3) multiplier = 2;
              }}
              >{#each [0, ...Array.from({ length: 20 }, (_, i) => i + 1), 25] as value (value)}<option
                  {value}
                  >{value === 0
                    ? messages.darts.miss
                    : value === 25
                      ? messages.darts.bull
                      : value}</option
                >{/each}</select
            >
          </div>
          <div class="game-field">
            <label for="dart-multiplier">{messages.darts.multiplier}</label><select
              id="dart-multiplier"
              bind:value={multiplier}
              >{#each [1, 2, 3].filter( (n) => (sector === 0 ? n === 1 : sector === 25 ? n <= 2 : true) ) as value (value)}<option
                  {value}>{messages.darts.multipliers[value - 1]}</option
                >{/each}</select
            >
          </div>
          <p>{messages.darts.preview(dartScore(sector, multiplier))}</p>
        {/if}
        <ScorePreview
          {match}
          state={view.state}
          command={() => ({
            type: 'record',
            ownerId: current,
            values: (!isCricket && !connected && entryMode === 'visit'
              ? { total: visitTotal, checkout: needsDouble && doubleFinish ? 1 : 0 }
              : { sector, multiplier }) as Record<string, number>,
          })}
        />
        <button
          class="button"
          disabled={saving || view.projection.lastEventSequence >= MAX_JOURNAL_EVENTS}
          ><Icon name="check" />{!isCricket && !connected && entryMode === 'visit'
            ? messages.darts.recordVisit
            : messages.darts.record}</button
        >
      </form>{/if}
  {/if}
  {#if notice}<p role="status">{notice}</p>{/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</section>
<dialog
  bind:this={dialog}
  onclose={() => {
    prompt = null;
  }}
  aria-labelledby="dart-confirm"
>
  <h2 id="dart-confirm">{messages.four21.confirm}</h2>
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
  .double-finish {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: 44px;
  }
  .checkout-panel {
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    padding: 1rem;
  }
  .checkout-panel li {
    padding-block: 0.25rem;
  }
  .grid-scroll {
    overflow-x: auto;
  }
  table {
    border-collapse: collapse;
    width: 100%;
  }
  th,
  td {
    padding: 0.75rem;
    text-align: center;
    border-bottom: 1px solid var(--border);
  }
  select {
    min-height: 44px;
  }
</style>
