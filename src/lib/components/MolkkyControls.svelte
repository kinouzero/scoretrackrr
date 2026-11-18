<script lang="ts">
  import EntrySituation from './EntrySituation.svelte';
  import ScorePreview from './ScorePreview.svelte';
  import { entryDraft } from '../application/entry-draft.svelte';
  import GameRules from './GameRules.svelte';
  import Icon from './Icon.svelte';
  import GameHeader, { type HeaderRenderer } from './GameHeader.svelte';
  import type { MatchRecord } from '#lib/domain/records';
  import type { JournalAction, JournalView } from '#lib/domain/journal';
  import type { LocalDatabase } from '#lib/storage/database';
  import type { MatchJournal } from '#lib/storage/journal';
  import { createMolkkyGame } from '#lib/domain/games/molkky';
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
  const game = $derived(createMolkkyGame(match.rulesSnapshot.definition));
  const config = $derived(game.validateConfig(match.settingsSnapshot.engineConfig));
  const position = $derived(game.inspect(view.state, config));
  const current = $derived(config.ownerIds[position.turn]!);
  const activePlayer = $derived(activeTeamPlayer(match, view.audit, current));
  const status = $derived(view.projection.status);
  const last = $derived(
    scoreSlots(view.audit)
      .filter((slot) => slot.command)
      .at(-1),
  );
  let points = $state(0),
    correction = $state(0),
    saving = $state(false),
    error = $state(''),
    notice = $state('');
  let prompt = $state<JournalAction | 'correct' | null>(null),
    promptVersion = $state(0);
  let dialog: HTMLDialogElement;
  $effect(() => {
    void position.eventCount;
    points = 0;
  });
  function owner(id: string) {
    return (
      match.teamsSnapshot.find((team) => team.id === id)?.name ??
      match.playersSnapshot.find((player) => player.id === id)?.displayName ??
      id
    );
  }
  async function act(action: JournalAction, expectedVersion = view.projection.lastEventSequence) {
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
        expectedVersion,
        actorPlayerId: view.authority.playerId,
        deviceId,
        timestamp: new Date().toISOString(),
        action,
      });
      notice = '';
      if (dialog?.open) dialog.close();
    } catch (failure) {
      error =
        failure instanceof EngineError ? messages.molkky.invalid : petanqueErrorMessage(failure);
    } finally {
      saving = false;
    }
  }
  function confirm(action: JournalAction | 'correct') {
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
          replacement: {
            type: 'record',
            ownerId: last.command.ownerId,
            values: { turn: last.command.values.turn!, points: correction },
          },
        },
        promptVersion,
      );
    else if (prompt && prompt !== 'correct') void act(prompt, promptVersion);
  }
  const draft = entryDraft(
    () => `${match.id}:molkky`,
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
      <button class="button secondary" disabled={saving} onclick={() => confirm('correct')}
        ><Icon name="edit" />{messages.molkky.correct}</button
      >
      <button
        class="button secondary"
        disabled={saving}
        onclick={() => confirm({ type: 'undo', targetEventId: last!.revisionId })}
        ><Icon name="undo" />{messages.molkky.undo}</button
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

<section class="game-play-area molkky-controls" aria-labelledby="molkky-title">
  <h2 id="molkky-title">{header ? messages.matches.scoreEntry : messages.molkky.title}</h2>

  <EntrySituation {status}
    ><div class="situation-active">
      <h3>{messages.molkky.turn(owner(current))}</h3>
      {#if activePlayer}<p role="status">
          <strong>{messages.generic.activeTeamPlayer(activePlayer.displayName)}</strong>
        </p>{/if}
    </div>
    <div class="situation-metric situation-active">
      <span>{messages.farkle.banked}</span><strong
        >{position.totals[current]}<small> / 50</small></strong
      >
    </div></EntrySituation
  >
  {#if status === 'in_progress' && (!selfOnly || allowedOwnerIds?.includes(current))}
    <form
      class="molkky-controls"
      onsubmit={(event) => {
        event.preventDefault();
        void act({
          type: 'record',
          ownerId: current,
          values: { points, turn: position.eventCount },
        });
      }}
    >
      <div class="game-field">
        <label for="molkky-points">{messages.molkky.points}</label>
        <select id="molkky-points" bind:value={points} disabled={saving}>
          {#each Array.from({ length: 13 }, (_, i) => i) as value (value)}<option {value}
              >{value === 0 ? messages.molkky.miss : messages.molkky.score(value)}</option
            >{/each}
        </select>
      </div>
      {#if position.totals[current]! + points > 50}<p>{messages.molkky.overshoot}</p>{/if}
      <ScorePreview
        {match}
        state={view.state}
        command={() => ({
          type: 'record',
          ownerId: current,
          values: { points, turn: position.eventCount },
        })}
      />
      <button class="button" disabled={saving}><Icon name="check" />{messages.molkky.record}</button
      >
    </form>
  {/if}
  <ul aria-label={messages.molkky.missList}>
    {#each config.ownerIds as id (id)}{#if position.misses[id]}<li>
          {position.misses[id] === 3
            ? messages.molkky.eliminated(owner(id))
            : messages.molkky.misses(owner(id), position.misses[id]!)}
        </li>{/if}{/each}
  </ul>
  {#if notice}<p role="status">{notice}</p>{/if}
  <p class="error" role="alert">{error}</p>
</section>
<dialog
  bind:this={dialog}
  aria-labelledby="molkky-confirm"
  oncancel={(event) => {
    if (saving) event.preventDefault();
  }}
>
  <h2 id="molkky-confirm">{messages.generic.confirm}</h2>
  {#if prompt === 'correct'}<div class="game-field">
      <label for="molkky-correction">{messages.molkky.points}</label><input
        id="molkky-correction"
        type="number"
        min="0"
        max="12"
        step="1"
        bind:value={correction}
        disabled={saving}
      />
    </div>{/if}
  <p>{messages.molkky.confirmHint}</p>
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
  .molkky-controls {
    display: grid;
    gap: var(--space-4);
  }
  dialog {
    padding: var(--panel-padding);
  }
  select {
    height: 48px;
  }
</style>
