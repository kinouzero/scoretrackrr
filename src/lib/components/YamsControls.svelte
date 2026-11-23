<script lang="ts">
  import EntrySituation from './EntrySituation.svelte';
  import { entryDraft } from '../application/entry-draft.svelte';
  import Icon from './Icon.svelte';
  import GameHeader, { type HeaderRenderer } from './GameHeader.svelte';
  import { tick } from 'svelte';
  import type { MatchRecord } from '#lib/domain/records';
  import type { JournalAction, JournalView } from '#lib/domain/journal';
  import type { LocalDatabase } from '#lib/storage/database';
  import type { MatchJournal } from '#lib/storage/journal';
  import {
    createYamsGame,
    yamsCategories,
    yamsPossibleScores,
    yamsTotals,
    yamsScoring,
  } from '#lib/domain/games/yams';
  import type { EngineState } from '#lib/domain/engine/types';
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
  const game = $derived(createYamsGame(match.rulesSnapshot.definition));
  const config = $derived(game.validateConfig(match.settingsSnapshot.engineConfig));
  const grid = $derived(game.getGrid(view.state, config));
  const options = $derived(yamsScoring(game.definition));
  const activeOwner = $derived(game.getActiveOwner(view.state, config));
  let correcting = $state(false);
  let entryState = $state.raw<EngineState>();
  let repeatYams = $state(false);
  let repeatFace = $state(1);
  const slots = $derived(scoreSlots(view.audit));
  const status = $derived(view.projection.status);
  const limited = $derived(view.projection.lastEventSequence >= 1000);
  let saving = $state(false);
  let notice = $state('');
  let error = $state('');
  let dialogError = $state('');
  let selected = $state<{
    ownerId: string;
    category: number;
    revisionId?: string;
    expectedVersion: number;
  }>();
  let assisted = $state(false);
  let dice = $state([1, 1, 1, 1, 1]);
  let points = $state(0);
  let cancelling = $state(false);
  let cancelVersion = $state(0);
  let dialog: HTMLDialogElement;
  let heading: HTMLHeadingElement;
  let opener: HTMLElement | null = null;
  let scrollRegion = $state<HTMLDivElement>();
  $effect(() => {
    const active = activeOwner;
    const region = scrollRegion;
    if (!active || !region || correcting || status !== 'in_progress') return;
    void tick().then(() => {
      if (!region.isConnected || activeOwner !== active) return;
      const column = region.querySelector('th[aria-current="true"]');
      if (!column) return;
      const bounds = column.getBoundingClientRect();
      const viewport = region.getBoundingClientRect();
      const labels = region.querySelector('th')!.getBoundingClientRect().width;
      if (bounds.left < viewport.left + labels)
        region.scrollLeft += bounds.left - viewport.left - labels;
      else if (bounds.right > viewport.right) region.scrollLeft += bounds.right - viewport.right;
    });
  });
  const rollDice = $derived(
    assisted ? dice : repeatYams ? Array<number>(5).fill(repeatFace) : dice,
  );
  const roll = $derived(
    selected
      ? game.scoreRoll(
          entryState ?? view.state,
          selected.ownerId,
          selected.category,
          rollDice,
          config,
        )
      : { points: 0, bonus: 0, allowed: true },
  );
  const computed = $derived(roll.points);
  const repeatAvailable = $derived(
    selected &&
      (options.extraYamsBonus || options.joker) &&
      game.getGrid(entryState ?? view.state, config)[selected.ownerId]?.[11] !== null,
  );

  function owner(id: string) {
    return (
      match.teamsSnapshot.find((team) => team.id === id)?.name ??
      match.playersSnapshot.find((player) => player.id === id)?.displayName ??
      id
    );
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
  function message(failure: unknown) {
    return failure instanceof EngineError ? messages.yams.invalid : petanqueErrorMessage(failure);
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
  async function edit(ownerId: string, category: number) {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const slot = slots.find(
      (slot) => slot.command?.ownerId === ownerId && slot.command.values.category === category,
    );
    selected = {
      ownerId,
      category,
      expectedVersion: view.projection.lastEventSequence,
      ...(slot ? { revisionId: slot.revisionId } : {}),
    };
    let before = game.initialState(config);
    for (const previous of slots) {
      if (previous === slot) break;
      if (previous.command)
        for (const event of game.decide(before, previous.command, config))
          before = game.evolve(before, event, config);
    }
    entryState = slot ? before : view.state;
    repeatYams = false;
    repeatFace = 1;
    points = grid[ownerId]![category] ?? 0;
    assisted = slot?.command?.values.d1 !== undefined;
    dice = [1, 2, 3, 4, 5].map((n) => slot?.command?.values[`d${n}`] ?? 1);
    cancelling = false;
    dialogError = '';
    await tick();
    dialog.showModal();
  }
  async function cancel() {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    selected = undefined;
    cancelling = true;
    cancelVersion = view.projection.lastEventSequence;
    dialogError = '';
    await tick();
    dialog.showModal();
  }
  async function commit(undo = false) {
    if (saving) return;
    saving = true;
    dialogError = '';
    try {
      if (cancelling) await submit({ type: 'cancel' }, cancelVersion);
      else if (selected) {
        const values = {
          category: selected.category,
          points: assisted || repeatYams ? computed : points,
          ...(assisted || repeatYams
            ? Object.fromEntries(rollDice.map((die, index) => [`d${index + 1}`, die]))
            : {}),
        };
        const record = { type: 'record' as const, ownerId: selected.ownerId, values };
        const action: JournalAction = undo
          ? { type: 'undo', targetEventId: selected.revisionId! }
          : selected.revisionId
            ? { type: 'correct', targetEventId: selected.revisionId, replacement: record }
            : record;
        await submit(action, selected.expectedVersion);
      }
      dialog.close();
      notice = messages.yams.saved;
    } catch (failure) {
      dialogError = message(failure);
    } finally {
      saving = false;
    }
  }
  entryDraft(
    () => `${match.id}:yams`,
    () => `${view.projection.lastEventSequence}:${status}`,
    () => ({
      selected: selected && !selected.revisionId ? selected : null,
      assisted,
      dice,
      points,
      repeatYams,
      repeatFace,
    }),
    (data) => {
      if (
        !data.dice.every((value) => Number.isInteger(value) && value >= 1 && value <= 6) ||
        !Number.isInteger(data.repeatFace) ||
        data.repeatFace < 1 ||
        data.repeatFace > 6 ||
        !data.selected ||
        data.selected.revisionId ||
        !Number.isInteger(data.selected.category) ||
        data.selected.category < 0 ||
        data.selected.category > 12 ||
        data.selected.ownerId !== activeOwner ||
        data.selected.expectedVersion !== view.projection.lastEventSequence ||
        status !== 'in_progress'
      )
        return false;
      selected = data.selected;
      entryState = view.state;
      assisted = data.assisted;
      dice = data.dice;
      points = data.points;
      repeatYams = data.repeatYams;
      repeatFace = data.repeatFace;
      void tick().then(() => {
        if (dialog?.isConnected && !dialog.open) dialog.showModal();
      });
    },
  );
</script>

{#snippet actions()}
  {#if !selfOnly}
    {#if activeOwner && view.state.eventCount > 0 && status !== 'cancelled'}
      <button
        class="button secondary"
        aria-pressed={correcting}
        disabled={saving}
        onclick={() => (correcting = !correcting)}
        ><Icon name="edit" />{correcting
          ? messages.yams.backToPlay
          : messages.yams.correctGrid}</button
      >
    {/if}
    {#if status === 'draft'}<button
        class="button"
        disabled={saving || limited}
        onclick={() => act({ type: 'start' })}><Icon name="play" />{messages.matches.start}</button
      >{/if}
    {#if status === 'in_progress'}<button
        class="button secondary"
        disabled={saving || limited}
        onclick={() => act({ type: 'pause' })}><Icon name="pause" />{messages.matches.pause}</button
      >{/if}
    {#if status === 'paused'}<button
        class="button"
        disabled={saving || limited}
        onclick={() => act({ type: 'resume' })}
        ><Icon name="play" />{messages.matches.resume}</button
      >{/if}
    {#if status !== 'finished' && status !== 'cancelled'}<button
        class="button secondary"
        disabled={saving || limited}
        onclick={cancel}><Icon name="cancel" />{messages.matches.cancel}</button
      >{/if}
  {/if}
{/snippet}

<GameHeader renderer={header} {actions} />

<section class="game-play-area yams-controls" aria-labelledby="yams-title">
  <h2 id="yams-title" bind:this={heading} tabindex="-1">
    {header ? messages.matches.scoreEntry : messages.yams.title}
  </h2>

  <EntrySituation {status}>
    {#if activeOwner && status === 'in_progress'}
      <div class="yams-turn" role="status">
        <Icon name={correcting ? 'edit' : 'play'} />
        <div>
          <strong
            >{correcting
              ? messages.yams.correctGrid
              : messages.yams.turn(owner(activeOwner))}</strong
          >
          <p>{correcting ? messages.yams.correctionHint : messages.yams.lockHint}</p>
        </div>
      </div>
    {/if}
  </EntrySituation>
  {#if notice}<p role="status">{notice}</p>{/if}
  <p role="alert" class="error">{error}</p>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (The scrollable score table needs keyboard focus.) -->
  <div
    bind:this={scrollRegion}
    class="yams-scroll"
    role="region"
    aria-label={messages.yams.scroll}
    tabindex="0"
  >
    <table>
      <caption>{messages.yams.title}</caption><thead
        ><tr
          ><th scope="col">{messages.yams.category}</th>{#each config.ownerIds as id (id)}<th
              scope="col"
              class:active-column={activeOwner === id && !correcting}
              aria-current={activeOwner === id && !correcting ? true : undefined}
              >{owner(id)}<small
                >{messages.yams.progress(grid[id]!.filter((score) => score !== null).length)}</small
              ></th
            >{/each}</tr
        ></thead
      >
      <tbody
        >{#each yamsCategories as category, index (category)}<tr
            ><th scope="row">{messages.yams.categories[index]}</th>
            {#each config.ownerIds as id (id)}<td
                class:active-column={activeOwner === id && !correcting}
                ><button
                  class="cell"
                  class:filled={grid[id]![index] !== null}
                  aria-label={messages.yams.cell(
                    owner(id),
                    messages.yams.categories[index]!,
                    grid[id]![index]!,
                  )}
                  disabled={saving ||
                    (activeOwner !== undefined &&
                      (correcting
                        ? grid[id]![index] === null
                        : id !== activeOwner || grid[id]![index] !== null)) ||
                    (selfOnly && (!allowedOwnerIds?.includes(id) || grid[id]![index] !== null)) ||
                    limited ||
                    status === 'draft' ||
                    status === 'cancelled' ||
                    (grid[id]![index] === null && status !== 'in_progress')}
                  onclick={() => edit(id, index)}
                  ><Icon name="edit" size={12} />{grid[id]![index] ?? '·'}</button
                ></td
              >{/each}</tr
          >
          {#if index === 5}<tr
              ><th scope="row">{messages.yams.upper}</th>{#each config.ownerIds as id (id)}<td
                  >{yamsTotals(grid[id]!, game.definition.upperBonus).upper}</td
                >{/each}</tr
            >
            <tr
              ><th scope="row">{messages.yams.bonus}</th>{#each config.ownerIds as id (id)}<td
                  >{yamsTotals(grid[id]!, game.definition.upperBonus).bonus}</td
                >{/each}</tr
            >{/if}
        {/each}<tr
          ><th scope="row">{messages.yams.lower}</th>{#each config.ownerIds as id (id)}<td
              >{yamsTotals(grid[id]!, game.definition.upperBonus).lower}</td
            >{/each}</tr
        >
        {#if options.extraYamsBonus}<tr
            ><th scope="row">{messages.yams.extraYamsTotal}</th
            >{#each config.ownerIds as id (id)}<td>{game.getExtraBonus(view.state, id, config)}</td
              >{/each}</tr
          >{/if}
        <tr
          ><th scope="row">{messages.yams.total}</th>{#each config.ownerIds as id (id)}<td
              ><strong>{view.state.totals[id]}</strong></td
            >{/each}</tr
        ></tbody
      >
    </table>
  </div>
</section>
<dialog
  bind:this={dialog}
  aria-labelledby="yams-dialog-title"
  oncancel={(event) => {
    if (saving) event.preventDefault();
  }}
  onclose={() => {
    selected = undefined;
    cancelling = false;
    if (opener?.isConnected && !opener.hasAttribute('disabled')) opener.focus();
    else heading?.focus();
  }}
>
  <h2 id="yams-dialog-title">
    {cancelling ? messages.petanque.confirmCancel : messages.yams.edit}
  </h2>
  {#if cancelling}<p>{messages.petanque.cancelHelp}</p>{:else if selected}
    <p>{owner(selected.ownerId)} — {messages.yams.categories[selected.category]}</p>
    {#if selected.revisionId}<p>{messages.petanque.correctionHelp}</p>{/if}
    <fieldset class="editor-fields" disabled={saving}>
      <label class="check-label"
        ><input type="checkbox" bind:checked={assisted} />{messages.yams.assisted}</label
      >
      {#if repeatAvailable && !assisted}
        <label class="check-label"
          ><input type="checkbox" bind:checked={repeatYams} />{messages.yams.repeatRoll}</label
        >
        {#if repeatYams}<div class="game-field">
            <label for="yams-repeat-face">{messages.yams.repeatFace}</label><select
              id="yams-repeat-face"
              bind:value={repeatFace}
              >{#each [1, 2, 3, 4, 5, 6] as face (face)}<option value={face}>{face}</option
                >{/each}</select
            >
          </div>{/if}
      {/if}
      {#if assisted}<div class="dice-inputs">
          {#each [0, 1, 2, 3, 4] as index (index)}<div>
              <div class="game-field">
                <label for={`yams-die-${index}`}>{messages.yams.die(index + 1)}</label>
                <select id={`yams-die-${index}`} bind:value={dice[index]}>
                  {#each [1, 2, 3, 4, 5, 6] as value (value)}<option {value}>{value}</option>{/each}
                </select>
              </div>
            </div>{/each}
        </div>
        <p>{messages.yams.computed(computed)}</p>
      {:else if !repeatYams}<div class="game-field">
          <label for="yams-points">{messages.yams.points}</label><select
            id="yams-points"
            bind:value={points}
            >{#each yamsPossibleScores(selected.category, options) as value (value)}<option {value}
                >{value}</option
              >{/each}</select
          >
        </div>{/if}
      {#if repeatYams}<p>{messages.yams.computed(computed)}</p>{/if}
      {#if assisted || repeatYams}
        {#if roll.bonus}<p class="yams-bonus">{messages.yams.extraAward(roll.bonus)}</p>{/if}
        {#if !roll.allowed}<p class="error" role="alert">{messages.yams.jokerRequired}</p>{/if}
      {/if}
    </fieldset>
  {/if}
  <p role="alert" class="error">{dialogError}</p>
  <div class="form-actions">
    <button
      class="button"
      disabled={saving || ((assisted || repeatYams) && !roll.allowed)}
      onclick={() => commit()}
      ><Icon name="check" />{saving ? messages.petanque.saving : messages.petanque.confirm}</button
    >
    {#if selected?.revisionId}<button
        class="button secondary"
        disabled={saving}
        onclick={() => commit(true)}><Icon name="undo" />{messages.yams.undo}</button
      >{/if}
    <button class="button secondary" disabled={saving} onclick={() => dialog.close()}
      ><Icon name="close" />{messages.players.cancel}</button
    >
  </div>
</dialog>

<style>
  .yams-turn {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    border-radius: 12px;
    background: var(--selected);
  }
  .yams-turn p {
    margin: var(--space-1) 0 0;
    font-size: 0.85rem;
    color: var(--muted-text);
  }
  .active-column {
    background: var(--selected);
  }
  .active-column[scope='col'] {
    box-shadow: inset 0 3px var(--accent);
  }
  .yams-bonus {
    color: var(--success);
    font-weight: 650;
  }
  .yams-controls {
    display: grid;
    gap: var(--space-4);
  }
  .yams-controls > p {
    margin-top: 0;
  }
  .yams-scroll {
    overflow-x: auto;
    margin-top: 0;
  }
  table {
    border-collapse: collapse;
    min-width: 100%;
  }
  caption {
    text-align: left;
    margin-bottom: var(--space-3);
  }
  th,
  td {
    border: 1px solid var(--border);
    padding: 0.4rem;
    text-align: center;
  }
  th {
    font-size: 0.85rem;
  }
  th small {
    display: block;
    font-weight: 400;
  }
  th[scope='row'] {
    text-align: left;
    min-width: 90px;
  }
  th:first-child {
    position: sticky;
    left: 0;
    z-index: 1;
    background: var(--surface);
  }
  .cell {
    min-width: 48px;
    min-height: 48px;
    border: 1px solid var(--input-border);
    border-radius: 7px;
    background: var(--surface);
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }
  .cell.filled {
    background: var(--selected);
  }
  .dice-inputs {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(4rem, 1fr));
    gap: var(--space-2);
  }
  .dice-inputs label {
    font-size: 0.75rem;
  }
</style>
