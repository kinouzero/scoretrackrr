<script lang="ts">
  import EntrySituation from './EntrySituation.svelte';
  import ScorePreview from './ScorePreview.svelte';
  import { entryDraft } from '../application/entry-draft.svelte';
  import GameRules from './GameRules.svelte';
  import Icon from './Icon.svelte';
  import GameHeader, { type HeaderRenderer } from './GameHeader.svelte';
  import { onMount } from 'svelte';
  import type { MatchRecord } from '#lib/domain/records';
  import type { JournalAction, JournalView } from '#lib/domain/journal';
  import type { LocalDatabase } from '#lib/storage/database';
  import type { MatchJournal } from '#lib/storage/journal';
  import { createTimesUpGame, timerClock, timerRemaining } from '#lib/domain/games/times-up';
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
  const game = $derived(createTimesUpGame(match.rulesSnapshot.definition));
  const config = $derived(game.validateConfig(match.settingsSnapshot.engineConfig));
  const position = $derived(game.inspect(view.state, config));
  const current = $derived(config.ownerIds[position.turn % config.ownerIds.length]!);
  const activePlayer = $derived(activeTeamPlayer(match, view.audit, current));
  const last = $derived(
    scoreSlots(view.audit)
      .filter((slot) => slot.command)
      .at(-1),
  );
  const status = $derived(view.projection.status);
  const canPlay = $derived(
    status === 'in_progress' && (!selfOnly || allowedOwnerIds?.includes(current)),
  );
  let now = $state(Date.now());
  const remaining = $derived(timerRemaining(position, now));
  const seconds = $derived(Math.ceil(remaining / 1000));
  let points = $state(0),
    correction = $state(0),
    saving = $state(false),
    error = $state(''),
    notice = $state('');
  let prompt = $state<JournalAction | 'correct' | 'reset' | null>(null),
    promptVersion = $state(0);
  let dialog: HTMLDialogElement;
  let audio: AudioContext | undefined;
  let soundedDeadline: number | null = null;
  onMount(() => {
    const interval = window.setInterval(() => {
      now = Date.now();
    }, 100);
    return () => {
      window.clearInterval(interval);
      if (audio) void audio.close().catch(() => {});
    };
  });
  $effect(() => {
    void position.turn;
    points = 0;
  });
  $effect(() => {
    if (position.deadline !== null && remaining === 0 && soundedDeadline !== position.deadline) {
      soundedDeadline = position.deadline;
      if (audio?.state === 'running') {
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        oscillator.frequency.value = 880;
        gain.gain.setValueAtTime(0.15, audio.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.7);
        oscillator.connect(gain);
        gain.connect(audio.destination);
        oscillator.start();
        oscillator.stop(audio.currentTime + 0.7);
      }
    }
  });
  function unlockAudio() {
    try {
      audio ??= new AudioContext();
      void audio.resume().catch(() => {});
    } catch {
      /* The visible expiry signal remains available when audio is unavailable. */
    }
  }
  function owner(id: string) {
    return match.teamsSnapshot.find((team) => team.id === id)?.name ?? id;
  }
  function timerAction(kind: number, score?: number): JournalAction {
    return {
      type: 'record',
      ownerId: current,
      values: {
        kind,
        turn: position.turn,
        ...timerClock(Math.max(Date.now(), position.clockAt)),
        ...(score === undefined ? {} : { points: score }),
      },
    };
  }
  async function act(action: JournalAction, expectedVersion = view.projection.lastEventSequence) {
    if (saving) return;
    saving = true;
    error = '';
    notice = '';
    try {
      const deviceId = await database.readOrCreateDeviceId(crypto.randomUUID());
      const submit = (next: JournalAction, version: number) =>
        journal.submit({
          matchId: match.id,
          eventId: crypto.randomUUID(),
          commandId: crypto.randomUUID(),
          expectedVersion: version,
          actorPlayerId: view.authority.playerId,
          deviceId,
          timestamp: new Date().toISOString(),
          action: next,
        });
      // Freeze the timer before pausing the match. A failed second write safely leaves it paused.
      if (action.type === 'pause' && position.deadline !== null) {
        const paused = await submit(timerAction(1), expectedVersion);
        expectedVersion = paused.projection.lastEventSequence;
      }
      await submit(action, expectedVersion);
      now = Date.now();
      notice = '';
      if (dialog?.open) dialog.close();
    } catch (failure) {
      error =
        failure instanceof EngineError ? messages.timesUp.invalid : petanqueErrorMessage(failure);
    } finally {
      saving = false;
    }
  }
  function confirm(action: JournalAction | 'correct' | 'reset') {
    prompt = action;
    promptVersion = view.projection.lastEventSequence;
    correction = last?.command?.values.points ?? 0;
    error = '';
    dialog.showModal();
  }
  function confirmAction() {
    if (prompt === 'correct' && last?.command)
      void act(
        {
          type: 'correct',
          targetEventId: last.revisionId,
          replacement: { ...last.command, values: { ...last.command.values, points: correction } },
        },
        promptVersion,
      );
    else if (prompt === 'reset') void act(timerAction(3), promptVersion);
    else if (prompt && prompt !== 'correct') void act(prompt, promptVersion);
  }
  const draft = entryDraft(
    () => `${match.id}:timesup`,
    () => `${view.projection.lastEventSequence}:${view.projection.status}`,
    () => ({ points }),
    (data) => {
      points = data.points;
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
    {#if last && status !== 'cancelled'}
      {#if last.command?.values.kind === 2}<button
          class="button secondary"
          disabled={saving}
          onclick={() => confirm('correct')}><Icon name="edit" />{messages.timesUp.correct}</button
        >{/if}
      <button
        class="button secondary"
        disabled={saving}
        onclick={() => confirm({ type: 'undo', targetEventId: last!.revisionId })}
        ><Icon name="undo" />{messages.timesUp.undo}</button
      >
    {/if}
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

<section class="game-play-area times-up-controls" aria-labelledby="times-up-title">
  <h2 id="times-up-title">{header ? messages.matches.scoreEntry : messages.timesUp.title}</h2>

  <EntrySituation {status}>
    <div class="situation-player">
      <div>
        <h3>
          {messages.timesUp.round(position.round)} · {messages.timesUp.phases[position.round - 1]}
        </h3>
        <p>{messages.timesUp.cards(position.cards)}</p>
      </div>

      <h3 class="situation-active">{messages.timesUp.turn(owner(current))}</h3>
      {#if activePlayer}<p role="status" class="situation-active">
          <strong>{messages.timesUp.activePlayer(activePlayer.displayName)}</strong>
        </p>{/if}
    </div>
    <div
      class:expired={position.started && remaining === 0}
      class="countdown situation-active"
      role="timer"
      aria-live="off"
      aria-label={messages.timesUp.timer}
    >
      {String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}
    </div>
    {#if position.started && remaining === 0}<p role="alert" class="situation-active">
        {messages.timesUp.expired}
      </p>{/if}
    <p class="muted situation-hint situation-active">{messages.timesUp.hint}</p>
  </EntrySituation>
  {#if canPlay}
    <div class="button-row">
      {#if position.deadline !== null && remaining > 0}
        <button class="button" disabled={saving} onclick={() => act(timerAction(1))}
          ><Icon name="pause" />{messages.timesUp.pause}</button
        >
      {:else if remaining > 0}
        <button
          class="button"
          disabled={saving}
          onclick={() => {
            unlockAudio();
            void act(timerAction(0));
          }}
          ><Icon name="play" />{position.started
            ? messages.timesUp.resume
            : messages.timesUp.start}</button
        >
      {/if}
      {#if position.started}<button
          class="button secondary"
          disabled={saving}
          onclick={() => confirm('reset')}><Icon name="replay" />{messages.timesUp.reset}</button
        >{/if}
    </div>
    <form
      onsubmit={(event) => {
        event.preventDefault();
        void act(timerAction(2, points));
      }}
    >
      <div class="game-field">
        <label for="times-up-points">{messages.timesUp.points}</label>
        <input
          id="times-up-points"
          type="number"
          min="0"
          max={position.cards}
          step="1"
          bind:value={points}
          disabled={saving || !position.started}
          required
        />
      </div>
      <ScorePreview
        {match}
        state={view.state}
        command={() => timerAction(2, points) as import('#lib/domain/engine/types').ScoreCommand}
      />
      <button class="button" disabled={saving || !position.started}
        ><Icon name="check" />{messages.timesUp.record}</button
      >
    </form>
  {/if}

  {#if notice}<p role="status">{notice}</p>{/if}
  <p class="error" role="alert">{error}</p>
</section>
<dialog
  bind:this={dialog}
  aria-labelledby="times-up-confirm"
  oncancel={(event) => {
    if (saving) event.preventDefault();
  }}
>
  <h2 id="times-up-confirm">{messages.generic.confirm}</h2>
  {#if prompt === 'correct'}<div class="game-field">
      <label for="times-up-correction">{messages.timesUp.points}</label><input
        id="times-up-correction"
        type="number"
        min="0"
        max="40"
        step="1"
        bind:value={correction}
        disabled={saving}
      />
    </div>{/if}
  <p>{messages.timesUp.confirm}</p>
  <p class="error" role="alert">{error}</p>
  <div class="button-row">
    <button class="button secondary" disabled={saving} onclick={() => dialog.close()}
      ><Icon name="close" />{messages.players.cancel}</button
    ><button class="button" disabled={saving} onclick={confirmAction}
      ><Icon name="check" />{messages.petanque.confirm}</button
    >
  </div>
</dialog>

<style>
  .times-up-controls,
  form {
    display: grid;
    gap: var(--space-4);
  }
  dialog {
    padding: var(--panel-padding);
  }
  .button-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
  }
  .countdown {
    font-size: clamp(3rem, 14vw, 6rem);
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    text-align: center;
    line-height: 1.2;
  }
  .expired {
    color: var(--danger, #ba2525);
  }
</style>
