<script lang="ts">
  import GranBoardControls from './GranBoardControls.svelte';
  import { granBoard } from '../application/granboard/session.svelte';
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
  import { dartsStats } from '#lib/domain/games/darts-stats';
  import { createX01Game, dartScore } from '#lib/domain/games/darts';
  import { activeTeamPlayer } from '#lib/domain/team-turn';
  import { scoreSlots } from '#lib/domain/score-slots';
  import { petanqueErrorMessage } from '#lib/application/petanque-errors';
  import { EngineError, type EngineState } from '#lib/domain/engine/types';
  import { getLocale, messages } from '#lib/i18n/index';
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
  function inspectLeg(state: EngineState, legConfig = config) {
    return game.inspect(series ? series.inspect(state, seriesConfig).legState : state, legConfig);
  }
  const position = $derived(inspectLeg(view.state));
  function impactOutcome(result: JournalView, next: ReturnType<typeof inspectLeg>) {
    if (result.projection.status === 'finished') return 'win';
    return 'bust' in next && next.bust ? 'bust' : 'hit';
  }
  const progress = $derived(series?.getProgress(view.state, seriesConfig));
  const current = $derived(config.ownerIds[position.turn]!);
  const activePlayer = $derived(activeTeamPlayer(match, view.audit, current));
  const checkoutPageSize = 6;
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
  const stats = $derived(status === 'finished' ? dartsStats(match, view.audit) : []);
  const statsWithPoints = $derived(!isCricket || match.rulesSnapshot.definition.points === true);
  const statsNumber = $derived(new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 1 }));
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
  let handoff = $state<{ ownerId: string; playerName?: string }>();
  const displayedPlayer = $derived(handoff ? handoff.playerName : activePlayer?.displayName);
  let boardVersion = 0;
  let boardMatchId = '';
  let boardOwner = '';
  let boardPlayerName: string | undefined;
  let endingVisit = false;
  let remaining = 0;
  let pending: BoardHit[] = [];
  let draining = $state(false);

  function disarm() {
    armed = false;
    pending = [];
    remaining = 0;
    endingVisit = false;
  }
  function boardConnection(value: boolean) {
    disarm();
    connected = value;
    if (value) entryMode = 'dart';
    if (granBoard.matchId !== match.id) handoff = undefined;
  }
  function selectBoardVisit(
    ownerId: string,
    version: number,
    dartsUsed: number,
    audit = view.audit,
  ) {
    boardMatchId = match.id;
    boardOwner = ownerId;
    boardPlayerName = activeTeamPlayer(match, audit, ownerId)?.displayName;
    boardVersion = version;
    remaining = 3 - dartsUsed;
    armed = true;
    granBoard.signalReady();
  }
  function armBoard() {
    if (!canArm || document.hidden) return;
    granBoard.enableAudio();
    handoff = undefined;
    selectBoardVisit(current, view.projection.lastEventSequence, position.dartsUsed);
  }
  const canArm = $derived(
    connected &&
      !saving &&
      !draining &&
      !progress?.nextStarterId &&
      status === 'in_progress' &&
      view.projection.lastEventSequence < MAX_JOURNAL_EVENTS,
  );
  function boardNext() {
    if (
      !connected ||
      document.hidden ||
      prompt ||
      status !== 'in_progress' ||
      progress?.nextStarterId ||
      (saving && !draining)
    )
      return;
    if (!armed) {
      armBoard();
      return;
    }
    endingVisit = true;
    void drainBoard();
  }
  function boardHit(hit: BoardHit) {
    if (
      !armed ||
      endingVisit ||
      status !== 'in_progress' ||
      document.hidden ||
      boardMatchId !== match.id ||
      remaining <= 0
    )
      return;
    remaining--;
    pending.push(hit);
    void drainBoard();
  }
  async function drainBoard() {
    if (draining) return;
    draining = true;
    try {
      // Serialize scoring and the button behind hits already received for the same player.
      while (armed && (pending.length > 0 || endingVisit)) {
        const hit = pending.shift();
        const playerName = boardPlayerName;
        const feedback = hit ? granBoard.captureFeedback() : undefined;
        const result = await act(
          { type: 'record', ownerId: boardOwner, values: hit ?? { sector: 0, multiplier: 1 } },
          boardVersion,
          true,
        );
        if (!result || (!armed && result.projection.status !== 'finished')) {
          disarm();
          break;
        }
        const legConfig = series?.getLegConfig(result.state, seriesConfig) ?? seriesConfig;
        const next = inspectLeg(result.state, legConfig);
        if (hit) feedback?.(hit, impactOutcome(result, next));
        const version = result.projection.lastEventSequence;
        if (
          result.projection.status !== 'in_progress' ||
          series?.getProgress(result.state, seriesConfig).nextStarterId ||
          version >= MAX_JOURNAL_EVENTS
        ) {
          disarm();
          break;
        }
        if (next.dartsUsed === 0) {
          const readyNext = endingVisit;
          disarm();
          if (readyNext) selectBoardVisit(legConfig.ownerIds[next.turn]!, version, 0, result.audit);
          else handoff = { ownerId: boardOwner, playerName };
          break;
        }
        boardVersion = version;
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
    if (!fromBoard) {
      disarm();
      handoff = undefined;
    }
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
  async function record(event: SubmitEvent) {
    event.preventDefault();
    if (handoff) return;
    const ownerId = current;
    const playerName = activePlayer?.displayName;
    const hit = { sector, multiplier };
    const feedback = connected ? granBoard.captureFeedback() : undefined;
    const result = await act({
      type: 'record',
      ownerId: current,
      values:
        !isCricket && !connected && entryMode === 'visit'
          ? { total: visitTotal, checkout: needsDouble && doubleFinish ? 1 : 0 }
          : hit,
    });
    if (result && feedback) {
      const legConfig = series?.getLegConfig(result.state, seriesConfig) ?? seriesConfig;
      const next = inspectLeg(result.state, legConfig);
      feedback(hit, impactOutcome(result, next));
      if (
        connected &&
        result.projection.status === 'in_progress' &&
        !series?.getProgress(result.state, seriesConfig).nextStarterId &&
        next.dartsUsed === 0
      )
        handoff = { ownerId, playerName };
    }
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
    {#if status === 'in_progress'}
      {#key match.id}
        <GranBoardControls
          matchId={match.id}
          onhit={boardHit}
          onnext={boardNext}
          onconnection={boardConnection}
          onarm={armBoard}
          {armed}
          {canArm}
          awaitingNext={Boolean(handoff)}
        />
      {/key}
    {/if}
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
      <h3>
        {handoff
          ? messages.granboard.visitComplete(owner(handoff.ownerId))
          : messages.four21.turn(owner(current))}
      </h3>
      {#if displayedPlayer}<p role="status">
          <strong>{messages.generic.activeTeamPlayer(displayedPlayer)}</strong>
        </p>{/if}
      <p aria-live="polite">
        {handoff
          ? messages.granboard.waitForButton
          : 'visitStart' in position
            ? messages.darts.visit(position.dartsUsed + 1, position.visitStart)
            : messages.cricket.visit(position.dartsUsed + 1)}
      </p>
    </div>
    <div class="situation-phase">
      {#if progress && series}<section class="legs-summary" aria-labelledby="legs-title">
          <h3 id="legs-title">{messages.dartsMatch.title}</h3>
          <p>
            {series.options.setsToWin === undefined
              ? messages.dartsMatch.format(series.options.legsToWin, progress.number)
              : messages.dartsMatch.setFormat(
                  series.options.setsToWin,
                  progress.setNumber,
                  progress.number,
                )}
          </p>
          <p>
            {series.options.startingRule === 'alternate'
              ? messages.dartsMatch.alternate
              : messages.dartsMatch.loser}
          </p>
          <ul>
            {#each seriesConfig.ownerIds as id (id)}<li>
                {progress.sets
                  ? messages.dartsMatch.setScore(owner(id), progress.sets[id]!, progress.wins[id]!)
                  : messages.dartsMatch.score(owner(id), progress.wins[id]!)}
              </li>{/each}
          </ul>
          {#if progress.setWinnerId}<p role="status">
              {messages.dartsMatch.setWinner(owner(progress.setWinnerId))}
            </p>
          {:else if progress.legWinnerId}<p role="status">
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
                ><Icon name="arrow-right" />{progress.setWinnerId
                  ? messages.dartsMatch.nextSet(progress.setNumber + 1)
                  : messages.dartsMatch.nextLeg(progress.number + 1)}</button
              >{/if}{/if}
        </section>{/if}
    </div>
  </EntrySituation>
  {#if stats.length}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div class="grid-scroll" role="region" aria-label={messages.dartsStats.title} tabindex="0">
      <table>
        <caption>{messages.dartsStats.title}</caption>
        <thead>
          <tr>
            <th scope="col">{messages.dartsStats.side}</th>
            <th scope="col">{messages.dartsStats.visits}</th>
            {#if statsWithPoints}
              <th scope="col">{messages.dartsStats.points}</th>
              <th scope="col">{messages.dartsStats.best}</th>
              <th scope="col">{messages.dartsStats.average}</th>
            {/if}
            {#if isCricket}
              <th scope="col">{messages.dartsStats.marks}</th>
            {:else}
              <th scope="col">{messages.dartsStats.busts}</th>
            {/if}
          </tr>
        </thead>
        <tbody>
          {#each stats as row (row.id)}
            <tr>
              <th scope="row">{owner(row.id)}</th>
              <td>{statsNumber.format(row.visits)}</td>
              {#if statsWithPoints}
                <td>{statsNumber.format(row.points)}</td>
                <td>{statsNumber.format(row.best)}</td>
                <td>{row.visits ? statsNumber.format(row.points / row.visits) : '—'}</td>
              {/if}
              {#if isCricket}
                <td>{statsNumber.format(row.marks)}</td>
              {:else}
                <td>{statsNumber.format(row.busts)}</td>
              {/if}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
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
  {#if status === 'in_progress' && handoff}
    <button class="button secondary handoff-action" disabled={!canArm} onclick={armBoard}>
      <Icon name="arrow-right" />{messages.granboard.nextPlayer}
    </button>
  {:else if status === 'in_progress' && !progress?.nextStarterId}
    {#if !isCricket}<aside
        class="checkout-panel"
        aria-labelledby="checkouts-title"
        aria-live="polite"
      >
        <h4 id="checkouts-title">
          <Icon name="darts" />{messages.darts.checkouts(3 - position.dartsUsed)}
        </h4>
        {#if checkouts.length}
          <ul class="checkout-routes" role="list">
            {#each checkouts.slice(checkoutPage * checkoutPageSize, (checkoutPage + 1) * checkoutPageSize) as route (route
              .map((dart) => `${dart.sector}-${dart.multiplier}`)
              .join(','))}
              <li>
                {#each route as dart, index (index)}
                  {#if index > 0}<span class="checkout-arrow"><Icon name="arrow-right" /></span
                    >{/if}
                  <span class="checkout-dart" class:checkout-finish={index === route.length - 1}
                    >{checkoutLabel(dart)}</span
                  >
                {/each}
              </li>
            {/each}
          </ul>
          {#if checkouts.length > checkoutPageSize}
            <div class="checkout-pagination">
              <button
                type="button"
                class="button secondary"
                aria-label={messages.darts.previousCheckouts}
                disabled={checkoutPage === 0}
                onclick={() => checkoutPage--}><Icon name="arrow-left" /></button
              >
              <p>
                {messages.darts.checkoutCount(
                  checkoutPage + 1,
                  Math.ceil(checkouts.length / checkoutPageSize),
                  checkouts.length,
                )}
              </p>
              <button
                type="button"
                class="button secondary"
                aria-label={messages.darts.nextCheckouts}
                disabled={(checkoutPage + 1) * checkoutPageSize >= checkouts.length}
                onclick={() => checkoutPage++}><Icon name="arrow-right" /></button
              >
            </div>
          {/if}
        {:else}
          <p>{messages.darts.noCheckout}</p>
        {/if}
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
  .handoff-action {
    justify-self: start;
  }
  .checkout-panel {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-3);
    border-radius: 0.75rem;
    background: color-mix(in srgb, var(--accent) 7%, var(--surface));
  }
  .checkout-panel h4 {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
  }
  .checkout-panel p {
    margin: 0;
    color: var(--muted-text);
  }
  .checkout-routes {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 17rem), 1fr));
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .checkout-routes li {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: var(--space-2);
    padding: var(--space-2);
    border-radius: 0.65rem;
    background: var(--surface);
  }
  .checkout-dart {
    padding: 0.2rem 0.5rem;
    border-radius: 0.4rem;
    white-space: nowrap;
    font-weight: 700;
  }
  .checkout-finish {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, var(--surface));
  }
  .checkout-arrow {
    display: flex;
    color: var(--muted-text);
  }
  .checkout-pagination {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: var(--space-2);
    text-align: center;
  }
  .checkout-pagination > button {
    inline-size: 44px;
    padding-inline: 0;
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
