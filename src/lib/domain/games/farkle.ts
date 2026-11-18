import { EngineError, type EngineConfig, type EngineState } from '../engine/types';
import { copyBoundedJson, immutable } from '../engine/validation';
import type { GameVersionRecord, JsonObject } from '../records';
import { recordedGame } from './recorded';
export function farkleVersion(
  target: 5000 | 10000,
  entry: 0 | 500,
  publishedAt: string,
): GameVersionRecord {
  return {
    id: `farkle-${target}-${entry}-v1`,
    gameId: '5000-10000',
    rulesetVersion: `farkle-${target}-${entry}-v1`,
    schemaVersion: 1,
    publishedAt,
    name: `${target} · entrée ${entry}`,
    definition: {
      schemaVersion: 1,
      id: '5000-10000',
      rulesetVersion: `farkle-${target}-${entry}-v1`,
      engine: 'farkle-fixed',
      supportedModes: ['individual', 'teams'],
      target,
      entry,
    },
  };
}
function validDice(dice: readonly number[]) {
  if (
    !Array.isArray(dice) ||
    dice.length < 1 ||
    dice.length > 6 ||
    dice.some((n) => !Number.isInteger(n) || n < 1 || n > 6)
  )
    throw new EngineError('invalid_command');
}
// Returns null if any selected die is unscored. Combinations never span rolls.
export function farkleScore(dice: readonly number[]): number | null {
  validDice(dice);
  const counts = Array.from({ length: 6 }, (_, i) => dice.filter((d) => d === i + 1).length);
  const groups = counts.filter(Boolean).sort((a, b) => a - b);
  if (dice.length === 6) {
    if (groups.length === 6 || groups.join(',') === '2,2,2' || groups.join(',') === '2,4')
      return 1500;
    if (groups.join(',') === '3,3') return 2500;
  }
  let total = 0;
  for (let face = 1; face <= 6; face++) {
    const count = counts[face - 1]!;
    if (count >= 3)
      total +=
        count === 6
          ? 3000
          : count === 5
            ? 2000
            : count === 4
              ? 1000
              : face === 1
                ? 300
                : face * 100;
    else if (face === 1) total += count * 100;
    else if (face === 5) total += count * 50;
    else if (count) return null;
  }
  return total;
}
export function farkleCanScore(dice: readonly number[]) {
  validDice(dice);
  return (
    dice.includes(1) ||
    dice.includes(5) ||
    [2, 3, 4, 6].some((n) => dice.filter((d) => d === n).length >= 3) ||
    farkleScore(dice) !== null
  );
}
export interface FarkleState extends EngineState {
  turn: number;
  running: number;
  remaining: number;
  finalTurns: number;
}
export function createFarkleGame(input: unknown) {
  const value = copyBoundedJson(input) as { target: 5000 | 10000; entry: 0 | 500 };
  if (
    !value ||
    ![5000, 10000].includes(value.target) ||
    ![0, 500].includes(value.entry) ||
    JSON.stringify(value) !==
      JSON.stringify(farkleVersion(value.target, value.entry, '').definition)
  )
    throw new EngineError('invalid_rules');
  const { target, entry } = value;
  function advance(state: FarkleState, config: EngineConfig, bank: boolean): FarkleState {
    const id = config.ownerIds[state.turn]!;
    const totals = { ...state.totals, [id]: state.totals[id]! + (bank ? state.running : 0) };
    let finalTurns = state.finalTurns;
    if (finalTurns >= 0) finalTurns--;
    else if (totals[id]! >= target) finalTurns = config.ownerIds.length - 1;
    const finished = finalTurns === 0;
    const best = Math.max(...Object.values(totals));
    return {
      ...state,
      totals,
      turn: (state.turn + 1) % config.ownerIds.length,
      running: 0,
      remaining: 6,
      finalTurns,
      status: finished ? 'finished' : 'in_progress',
      winnerIds: finished ? config.ownerIds.filter((id) => totals[id] === best) : [],
    };
  }
  const engine = recordedGame<FarkleState>({
    id: '5000-10000',
    rulesetVersion: farkleVersion(target, entry, '').rulesetVersion,
    initial: (config) => ({
      totals: Object.fromEntries(config.ownerIds.map((id) => [id, 0])),
      eventCount: 0,
      status: 'in_progress',
      winnerIds: [],
      turn: 0,
      running: 0,
      remaining: 6,
      finalTurns: -1,
    }),
    check(state, config) {
      const totals = Object.values(state.totals);
      if (
        Object.keys(state).length !== 8 ||
        !Number.isInteger(state.turn) ||
        state.turn < 0 ||
        state.turn >= config.ownerIds.length ||
        !Number.isSafeInteger(state.running) ||
        state.running < 0 ||
        state.running > 1e9 ||
        state.running % 50 ||
        !Number.isInteger(state.remaining) ||
        state.remaining < 1 ||
        state.remaining > 6 ||
        !Number.isInteger(state.finalTurns) ||
        state.finalTurns < -1 ||
        state.finalTurns >= config.ownerIds.length ||
        totals.some((n) => !Number.isSafeInteger(n) || n < 0 || n % 50 || n > 1e12) ||
        (state.finalTurns === -1 && totals.some((n) => n >= target)) ||
        (state.finalTurns >= 0 && !totals.some((n) => n >= target))
      )
        throw new EngineError('invalid_state');
      const winners =
        state.finalTurns === 0
          ? config.ownerIds.filter((id) => state.totals[id] === Math.max(...totals))
          : [];
      if (
        state.status !== (state.finalTurns === 0 ? 'finished' : 'in_progress') ||
        JSON.stringify(winners) !== JSON.stringify(state.winnerIds) ||
        (state.status === 'finished' && (state.running !== 0 || state.remaining !== 6))
      )
        throw new EngineError('invalid_state');
    },
    reduce(state, action, config) {
      if (action.ownerId !== config.ownerIds[state.turn]) throw new EngineError('invalid_command');
      const next = { ...state, eventCount: state.eventCount + 1 };
      if (action.values.kind === 1) {
        if (
          Object.keys(action.values).length !== 1 ||
          state.running === 0 ||
          (state.totals[action.ownerId] === 0 && state.running < entry)
        )
          throw new EngineError('invalid_command');
        return advance(next, config, true);
      }
      const { kind, keep } = action.values;
      if (
        kind !== 0 ||
        !Number.isInteger(keep) ||
        keep! < 0 ||
        keep! >= 2 ** state.remaining ||
        Object.keys(action.values).length !== state.remaining + 2
      )
        throw new EngineError('invalid_command');
      const dice = Array.from({ length: state.remaining }, (_, n) => action.values[`d${n + 1}`]!);
      validDice(dice);
      if (!farkleCanScore(dice)) {
        if (keep !== 0) throw new EngineError('invalid_command');
        return advance(next, config, false);
      }
      const selected = dice.filter((_, i) => (keep! & (1 << i)) !== 0);
      if (!selected.length) throw new EngineError('invalid_command');
      const score = farkleScore(selected);
      if (score === null) throw new EngineError('invalid_command');
      const remaining = state.remaining - selected.length;
      return { ...next, running: state.running + score, remaining: remaining || 6 };
    },
  });
  return Object.freeze({
    ...engine,
    definition: immutable(farkleVersion(target, entry, '').definition) as JsonObject & {
      schemaVersion: 1;
      supportedModes: readonly ['individual', 'teams'];
      target: 5000 | 10000;
      entry: 0 | 500;
    },
  });
}
