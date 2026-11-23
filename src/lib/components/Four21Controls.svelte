<script lang="ts">
  import EntrySituation from './EntrySituation.svelte';
  import ScorePreview from './ScorePreview.svelte';
  import { entryDraft } from '../application/entry-draft.svelte';
  import Icon from './Icon.svelte';
  import GameHeader, { type HeaderRenderer } from './GameHeader.svelte';
  import type { MatchRecord } from '#lib/domain/records';
  import type { JournalAction, JournalView } from '#lib/domain/journal';
  import type { LocalDatabase } from '#lib/storage/database';
  import type { MatchJournal } from '#lib/storage/journal';
  import { createFour21Game, four21Extremes, combination421 } from '#lib/domain/games/four21';
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
  const game = $derived(createFour21Game(match.rulesSnapshot.definition));
  const config = $derived(game.validateConfig(match.settingsSnapshot.engineConfig));
  const position = $derived(game.inspect(view.state, config));
  const extremes = $derived(four21Extremes(position));
  const pending = $derived(position.hands.length === config.ownerIds.length);
  const current = $derived(
    config.ownerIds[(position.starter + position.hands.length) % config.ownerIds.length]!,
  );
  const last = $derived(
    scoreSlots(view.audit)
      .filter((slot) => slot.command)
      .at(-1),
  );
  const status = $derived(view.projection.status);
  let dice = $state([1, 1, 1]);
  let throws = $state(1);
  let best = $state('');
  let worst = $state('');
  let saving = $state(false);
  let notice = $state('');
  let error = $state('');
  let prompt = $state<JournalAction | null>(null);
  let promptVersion = $state(0);
  let dialog: HTMLDialogElement;
  $effect(() => {
    void position.eventCount;
    throws = 1;
    best = '';
    worst = '';
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
        failure instanceof EngineError ? messages.four21.invalid : petanqueErrorMessage(failure);
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
      ownerId: pending ? config.ownerIds[position.starter]! : current,
      values: pending
        ? { best: config.ownerIds.indexOf(best), worst: config.ownerIds.indexOf(worst) }
        : { d1: dice[0]!, d2: dice[1]!, d3: dice[2]!, throws },
    });
  }
  const draft = entryDraft(
    () => `${match.id}:four21`,
    () => `${view.projection.lastEventSequence}:${view.projection.status}`,
    () => ({ dice, throws, best, worst }),
    (data) => {
      if (!data.dice.every((value) => Number.isInteger(value) && value >= 1 && value <= 6))
        return false;
      dice = data.dice;
      throws = data.throws;
      best = data.best;
      worst = data.worst;
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

<GameHeader renderer={header} {actions} />

<section class="game-play-area stack" aria-labelledby="four21-title">
  <h2 id="four21-title">{header ? messages.matches.scoreEntry : messages.four21.title}</h2>

  <EntrySituation {status}>
    <div class="situation-active">
      {#if pending}<h3>{messages.four21.tie}</h3>{:else}<h3>
          {messages.four21.turn(owner(current))}
        </h3>{/if}
    </div>
    <p>{messages.four21.phase(position.phase, position.pot)}</p>
  </EntrySituation>

  {#if status === 'in_progress'}
    {#if !selfOnly || (!pending && allowedOwnerIds?.includes(current))}
      <form class="stack" onsubmit={record}>
        {#if pending}
          <div class="game-field">
            <label for="421-best">{messages.four21.best}</label><select
              id="421-best"
              bind:value={best}
              required
              ><option value="">{messages.four21.choose}</option
              >{#each extremes.best as id (id)}<option value={id}>{owner(id)}</option
                >{/each}</select
            >
          </div>
          <div class="game-field">
            <label for="421-worst">{messages.four21.worst}</label><select
              id="421-worst"
              bind:value={worst}
              required
              ><option value="">{messages.four21.choose}</option
              >{#each extremes.worst as id (id)}<option value={id}>{owner(id)}</option
                >{/each}</select
            >
          </div>
        {:else}
          {#each [0, 1, 2] as index (index)}<div class="game-field">
              <label for={`421-die-${index}`}>{messages.yams.die(index + 1)}</label><select
                id={`421-die-${index}`}
                bind:value={dice[index]}
                >{#each [1, 2, 3, 4, 5, 6] as value (value)}<option {value}>{value}</option
                  >{/each}</select
              >
            </div>{/each}
          <p>{messages.four21.combination(combination421(dice).tokens)}</p>
          {#if position.phase === 'discharge'}<div class="game-field">
              <label for="421-throws">{messages.four21.throws}</label><select
                id="421-throws"
                bind:value={throws}
                >{#each [1, 2, 3].filter((n) => n <= (position.hands[0]?.throws ?? 3)) as value (value)}<option
                    {value}>{value}</option
                  >{/each}</select
              >
            </div>{/if}
        {/if}
        <ScorePreview
          {match}
          state={view.state}
          command={() => ({
            type: 'record',
            ownerId: pending ? config.ownerIds[position.starter]! : current,
            values: (pending
              ? { best: config.ownerIds.indexOf(best), worst: config.ownerIds.indexOf(worst) }
              : { d1: dice[0]!, d2: dice[1]!, d3: dice[2]!, throws }) as Record<string, number>,
          })}
        />
        <button class="button" disabled={saving || view.projection.lastEventSequence >= 1000}
          ><Icon name="check" />{messages.four21.record}</button
        >
      </form>{/if}
  {/if}
  {#if position.hands.length}<ul>
      {#each position.hands as hand (hand.ownerId)}<li>
          {owner(hand.ownerId)} : {hand.dice.join(' · ')} ({hand.throws})
        </li>{/each}
    </ul>{/if}
  {#if notice}<p role="status">{notice}</p>{/if}
  {#if error}<p role="alert" class="error">{error}</p>{/if}
</section>
<dialog
  bind:this={dialog}
  onclose={() => {
    prompt = null;
  }}
  aria-labelledby="421-confirm"
>
  <h2 id="421-confirm">{messages.four21.confirm}</h2>
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
  select {
    min-height: 44px;
  }
</style>
