import type { MatchRecord } from './records';
import type { AuditEntry } from './journal';
import type { DartsMatchState } from './games/darts-match';
import type { X01State } from './games/darts';
import type { CricketState } from './games/cricket';
import { createGame } from './games/engine';
import { scoreSlots } from './score-slots';

// Replay active scoring slots so corrections and undo cannot drift member rotation.
export function activeTeamPlayer(
  match: MatchRecord,
  audit: readonly AuditEntry[],
  ownerId: string,
) {
  const team = match.teamsSnapshot.find((team) => team.id === ownerId);
  const family = match.rulesSnapshot.gameId;
  if (!team?.playerIds.length || !['times-up', 'molkky', 'darts'].includes(family))
    return undefined;
  const commands = scoreSlots(audit).flatMap((slot) => (slot.command ? [slot.command] : []));
  let completed = 0;
  if (family === 'darts') {
    const game = createGame(match.rulesSnapshot, match.settingsSnapshot.dartsMatch);
    const config = game.validateConfig(match.settingsSnapshot.engineConfig);
    let state = game.initialState(config);
    for (const command of commands) {
      state = game
        .decide(state, command, config)
        .reduce((s, event) => game.evolve(s, event, config), state);
      // A full visit, a bust or a winning dart ends the member's turn. Leg markers do not.
      const position = (
        match.settingsSnapshot.dartsMatch === undefined
          ? state
          : (state as DartsMatchState).legState
      ) as X01State | CricketState;
      if (
        command.ownerId === ownerId &&
        command.values.nextLeg === undefined &&
        position.dartsUsed === 0
      )
        completed++;
    }
  } else {
    completed = commands.filter(
      (command) =>
        command.ownerId === ownerId && (family === 'molkky' || command.values.kind === 2),
    ).length;
  }
  const playerId = team.playerIds[completed % team.playerIds.length];
  return match.playersSnapshot.find((player) => player.id === playerId);
}
