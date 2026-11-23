<script lang="ts">
  import EntrySituation from './EntrySituation.svelte';
  import { entryDraft } from '../application/entry-draft.svelte';
  import Icon from './Icon.svelte';
  import GameHeader, { type HeaderRenderer } from './GameHeader.svelte';
  import type { MatchRecord } from '#lib/domain/records';
  import type { JournalAction, JournalView } from '#lib/domain/journal';
  import type { LocalDatabase } from '#lib/storage/database';
  import type { MatchJournal } from '#lib/storage/journal';
  import { submitSixNimmtRound } from '#lib/storage/six-nimmt';
  import PlayerAvatar from './PlayerAvatar.svelte';
  import { createSixNimmtGame } from '#lib/domain/games/six-nimmt';
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
  const game = $derived(createSixNimmtGame(match.rulesSnapshot.definition));
  const config = $derived(game.validateConfig(match.settingsSnapshot.engineConfig));
  const position = $derived(game.inspect(view.state, config));
  const roundLimit = $derived(game.roundLimit(config.ownerIds.length));
  const complete = $derived(config.ownerIds.every((id) => position.entries[id] !== null));
  const pending = $derived(
    config.ownerIds.filter(
      (id) => position.entries[id] === null && (!selfOnly || allowedOwnerIds?.includes(id)),
    ),
  );
  const last = $derived(
    scoreSlots(view.audit)
      .filter((slot) => slot.command)
      .at(-1),
  );
  const status = $derived(view.projection.status);
  let drafts = $state<Record<string, number | undefined>>({});
  let draftRound = $state('');
  const roundTotal = $derived(
    config.ownerIds.reduce((total, id) => total + (position.entries[id] ?? drafts[id] ?? 0), 0),
  );
  let correction = $state(0),
    saving = $state(false),
    error = $state(''),
    notice = $state('');
  let prompt = $state<JournalAction | 'correct' | null>(null),
    promptVersion = $state(0);
  let dialog: HTMLDialogElement;
  $effect(() => {
    const key = `${match.id}:${position.round}`;
    if (draftRound !== key) {
      draftRound = key;
      drafts = {};
    } else if (Object.keys(drafts).some((id) => position.entries[id] !== null)) {
      drafts = Object.fromEntries(
        Object.entries(drafts).filter(([id]) => position.entries[id] === null),
      );
    }
  });
  function owner(id: string) {
    return match.playersSnapshot.find((player) => player.id === id)?.displayName ?? id;
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
        failure instanceof EngineError ? messages.sixNimmt.invalid : petanqueErrorMessage(failure);
    } finally {
      saving = false;
    }
  }
  async function recordRound(event: SubmitEvent) {
    event.preventDefault();
    if (saving || status !== 'in_progress' || !pending.length) return;
    const scores: { ownerId: string; points: number }[] = [];
    for (const ownerId of pending) {
      const value = drafts[ownerId];
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        error = messages.sixNimmt.invalid;
        return;
      }
      scores.push({ ownerId, points: value });
    }
    const round = position.round;
    const expectedVersion = view.projection.lastEventSequence;
    const actorPlayerId = view.authority.playerId;
    saving = true;
    error = '';
    notice = '';
    try {
      const deviceId = await database.readOrCreateDeviceId(crypto.randomUUID());
      await submitSixNimmtRound(database, journal, {
        matchId: match.id,
        round,
        expectedVersion,
        actorPlayerId,
        deviceId,
        timestamp: new Date().toISOString(),
        scores,
      });
      notice = '';
    } catch (failure) {
      error =
        failure instanceof EngineError ? messages.sixNimmt.invalid : petanqueErrorMessage(failure);
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
            values: { round: last.command.values.round!, points: correction },
          },
        },
        promptVersion,
      );
    else if (prompt && prompt !== 'correct') void act(prompt, promptVersion);
  }
  const draft = entryDraft(
    () => `${match.id}:sixnimmt`,
    () => `${view.projection.lastEventSequence}:${view.projection.status}`,
    () => ({ drafts }),
    (data) => {
      drafts = data.drafts;
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
      {#if last.command?.values.points !== undefined}<button
          class="button secondary"
          disabled={saving}
          onclick={() => confirm('correct')}><Icon name="edit" />{messages.sixNimmt.correct}</button
        >{/if}
      <button
        class="button secondary"
        disabled={saving}
        onclick={() => confirm({ type: 'undo', targetEventId: last!.revisionId })}
        ><Icon name="undo" />{messages.sixNimmt.undo}</button
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

<GameHeader renderer={header} {actions} />

<section class="game-play-area six-nimmt-controls" aria-labelledby="six-nimmt-title">
  <h2 id="six-nimmt-title">{header ? messages.matches.scoreEntry : messages.sixNimmt.title}</h2>

  <EntrySituation {status}>
    <h3>{messages.sixNimmt.round(position.round)}</h3>
    <p>
      {messages.sixNimmt.progress(
        config.ownerIds.filter((id) => position.entries[id] !== null).length,
        config.ownerIds.length,
      )}
    </p>
  </EntrySituation>
  {#if complete && status === 'in_progress' && !selfOnly}<button
      class="button"
      disabled={saving}
      onclick={() =>
        act({
          type: 'record',
          ownerId: config.ownerIds[0]!,
          values: { round: position.round, nextRound: 1 },
        })}><Icon name="arrow-right" />{messages.sixNimmt.nextRound}</button
    >{/if}
  <form class="round-form" aria-label={messages.sixNimmt.points} onsubmit={recordRound}>
    <fieldset disabled={saving || status !== 'in_progress'}>
      <legend>{messages.sixNimmt.points}</legend>
      <p class="field-hint">{messages.sixNimmt.roundHint}</p>
      {#if game.options.expansion === 'surprises'}<p class="field-hint">
          {messages.sixNimmt.surprisesHint}
        </p>{/if}
      <div class="round-entries">
        {#each config.ownerIds as id (id)}
          {@const recorded = position.entries[id]}
          {@const profile = match.playersSnapshot.find((player) => player.id === id)}
          <div class="round-entry" class:recorded={recorded !== null}>
            <label for={`six-nimmt-${id}`}>
              {#if profile}<PlayerAvatar {profile} />{/if}
              <span>{owner(id)}</span>
            </label>
            {#if recorded !== null}
              <input
                id={`six-nimmt-${id}`}
                type="number"
                value={recorded}
                disabled
                aria-label={messages.sixNimmt.forPlayer(owner(id))}
              />
            {:else}
              <input
                id={`six-nimmt-${id}`}
                type="number"
                inputmode="numeric"
                min="0"
                max={roundLimit}
                step="1"
                bind:value={drafts[id]}
                required
                disabled={selfOnly && !allowedOwnerIds?.includes(id)}
                aria-label={messages.sixNimmt.forPlayer(owner(id))}
              />
            {/if}
          </div>
        {/each}
      </div>
      <aside class="score-preview" aria-label={messages.play.preview}>
        <span class="preview-caption">{messages.play.preview}</span>
        {#each pending as id (id)}
          {#if Number.isInteger(drafts[id]) && drafts[id]! >= 0 && drafts[id]! <= roundLimit && roundTotal <= roundLimit}
            <p>
              <span>{owner(id)}</span><strong
                >{position.totals[id]} → {position.totals[id]! + drafts[id]!}</strong
              ><small>+{drafts[id]}</small>
            </p>
          {/if}
        {/each}
        {#if pending.some((id) => !Number.isInteger(drafts[id])) || roundTotal > roundLimit}<p>
            {messages.play.previewIncomplete}
          </p>{/if}
      </aside>
    </fieldset>
    <p class="round-total" class:error={roundTotal > roundLimit} aria-live="polite">
      {messages.sixNimmt.roundTotal(roundTotal, roundLimit)}
    </p>
    {#if !complete && status === 'in_progress' && pending.length}
      <button class="button" disabled={saving || roundTotal > roundLimit}
        ><Icon name="check" />{messages.sixNimmt.record}</button
      >
    {/if}
  </form>
  {#if notice}<p role="status">{notice}</p>{/if}
  <p class="error" role="alert">{error}</p>
</section>
<dialog
  bind:this={dialog}
  aria-labelledby="six-nimmt-confirm"
  oncancel={(event) => {
    if (saving) event.preventDefault();
  }}
>
  <h2 id="six-nimmt-confirm">{messages.generic.confirm}</h2>
  {#if prompt === 'correct'}<div class="game-field">
      <label for="six-nimmt-correction">{messages.sixNimmt.points}</label><input
        id="six-nimmt-correction"
        type="number"
        min="0"
        max={roundLimit}
        step="1"
        bind:value={correction}
        disabled={saving}
      />
    </div>{/if}
  <p>{messages.sixNimmt.confirmHint}</p>
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
  .six-nimmt-controls {
    display: grid;
    gap: var(--space-4);
  }
  .round-form,
  fieldset {
    display: grid;
    gap: var(--space-3);
    min-width: 0;
  }
  fieldset {
    border: 0;
    padding: 0;
    margin: 0;
  }
  legend {
    padding: 0;
    margin-bottom: var(--space-2);
    font-weight: 650;
  }
  .round-entries {
    display: grid;
    gap: var(--space-2);
  }
  .round-entry {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 6rem;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--soft);
  }
  .round-entry label {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
    overflow-wrap: anywhere;
    font-weight: 650;
  }
  .round-entry input {
    width: 100%;
    min-width: 0;
    margin: 0;
    text-align: center;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .round-entry.recorded {
    background: var(--surface);
  }
  .round-entry input:disabled {
    color: var(--muted-text);
  }
  .round-total {
    font-size: 0.85rem;
    font-variant-numeric: tabular-nums;
  }
  @media (max-width: 480px) {
    .round-entry {
      grid-template-columns: minmax(0, 1fr) 4.5rem;
      gap: var(--space-2);
      padding: var(--space-2);
    }
  }
  dialog {
    padding: var(--panel-padding);
  }
</style>
