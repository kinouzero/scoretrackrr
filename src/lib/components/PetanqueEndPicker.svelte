<script lang="ts">
  import Icon from '#lib/components/Icon.svelte';
  import type { TeamSnapshot } from '#lib/domain/records';
  import type { PetanqueEnd } from '#lib/domain/games/petanque';
  import { messages } from '#lib/i18n/index';
  let {
    teams,
    end = $bindable<PetanqueEnd>({ type: 'points', teamId: '', points: 0 }),
    prefix,
    boulesPerPlayer,
    disabled = false,
    pointsOnly = false,
  }: {
    teams: readonly TeamSnapshot[];
    end?: PetanqueEnd;
    prefix: string;
    boulesPerPlayer: number;
    disabled?: boolean;
    pointsOnly?: boolean;
  } = $props();
  const selectedId = $derived(end.type === 'points' ? end.teamId : undefined);
  const selectedSide = $derived(teams.find((side) => side.id === selectedId));
  const maxPoints = $derived(
    (selectedSide?.playerIds.length ?? Math.max(...teams.map((side) => side.playerIds.length))) *
      boulesPerPlayer,
  );
</script>

<fieldset class="end-picker" {disabled}>
  <legend>{messages.petanque.endKind}</legend>
  <div class="end-kinds">
    {#each pointsOnly ? ['points'] : teams.length === 2 ? ['points', 'void', 'dead_jack'] : ['points', 'void'] as kind (kind)}
      <label class="avatar-option"
        ><input
          type="radio"
          name={`${prefix}-kind`}
          checked={end.type === kind}
          onchange={() => {
            end =
              kind === 'void'
                ? { type: 'void' }
                : kind === 'dead_jack'
                  ? { type: 'dead_jack', remaining: [0, 0] }
                  : { type: 'points', teamId: '', points: 0 };
          }}
        />
        {kind === 'points'
          ? messages.petanque.normal
          : kind === 'void'
            ? messages.petanque.void
            : messages.petanque.dead}</label
      >
    {/each}
  </div>
  {#if end.type === 'points'}
    <fieldset class="end-picker">
      <legend>{messages.petanque.scoringTeam}</legend>
      <div class="end-kinds">
        {#each teams as team (team.id)}<label class="avatar-option"
            ><input
              type="radio"
              name={`${prefix}-team`}
              checked={end.teamId === team.id}
              aria-label={messages.petanque.selectTeam(team.name)}
              onchange={() => {
                if (end.type === 'points') end = { ...end, teamId: team.id };
              }}
            />{team.name}</label
          >{/each}
      </div>
    </fieldset>
    <div class="point-grid">
      {#each Array.from({ length: Math.min(maxPoints, 6) }, (_, index) => index + 1) as points (points)}<button
          type="button"
          class="button secondary"
          aria-pressed={end.points === points}
          onclick={() => {
            if (end.type === 'points') end = { ...end, points };
          }}><Icon name="plus" />{messages.petanque.points(points)}</button
        >{/each}
    </div>
    {#if maxPoints > 6}<div class="game-field">
        <label for={`${prefix}-extra-points`}>{messages.petanque.morePoints}</label>
        <select
          id={`${prefix}-extra-points`}
          value={end.points > 6 ? end.points : 0}
          onchange={(event) => {
            if (end.type === 'points') end = { ...end, points: Number(event.currentTarget.value) };
          }}
        >
          <option value={0}>{messages.petanque.chooseOption}</option
          >{#each Array.from({ length: maxPoints - 6 }, (_, i) => i + 7) as value (value)}<option
              {value}>{messages.petanque.points(value)}</option
            >{/each}
        </select>
      </div>{/if}
  {:else if end.type === 'dead_jack'}
    <p class="field-hint">{messages.petanque.deadHelp}</p>
    {#each teams as team, index (team.id)}<div class="game-field">
        <label class="remaining-label" for={`${prefix}-remaining-${index}`}
          >{messages.petanque.remaining(team.name)}</label
        >
        <select
          id={`${prefix}-remaining-${index}`}
          value={end.remaining[index]}
          onchange={(event) => {
            if (end.type === 'dead_jack') {
              const remaining: [number, number] = [...end.remaining];
              remaining[index] = Number(event.currentTarget.value);
              end = { type: 'dead_jack', remaining };
            }
          }}
          >{#each Array.from({ length: team.playerIds.length * boulesPerPlayer + 1 }, (_, i) => i) as value (value)}<option
              {value}>{value}</option
            >{/each}</select
        >
      </div>{/each}
  {:else}<p>{messages.petanque.voidLabel}</p>{/if}
  {#if teams.length > 2}<p class="field-hint">{messages.petanque.deadUnsupported}</p>{/if}
</fieldset>

<style>
  .end-picker {
    display: grid;
    gap: var(--space-3);
    min-width: 0;
    border: 0;
    padding: 0;
    margin: var(--space-3) 0;
  }
  .end-picker legend {
    font-weight: 650;
    margin-bottom: var(--space-2);
  }
  .end-kinds {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .point-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-2);
  }
  .point-grid button[aria-pressed='true'] {
    background: var(--accent);
    color: var(--on-accent);
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .remaining-label {
    display: block;
    margin: 0;
  }
</style>
