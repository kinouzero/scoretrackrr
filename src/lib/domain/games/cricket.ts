import { EngineError, type EngineState } from '../engine/types';
import { copyBoundedJson, immutable } from '../engine/validation';
import type { GameVersionRecord, JsonObject } from '../records';
import { recordedGame } from './recorded';
import { dartScore } from './darts';
export const cricketTargets = [20, 19, 18, 17, 16, 15, 25] as const;
export function cricketVersion(points: boolean, publishedAt: string): GameVersionRecord {
  const rulesetVersion = `cricket-${points ? 'points' : 'no-score'}-v1`;
  return {
    id: rulesetVersion,
    gameId: 'darts',
    rulesetVersion,
    schemaVersion: 1,
    publishedAt,
    name: points ? 'Cricket · points classiques' : 'Cricket · sans points',
    definition: {
      schemaVersion: 1,
      id: 'darts',
      rulesetVersion,
      engine: 'cricket',
      supportedModes: ['individual', 'teams'],
      points,
    },
  };
}
export interface CricketState extends EngineState {
  marks: Record<string, number[]>;
  turn: number;
  dartsUsed: number;
}
export function createCricketGame(input: unknown) {
  const value = copyBoundedJson(input) as { points: boolean };
  if (
    !value ||
    typeof value.points !== 'boolean' ||
    JSON.stringify(value) !== JSON.stringify(cricketVersion(value.points, '').definition)
  )
    throw new EngineError('invalid_rules');
  const points = value.points;
  const engine = recordedGame<CricketState>({
    id: 'darts',
    rulesetVersion: cricketVersion(points, '').rulesetVersion,
    initial: (config) => ({
      totals: Object.fromEntries(config.ownerIds.map((id) => [id, 0])),
      eventCount: 0,
      status: 'in_progress',
      winnerIds: [],
      marks: Object.fromEntries(config.ownerIds.map((id) => [id, [0, 0, 0, 0, 0, 0, 0]])),
      turn: 0,
      dartsUsed: 0,
    }),
    check(state, config) {
      if (
        Object.keys(state).length !== 7 ||
        !Number.isInteger(state.turn) ||
        state.turn < 0 ||
        state.turn >= config.ownerIds.length ||
        !Number.isInteger(state.dartsUsed) ||
        state.dartsUsed < 0 ||
        state.dartsUsed > 2 ||
        !state.marks ||
        typeof state.marks !== 'object' ||
        Array.isArray(state.marks) ||
        Object.keys(state.marks).length !== config.ownerIds.length ||
        config.ownerIds.some(
          (id) =>
            !Array.isArray(state.marks[id]) ||
            state.marks[id]!.length !== 7 ||
            state.marks[id]!.some((n) => !Number.isInteger(n) || n < 0 || n > 3),
        ) ||
        Object.values(state.totals).some(
          (n) => !Number.isSafeInteger(n) || n < 0 || n > 1e12 || (!points && n !== 0),
        )
      )
        throw new EngineError('invalid_state');
      const best = Math.max(...Object.values(state.totals));
      const winners = config.ownerIds.filter(
        (id) => state.marks[id]!.every((n) => n === 3) && state.totals[id] === best,
      );
      if (
        winners.length > 1 ||
        JSON.stringify(winners) !== JSON.stringify(state.winnerIds) ||
        state.status !== (winners.length ? 'finished' : 'in_progress')
      )
        throw new EngineError('invalid_state');
    },
    reduce(state, action, config) {
      if (action.ownerId !== config.ownerIds[state.turn] || Object.keys(action.values).length !== 2)
        throw new EngineError('invalid_command');
      const { sector, multiplier } = action.values;
      dartScore(sector!, multiplier!);
      const index = cricketTargets.findIndex((n) => n === sector);
      const marks = { ...state.marks, [action.ownerId]: [...state.marks[action.ownerId]!] };
      const totals = { ...state.totals };
      if (index !== -1) {
        const previous = marks[action.ownerId]![index]!;
        const hits = previous + multiplier!;
        marks[action.ownerId]![index] = Math.min(3, hits);
        if (points && config.ownerIds.some((id) => id !== action.ownerId && marks[id]![index]! < 3))
          totals[action.ownerId]! += Math.max(0, hits - 3) * sector!;
      }
      const finished =
        marks[action.ownerId]!.every((n) => n === 3) &&
        totals[action.ownerId]! >= Math.max(...Object.values(totals));
      const nextVisit = state.dartsUsed === 2;
      return {
        totals,
        marks,
        eventCount: state.eventCount + 1,
        status: finished ? 'finished' : 'in_progress',
        winnerIds: finished ? [action.ownerId] : [],
        turn: finished
          ? state.turn
          : nextVisit
            ? (state.turn + 1) % config.ownerIds.length
            : state.turn,
        dartsUsed: finished || nextVisit ? 0 : state.dartsUsed + 1,
      };
    },
  });
  return Object.freeze({
    ...engine,
    definition: immutable(cricketVersion(points, '').definition) as JsonObject & {
      schemaVersion: 1;
      supportedModes: readonly ['individual', 'teams'];
      points: boolean;
    },
  });
}
