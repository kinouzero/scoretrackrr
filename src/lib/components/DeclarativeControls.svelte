<script lang="ts">
  import EntrySituation from './EntrySituation.svelte';
  import ScorePreview from './ScorePreview.svelte';
  import { entryDraft } from '../application/entry-draft.svelte';
  import GameRules from './GameRules.svelte';
  import Icon from './Icon.svelte';
  import GameHeader, { type HeaderRenderer } from './GameHeader.svelte';
  import { tick } from 'svelte';
  import type { MatchRecord } from '#lib/domain/records';
  import type { ScoreCommand } from '#lib/domain/engine/types';
  import type { JournalAction, JournalView, AuditEntry } from '#lib/domain/journal';
  import type { LocalDatabase } from '#lib/storage/database';
  import type { MatchJournal } from '#lib/storage/journal';
  import { createDeclarativeGame } from '#lib/domain/engine/declarative';
  import { petanqueErrorMessage } from '#lib/application/petanque-errors';
  import { EngineError } from '#lib/domain/engine/types';
  import { messages } from '#lib/i18n/index';
  import ScoreFields from './ScoreFields.svelte';
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
  const game = $derived(createDeclarativeGame(match.rulesSnapshot.definition));
  const config = $derived(game.validateConfig(match.settingsSnapshot.engineConfig));
  const owners = $derived(
    config.ownerIds.map((id) => ({
      id,
      name:
        match.teamsSnapshot.find((team) => team.id === id)?.name ??
        match.playersSnapshot.find((player) => player.id === id)?.displayName ??
        id,
    })),
  );
  const status = $derived(view.projection.status);
  const selectableOwners = $derived(
    owners.filter((owner) => !allowedOwnerIds || allowedOwnerIds.includes(owner.id)),
  );
  const roundIndex = $derived(Math.floor(view.state.eventCount / config.ownerIds.length));
  const nextOwner = $derived(owners[view.state.eventCount % owners.length]!);
  $effect(() => {
    if (game.definition.turns && ownerId !== nextOwner.id) ownerId = nextOwner.id;
    else if (view.state.eventCount === 0 && !ownerId) ownerId = selectableOwners[0]?.id ?? '';
  });
  const defaults = $derived(
    Object.fromEntries(
      game.definition.fields.map((field) => [
        field.id,
        Math.max(field.minimum, Math.min(field.maximum, 0)),
      ]),
    ),
  );
  let ownerId = $state('');
  let values = $state<Record<string, number>>({});
  let editOwner = $state('');
  let editValues = $state<Record<string, number>>({});
  let saving = $state(false);
  let error = $state('');
  let notice = $state('');
  let dialog: HTMLDialogElement;
  let dialogError = $state('');
  let prompt = $state<JournalAction | 'correct' | null>(null);
  let target = $state('');
  let expectedVersion = $state(0);
  let opener: HTMLElement | null = null;
  let heading: HTMLHeadingElement;
  const limited = $derived(view.projection.lastEventSequence >= 1000);
  const editable = $derived(
    view.audit
      .filter(
        (entry) =>
          !entry.supersededBy &&
          (entry.action.type === 'record' ||
            entry.action.type === 'correct' ||
            entry.action.type === 'finish'),
      )
      .slice()
      .reverse(),
  );
  let pageIndex = $state(0);
  $effect(() => {
    if (!Object.keys(values).length) values = { ...defaults };
  });
  $effect(() => {
    const max = Math.max(0, Math.ceil(editable.length / 10) - 1);
    if (pageIndex > max) pageIndex = max;
  });
  async function submit(action: JournalAction, version = view.projection.lastEventSequence) {
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
  }
  function message(failure: unknown) {
    return failure instanceof EngineError
      ? messages.generic.invalid
      : petanqueErrorMessage(failure);
  }
  async function act(action: JournalAction) {
    if (saving) return;
    saving = true;
    error = '';
    notice = '';
    try {
      await submit(action);
      notice = '';
    } catch (failure) {
      error = message(failure);
    } finally {
      saving = false;
    }
  }
  async function record(event: SubmitEvent) {
    event.preventDefault();
    if (saving) return;
    saving = true;
    error = '';
    notice = '';
    try {
      await submit({ type: 'record', ownerId, values });
      ownerId = '';
      values = { ...defaults };
      notice = messages.generic.saved;
    } catch (failure) {
      error = message(failure);
    } finally {
      saving = false;
    }
  }
  async function confirm(action: JournalAction | 'correct', entry?: AuditEntry) {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    prompt = action;
    expectedVersion = view.projection.lastEventSequence;
    dialogError = '';
    target = entry?.event.id ?? '';
    if (entry) {
      const command =
        entry.action.type === 'record'
          ? entry.action
          : entry.action.type === 'correct'
            ? entry.action.replacement
            : undefined;
      if (command) {
        editOwner = command.ownerId;
        editValues = { ...command.values };
      }
    }
    await tick();
    dialog.showModal();
  }
  async function commit() {
    if (saving || !prompt) return;
    saving = true;
    dialogError = '';
    try {
      const action: JournalAction =
        prompt === 'correct'
          ? {
              type: 'correct',
              targetEventId: target,
              replacement: { type: 'record', ownerId: editOwner, values: editValues },
            }
          : prompt;
      await submit(action, expectedVersion);
      dialog.close();
      notice = '';
    } catch (failure) {
      dialogError = message(failure);
    } finally {
      saving = false;
    }
  }
  function label(entry: AuditEntry) {
    const action: ScoreCommand | undefined =
      entry.action.type === 'record' || entry.action.type === 'finish'
        ? entry.action
        : entry.action.type === 'correct'
          ? entry.action.replacement
          : undefined;
    if (!action || action.type === 'finish') return messages.matches.finish;
    return messages.matches.record(
      owners.find((owner) => owner.id === action.ownerId)?.name ?? action.ownerId,
      Object.values(action.values).join(' · '),
    );
  }
  const draft = entryDraft(
    () => `${match.id}:declarative`,
    () => `${view.projection.lastEventSequence}:${view.projection.status}`,
    () => ({ ownerId, values }),
    (data) => {
      ownerId = data.ownerId;
      values = data.values;
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
        disabled={saving || limited}
        onclick={() => act({ type: 'start' })}><Icon name="play" />{messages.matches.start}</button
      >{/if}
    {#if status === 'in_progress'}<button
        class="button secondary"
        disabled={saving || limited}
        onclick={() => act({ type: 'pause' })}><Icon name="pause" />{messages.matches.pause}</button
      >
      {#if game.definition.objective.target === undefined && !game.definition.turns}<button
          class="button secondary"
          disabled={saving || limited || !view.state.eventCount}
          onclick={() => confirm({ type: 'finish' })}
          ><Icon name="flag" />{messages.matches.finish}</button
        >{/if}{/if}
    {#if status === 'paused'}<button
        class="button"
        disabled={saving || limited}
        onclick={() => act({ type: 'resume' })}
        ><Icon name="play" />{messages.matches.resume}</button
      >{/if}
    {#if status !== 'cancelled' && status !== 'finished'}<button
        class="button secondary"
        disabled={saving || limited}
        onclick={() => confirm({ type: 'cancel' })}
        ><Icon name="cancel" />{messages.matches.cancel}</button
      >{/if}
  {/if}
{/snippet}

{#snippet rules()}
  <GameRules {match} />
{/snippet}

<GameHeader renderer={header} {actions} {rules} />

<section class="game-play-area generic-controls" aria-labelledby="generic-controls-title">
  <h2 id="generic-controls-title" bind:this={heading} tabindex="-1">
    {header ? messages.matches.scoreEntry : messages.generic.controls}
  </h2>

  <EntrySituation {status}>
    {#if game.definition.turns && status !== 'finished' && status !== 'cancelled'}<p
        aria-live="polite"
      >
        {messages.builder.turn(
          roundIndex + 1,
          game.definition.turns.rounds,
          nextOwner.name,
          game.definition.turns.categories?.[roundIndex],
        )}
      </p>{/if}
  </EntrySituation>
  {#if limited}<p>{messages.petanque.limit}</p>{/if}
  {#if status === 'in_progress' && (!game.definition.turns || selectableOwners.some((owner) => owner.id === nextOwner.id))}<form
      onsubmit={record}
      aria-label={messages.generic.record}
    >
      <ScoreFields
        fields={game.definition.fields}
        owners={game.definition.turns ? [nextOwner] : selectableOwners}
        bind:ownerId
        bind:values
        prefix="score-entry"
        disabled={saving || limited}
      />
      <ScorePreview
        {match}
        state={view.state}
        command={() => ({ type: 'record', ownerId, values })}
      />
      <button class="button" disabled={saving || limited}
        ><Icon name="check" />{saving ? messages.petanque.saving : messages.generic.record}</button
      >
    </form>{/if}
  {#if notice}<p role="status">{notice}</p>{/if}
  <p role="alert" class="error">{error}</p>
  {#if status !== 'cancelled'}<ul class="generic-history">
      {#each editable.slice(pageIndex * 10, pageIndex * 10 + 10) as entry (entry.event.id)}<li>
          <p>{messages.matches.actionNumber(entry.event.sequence)} — {label(entry)}</p>
          {#if !selfOnly}<div class="profile-actions">
              {#if entry.action.type !== 'finish'}<button
                  class="button secondary"
                  disabled={saving || limited}
                  onclick={() => confirm('correct', entry)}
                  ><Icon name="edit" />{messages.generic.correct}</button
                >{/if}
              <button
                class="button secondary"
                disabled={saving || limited}
                onclick={() => confirm({ type: 'undo', targetEventId: entry.event.id }, entry)}
                ><Icon name="undo" />{messages.generic.undo}</button
              >
            </div>{/if}
        </li>{/each}
    </ul>{/if}
  {#if editable.length > 10}<div class="profile-pagination">
      <button class="button secondary" disabled={pageIndex === 0} onclick={() => pageIndex--}
        ><Icon name="arrow-left" />{messages.players.previous}</button
      ><span>{messages.players.page(pageIndex + 1)}</span><button
        class="button secondary"
        disabled={(pageIndex + 1) * 10 >= editable.length}
        onclick={() => pageIndex++}><Icon name="arrow-right" />{messages.players.next}</button
      >
    </div>{/if}
</section>
<dialog
  bind:this={dialog}
  aria-labelledby="generic-confirm-title"
  oncancel={(event) => {
    if (saving) event.preventDefault();
  }}
  onclose={() => {
    prompt = null;
    if (opener?.isConnected) opener.focus();
    else heading?.focus();
  }}
>
  <h2 id="generic-confirm-title">{messages.generic.confirm}</h2>
  <p>
    {prompt !== 'correct' && prompt?.type === 'cancel'
      ? messages.petanque.cancelHelp
      : prompt !== 'correct' && prompt?.type === 'finish'
        ? messages.generic.finishHelp
        : messages.petanque.correctionHelp}
  </p>
  {#if prompt === 'correct'}<ScoreFields
      fields={game.definition.fields}
      {owners}
      bind:ownerId={editOwner}
      bind:values={editValues}
      prefix="score-correction"
      disabled={saving}
    />{/if}
  <p class="error" role="alert">{dialogError}</p>
  <div class="form-actions">
    <button class="button" disabled={saving} onclick={commit}
      ><Icon name="check" />{messages.petanque.confirm}</button
    >
    <button class="button secondary" disabled={saving} onclick={() => dialog.close()}
      ><Icon name="close" />{messages.players.cancel}</button
    >
  </div>
</dialog>

<style>
  .generic-controls {
    display: grid;
    gap: var(--space-4);
  }
  .generic-controls > p {
    margin-top: 0;
  }
  .generic-history {
    list-style: none;
    padding: 0;
  }
  .generic-history li {
    margin-top: var(--space-3);
    border-top: 1px solid var(--border);
    padding-top: 0.8rem;
  }
</style>
