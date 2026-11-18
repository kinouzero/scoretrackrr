import { createGame } from '#lib/domain/games/engine';
import { validatePetanqueCommand } from '#lib/domain/games/petanque';
import type { MatchRecord } from '#lib/domain/records';
import type { EngineState, ScoreCommand } from '#lib/domain/engine/types';
export function createScorePreview(match: MatchRecord) {
  const game = createGame(match.rulesSnapshot, match.settingsSnapshot.dartsMatch);
  const config = game.validateConfig(match.settingsSnapshot.engineConfig);
  return (state: EngineState, command: ScoreCommand) => {
    if (match.rulesSnapshot.gameId === 'petanque' && command.type === 'record')
      validatePetanqueCommand(match, command);
    const action = game.validateAction(state, command, config);
    let next = state;
    for (const event of game.decide(state, action, config)) next = game.evolve(next, event, config);
    const inspected = 'inspect' in game ? game.inspect(next, config) : next;
    return {
      changes: config.ownerIds
        .map((id) => ({
          id,
          before: state.totals[id]!,
          after: next.totals[id]!,
          delta: next.totals[id]! - state.totals[id]!,
        }))
        .filter(
          (item) => item.delta !== 0 || (command.type === 'record' && item.id === command.ownerId),
        ),
      bust: 'bust' in inspected && inspected.bust === true,
      finished: next.status === 'finished',
      pending:
        'running' in inspected && typeof inspected.running === 'number'
          ? inspected.running
          : undefined,
    };
  };
}

export function previewScore(match: MatchRecord, state: EngineState, command: ScoreCommand) {
  return createScorePreview(match)(state, command);
}
