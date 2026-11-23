<script lang="ts">
  import type { Snippet } from 'svelte';
  import { cricketTargets } from '#lib/domain/games/cricket';
  import type { CheckoutDart } from '#lib/domain/games/checkouts';
  import type { dartsScorecard } from '#lib/domain/games/darts-stats';
  import { getLocale, messages } from '#lib/i18n/index';
  import type { MatchRecord } from '#lib/domain/records';
  import Icon from './Icon.svelte';
  import PlayerAvatar from './PlayerAvatar.svelte';
  import TeamAvatar from './TeamAvatar.svelte';

  let {
    match,
    ownerIds,
    totals,
    active,
    next,
    name,
    headline,
    detail,
    teamPlayer,
    scorecard,
    checkout,
    darts,
    aggregate,
    points,
    legs,
    sets,
    leg,
    set,
    marks,
    seriesLabels,
    connected,
    awaiting,
    label,
    continuation,
  }: {
    match: MatchRecord;
    ownerIds: readonly string[];
    totals: Record<string, number>;
    active: string;
    next?: string;
    name: (id: string) => string;
    headline: string;
    detail: string;
    teamPlayer?: string;
    scorecard: ReturnType<typeof dartsScorecard>;
    checkout?: readonly CheckoutDart[];
    darts: readonly CheckoutDart[];
    aggregate?: number;
    points: boolean;
    legs?: Record<string, number>;
    sets?: Record<string, number>;
    leg?: number;
    set?: number;
    marks?: Record<string, number[]>;
    seriesLabels?: { legs: string; sets?: string };
    connected: boolean;
    awaiting: boolean;
    label: (dart: CheckoutDart) => string;
    continuation?: Snippet;
  } = $props();
  const rules = $derived(match.rulesSnapshot.definition);
  const cricket = $derived(rules.engine === 'cricket');
  const activeSide = $derived(scorecard.sides.get(active));
  const visit = $derived((activeSide?.count ?? 0) + (awaiting ? 0 : 1));
  function sideScore(id: string) {
    return points ? totals[id] : (marks?.[id]?.reduce((total, value) => total + value, 0) ?? 0);
  }
  const number = $derived(new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 2 }));
</script>

<section class="board" aria-label={messages.matches.scores}>
  <div class="board-bar">
    <p class="board-format">
      <strong>{cricket ? messages.cricket.title : rules.start}</strong>
      <span>{messages.dartsBoard.round(visit)}</span>
      {#if leg !== undefined}<span>{messages.dartsBoard.leg(leg)}</span>{/if}
      {#if set !== undefined}<span>{messages.dartsBoard.set(set)}</span>{/if}
    </p>
    <p class="board-settings">
      {#if cricket}
        <span>{points ? messages.dartsBoard.points : messages.dartsBoard.noPoints}</span>
      {:else}
        <span title={messages.darts.bull}>25/50</span>
        <span>{messages.dartsBoard.straightIn}</span>
        <span
          >{rules.doubleOut === true
            ? messages.dartsBoard.doubleOut
            : messages.dartsBoard.straightOut}</span
        >
      {/if}
      {#if seriesLabels}
        <span>{seriesLabels.legs}</span>
        {#if seriesLabels.sets}<span>{seriesLabels.sets}</span>{/if}
      {/if}
      {#if connected}
        <span class="board-link" role="status" aria-label={messages.granboard.connected}
          ><Icon name="bluetooth" /></span
        >
      {/if}
    </p>
  </div>

  <div class="board-grid" class:duel={ownerIds.length === 2}>
    <div class="board-focus">
      <div class="current-turn" aria-live="polite">
        <h3>{headline}</h3>
        {#if teamPlayer}<p role="status">{messages.generic.activeTeamPlayer(teamPlayer)}</p>{/if}
        <p
          class="large-score"
          aria-label={cricket
            ? points
              ? messages.dartsStats.points
              : messages.dartsStats.marks
            : messages.dartsBoard.remaining}
        >
          {sideScore(active)}
        </p>
        <p class="turn-detail">{detail}</p>
      </div>
      <div class="dart-sequence">
        <p>{checkout?.length ? messages.dartsBoard.suggested : messages.dartsBoard.darts}</p>
        <ol aria-label={messages.dartsBoard.darts} role="list">
          {#each [0, 1, 2] as index (index)}
            {@const thrown = darts[index]}
            {@const suggested = checkout?.[index - darts.length]}
            {@const total = index === 0 ? aggregate : undefined}
            <li
              class:played={Boolean(thrown) || total !== undefined}
              class:suggested={Boolean(suggested)}
              class:current={!awaiting && index === darts.length}
            >
              {#if thrown}{label(thrown)}
              {:else if total !== undefined}{total}
              {:else if suggested}{label(suggested)}
              {:else}<span aria-hidden="true">—</span>{/if}
            </li>
          {/each}
        </ol>
      </div>
      {@render continuation?.()}
    </div>

    {#each ownerIds as id (id)}
      {@const side = scorecard.sides.get(id)}
      {@const team = match.teamsSnapshot.find((entry) => entry.id === id)}
      {@const player = match.playersSnapshot.find((entry) => entry.id === id)}
      <article class="side" class:active-side={id === active} aria-label={name(id)}>
        <div class="side-identity">
          {#if team}<TeamAvatar {team} />{:else if player}<PlayerAvatar profile={player} />{/if}
          <h4>{name(id)}</h4>
        </div>
        <strong class="side-score">{sideScore(id)}</strong>
        <p class="side-role">
          {#if id === active}{messages.dartsBoard.active}{:else if id === next}{messages.dartsBoard
              .next}{/if}
        </p>
        {#if legs}
          <p class="side-legs">
            {messages.dartsBoard.legsWon(legs[id] ?? 0)}
            {#if sets}<span>{messages.dartsBoard.setsWon(sets[id] ?? 0)}</span>{/if}
          </p>
        {/if}
        <p class="side-average">
          <span>{messages.dartsBoard.average}</span>
          <strong>{side?.count ? number.format(side.scored / side.count) : '—'}</strong>
        </p>
        {#if marks?.[id]}
          <ul class="cricket-marks" role="list">
            {#each cricketTargets as target, index (target)}
              {@const value = marks[id]![index]!}
              <li aria-label={messages.cricket.cell(name(id), target, value)}>
                <span>{target === 25 ? 'B' : target}</span>
                <strong>{messages.cricket.marks[value]}</strong>
              </li>
            {/each}
          </ul>
        {/if}
        <ol class="recent" aria-label={messages.dartsBoard.recent} role="list">
          {#each side?.recent ?? [] as recent (recent.number)}
            <li class:bust={recent.bust}>
              <span>{messages.dartsBoard.visitNumber(recent.number)}</span>
              <strong>{recent.bust ? messages.dartsBoard.bust : recent.value}</strong>
            </li>
          {/each}
        </ol>
      </article>
    {/each}
  </div>
</section>

<style>
  .board {
    container-type: inline-size;
    isolation: isolate;
    display: grid;
    gap: clamp(0.7rem, 2.4vw, 1.25rem);
    border-radius: 1.1rem;
    border: 1px solid #425f98;
    padding: clamp(0.75rem, 2.4vw, 1.4rem);
    background: radial-gradient(ellipse at 52% 0%, #284c88, #152746 58%, #111d33);
    color: #f5f8ff;
  }
  .board p,
  .board h3,
  .board h4,
  .board ol {
    margin: 0;
  }
  .board-bar,
  .board-format,
  .board-settings {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.38rem;
  }
  .board-bar {
    justify-content: space-between;
  }
  .board-format strong {
    font-size: 1.15rem;
    font-weight: 800;
  }
  .board-format span,
  .board-settings span {
    font-size: 0.71rem;
    font-weight: 680;
    color: #d7e5ff;
    padding: 0.12rem 0.42rem;
    border-radius: 0.35rem;
    background: #0e1b35c9;
    white-space: nowrap;
  }
  .board-settings .board-link {
    display: inline-flex;
    color: #96edc0;
  }
  .board-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 8.25rem), 1fr));
    gap: clamp(0.45rem, 1.5cqi, 0.85rem);
    min-width: 0;
  }
  .duel {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .board-focus {
    grid-column: 1 / -1;
    display: grid;
    justify-items: center;
    align-content: center;
    gap: 0.55rem;
    min-width: 0;
    text-align: center;
  }
  .current-turn h3 {
    font-size: 1rem;
    overflow-wrap: anywhere;
  }
  .current-turn .large-score {
    color: #f5f8ff;
    font-size: clamp(3.25rem, 13cqi, 7.5rem);
    line-height: 0.96;
    letter-spacing: -0.055em;
    padding-inline-end: 0.055em;
    font-weight: 850;
    font-variant-numeric: tabular-nums;
    margin-block: 0.2rem 0.32rem;
  }
  .current-turn > p:not(.large-score),
  .dart-sequence p {
    color: #c6d6f5;
    font-size: 0.77rem;
  }
  .dart-sequence {
    width: min(100%, 16rem);
  }
  .dart-sequence ol {
    padding: 0;
    margin-block-start: 0.3rem;
    list-style: none;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.3rem;
  }
  .dart-sequence li {
    display: grid;
    place-items: center;
    min-height: 2.05rem;
    padding-inline: 0.15rem;
    border-radius: 0.5rem;
    border: 1px solid #7e9bd260;
    background: #142443;
    color: #c6d6f5;
    font-size: 0.78rem;
    font-weight: 750;
    overflow-wrap: anywhere;
  }
  .dart-sequence .suggested {
    color: #bcd5ff;
    background: #284c88;
  }
  .dart-sequence .played {
    color: #a4edce;
  }
  .dart-sequence .current {
    border-color: #add0ff;
  }
  .side {
    display: grid;
    align-content: start;
    gap: 0.27rem;
    min-width: 0;
    padding: clamp(0.52rem, 1.45cqi, 0.92rem);
    border-radius: 0.75rem;
    background: #0e1b35be;
    border: 1px solid #7e9bd249;
  }
  .side.active-side {
    border-color: #9fc6ff;
    background: #163156;
  }
  .side-identity {
    display: flex;
    align-items: center;
    gap: 0.45rem;
  }
  .side-identity :global(.player-avatar) {
    --avatar-size: clamp(1.6rem, 5cqi, 2.6rem);
    width: var(--avatar-size);
    min-width: var(--avatar-size);
    height: var(--avatar-size);
    padding: 0;
    flex: 0 0 var(--avatar-size);
    border-radius: 50%;
    font-size: 0.72rem;
  }
  .side h4 {
    font-size: 0.91rem;
    overflow-wrap: anywhere;
  }
  .side-score {
    font: inherit;
    font-size: clamp(1.85rem, 6cqi, 3.2rem);
    line-height: 1;
    font-weight: 790;
  }
  .side-role,
  .side-legs,
  .side-average,
  .recent {
    color: #c6d6f5;
    font-size: 0.73rem;
    line-height: 1.25;
  }
  .side-role:empty {
    display: none;
  }
  .active-side .side-role {
    color: #a4edce;
  }
  .side-legs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .side-average,
  .recent li {
    display: flex;
    justify-content: space-between;
    gap: 0.25rem;
  }
  .side-average strong,
  .recent strong {
    color: #f5f8ff;
    font-variant-numeric: tabular-nums;
  }
  .side .recent {
    display: grid;
    gap: 0.12rem;
    padding: 0.3rem 0 0;
    border-top: 1px solid #7e9bd244;
    list-style: none;
  }
  .recent:empty {
    display: none;
  }
  .recent .bust strong {
    color: #ffb5ac;
  }
  .cricket-marks {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    margin: 0;
    padding: 0;
    list-style: none;
    text-align: center;
  }
  .cricket-marks li {
    display: grid;
    justify-items: center;
    font-size: 0.62rem;
  }
  .cricket-marks li span {
    color: #c6d6f5;
  }
  @container (min-width: 38rem) {
    .duel {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.45fr) minmax(0, 1fr);
      align-items: stretch;
    }
    .duel .board-focus {
      grid-column: 2;
      grid-row: 1;
    }
    .duel .side:nth-child(2) {
      grid-column: 1;
      grid-row: 1;
    }
    .duel .side:nth-child(3) {
      grid-column: 3;
      grid-row: 1;
    }
  }
</style>
