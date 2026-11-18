<script lang="ts">
  import { messages } from '#lib/i18n/index';
  import { createScorePreview } from '#lib/application/score-preview';
  import type { MatchRecord } from '#lib/domain/records';
  import type { EngineState, ScoreCommand } from '#lib/domain/engine/types';
  let {
    match,
    state,
    command,
  }: { match: MatchRecord; state: EngineState; command: () => ScoreCommand } = $props();
  const evaluate = $derived.by(() => {
    try {
      return createScorePreview(match);
    } catch {
      return undefined;
    }
  });
  const preview = $derived.by(() => {
    try {
      return evaluate?.(state, command());
    } catch {
      return undefined;
    }
  });
  function owner(id: string) {
    return (
      match.teamsSnapshot.find((team) => team.id === id)?.name ??
      match.playersSnapshot.find((player) => player.id === id)?.displayName ??
      id
    );
  }
</script>

<aside class="score-preview" aria-label={messages.play.preview}>
  <span class="preview-caption">{messages.play.preview}</span>
  {#if preview}
    {#if preview.bust}<strong>{messages.play.bust}</strong>{/if}
    {#each preview.changes as change (change.id)}
      <p>
        <span>{owner(change.id)}</span><strong>{change.before} → {change.after}</strong><small
          >{change.delta > 0 ? '+' : ''}{change.delta}</small
        >
      </p>
    {/each}
    {#if preview.pending !== undefined}<p>{messages.play.pendingPoints(preview.pending)}</p>{/if}
    {#if preview.finished}<strong>{messages.play.winningInput}</strong>{/if}
  {:else}<p>{messages.play.previewIncomplete}</p>{/if}
</aside>
