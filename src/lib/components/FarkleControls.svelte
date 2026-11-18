<script lang="ts">
  import EntrySituation from './EntrySituation.svelte';
  import { entryDraft } from '../application/entry-draft.svelte';
  import GameRules from './GameRules.svelte';
  import Icon from '#lib/components/Icon.svelte';
  import GameHeader, { type HeaderRenderer } from './GameHeader.svelte';
  import type { MatchRecord } from '#lib/domain/records';
  import type { JournalAction, JournalView } from '#lib/domain/journal';
  import type { LocalDatabase } from '#lib/storage/database';
  import type { MatchJournal } from '#lib/storage/journal';
  import { createFarkleGame, farkleScore, farkleCanScore } from '#lib/domain/games/farkle';
  import { scoreSlots } from '#lib/domain/score-slots';
  import { petanqueErrorMessage } from '#lib/application/petanque-errors';
  import { EngineError } from '#lib/domain/engine/types';
  import { messages } from '#lib/i18n/index';
  import PlayerAvatar from './PlayerAvatar.svelte';
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
  const game = $derived(createFarkleGame(match.rulesSnapshot.definition));
  const config = $derived(game.validateConfig(match.settingsSnapshot.engineConfig));
  const position = $derived(game.inspect(view.state, config));
  const current = $derived(config.ownerIds[position.turn]!);
  let saving = $state(false);
  let dice = $state([1, 1, 1, 1, 1, 1]);
  const rolled = $derived(dice.slice(0, position.remaining));
  const subset = $derived(rolled.filter((_, i) => selected[i]));
  const preview = $derived(subset.length ? farkleScore(subset) : 0);
  const bust = $derived(!farkleCanScore(rolled));
  const last = $derived(
    scoreSlots(view.audit)
      .filter((slot) => slot.command)
      .at(-1),
  );
  const status = $derived(view.projection.status);
  const profile = $derived(match.playersSnapshot.find((player) => player.id === current));
  const entryNeeded = $derived(
    position.totals[current] === 0 ? Math.max(0, game.definition.entry - position.running) : 0,
  );
  const editable = $derived(
    !saving &&
      status === 'in_progress' &&
      view.projection.lastEventSequence < 1000 &&
      (!selfOnly || allowedOwnerIds?.includes(current)),
  );
  const canBank = $derived(editable && position.running > 0 && entryNeeded === 0);
  const pips = [[], [4], [0, 8], [0, 4, 8], [0, 2, 6, 8], [0, 2, 4, 6, 8], [0, 2, 3, 5, 6, 8]];
  let draftKey = $state('');
  let selected = $state([false, false, false, false, false, false]);
  let notice = $state('');
  let error = $state('');
  let prompt = $state<JournalAction | null>(null);
  let promptVersion = $state(0);
  let dialog: HTMLDialogElement;
  $effect(() => {
    const key = `${match.id}:${position.eventCount}`;
    if (draftKey !== key) {
      draftKey = key;
      dice = [1, 1, 1, 1, 1, 1];
      selected = [false, false, false, false, false, false];
    }
  });
  function owner(id: string) {
    return (
      match.teamsSnapshot.find((t) => t.id === id)?.name ??
      match.playersSnapshot.find((p) => p.id === id)?.displayName ??
      id
    );
  }
  async function act(action: JournalAction, version = view.projection.lastEventSequence) {
    if (saving) return;
    const actorPlayerId = view.authority.playerId;
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
        actorPlayerId,
        deviceId,
        timestamp: new Date().toISOString(),
        action,
      });
      notice = '';
      if (dialog?.open) dialog.close();
    } catch (failure) {
      error =
        failure instanceof EngineError ? messages.farkle.invalid : petanqueErrorMessage(failure);
    } finally {
      saving = false;
    }
  }
  function confirm(action: JournalAction) {
    prompt = action;
    promptVersion = view.projection.lastEventSequence;
    dialog.showModal();
  }
  function record(event: SubmitEvent) {
    event.preventDefault();
    void act({
      type: 'record',
      ownerId: current,
      values: {
        kind: 0,
        keep: bust
          ? 0
          : selected
              .slice(0, position.remaining)
              .reduce((mask, keep, i) => (keep ? mask | (1 << i) : mask), 0),
        ...Object.fromEntries(rolled.map((die, i) => [`d${i + 1}`, die])),
      },
    });
  }
  const draft = entryDraft(
    () => `${match.id}:farkle`,
    () => `${view.projection.lastEventSequence}:${view.projection.status}`,
    () => ({ dice, selected }),
    (data) => {
      if (!data.dice.every((value) => Number.isInteger(value) && value >= 1 && value <= 6))
        return false;
      dice = data.dice;
      selected = data.selected;
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

<section class="game-play-area stack" aria-labelledby="farkle-title">
  <h2 id="farkle-title">{header ? messages.matches.scoreEntry : messages.farkle.title}</h2>

  {#if position.finalTurns >= 0}<p role="status">
      {messages.farkle.lastTurns(position.finalTurns)}
    </p>{/if}

  <EntrySituation {status}>
    <div class="turn-card stack">
      <div class="turn-header situation-active">
        <div class="identity">
          {#if profile}<PlayerAvatar {profile} />{/if}
          <div>
            <p class="eyebrow">{messages.farkle.currentPlayer}</p>
            <h3>{messages.four21.turn(owner(current))}</h3>
          </div>
        </div>
        <span class="target">{messages.farkle.target(game.definition.target)}</span>
      </div>
      <div class="metrics">
        <div>
          <span>{messages.farkle.banked}</span><strong>{position.totals[current]}</strong>
        </div>
        <div class="at-risk">
          <span>{messages.farkle.atRisk}</span><strong>{position.running}</strong>
        </div>
        <div>
          <span>{messages.farkle.diceLeft}</span><strong
            >{position.remaining}<small> / 6</small></strong
          >
        </div>
      </div>
      <progress
        value={position.totals[current]}
        max={game.definition.target}
        aria-label={messages.farkle.target(game.definition.target)}
      ></progress>
      <p class="turn-caption" aria-live="polite">
        {messages.farkle.running(position.running, position.remaining)}
      </p>
    </div>
  </EntrySituation>
  {#if status === 'in_progress' || status === 'paused'}
    {#if !selfOnly || allowedOwnerIds?.includes(current)}
      <form class="roll-form stack" aria-label={messages.farkle.rollTitle} onsubmit={record}>
        <div class="roll-heading">
          <h3>{messages.farkle.rollTitle}</h3>
          <span>{messages.farkle.selectedCount(bust ? 0 : subset.length, position.remaining)}</span>
        </div>
        <p class="hint">{messages.farkle.rollHint}</p>
        <div class="dice-grid">
          {#each Array.from({ length: position.remaining }, (_, i) => i) as index (index)}
            <div class="die-card stack" class:chosen={selected[index] && !bust}>
              <label for={`farkle-die-${index}`}>{messages.yams.die(index + 1)}</label>
              <button
                type="button"
                class="die-toggle"
                aria-label={messages.farkle.keep(index + 1)}
                aria-pressed={selected[index] && !bust}
                disabled={!editable || bust}
                onclick={() => {
                  selected[index] = !selected[index];
                }}
              >
                <span class="die-face" aria-hidden="true"
                  >{#each Array.from({ length: 9 }, (_, i) => i) as dot (dot)}<span
                      class:visible={pips[dice[index]!]!.includes(dot)}
                    ></span>{/each}</span
                >
                <span class="keep-state"
                  ><span aria-hidden="true"
                    ><Icon name={selected[index] && !bust ? 'check' : 'plus'} size={14} /></span
                  >{selected[index] && !bust ? messages.farkle.kept : messages.farkle.choose}</span
                >
              </button>
              <select id={`farkle-die-${index}`} bind:value={dice[index]} disabled={!editable}
                >{#each [1, 2, 3, 4, 5, 6] as value (value)}<option {value}>{value}</option
                  >{/each}</select
              >
            </div>
          {/each}
        </div>
        <div
          class="selection-summary"
          class:lost={bust}
          class:invalid={!bust && preview === null}
          aria-live="polite"
        >
          <span class="selection-symbol" aria-hidden="true"
            ><Icon name={bust || preview === null ? 'warning' : 'plus'} size={24} /></span
          >
          <div>
            <strong
              >{bust
                ? messages.farkle.bust
                : preview === null
                  ? messages.farkle.invalidSelection
                  : !subset.length
                    ? messages.farkle.chooseHint
                    : messages.farkle.preview(preview)}</strong
            >
            {#if !bust && preview !== null && subset.length}<p>
                {messages.farkle.afterRoll(position.running + preview)}
              </p>{/if}
          </div>
        </div>
        <button
          class="button continue-button"
          disabled={!editable || (!bust && (!subset.length || preview === null))}
          ><Icon name={bust ? 'warning' : 'check'} />{bust
            ? messages.farkle.recordBust
            : messages.farkle.record}</button
        >
      </form>
    {/if}
    <div class="bank-panel stack">
      <div class="bank-heading">
        <div>
          <h3>{messages.farkle.bank}</h3>
          <p>{messages.farkle.bankHint}</p>
        </div>
        <strong>{position.running}</strong>
      </div>
      {#if entryNeeded > 0}<p class="threshold-hint">
          {messages.farkle.entryNeeded(entryNeeded)}
        </p>{/if}
      <button
        class="button"
        disabled={!canBank}
        onclick={() => act({ type: 'record', ownerId: current, values: { kind: 1 } })}
        ><Icon name="save" />{messages.farkle.bank}</button
      >
    </div>
  {/if}
  {#if notice}<p role="status">{notice}</p>{/if}
  {#if error}<p role="alert" class="error">{error}</p>{/if}
</section>
<dialog
  bind:this={dialog}
  onclose={() => {
    prompt = null;
  }}
  aria-labelledby="farkle-confirm"
>
  <h2 id="farkle-confirm">{messages.four21.confirm}</h2>
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
  .turn-card,
  .roll-form,
  .bank-panel {
    padding: var(--panel-padding);
    border: 1px solid var(--border);
    border-radius: 18px;
    min-width: 0;
  }
  .turn-card {
    background: var(--soft);
  }
  .turn-header,
  .identity,
  .roll-heading,
  .bank-heading {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
  .turn-header,
  .roll-heading,
  .bank-heading {
    justify-content: space-between;
  }
  .identity {
    flex-wrap: nowrap;
    min-width: 0;
  }
  .identity h3 {
    overflow-wrap: anywhere;
  }
  .eyebrow,
  .hint,
  .turn-caption,
  .roll-heading > span,
  .bank-heading p {
    color: var(--muted-text);
    font-size: 0.875rem;
  }
  .target {
    background: var(--selected);
    color: var(--accent);
    border-radius: 999px;
    padding: var(--space-2) var(--space-3);
    font-size: 0.875rem;
    font-weight: 700;
  }
  .metrics {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-3);
  }
  .metrics > div {
    display: grid;
    gap: var(--space-2);
  }
  .metrics span {
    font-size: 0.75rem;
    color: var(--muted-text);
  }
  .metrics strong {
    font-size: clamp(1.25rem, 3vw, 2rem);
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  }
  .metrics small {
    font-size: 0.875rem;
    color: var(--muted-text);
  }
  .at-risk strong {
    color: var(--warning);
  }
  progress {
    width: 100%;
    height: 8px;
    accent-color: var(--success);
  }
  .dice-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-3);
  }
  .die-card {
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface);
    gap: var(--space-2);
    min-width: 0;
  }
  .die-card.chosen {
    border-color: var(--success);
    box-shadow: inset 0 0 0 1px var(--success);
    background: var(--selected);
  }
  .die-card label {
    font-size: 0.875rem;
    text-align: center;
  }
  .die-toggle {
    display: grid;
    justify-items: center;
    gap: var(--space-2);
    min-height: 96px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: var(--text);
    padding: var(--space-2);
    cursor: pointer;
  }
  .die-face {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 5px;
    width: 52px;
    height: 52px;
    padding: 8px;
    border: 1px solid var(--input-border);
    border-radius: 10px;
    background: var(--surface);
  }
  .die-face > span {
    border-radius: 50%;
    background: transparent;
  }
  .die-face > span.visible {
    background: var(--text);
  }
  .chosen .die-face {
    border-color: var(--success);
  }
  .keep-state {
    font-size: 0.75rem;
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .chosen .keep-state {
    color: var(--success);
  }
  .die-card select {
    width: 100%;
    min-width: 0;
  }
  .selection-summary {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-4);
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--selected);
  }
  .selection-summary p {
    font-size: 0.875rem;
    margin-top: var(--space-1);
    color: var(--muted-text);
  }
  .selection-symbol {
    font-size: 1.5rem;
    font-weight: 800;
  }
  .selection-summary.lost,
  .selection-summary.invalid {
    color: var(--danger);
    border-color: var(--danger);
    background: var(--surface);
  }
  .bank-panel {
    background: var(--soft);
  }
  .bank-heading strong {
    font-size: 2rem;
    color: var(--success);
    font-variant-numeric: tabular-nums;
  }
  .threshold-hint {
    color: var(--warning);
    font-size: 0.875rem;
  }
  .die-toggle:disabled {
    opacity: 0.55;
    cursor: default;
  }
  @media (max-width: 480px) {
    .dice-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--space-2);
    }
    .die-card {
      padding: var(--space-2);
    }
  }
</style>
