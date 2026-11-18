<script lang="ts">
  import EntrySituation from './EntrySituation.svelte';
  import ScorePreview from './ScorePreview.svelte';
  import { entryDraft } from '../application/entry-draft.svelte';
  import GameRules from './GameRules.svelte';
  import Icon from './Icon.svelte';
  import GameHeader, { type HeaderRenderer } from './GameHeader.svelte';
  import { tick } from 'svelte';
  import type { MatchRecord } from '#lib/domain/records';
  import type { JournalAction, JournalView } from '#lib/domain/journal';
  import type { LocalDatabase } from '#lib/storage/database';
  import type { MatchJournal } from '#lib/storage/journal';
  import { PetanqueRepository } from '#lib/storage/petanque';
  import {
    petanqueCommand,
    petanqueProgress,
    petanqueSides,
    type EndCommand,
    type PetanqueEnd,
    type PetanqueEndSlot,
  } from '#lib/domain/games/petanque';
  import { petanqueErrorMessage } from '#lib/application/petanque-errors';
  import { petanqueEndLabel } from '#lib/application/petanque-labels';
  import { messages } from '#lib/i18n/index';
  import PetanqueEndPicker from './PetanqueEndPicker.svelte';

  let {
    match,
    view,
    journal,
    selfOnly = false,
    allowedOwnerIds,
    header,
    database,
    onrematch,
  }: {
    match: MatchRecord;
    view: JournalView;
    journal: Pick<MatchJournal, 'submit'>;
    selfOnly?: boolean;
    allowedOwnerIds?: readonly string[];
    header?: HeaderRenderer;
    database: LocalDatabase;
    onrematch?: (id: string) => void;
  } = $props();
  const sides = $derived(petanqueSides(match));
  const progress = $derived(petanqueProgress(match, view.audit));
  const status = $derived(view.projection.status);
  let end = $state<PetanqueEnd>({ type: 'points', teamId: '', points: 0 });
  let corrected = $state<PetanqueEnd>({ type: 'void' });
  let saving = $state(false);
  let notice = $state('');
  let error = $state('');
  let dialogError = $state('');
  let endPage = $state(0);
  $effect(() => {
    const lastPage = Math.max(0, Math.ceil(progress.active.length / 10) - 1);
    if (endPage > lastPage) endPage = lastPage;
  });
  let prompt = $state<'correct' | 'undo' | 'cancel' | 'rematch' | null>(null);
  let slot = $state<PetanqueEndSlot>();
  let expectedVersion = $state(0);
  let dialog: HTMLDialogElement;
  let opener: HTMLElement | null = null;
  let controlHeading: HTMLHeadingElement;
  const recentEnds = $derived(
    progress.active
      .slice()
      .reverse()
      .slice(endPage * 10, endPage * 10 + 10),
  );
  const limited = $derived(view.projection.lastEventSequence >= 1000);
  const rematchLabel = $derived(
    match.mode === 'individual' ? messages.petanque.rematchIndividual : messages.petanque.rematch,
  );
  const promptTitle = $derived(
    prompt === 'correct'
      ? messages.petanque.confirmCorrection
      : prompt === 'undo'
        ? messages.petanque.confirmUndo
        : prompt === 'cancel'
          ? messages.petanque.confirmCancel
          : rematchLabel,
  );
  function owner(id: string) {
    return sides.find((team) => team.id === id)?.name ?? id;
  }
  function description(command: EndCommand) {
    return petanqueEndLabel(match, command);
  }
  function asEnd(command: EndCommand): PetanqueEnd {
    return command.values.kind === 2
      ? {
          type: 'dead_jack',
          remaining: [command.values.remainingFirst!, command.values.remainingSecond!],
        }
      : command.values.kind === 1
        ? { type: 'void' }
        : { type: 'points', teamId: command.ownerId, points: command.values.points! };
  }
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
  async function act(action: JournalAction) {
    if (saving) return;
    saving = true;
    error = '';
    notice = '';
    try {
      await submit(action);
      notice = '';
    } catch (failure) {
      error = petanqueErrorMessage(failure);
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
      await submit(petanqueCommand(end, sides, match.settingsSnapshot.boulesPerPlayer as number));
      end = { type: 'points', teamId: '', points: 0 };
      notice = messages.petanque.saved;
    } catch (failure) {
      error = petanqueErrorMessage(failure);
    } finally {
      saving = false;
    }
  }
  async function confirm(kind: NonNullable<typeof prompt>, selected?: PetanqueEndSlot) {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    prompt = kind;
    slot = selected;
    expectedVersion = view.projection.lastEventSequence;
    dialogError = '';
    notice = '';
    if (selected?.command) corrected = asEnd(selected.command);
    await tick();
    dialog.showModal();
  }
  async function commit() {
    if (saving || !prompt) return;
    saving = true;
    dialogError = '';
    try {
      if (prompt === 'rematch') {
        if (!onrematch) return;
        const created = await new PetanqueRepository(database).rematch(match.id, {
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          expectedVersion,
        });
        dialog.close();
        onrematch(created.id);
      } else {
        const action: JournalAction =
          prompt === 'correct'
            ? {
                type: 'correct',
                targetEventId: slot!.revisionId,
                replacement: petanqueCommand(
                  corrected,
                  sides,
                  match.settingsSnapshot.boulesPerPlayer as number,
                ),
              }
            : prompt === 'undo'
              ? { type: 'undo', targetEventId: slot!.revisionId }
              : { type: 'cancel' };
        await submit(action, expectedVersion);
        dialog.close();
        notice = '';
      }
    } catch (failure) {
      dialogError = petanqueErrorMessage(failure);
    } finally {
      saving = false;
    }
  }
  const draft = entryDraft(
    () => `${match.id}:petanque`,
    () => `${view.projection.lastEventSequence}:${view.projection.status}`,
    () => ({
      type: end.type,
      teamId: end.type === 'points' ? end.teamId : '',
      points: end.type === 'points' ? end.points : 0,
      remaining: end.type === 'dead_jack' ? [...end.remaining] : [0, 0],
    }),
    (data) => {
      if (data.type === 'points')
        end = { type: 'points', teamId: data.teamId, points: data.points };
      else if (data.type === 'void') end = { type: 'void' };
      else if (data.type === 'dead_jack')
        end = { type: 'dead_jack', remaining: [data.remaining[0]!, data.remaining[1]!] };
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
    {#if status === 'paused'}<button
        class="button"
        disabled={saving || limited}
        onclick={() => act({ type: 'resume' })}
        ><Icon name="play" />{messages.matches.resume}</button
      >{/if}
    {#if progress.active.length && status !== 'cancelled'}<button
        class="button secondary"
        disabled={saving || limited}
        onclick={() => confirm('undo', progress.active.at(-1)!)}
        ><Icon name="undo" />{messages.four21.undo}</button
      >{/if}
    {#if status === 'in_progress'}<button
        class="button secondary"
        disabled={saving || limited}
        onclick={() => act({ type: 'pause' })}><Icon name="pause" />{messages.matches.pause}</button
      >{/if}
    {#if status === 'draft' || status === 'in_progress' || status === 'paused'}<button
        class="button secondary"
        disabled={saving || limited}
        onclick={() => confirm('cancel')}><Icon name="cancel" />{messages.matches.cancel}</button
      >
    {:else if onrematch}<button class="button" disabled={saving} onclick={() => confirm('rematch')}
        ><Icon name="replay" />{rematchLabel}</button
      >{/if}
  {/if}
{/snippet}

{#snippet rules()}
  <GameRules {match}>
    <h3>{messages.petanque.roster}</h3>
    <ul class="team-members">
      {#each sides as team (team.id)}<li>
          <strong>{team.name}</strong><span
            >{team.playerIds
              .map(
                (id) => match.playersSnapshot.find((player) => player.id === id)?.displayName ?? id,
              )
              .join(' · ')}</span
          >
        </li>{/each}
    </ul>
  </GameRules>
{/snippet}

<GameHeader renderer={header} {actions} {rules} />

<section class="game-play-area match-controls" aria-labelledby="petanque-controls-title">
  <h2 id="petanque-controls-title" bind:this={controlHeading} tabindex="-1">
    {header ? messages.matches.scoreEntry : messages.petanque.controls}
  </h2>

  <EntrySituation {status}>
    <p>
      {messages.petanque.targetPoints(match.settingsSnapshot.target as number)} · {messages.petanque.roundCount(
        progress.active.length,
      )}
    </p>
    {#if status !== 'finished' && status !== 'cancelled'}<p>
        {messages.petanque.nextThrow(owner(progress.nextThrowOwnerId))}
      </p>{/if}
  </EntrySituation>
  {#if limited}<p class="notice">{messages.petanque.limit}</p>{/if}

  {#if status === 'paused'}<p>{messages.petanque.paused}</p>{/if}
  {#if status === 'in_progress'}<form onsubmit={record} aria-label={messages.petanque.record}>
      <PetanqueEndPicker
        teams={selfOnly ? sides.filter((side) => allowedOwnerIds?.includes(side.id)) : sides}
        pointsOnly={selfOnly}
        boulesPerPlayer={match.settingsSnapshot.boulesPerPlayer as number}
        bind:end
        prefix="current-end"
        disabled={saving || limited}
      />
      <ScorePreview
        {match}
        state={view.state}
        command={() =>
          petanqueCommand(end, sides, match.settingsSnapshot.boulesPerPlayer as number)}
      />
      <button class="button" disabled={saving || limited}
        ><Icon name="check" />{saving ? messages.petanque.saving : messages.petanque.record}</button
      >
    </form>{/if}
  {#if notice}<p role="status" class="profile-notice">{notice}</p>{/if}
  <p role="alert" class="error">{error}</p>
  {#if progress.active.length && status !== 'cancelled'}
    <h3>{messages.petanque.ends}</h3>
    <ul class="end-history">
      {#each recentEnds as current (current.revisionId)}<li>
          <p>
            <strong>{messages.petanque.end(current.number)}</strong> — {description(
              current.command!,
            )}
          </p>
          {#if !selfOnly}
            <div class="profile-actions">
              <button
                class="button secondary"
                disabled={saving || limited}
                onclick={() => confirm('correct', current)}
                ><Icon name="edit" />{messages.petanque.correct(current.number)}</button
              >
              <button
                class="button secondary"
                disabled={saving || limited}
                onclick={() => confirm('undo', current)}
                ><Icon name="undo" />{messages.petanque.undo(current.number)}</button
              >
            </div>{/if}
        </li>{/each}
    </ul>
    {#if progress.active.length > 10}<div
        class="profile-pagination"
        role="group"
        aria-label={messages.players.pagination}
      >
        <button class="button secondary" disabled={endPage === 0} onclick={() => endPage--}
          ><Icon name="arrow-left" />{messages.players.previous}</button
        >
        <span>{messages.players.page(endPage + 1)}</span><button
          class="button secondary"
          disabled={(endPage + 1) * 10 >= progress.active.length}
          onclick={() => endPage++}><Icon name="arrow-right" />{messages.players.next}</button
        >
      </div>{/if}
  {/if}
</section>
<dialog
  bind:this={dialog}
  aria-labelledby="petanque-confirm-title"
  oncancel={(event) => {
    if (saving) event.preventDefault();
  }}
  onclose={() => {
    prompt = null;
    if (opener?.isConnected) opener.focus();
    else controlHeading?.focus();
  }}
>
  <h2 id="petanque-confirm-title">{promptTitle}</h2>
  <p>
    {prompt === 'cancel'
      ? messages.petanque.cancelHelp
      : prompt === 'rematch'
        ? messages.petanque.rematchHelp
        : messages.petanque.correctionHelp}
  </p>
  {#if slot?.command && (prompt === 'correct' || prompt === 'undo')}<p>
      {messages.petanque.end(slot.number)} — {description(slot.command)}
    </p>{/if}
  {#if prompt === 'correct'}<PetanqueEndPicker
      teams={sides}
      boulesPerPlayer={match.settingsSnapshot.boulesPerPlayer as number}
      bind:end={corrected}
      prefix="correct-end"
      disabled={saving}
    />{/if}
  <p role="alert" class="error">{dialogError}</p>
  <div class="form-actions">
    <button class="button" disabled={saving} onclick={commit}
      ><Icon name="check" />{saving ? messages.petanque.saving : messages.petanque.confirm}</button
    >
    <button class="button secondary" disabled={saving} onclick={() => dialog.close()}
      ><Icon name="close" />{messages.players.cancel}</button
    >
  </div>
</dialog>

<style>
  .match-controls {
    display: grid;
    gap: var(--space-4);
    overflow-wrap: anywhere;
  }
  .match-controls > p {
    margin-top: 0;
  }
  .end-history {
    list-style: none;
    padding: 0;
    display: grid;
    gap: var(--space-3);
    margin-top: var(--space-3);
  }
  .end-history li {
    border-top: 1px solid var(--border);
    padding-top: 0.8rem;
  }
</style>
