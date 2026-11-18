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
  import { createFlip7Game, flip7Score } from '#lib/domain/games/flip7';
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
  const game = $derived(createFlip7Game(match.rulesSnapshot.definition));
  const config = $derived(game.validateConfig(match.settingsSnapshot.engineConfig));
  const position = $derived(game.inspect(view.state, config));
  const complete = $derived(config.ownerIds.every((id) => position.hands[id] !== null));
  const current = $derived(
    config.ownerIds.find((id) => position.hands[id] === null) ?? config.ownerIds[0]!,
  );
  const last = $derived(
    scoreSlots(view.audit)
      .filter((slot) => slot.command)
      .at(-1),
  );
  const status = $derived(view.projection.status);
  let numbers = $state<boolean[]>(Array(13).fill(false));
  const numberCount = $derived(numbers.filter(Boolean).length);
  let modifiers = $state<boolean[]>(Array(5).fill(false));
  let doubled = $state(false);
  const hand = $derived({
    cards: numbers.reduce((mask, on, i) => (on ? mask | (1 << i) : mask), 0),
    modifiers: modifiers.reduce((mask, on, i) => (on ? mask | (1 << i) : mask), 0),
    double: doubled ? 1 : 0,
    bust: 0,
  });
  const preview = $derived.by(() => {
    try {
      return flip7Score(hand);
    } catch {
      return null;
    }
  });
  let saving = $state(false);
  let notice = $state('');
  let error = $state('');
  let prompt = $state<JournalAction | null>(null);
  let promptVersion = $state(0);
  let dialog: HTMLDialogElement;
  $effect(() => {
    void position.eventCount;
    numbers = Array(13).fill(false);
    modifiers = Array(5).fill(false);
    doubled = false;
  });
  function toggleNumber(value: number) {
    if (saving || (!numbers[value] && numberCount >= 7)) return;
    numbers[value] = !numbers[value];
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
    } catch (failure) {
      error =
        failure instanceof EngineError ? messages.flip.invalid : petanqueErrorMessage(failure);
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
    void act({ type: 'record', ownerId: current, values: { round: position.round, ...hand } });
  }
  const draft = entryDraft(
    () => `${match.id}:flip`,
    () => `${view.projection.lastEventSequence}:${view.projection.status}`,
    () => ({ numbers, modifiers, doubled }),
    (data) => {
      numbers = data.numbers;
      modifiers = data.modifiers;
      doubled = data.doubled;
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

<section class="game-play-area stack" aria-labelledby="flip-title">
  <h2 id="flip-title">{header ? messages.matches.scoreEntry : messages.flip.title}</h2>

  <EntrySituation {status}>
    <div>
      <h3>{messages.flip.round(position.round)}</h3>
      {#if !complete}<h3 class="situation-active">{owner(current)}</h3>{:else}<p>
          {messages.flip.complete}
        </p>{/if}
    </div>
    <p>
      {messages.sixNimmt.progress(
        config.ownerIds.filter((id) => position.hands[id] !== null).length,
        config.ownerIds.length,
      )}
    </p>
  </EntrySituation>
  <ul class="hand-progress">
    {#each config.ownerIds as id (id)}<li>
        {owner(id)} : {position.hands[id] === null
          ? messages.flip.pending
          : messages.flip.points(flip7Score(position.hands[id]!))}
      </li>{/each}
  </ul>
  {#if status === 'in_progress'}{#if complete}<p>{messages.flip.complete}</p>
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
        >{/if}
    {:else}
      {#if !selfOnly || allowedOwnerIds?.includes(current)}
        <form class="stack" onsubmit={record}>
          <p>{messages.flip.handHint}</p>
          <fieldset class="cards" disabled={saving} aria-describedby="flip-card-count">
            <legend>{messages.flip.cards}</legend>
            <p id="flip-card-count" class="selection-count" aria-live="polite">
              {messages.flip.selectionCount(numberCount)}
            </p>
            <div class="card-grid">
              {#each Array.from({ length: 13 }, (_, i) => i) as value (value)}
                <button
                  type="button"
                  class="card-choice"
                  aria-label={messages.flip.card(value)}
                  aria-pressed={numbers[value]}
                  disabled={!numbers[value] && numberCount >= 7}
                  onclick={() => toggleNumber(value)}
                >
                  {value}<span class="selection-mark" aria-hidden="true"
                    >{#if numbers[value]}<Icon name="check" size={12} />{/if}</span
                  >
                </button>
              {/each}
            </div>
          </fieldset>
          {#if numberCount === 7}
            <p class="seven-bonus" role="status">
              <Icon name="sparkle" size={18} />{messages.flip.sevenBonus}
            </p>
          {/if}
          <fieldset class="cards" disabled={saving}>
            <legend>{messages.flip.modifiers}</legend>
            <div class="card-grid modifiers">
              {#each [2, 4, 6, 8, 10] as value, index (value)}
                <button
                  type="button"
                  class="card-choice"
                  aria-label={messages.flip.modifier(value)}
                  aria-pressed={modifiers[index]}
                  onclick={() => (modifiers[index] = !modifiers[index])}
                >
                  +{value}<span class="selection-mark" aria-hidden="true"
                    >{#if modifiers[index]}<Icon name="check" size={12} />{/if}</span
                  >
                </button>
              {/each}
              <button
                type="button"
                class="card-choice"
                aria-label={messages.flip.double}
                aria-pressed={doubled}
                onclick={() => (doubled = !doubled)}
              >
                ×2<span class="selection-mark" aria-hidden="true"
                  >{#if doubled}<Icon name="check" size={12} />{/if}</span
                >
              </button>
            </div>
          </fieldset>
          <p aria-live="polite">
            {preview === null ? messages.flip.invalid : messages.flip.points(preview)}
          </p>
          <div class="button-row">
            <button
              class="button"
              disabled={saving || preview === null || view.projection.lastEventSequence >= 1000}
              ><Icon name="check" />{messages.flip.record}</button
            >
            <button
              type="button"
              class="button secondary"
              disabled={saving || view.projection.lastEventSequence >= 1000}
              onclick={() =>
                act({
                  type: 'record',
                  ownerId: current,
                  values: { round: position.round, cards: 0, modifiers: 0, double: 0, bust: 1 },
                })}><Icon name="warning" />{messages.flip.recordBust}</button
            >
          </div>
          <p class="field-hint">{messages.flip.bustHint}</p>
        </form>{/if}{/if}{/if}
  {#if notice}<p role="status">{notice}</p>{/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</section>
<dialog
  bind:this={dialog}
  onclose={() => {
    prompt = null;
  }}
  aria-labelledby="flip-confirm"
>
  <h2 id="flip-confirm">{messages.four21.confirm}</h2>
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
  .cards {
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }
  .cards legend {
    margin-bottom: var(--space-3);
    padding: 0;
    font-weight: 650;
  }
  .card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(3.5rem, 1fr));
    gap: var(--space-2);
  }
  .card-grid.modifiers {
    grid-template-columns: repeat(auto-fit, minmax(4.5rem, 1fr));
  }
  .card-choice {
    position: relative;
    display: grid;
    place-items: center;
    min-height: 56px;
    min-width: 0;
    border: 1px solid var(--input-border);
    border-radius: 12px;
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 1.1rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .card-choice:hover:not(:disabled) {
    background: var(--soft);
  }
  .card-choice[aria-pressed='true'] {
    color: var(--accent);
    background: var(--selected);
    border-color: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent);
  }
  .card-choice:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .selection-count {
    margin-block-end: var(--space-3);
    color: var(--muted-text);
    font-size: 0.85rem;
  }
  .seven-bonus {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    border-radius: 12px;
    background: var(--selected);
    color: var(--success);
    font-weight: 750;
  }
  .selection-mark {
    position: absolute;
    top: var(--space-1);
    right: var(--space-1);
    font-size: 0.7rem;
    line-height: 1;
  }
</style>
