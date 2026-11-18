import { EngineError, type EngineState } from '../engine/types';
import { copyBoundedJson, immutable } from '../engine/validation';
import type { GameVersionRecord, JsonObject } from '../records';
import { dartScore } from './dartboard';
export { dartScore } from './dartboard';
import { x01VisitResult } from './visits';
import { recordedGame } from './recorded';
export function x01Version(
  start: number,
  doubleOut: boolean,
  publishedAt: string,
): GameVersionRecord {
  if (!Number.isInteger(start) || start < 101 || start > 701 || typeof doubleOut !== 'boolean')
    throw new EngineError('invalid_rules');
  const rulesetVersion = `x01-${start}-${doubleOut ? 'double' : 'straight'}-v1`;
  return {
    id: rulesetVersion,
    gameId: 'darts',
    rulesetVersion,
    schemaVersion: 1,
    publishedAt,
    name: `${start} · sortie ${doubleOut ? 'double' : 'simple'}`,
    definition: {
      schemaVersion: 1,
      id: 'darts',
      rulesetVersion,
      engine: 'x01',
      supportedModes: ['individual', 'teams'],
      start,
      doubleOut,
    },
  };
}
export interface X01State extends EngineState {
  turn: number;
  dartsUsed: number;
  visitStart: number;
  bust: boolean;
}
export function createX01Game(input: unknown) {
  const value = copyBoundedJson(input) as { start: number; doubleOut: boolean };
  if (
    !value ||
    !Number.isInteger(value.start) ||
    value.start < 101 ||
    value.start > 701 ||
    typeof value.doubleOut !== 'boolean' ||
    JSON.stringify(value) !==
      JSON.stringify(x01Version(value.start, value.doubleOut, '').definition)
  )
    throw new EngineError('invalid_rules');
  const { start, doubleOut } = value;
  const engine = recordedGame<X01State>({
    id: 'darts',
    rulesetVersion: x01Version(start, doubleOut, '').rulesetVersion,
    lowest: true,
    initial: (config) => ({
      totals: Object.fromEntries(config.ownerIds.map((id) => [id, start])),
      eventCount: 0,
      status: 'in_progress',
      winnerIds: [],
      turn: 0,
      dartsUsed: 0,
      visitStart: start,
      bust: false,
    }),
    check(state, config) {
      if (
        Object.keys(state).length !== 8 ||
        !Number.isInteger(state.turn) ||
        state.turn < 0 ||
        state.turn >= config.ownerIds.length ||
        !Number.isInteger(state.dartsUsed) ||
        state.dartsUsed < 0 ||
        state.dartsUsed > 2 ||
        !Number.isInteger(state.visitStart) ||
        state.visitStart < 0 ||
        state.visitStart > start ||
        typeof state.bust !== 'boolean' ||
        Object.values(state.totals).some(
          (n) => !Number.isInteger(n) || n < 0 || n > start || (doubleOut && n === 1),
        ) ||
        state.visitStart < state.totals[config.ownerIds[state.turn]!]! ||
        (state.dartsUsed === 0 &&
          state.visitStart !== state.totals[config.ownerIds[state.turn]!]) ||
        (state.bust && state.dartsUsed !== 0)
      )
        throw new EngineError('invalid_state');
      const winners = config.ownerIds.filter((id) => state.totals[id] === 0);
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
      const aggregate = Object.hasOwn(action.values, 'total');
      let remaining: number, bust: boolean, finished: boolean;
      if (aggregate) {
        const result = x01VisitResult(
          state.totals[action.ownerId]!,
          3 - state.dartsUsed,
          doubleOut,
          action.values.total!,
          action.values.checkout!,
        );
        ({ remaining, bust, finished } = result);
      } else {
        const { sector, multiplier } = action.values;
        remaining = state.totals[action.ownerId]! - dartScore(sector!, multiplier!);
        bust =
          remaining < 0 ||
          (doubleOut && (remaining === 1 || (remaining === 0 && multiplier !== 2)));
        finished = !bust && remaining === 0;
      }
      const totals = { ...state.totals, [action.ownerId]: bust ? state.visitStart : remaining };
      const nextVisit = aggregate || bust || state.dartsUsed === 2;
      const turn = finished
        ? state.turn
        : nextVisit
          ? (state.turn + 1) % config.ownerIds.length
          : state.turn;
      return {
        totals,
        eventCount: state.eventCount + 1,
        status: finished ? 'finished' : 'in_progress',
        winnerIds: finished ? [action.ownerId] : [],
        turn,
        dartsUsed: finished || nextVisit ? 0 : state.dartsUsed + 1,
        visitStart: finished ? 0 : nextVisit ? totals[config.ownerIds[turn]!]! : state.visitStart,
        bust,
      };
    },
  });
  return Object.freeze({
    ...engine,
    definition: immutable(x01Version(start, doubleOut, '').definition) as JsonObject & {
      schemaVersion: 1;
      supportedModes: readonly ['individual', 'teams'];
      start: number;
      doubleOut: boolean;
    },
  });
}
