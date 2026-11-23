<script lang="ts">
  import { translate } from '#lib/i18n/catalog';
  import { isScoreSheet } from '#lib/domain/games/score-sheets';
  import TableMode from '#lib/components/TableMode.svelte';
  import Icon from '#lib/components/Icon.svelte';
  import { onMount, tick, untrack, type Snippet } from 'svelte';
  import { SvelteDate } from 'svelte/reactivity';
  import GameControls from '#lib/components/GameControls.svelte';
  import GameRules from '#lib/components/GameRules.svelte';
  import JournalTimeline from '#lib/components/JournalTimeline.svelte';
  import GameIcon from '#lib/components/GameIcon.svelte';
  import { catalogGameId } from '#lib/domain/games/catalog';
  import { browser } from '$app/env';
  import { page } from '$app/state';
  import { resolve } from '$app/paths';
  import { goto } from '$app/navigation';
  import type { MatchRecord } from '#lib/domain/records';
  import type { AuditEntry } from '#lib/domain/journal';
  import type { MatchJournal, JournalSubmission } from '#lib/storage/journal';
  import type { LocalDatabase } from '#lib/storage/database';
  import { journalErrorMessage } from '#lib/application/journal-errors';
  import { StorageError } from '#lib/storage/errors';
  import type { HistoryCursor } from '#lib/domain/history';
  import { historyGameName } from '#lib/i18n/presentation';
  import MatchOptions from '#lib/components/MatchOptions.svelte';
  import EmptyState from '#lib/components/EmptyState.svelte';
  import PetanqueSetup from '#lib/components/PetanqueSetup.svelte';
  import TeamAvatar from '#lib/components/TeamAvatar.svelte';
  import PlayerAvatar from '#lib/components/PlayerAvatar.svelte';
  import DeclarativeSetup from '#lib/components/DeclarativeSetup.svelte';
  import { flip7Score } from '#lib/domain/games/flip7';
  import { yamsScoreLabel } from '#lib/application/yams-labels';
  import { petanqueEndLabel } from '#lib/application/petanque-labels';
  import { messages, getLocale } from '#lib/i18n/index';
  import { resumePausedMatch } from '#lib/application/resume-match';
  import { getMatchNavigation } from '#lib/application/match-navigation';

  const navigation = getMatchNavigation();

  let journal = $state.raw<MatchJournal>();
  let database = $state.raw<LocalDatabase>();
  let currentDeviceId = $state('');
  let observe = $state<typeof import('dexie').liveQuery>();
  let matches = $state<MatchRecord[]>([]);
  let detail = $state<Awaited<ReturnType<MatchJournal['inspect']>>>();
  let loading = $state(true);
  let error = $state('');
  let retry = $state(0);
  let pageIndex = $state(0);
  let auditPage = $state(0);
  let hasMore = $state(false);
  let historySearch = $state('');
  let historyStatus = $state('');
  let actionDialog = $state<HTMLDialogElement>();
  let pendingAction = $state<{ kind: 'cancel' | 'delete'; match: MatchRecord }>();
  let actionError = $state('');
  let savingAction = $state(false);
  let openingMatchId = $state('');
  let rematching = $state(false);
  let rematchError = $state('');
  async function revenge() {
    if (!database || !detail || rematching) return;
    rematching = true;
    rematchError = '';
    const current = detail;
    try {
      const { createRematch } = await import('#lib/storage/rematch');
      const created = await createRematch(database, {
        sourceId: current.match.id,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        expectedVersion: current.match.version,
        actorPlayerId: current.journal.authority.playerId,
        deviceId: currentDeviceId,
      });
      await openMatch(created.id);
    } catch (failure) {
      rematchError =
        failure instanceof StorageError
          ? failure.code === 'conflict'
            ? messages.matches.actionConflict
            : failure.code === 'quota_exceeded'
              ? messages.settings.quota
              : failure.code === 'unauthorized'
                ? messages.matches.actionDenied
                : failure.code === 'invalid_record' || failure.code === 'missing_reference'
                  ? messages.matches.rematchUnavailable
                  : journalErrorMessage(failure)
          : journalErrorMessage(failure);
    } finally {
      rematching = false;
    }
  }
  let listActionError = $state('');

  async function submitGameAction(input: JournalSubmission) {
    const result = await journal!.submit(input);
    if (result.projection.status === 'paused' || result.projection.status === 'cancelled') {
      if (detail?.match.id === input.matchId) detail = await journal!.inspect(input.matchId);
      await navigation.returnToList(input.matchId);
      if (result.projection.status === 'cancelled') detail = undefined;
    }
    return result;
  }

  async function resumeMatch(match: MatchRecord) {
    if (!journal || openingMatchId) return;
    openingMatchId = match.id;
    listActionError = '';
    try {
      await resumePausedMatch(journal, match, currentDeviceId);
      await goto(resolve(`/matches?match=${encodeURIComponent(match.id)}`));
    } catch (failure) {
      listActionError =
        failure instanceof StorageError
          ? failure.code === 'conflict' || failure.code === 'missing_reference'
            ? messages.matches.actionConflict
            : failure.code === 'quota_exceeded'
              ? messages.settings.quota
              : failure.code === 'unauthorized'
                ? messages.matches.actionDenied
                : journalErrorMessage(failure)
          : journalErrorMessage(failure);
    } finally {
      openingMatchId = '';
    }
  }
  let actionOpener: HTMLElement | null = null;

  async function confirmMatchAction(
    kind: 'cancel' | 'delete',
    match: MatchRecord,
    opener: HTMLElement,
  ) {
    actionOpener = opener;
    pendingAction = { kind, match };
    actionError = '';
    await tick();
    actionDialog?.showModal();
  }

  async function closeMatchAction() {
    pendingAction = undefined;
    await tick();
    if (actionOpener?.isConnected) actionOpener.focus();
    else document.getElementById('history-search')?.focus();
  }

  async function commitMatchAction() {
    if (!journal || !pendingAction || savingAction) return;
    savingAction = true;
    actionError = '';
    const { kind, match } = pendingAction;
    try {
      const view = await journal.read(match.id);
      const input = {
        matchId: match.id,
        expectedVersion: match.version,
        actorPlayerId: view.authority.playerId,
        deviceId: currentDeviceId,
      };
      if (kind === 'delete') await journal.deleteMatch(input);
      else
        await journal.submit({
          ...input,
          eventId: crypto.randomUUID(),
          commandId: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          action: { type: 'cancel' },
        });
      if (detail?.match.id === match.id) detail = undefined;
      resetHistory();
      retry++;
      actionDialog?.close();
    } catch (failure) {
      actionError =
        failure instanceof StorageError
          ? failure.code === 'conflict' || failure.code === 'missing_reference'
            ? messages.matches.actionConflict
            : failure.code === 'unauthorized'
              ? messages.matches.actionDenied
              : failure.code === 'quota_exceeded'
                ? messages.settings.quota
                : messages.matches.error
          : journalErrorMessage(failure);
    } finally {
      savingAction = false;
    }
  }
  const historyCursors: (HistoryCursor | undefined)[] = [];
  function resetHistory() {
    historyCursors.length = 0;
    pageIndex = 0;
  }
  const selected = $derived(browser ? page.url.searchParams.get('match') : null);
  const creating = $derived(browser && page.url.searchParams.get('new') === 'petanque');
  const creatingDeclarative = $derived(
    browser && page.url.searchParams.get('new') === 'declarative',
  );
  const entries = $derived(
    detail?.journal.audit
      .slice()
      .reverse()
      .slice(auditPage * 20, auditPage * 20 + 20) ?? [],
  );
  const number = $derived(new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 12 }));
  const date = $derived(
    new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium', timeStyle: 'short' }),
  );

  onMount(() => {
    let active = true;
    let connection: LocalDatabase | undefined;
    void (async () => {
      try {
        const [storage, adapter, dexie] = await Promise.all([
          import('#lib/storage/database'),
          import('#lib/storage/journal'),
          import('dexie'),
        ]);
        if (!active) return;
        connection = new storage.LocalDatabase();
        database = connection;
        currentDeviceId = await connection.readOrCreateDeviceId(crypto.randomUUID());
        observe = dexie.liveQuery;
        journal = new adapter.MatchJournal(database);
      } catch (failure) {
        if (active) {
          error = journalErrorMessage(failure);
          loading = false;
        }
      }
    })();
    return () => {
      active = false;
      connection?.close();
    };
  });

  $effect(() => {
    const adapter = journal;
    const watch = observe;
    const id = selected;
    const currentPage = pageIndex;
    const filters = {
      search: historySearch,
      status: historyStatus,
    };
    const cursor = historyCursors[currentPage];
    void retry;
    if (!adapter || !watch) return;
    loading = true;
    error = '';
    rematchError = '';
    untrack(() => {
      if (id && detail?.match.id !== id) detail = undefined;
    });
    auditPage = 0;
    const subscription = watch(async () =>
      id
        ? { detail: await adapter.inspect(id), items: [], hasMore: false, nextCursor: undefined }
        : { detail: undefined, ...(await adapter.history(filters, cursor)) },
    ).subscribe({
      next(result) {
        matches = result.items;
        hasMore = result.hasMore;
        historyCursors[currentPage + 1] = result.nextCursor;
        if (result.detail) detail = result.detail;
        loading = false;
      },
      error(failure) {
        error = journalErrorMessage(failure);
        loading = false;
      },
    });
    return () => subscription.unsubscribe();
  });

  function owner(id: string): string {
    return (
      detail?.match.teamsSnapshot.find((team) => team.id === id)?.name ??
      detail?.match.playersSnapshot.find((player) => player.id === id)?.displayName ??
      id
    );
  }
  function sequence(id: string): number {
    return detail?.journal.audit.find((entry) => entry.event.id === id)?.event.sequence ?? 0;
  }
  function label(entry: AuditEntry): string {
    const action = entry.action;
    const sheet = detail?.match;
    if (sheet && isScoreSheet(sheet.rulesSnapshot.gameId) && action.type === 'record') {
      const { ownerIds } = sheet.settingsSnapshot.engineConfig as { ownerIds: string[] };
      return translate(getLocale(), 'scoreSheet.history', {
        round: action.values.round!,
        scores: ownerIds
          .map((id, i) => `${owner(id)} ${number.format(action.values[`p${i}`]!)}`)
          .join(' · '),
      });
    }
    const record = (command: Extract<typeof action, { type: 'record' }>) =>
      detail?.match.rulesSnapshot.gameId === 'petanque'
        ? petanqueEndLabel(detail.match, command)
        : detail?.match.rulesSnapshot.gameId === 'times-up'
          ? messages.timesUp.entry(
              owner(command.ownerId),
              command.values.kind!,
              command.values.points,
            )
          : detail?.match.rulesSnapshot.gameId === '6-qui-prend'
            ? command.values.nextRound
              ? messages.sixNimmt.nextEntry(command.values.round! + 1)
              : messages.sixNimmt.entry(
                  owner(command.ownerId),
                  command.values.round!,
                  command.values.points!,
                )
            : detail?.match.rulesSnapshot.gameId === 'molkky'
              ? messages.molkky.entry(owner(command.ownerId), command.values.points!)
              : detail?.match.rulesSnapshot.gameId === 'flip-7'
                ? command.values.nextRound === 1
                  ? messages.skull.nextEntry(command.values.round!)
                  : messages.flip.entry(
                      owner(command.ownerId),
                      command.values.round!,
                      flip7Score({
                        cards: command.values.cards!,
                        modifiers: command.values.modifiers!,
                        double: command.values.double!,
                        bust: command.values.bust!,
                      }),
                    )
                : detail?.match.rulesSnapshot.gameId === 'skull-king'
                  ? command.values.nextRound === 1
                    ? messages.skull.nextEntry(command.values.round!)
                    : messages.skull.entry(
                        owner(command.ownerId),
                        command.values.round!,
                        command.values.kind!,
                        command.values.kind === 0 ? command.values.bid! : command.values.won!,
                      )
                  : detail?.match.rulesSnapshot.gameId === 'darts'
                    ? Object.hasOwn(command.values, 'nextLeg')
                      ? messages.dartsMatch.nextEntry(owner(command.ownerId))
                      : Object.hasOwn(command.values, 'total')
                        ? messages.darts.visitEntry(
                            owner(command.ownerId),
                            command.values.total!,
                            command.values.checkout!,
                          )
                        : messages.darts.entry(
                            owner(command.ownerId),
                            command.values.sector!,
                            command.values.multiplier!,
                          )
                    : detail?.match.rulesSnapshot.gameId === '5000-10000'
                      ? messages.farkle.entry(
                          owner(command.ownerId),
                          command.values.kind!,
                          Object.entries(command.values)
                            .filter(([key]) => /^d[1-6]$/.test(key))
                            .map(([, value]) => value)
                            .join(' · '),
                        )
                      : detail?.match.rulesSnapshot.gameId === '421'
                        ? command.values.d1 === undefined
                          ? messages.four21.tiebreak(
                              owner(
                                (
                                  detail.match.settingsSnapshot.engineConfig as {
                                    ownerIds: string[];
                                  }
                                ).ownerIds[command.values.best!]!,
                              ),
                              owner(
                                (
                                  detail.match.settingsSnapshot.engineConfig as {
                                    ownerIds: string[];
                                  }
                                ).ownerIds[command.values.worst!]!,
                              ),
                            )
                          : messages.four21.entry(
                              owner(command.ownerId),
                              [command.values.d1, command.values.d2, command.values.d3].join(' · '),
                              command.values.throws!,
                            )
                        : detail?.match.rulesSnapshot.gameId === 'yams'
                          ? yamsScoreLabel(detail.match, command)
                          : messages.matches.record(
                              owner(command.ownerId),
                              Object.values(command.values)
                                .map((value) => number.format(value))
                                .join(' · '),
                            );
    if (action.type === 'authority_transfer')
      return messages.sharing.transferEntry(owner(action.playerId));
    if (action.type === 'record') return record(action);
    if (action.type === 'correct')
      return messages.matches.correct(sequence(action.targetEventId), record(action.replacement));
    if (action.type === 'undo') return messages.matches.undo(sequence(action.targetEventId));
    return messages.matches[action.type];
  }
  function matchParticipants(match: MatchRecord) {
    const grouped = new Set(match.teamsSnapshot.flatMap((team) => team.playerIds));
    return [
      ...match.teamsSnapshot.map((team) => team.name),
      ...match.playersSnapshot
        .filter((player) => !grouped.has(player.id))
        .map((player) => player.displayName),
    ].join(' · ');
  }
  function openMatch(id: string) {
    return goto(resolve(`/matches?match=${encodeURIComponent(id)}`));
  }
</script>

<svelte:head
  ><title
    >{selected && detail ? historyGameName(detail.match) : messages.nav.matches} · {messages.appName}</title
  ></svelte:head
>
{#if !selected && !creating && !creatingDeclarative && (!navigation.ready || navigation.activeMatch)}
  <p role="status">{messages.matches.loading}</p>
{:else}
  {#if !selected}
    <div class="page-heading collection-heading">
      <div>
        <p class="eyebrow">{messages.nav.matches}</p>
        <h1>{messages.matches.title}</h1>
        <p>{messages.matches.intro}</p>
      </div>
      {#if !selected}<a class="button" href={resolve('/games')}
          ><Icon name="plus" />{messages.matches.create}</a
        >{/if}
    </div>
  {:else}
    <header
      class="match-page-heading"
      class:darts-heading={detail?.match.rulesSnapshot.gameId === 'darts' &&
        detail.journal.projection.status === 'in_progress'}
    >
      {#if !loading && (error || detail?.journal.projection.status !== 'in_progress')}
        <a class="button secondary match-back" href={resolve('/matches')}
          ><Icon name="arrow-left" />{messages.matches.back}</a
        >
      {/if}
      {#if detail && !error}
        <div class="match-identity" data-game={catalogGameId(detail.match.rulesSnapshot)}>
          <span class="game-art"><GameIcon game={catalogGameId(detail.match.rulesSnapshot)} /></span
          >
          <div class="match-identity-copy">
            <h1>{historyGameName(detail.match)}</h1>
            <span class="badge match-status" data-status={detail.journal.projection.status}
              >{messages.matches.statuses[detail.journal.projection.status]}</span
            >
          </div>
        </div>
      {/if}
    </header>
  {/if}
  {#if !selected}<div class="panel collection-filters history-search-controls">
      <div class="filter-field">
        <label for="history-search">{messages.history.search}</label><input
          id="history-search"
          type="search"
          bind:value={historySearch}
          placeholder={messages.history.searchPlaceholder}
          oninput={resetHistory}
          maxlength="120"
        />
      </div>
      <div class="filter-field">
        <label for="history-status">{messages.history.status}</label><select
          id="history-status"
          bind:value={historyStatus}
          onchange={resetHistory}
          ><option value="">{messages.history.all}</option
          >{#each ['draft', 'in_progress', 'paused', 'finished', 'cancelled'] as status (status)}<option
              value={status}
              >{messages.matches.statuses[status as keyof typeof messages.matches.statuses]}</option
            >{/each}</select
        >
      </div>
    </div>{/if}
  {#if error}<div class="notice error" role="alert">
      <p>{error}</p>
      <button class="button secondary" onclick={() => retry++}
        ><Icon name="replay" />{messages.players.retry}</button
      >
    </div>{/if}
  {#if listActionError}<p class="notice error" role="alert">{listActionError}</p>{/if}
  {#if loading}<p role="status">{messages.matches.loading}</p>
  {:else if !selected && !error && matches.length === 0}
    <EmptyState icon="matches" title={messages.matches.empty} detail={messages.matches.detail} />
  {:else if !selected && !error}
    <ul class="match-list collection-list" aria-label={messages.matches.list}>
      {#each matches as match (match.id)}
        <li>
          <article class="panel match-card" data-game={catalogGameId(match.rulesSnapshot)}>
            <span class="game-art"><GameIcon game={catalogGameId(match.rulesSnapshot)} /></span>
            <div class="match-card-body">
              <h2>{historyGameName(match)}</h2>
              <p>{matchParticipants(match)}</p>
              <MatchOptions {match} compact />
              <div class="match-card-meta">
                <span class="badge match-status" data-status={match.status}
                  >{messages.matches.statuses[match.status]}</span
                ><time datetime={match.updatedAt}
                  >{date.format(new SvelteDate(match.updatedAt))}</time
                >
              </div>
            </div>
            <div class="match-card-actions">
              {#if match.status === 'paused'}
                <button
                  class="button secondary"
                  disabled={!!openingMatchId}
                  onclick={() => resumeMatch(match)}
                >
                  <Icon name="play" />{messages.matches.open}
                </button>
              {:else}
                <a
                  class="button secondary"
                  href={resolve(`/matches?match=${encodeURIComponent(match.id)}`)}
                  >{#if match.status === 'cancelled' || match.status === 'finished'}
                    <Icon name="eye" />{messages.matches.view}
                  {:else}
                    <Icon name="play" />{messages.matches.open}
                  {/if}</a
                >
              {/if}
              {#if match.status !== 'finished' && match.status !== 'cancelled'}
                <button
                  class="button secondary"
                  onclick={(event) => confirmMatchAction('cancel', match, event.currentTarget)}
                  ><Icon name="cancel" />{messages.players.cancel}</button
                >
              {/if}
              <button
                class="button secondary delete-player-action"
                onclick={(event) => confirmMatchAction('delete', match, event.currentTarget)}
                ><Icon name="trash" />{messages.matches.delete}</button
              >
            </div>
          </article>
        </li>
      {/each}
    </ul>
  {/if}
  <dialog
    bind:this={actionDialog}
    aria-labelledby="match-action-title"
    onclose={() => void closeMatchAction()}
    oncancel={(event) => {
      if (savingAction) event.preventDefault();
    }}
  >
    <h2 id="match-action-title">
      {pendingAction?.kind === 'delete'
        ? messages.matches.deleteTitle
        : messages.petanque.confirmCancel}
    </h2>
    {#if pendingAction}
      <p>
        <strong>{historyGameName(pendingAction.match)}</strong> · {matchParticipants(
          pendingAction.match,
        )}
      </p>
      <p>
        {pendingAction.kind === 'delete'
          ? messages.matches.deleteHelp
          : messages.matches.cancelHelp}
      </p>
    {/if}
    <p class="error" role="alert">{actionError}</p>
    <div class="form-actions">
      <button class="button delete-confirm" disabled={savingAction} onclick={commitMatchAction}
        ><Icon name={pendingAction?.kind === 'delete' ? 'trash' : 'cancel'} />{savingAction
          ? messages.teams.saving
          : pendingAction?.kind === 'delete'
            ? messages.matches.delete
            : messages.petanque.confirm}</button
      >
      <button class="button secondary" disabled={savingAction} onclick={() => actionDialog?.close()}
        ><Icon name="close" />{messages.players.cancel}</button
      >
    </div>
  </dialog>
  {#if !selected && !loading && !error}
    {#if pageIndex > 0 || hasMore}<div
        class="profile-pagination"
        role="group"
        aria-label={messages.players.pagination}
      >
        <button class="button secondary" disabled={pageIndex === 0} onclick={() => pageIndex--}
          ><Icon name="arrow-left" />{messages.players.previous}</button
        >
        <span>{messages.players.page(pageIndex + 1)}</span>
        <button class="button secondary" disabled={!hasMore} onclick={() => pageIndex++}
          ><Icon name="arrow-right" />{messages.players.next}</button
        >
      </div>{/if}
  {/if}
  {#if creating && database}<PetanqueSetup
      {database}
      initialMode={page.url.searchParams.get('mode') === 'teams' ? 'teams' : 'individual'}
      initialTarget={page.url.searchParams.get('target') === '11' ? 11 : 13}
      ondismiss={() => {
        void goto(resolve('/matches'), { replaceState: true });
      }}
      oncreated={openMatch}
    />{/if}
  {#if creatingDeclarative && database}<DeclarativeSetup
      {database}
      versionId={page.url.searchParams.get('version') ?? ''}
      ondismiss={() => {
        void goto(resolve('/matches'), { replaceState: true });
      }}
      oncreated={openMatch}
    />{/if}
{/if}

{#if !error && detail}
  {@const currentDetail = detail}
  <div hidden={!selected}>
    <div class="match-detail">
      {#snippet matchHeader(actions?: Snippet, scoreboard?: Snippet)}
        <div class="match-header">
          <TableMode running={currentDetail.journal.projection.status === 'in_progress'} />
          <MatchOptions match={currentDetail.match} />
          <div class="match-toolbar" role="group" aria-label={messages.matches.actions}>
            {#if currentDetail.journal.projection.status === 'finished'}
              <button
                class="button"
                disabled={rematching ||
                  !currentDeviceId ||
                  (currentDetail.authorityLock !== undefined &&
                    currentDetail.authorityLock.state !== 'active') ||
                  (currentDetail.journal.authority.deviceId !== undefined &&
                    currentDetail.journal.authority.deviceId !== currentDeviceId)}
                onclick={revenge}><Icon name="replay" />{messages.matches.rematch}</button
              >
            {:else if currentDetail.match.rulesSnapshot.gameId !== 'petanque'}<a
                class="button secondary"
                href={resolve(
                  `/matches?new=declarative&version=${encodeURIComponent(currentDetail.match.gameVersionId)}`,
                )}><Icon name="replay" />{messages.history.replayRules}</a
              >{/if}
            {@render actions?.()}
            {#if rematchError}<p class="error" role="alert">{rematchError}</p>{/if}
          </div>
          {#if scoreboard}
            {@render scoreboard()}
          {:else}<section class="journal-summary" aria-label={messages.matches.scores}>
              {#if currentDetail.authorityLock?.state === 'prepared'}<p role="status">
                  {messages.sharing.authorityPrepared}
                </p>
              {:else if currentDetail.journal.authority.deviceId && currentDetail.journal.authority.deviceId !== currentDeviceId}<p
                  role="status"
                >
                  {messages.sharing.authorityTransferred}
                </p>{/if}
              <ul class="journal-scores" aria-label={messages.matches.scores}>
                {#each Object.entries(currentDetail.journal.projection.totals) as [id, total] (id)}
                  {@const team = currentDetail.match.teamsSnapshot.find((team) => team.id === id)}
                  {@const player = currentDetail.match.playersSnapshot.find(
                    (player) => player.id === id,
                  )}
                  <li>
                    <span class="score-owner"
                      >{#if team}<TeamAvatar {team} />{:else if player}<PlayerAvatar
                          profile={player}
                        />{/if}{owner(id)}</span
                    ><strong>{number.format(total)}</strong>
                  </li>
                {/each}
              </ul>
              <p role="status">
                {#if currentDetail.journal.projection.winnerIds?.length}{messages.matches.winner(
                    currentDetail.journal.projection.winnerIds.map(owner).join(', '),
                  )}{/if}
              </p>
            </section>{/if}
        </div>
      {/snippet}
      {#if detail.authorityLock?.state !== 'prepared' && (!detail.journal.authority.deviceId || detail.journal.authority.deviceId === currentDeviceId) && journal && database}<GameControls
          match={detail.match}
          view={detail.journal}
          journal={{ submit: submitGameAction }}
          {database}
          onrematch={detail.journal.projection.status === 'cancelled' ? openMatch : undefined}
          header={matchHeader}
        />{:else}{@render matchHeader()}{/if}
      <section class="journal-history" aria-labelledby="journal-title">
        <h2 id="journal-title">{messages.matches.journal}</h2>
        {#if detail.journal.audit.length === 0}<p>{messages.matches.noActions}</p>{/if}
        <JournalTimeline {entries} {label} {owner} {sequence} {date} />
        {#if detail.journal.audit.length > 20}<div
            class="profile-pagination"
            role="group"
            aria-label={messages.players.pagination}
          >
            <button class="button secondary" disabled={auditPage === 0} onclick={() => auditPage--}
              ><Icon name="arrow-left" />{messages.players.previous}</button
            >
            <span>{messages.players.page(auditPage + 1)}</span>
            <button
              class="button secondary"
              disabled={(auditPage + 1) * 20 >= detail.journal.audit.length}
              onclick={() => auditPage++}><Icon name="arrow-right" />{messages.players.next}</button
            >
          </div>{/if}
      </section>
      {#key currentDetail.match.id}
        <section class="game-rules" aria-label={messages.four21.ruleSummary}>
          <GameRules match={currentDetail.match} />
        </section>
      {/key}
    </div>
  </div>
{/if}

<style>
  .match-page-heading {
    display: grid;
    gap: var(--space-4);
    margin-block-end: var(--space-4);
  }
  .match-back {
    justify-self: start;
  }
  .match-identity {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    min-width: 0;
  }
  .match-identity .game-art {
    flex: 0 0 64px;
    width: 64px;
    height: 64px;
    padding: var(--space-3);
    border-radius: 18px;
  }
  .match-identity-copy {
    display: grid;
    gap: var(--space-2);
    justify-items: start;
    min-width: 0;
  }
  .match-identity h1 {
    font-size: clamp(1.6rem, 4vw, 2.5rem);
    overflow-wrap: anywhere;
  }
  @media (max-width: 47.99rem) {
    .darts-heading {
      margin-block-end: var(--space-2);
    }
    .darts-heading .match-identity {
      gap: var(--space-2);
    }
    .darts-heading .match-identity .game-art {
      flex-basis: 36px;
      width: 36px;
      height: 36px;
      border-radius: 10px;
      padding: var(--space-2);
    }
    .darts-heading .match-identity-copy {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
    }
    .darts-heading h1 {
      font-size: 1.15rem;
    }
  }
  .match-header {
    display: grid;
    gap: var(--space-4);
    min-width: 0;
  }
  .match-toolbar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-3);
  }
  .match-detail {
    display: grid;
    gap: var(--space-5);
  }
  .journal-summary {
    display: grid;
    gap: var(--space-4);
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .journal-scores {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
    width: 100%;
  }
  .journal-scores li {
    display: grid;
    align-content: start;
    justify-items: start;
    gap: var(--space-3);
    padding: var(--space-4);
    border-radius: 16px;
    background: var(--soft);
    min-width: 0;
  }
  .journal-scores strong {
    font-size: 1.85rem;
    line-height: 1.1;
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  }
  .score-owner {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    min-width: 0;
    overflow-wrap: anywhere;
    font-size: 0.875rem;
  }
  .score-owner :global(.player-avatar),
  .score-owner :global(.team-avatar) {
    width: 36px;
    height: 36px;
    flex-basis: 36px;
    border-radius: 12px;
    font-size: 1.1rem;
  }
  .match-detail :global(.game-play-area) {
    display: grid;
    align-content: start;
    gap: var(--space-4);
  }
  .match-detail :global(.game-play-area form) {
    display: grid;
    align-content: start;
    gap: var(--space-4);
    min-width: 0;
    margin: 0;
  }
  .match-detail :global(.game-play-area .end-picker) {
    margin: 0;
  }
  .match-detail :global(.game-play-area .editor-fields) {
    gap: var(--space-4);
  }
  .match-detail :global(.game-play-area > ul),
  .match-detail :global(.game-play-area > ol) {
    margin-block: 0;
  }
  .match-detail :global(.game-play-area > ul:empty),
  .match-detail :global(.game-play-area > ol:empty) {
    display: none;
  }
  .match-detail :global(.game-play-area .form-actions) {
    margin-block: 0;
  }
  .match-detail :global(.game-play-area .end-history > li),
  .match-detail :global(.game-play-area .generic-history > li) {
    display: grid;
    gap: var(--space-3);
    margin: 0;
    padding-block-start: var(--space-4);
  }
  @media (min-width: 900px) {
    .journal-scores {
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    }
  }
  @media (max-width: 480px) {
    .match-identity .game-art {
      flex-basis: 56px;
      width: 56px;
      height: 56px;
      padding: var(--space-2);
    }
    .journal-scores li {
      padding: var(--space-3);
    }
    .score-owner {
      flex-wrap: wrap;
    }
  }
</style>
