<script lang="ts">
  import { untrack } from 'svelte';
  import SkullCounter from './SkullCounter.svelte';
  import type { SkullResultDraft } from '#lib/application/skull-counters';
  import {
    skullResultScore,
    skullCaptures,
    type SkullKingOptions,
    type SkullCapture,
  } from '#lib/domain/games/skull-king';
  import { entryDraft } from '../application/entry-draft.svelte';
  import Icon from '#lib/components/Icon.svelte';
  import { type SkullEntry } from '#lib/domain/games/skull-king';
  import type { PlayerProfileInput } from '#lib/domain/players';
  import { messages } from '#lib/i18n/index';
  import PlayerAvatar from './PlayerAvatar.svelte';

  let {
    id,
    options,
    limits,
    onupdate,
    draftScope,
    draftId,
    name,
    profile,
    entry,
    cards,
    bidding,
    bid = $bindable(),
    disabled,
    open,
    ontoggle,
    onrecord,
    focusRequested = false,
    onfocused,
  }: {
    id: string;
    options: SkullKingOptions;
    limits: SkullResultDraft;
    onupdate: (id: string, draft: SkullResultDraft) => void;
    draftScope: string;
    draftId: string;
    name: string;
    profile?: PlayerProfileInput;
    entry: SkullEntry;
    cards: number;
    bidding: boolean;
    bid?: number | '';
    disabled: boolean;
    open: boolean;
    ontoggle: () => void;
    onrecord: (values: Record<string, number>) => void;
    focusRequested?: boolean;
    onfocused: () => void;
  } = $props();
  const caps = $derived(skullCaptures(options));
  const fields = $derived(Object.keys(caps) as SkullCapture[]);
  const requiresTrick = (field: SkullCapture) => field !== 'monsters' && field !== 'loot';
  const captureIcons = { mermaids: 'mermaid', pirates: 'pirate', king: 'skull' } as const;
  let won = $state<number | undefined>(0);
  let bonuses = $state<Record<string, number>>({
    c14: 0,
    b14: 0,
    mermaids: 0,
    pirates: 0,
    king: 0,
  });
  let wonControl = $state.raw<HTMLDivElement>();
  let toggleButton = $state.raw<HTMLButtonElement>();
  const saved = $derived(entry.won !== null);
  const actualWon = $derived(entry.won ?? won ?? 0);
  const captures = $derived(saved ? entry : bonuses);
  const score = $derived(
    entry.bid === null ? null : skullResultScore(cards, entry.bid, actualWon, captures, options),
  );
  $effect(() => {
    if (focusRequested && wonControl && !bidding && !saved && !disabled) {
      wonControl.focus();
      onfocused();
    }
  });
  $effect(() => {
    const active = fields;
    untrack(() => {
      bonuses = Object.fromEntries(active.map((field) => [field, bonuses[field] ?? 0]));
    });
  });
  const valid = $derived(
    Number.isInteger(won) &&
      (won ?? 0) >= 0 &&
      (won ?? 0) <= limits.won &&
      fields.every(
        (field) =>
          Number.isInteger(bonuses[field]) &&
          bonuses[field]! >= 0 &&
          bonuses[field]! <= (limits[field] ?? 0),
      ),
  );
  $effect(() => {
    const snapshot: SkullResultDraft = {
      won: won ?? 0,
      c14: bonuses.c14!,
      b14: bonuses.b14!,
      mermaids: bonuses.mermaids!,
      pirates: bonuses.pirates!,
      king: bonuses.king!,
      ...Object.fromEntries(fields.map((field) => [field, bonuses[field] ?? 0])),
    };
    untrack(() => onupdate(id, snapshot));
  });
  function changeWon(value: number) {
    won = value;
    if (value === 0)
      bonuses = Object.fromEntries(
        fields.map((field) => [field, requiresTrick(field) ? 0 : (bonuses[field] ?? 0)]),
      );
  }
  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (disabled || saved || !valid) return;
    onrecord({
      won: won!,
      ...Object.fromEntries(fields.map((field) => [field, bonuses[field] ?? 0])),
    });
  }
  entryDraft(
    () => `${draftId}:skull-bonus:${id}`,
    () => draftScope,
    () => ({ won, bonuses }),
    (data) => {
      if (
        !Number.isInteger(data.won) ||
        data.won! < 0 ||
        data.won! > cards ||
        (data.won === 0 &&
          fields.some((field) => requiresTrick(field) && data.bonuses[field] !== 0)) ||
        fields.some(
          (field) =>
            !Number.isInteger(data.bonuses[field]) ||
            data.bonuses[field]! < 0 ||
            data.bonuses[field]! > (caps[field] ?? 0),
        )
      )
        return false;
      won = data.won;
      bonuses = data.bonuses;
    },
  );
</script>

<article
  class="player-card stack"
  class:expanded={open}
  class:saved
  aria-labelledby={`skull-player-${id}`}
>
  <header>
    <div class="identity">
      {#if profile}<PlayerAvatar {profile} />{/if}
      <h4 id={`skull-player-${id}`}>{name}</h4>
    </div>
    {#if !bidding && score !== null}<span
        class="score"
        class:negative={score < 0}
        aria-label={messages.skull.preview(score)}>{score > 0 ? '+' : ''}{score}</span
      >{/if}
  </header>
  <div class="round-summary">
    <span>{messages.skull.bid} <strong>{entry.bid ?? '—'}</strong></span>
    {#if !bidding}<span>{messages.skull.won} <strong>{saved ? entry.won : actualWon}</strong></span
      >{/if}
    {#if saved}<span class="saved-label">{messages.skull.saved}</span>{/if}
  </div>
  {#if bidding}
    {#if entry.bid === null}
      <label for={`skull-bid-${id}`}>{messages.skull.bid}</label>
      <select
        id={`skull-bid-${id}`}
        form="skull-bids"
        class="bid-choice"
        aria-label={messages.skull.bidFor(name)}
        bind:value={bid}
        required
        {disabled}
      >
        <option value="" disabled>—</option>
        {#each Array.from({ length: cards + 1 }, (_, i) => i) as value (value)}<option {value}
            >{value}</option
          >{/each}
      </select>
    {/if}
  {:else}
    <form class="stack" aria-labelledby={`skull-player-${id}`} onsubmit={submit}>
      {#if !saved}
        <div
          class="tricks-heading"
          role="group"
          aria-label={messages.skull.won}
          tabindex="-1"
          bind:this={wonControl}
        >
          <span>{messages.skull.won}</span>
          <SkullCounter
            id={`skull-won-${id}`}
            label={messages.skull.won}
            value={actualWon}
            maximum={limits.won}
            {disabled}
            onchange={changeWon}
          />
        </div>
      {/if}
      <button
        type="button"
        class="bonus-toggle"
        bind:this={toggleButton}
        aria-expanded={open}
        aria-controls={`skull-bonuses-${id}`}
        onclick={ontoggle}
      >
        <Icon name="sparkle" size={18} /><span>{messages.skull.bonusesFor(name)}</span><span
          aria-hidden="true"><Icon name={open ? 'chevron-up' : 'chevron-down'} size={18} /></span
        >
      </button>
      {#if open}
        <section
          id={`skull-bonuses-${id}`}
          class="bonus-panel stack"
          aria-label={messages.skull.bonusesFor(name)}
        >
          <p>
            {options.scoring === 'rascal' ? messages.skull.rascalHint : messages.skull.bonusHint}
          </p>
          {#if options.loot}<p>{messages.skull.lootHint}</p>{/if}
          {#if !saved && actualWon === 0}<p>
              {options.expansion || options.loot
                ? messages.skull.noTrickHint
                : messages.skull.needTrick}
            </p>{/if}
          <p>{messages.skull.inventoryHint}</p>
          <div class="bonus-grid">
            {#each fields as field (field)}
              <div class="capture stack">
                <label for={`skull-${id}-${field}`}
                  ><span
                    class="capture-symbol"
                    class:black-card={field === 'b14'}
                    aria-hidden="true"
                    >{#if field === 'c14' || field === 'b14'}14{:else}<Icon
                        name={field in captureIcons
                          ? captureIcons[field as keyof typeof captureIcons]
                          : 'sparkle'}
                        size={22}
                      />{/if}</span
                  >{messages.skull.bonusFields[field]}</label
                >
                <SkullCounter
                  id={`skull-${id}-${field}`}
                  label={messages.skull.bonusFields[field]}
                  value={captures[field] ?? 0}
                  maximum={limits[field] ?? 0}
                  disabled={disabled || saved || (actualWon === 0 && requiresTrick(field))}
                  onchange={(value) => {
                    bonuses[field] = value;
                  }}
                />
              </div>
            {/each}
          </div>
          <div class="bonus-footer">
            <p>{messages.skull.preview(score ?? 0)}</p>
            <button
              type="button"
              class="button secondary"
              onclick={() => {
                toggleButton?.focus();
                ontoggle();
              }}><Icon name="close" />{messages.skull.closeBonuses}</button
            >
          </div>
        </section>
      {/if}
      {#if !saved}<button class="button" disabled={disabled || !valid}
          ><Icon name="check" />{messages.skull.recordResult}</button
        >{/if}
    </form>
  {/if}
</article>

<style>
  .stack {
    display: grid;
    gap: var(--space-4);
  }
  .player-card {
    min-width: 0;
    padding: var(--panel-padding);
    border: 1px solid var(--border);
    border-radius: 18px;
    background: var(--surface);
  }
  .player-card.expanded {
    border-color: var(--success);
    box-shadow: inset 0 0 0 1px var(--success);
  }
  header,
  .identity,
  .round-summary,
  .tricks-heading,
  .bonus-footer {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
  header,
  .tricks-heading,
  .bonus-footer {
    justify-content: space-between;
  }
  .identity {
    min-width: 0;
    flex: 1;
    flex-wrap: nowrap;
  }
  h4 {
    font-size: 1.25rem;
    overflow-wrap: anywhere;
  }
  .score {
    font-size: 1.25rem;
    font-weight: 800;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--success);
    border-radius: 12px;
    color: var(--success);
    font-variant-numeric: tabular-nums;
  }
  .score.negative {
    color: var(--danger);
    border-color: var(--danger);
  }
  .round-summary {
    color: var(--muted-text);
    font-size: 0.875rem;
  }
  .round-summary strong {
    color: var(--text);
    margin-inline-start: var(--space-1);
  }
  .saved-label {
    color: var(--success);
    font-weight: 700;
  }
  .bid-choice {
    width: 100%;
  }
  .bonus-toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    min-height: 56px;
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--success);
    border-radius: 12px;
    background: var(--success);
    color: light-dark(#fff, #142719);
    font-weight: 750;
    text-align: start;
  }
  .bonus-toggle > span:nth-child(2) {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .bonus-panel {
    padding: var(--space-4);
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--soft);
  }
  .bonus-panel p {
    font-size: 0.875rem;
    color: var(--muted-text);
  }
  .bonus-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr));
    gap: var(--space-3);
  }
  .capture {
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: 12px;
    align-content: space-between;
  }
  .capture label {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: 0.875rem;
  }
  .capture-symbol {
    display: grid;
    place-items: center;
    flex: 0 0 32px;
    min-height: 36px;
    border-radius: 8px;
    background: var(--surface);
    color: var(--success);
    font-weight: 800;
    font-size: 1.25rem;
  }
  .capture-symbol.black-card {
    color: var(--text);
  }
  button:disabled {
    opacity: 0.5;
  }
  button {
    cursor: pointer;
  }
  button:disabled {
    cursor: default;
  }
</style>
