import type { MatchRecord } from './records';
import type { JournalView } from './journal';
import { createGame } from './games/engine';

/** Rotate the frozen turn order so the worst-ranked nonwinner starts. */
export function rematchOrder(match: MatchRecord, view: JournalView): readonly string[] {
  const game = createGame(match.rulesSnapshot, match.settingsSnapshot.dartsMatch);
  const config = game.validateConfig(
    match.settingsSnapshot.engineConfig ?? {
      mode: match.mode,
      ownerIds:
        match.mode === 'teams'
          ? match.teamsSnapshot.map((team) => team.id)
          : match.playersSnapshot.map((player) => player.id),
    },
  );
  const ranking = game.getView(view.state, config).ranking;
  const winners = view.projection.winnerIds ?? view.state.winnerIds;
  const losers = ranking.filter((row) => !winners.includes(row.ownerId));
  const worstRank = Math.max(...losers.map((row) => row.rank));
  const starter =
    config.ownerIds.find((id) =>
      losers.some((row) => row.ownerId === id && row.rank === worstRank),
    ) ?? config.ownerIds[0]!;
  const index = config.ownerIds.indexOf(starter);
  return [...config.ownerIds.slice(index), ...config.ownerIds.slice(0, index)];
}
