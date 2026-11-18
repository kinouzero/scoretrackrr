import { EngineError, type EngineConfig, type EngineState } from '../engine/types';
import { copyBoundedJson, immutable } from '../engine/validation';
import type { GameVersionRecord, JsonObject } from '../records';
import { recordedGame } from './recorded';

export function four21Version(publishedAt: string): GameVersionRecord {
  return {
    id: '421-charge21-v1',
    gameId: '421',
    rulesetVersion: 'charge21-v1',
    schemaVersion: 1,
    publishedAt,
    name: 'Charge 21 · 421 = 10 · départage aux dés',
    definition: {
      schemaVersion: 1,
      id: '421',
      rulesetVersion: 'charge21-v1',
      engine: '421-charge21',
      supportedModes: ['individual', 'teams'],
    },
  };
}
export function combination421(input: readonly number[]) {
  if (
    !Array.isArray(input) ||
    input.length !== 3 ||
    input.some((n) => !Number.isInteger(n) || n < 1 || n > 6)
  )
    throw new EngineError('invalid_command');
  const [a, b, c] = [...input].sort((x, y) => y - x) as [number, number, number];
  if (a === 4 && b === 2 && c === 1) return { rank: 10000, tokens: 10 };
  if (a === 1) return { rank: 9000, tokens: 7 };
  if (b === 1 && c === 1) return { rank: 2000 + a * 200 + 1, tokens: a };
  if (a === b && b === c) return { rank: 2000 + a * 200, tokens: a };
  if (a === b + 1 && b === c + 1) return { rank: 1000 + a, tokens: 2 };
  if (a === 2 && b === 2 && c === 1) return { rank: 0, tokens: 2 };
  return { rank: a * 100 + b * 10 + c, tokens: 1 };
}
interface Hand {
  ownerId: string;
  dice: number[];
  throws: number;
}
export interface Four21State extends EngineState {
  pot: number;
  phase: 'charge' | 'discharge';
  starter: number;
  hands: Hand[];
}
export function four21Extremes(state: Four21State) {
  const ranks = state.hands.map((hand) => combination421(hand.dice).rank);
  return {
    best: state.hands.filter((_, i) => ranks[i] === Math.max(...ranks)).map((h) => h.ownerId),
    worst: state.hands.filter((_, i) => ranks[i] === Math.min(...ranks)).map((h) => h.ownerId),
  };
}
export function createFour21Game(input: unknown) {
  if (JSON.stringify(copyBoundedJson(input)) !== JSON.stringify(four21Version('').definition))
    throw new EngineError('invalid_rules');
  function complete(
    state: Four21State,
    config: EngineConfig,
    best: string,
    worst: string,
  ): Four21State {
    const totals = { ...state.totals };
    const bestHand = state.hands.find((h) => h.ownerId === best)!;
    const worstHand = state.hands.find((h) => h.ownerId === worst)!;
    const tokens =
      combination421(worstHand.dice).rank === 0 ? 2 : combination421(bestHand.dice).tokens;
    const amount = Math.min(tokens, state.phase === 'charge' ? state.pot : totals[best]!);
    totals[worst]! += amount;
    if (state.phase === 'discharge') totals[best]! -= amount;
    const pot = state.phase === 'charge' ? state.pot - amount : 0;
    const phase = pot === 0 ? 'discharge' : 'charge';
    const winnerIds = phase === 'discharge' ? config.ownerIds.filter((id) => totals[id] === 0) : [];
    return {
      ...state,
      totals,
      pot,
      phase,
      starter: config.ownerIds.indexOf(worst),
      hands: [],
      winnerIds,
      status: winnerIds.length ? 'finished' : 'in_progress',
    };
  }
  const engine = recordedGame<Four21State>({
    id: '421',
    rulesetVersion: 'charge21-v1',
    lowest: true,
    initial: (config) => ({
      totals: Object.fromEntries(config.ownerIds.map((id) => [id, 0])),
      eventCount: 0,
      status: 'in_progress',
      winnerIds: [],
      pot: 21,
      phase: 'charge',
      starter: 0,
      hands: [],
    }),
    check(state, config) {
      if (
        Object.keys(state).length !== 8 ||
        !Number.isInteger(state.pot) ||
        state.pot < 0 ||
        state.pot > 21 ||
        !['charge', 'discharge'].includes(state.phase) ||
        (state.phase === 'charge') !== state.pot > 0 ||
        !Number.isInteger(state.starter) ||
        state.starter < 0 ||
        state.starter >= config.ownerIds.length ||
        !Array.isArray(state.hands) ||
        state.hands.length > config.ownerIds.length ||
        Object.values(state.totals).some((n) => !Number.isInteger(n) || n < 0 || n > 21) ||
        Object.values(state.totals).reduce((a, b) => a + b, 0) + state.pot !== 21
      )
        throw new EngineError('invalid_state');
      state.hands.forEach((hand, i) => {
        if (
          !hand ||
          Object.keys(hand).length !== 3 ||
          hand.ownerId !== config.ownerIds[(state.starter + i) % config.ownerIds.length] ||
          !Number.isInteger(hand.throws) ||
          hand.throws < 1 ||
          hand.throws > (state.phase === 'charge' ? 1 : state.hands[0]!.throws) ||
          hand.throws > 3
        )
          throw new EngineError('invalid_state');
        combination421(hand.dice);
      });
      const winners =
        state.phase === 'discharge' ? config.ownerIds.filter((id) => state.totals[id] === 0) : [];
      if (
        JSON.stringify(winners) !== JSON.stringify(state.winnerIds) ||
        state.status !== (winners.length ? 'finished' : 'in_progress') ||
        (state.status === 'finished' && state.hands.length)
      )
        throw new EngineError('invalid_state');
    },
    reduce(state, action, config) {
      const next = { ...state, eventCount: state.eventCount + 1 };
      if (state.hands.length === config.ownerIds.length) {
        const { best, worst } = four21Extremes(state);
        const winner = config.ownerIds[action.values.best!],
          loser = config.ownerIds[action.values.worst!];
        if (
          Object.keys(action.values).length !== 2 ||
          !Number.isInteger(action.values.best) ||
          !Number.isInteger(action.values.worst) ||
          !winner ||
          !loser ||
          winner === loser ||
          action.ownerId !== config.ownerIds[state.starter] ||
          !best.includes(winner) ||
          !worst.includes(loser)
        )
          throw new EngineError('invalid_command');
        return complete(next, config, winner, loser);
      }
      const { d1, d2, d3, throws } = action.values;
      if (
        Object.keys(action.values).length !== 4 ||
        action.ownerId !==
          config.ownerIds[(state.starter + state.hands.length) % config.ownerIds.length] ||
        !Number.isInteger(throws) ||
        throws! < 1 ||
        throws! > (state.phase === 'charge' ? 1 : (state.hands[0]?.throws ?? 3))
      )
        throw new EngineError('invalid_command');
      combination421([d1!, d2!, d3!]);
      const hands = [
        ...state.hands,
        { ownerId: action.ownerId, dice: [d1!, d2!, d3!], throws: throws! },
      ];
      const pending = { ...next, hands };
      if (hands.length === config.ownerIds.length) {
        const { best, worst } = four21Extremes(pending);
        if (best.length === 1 && worst.length === 1)
          return complete(pending, config, best[0]!, worst[0]!);
      }
      return pending;
    },
  });
  return Object.freeze({
    ...engine,
    definition: immutable(four21Version('').definition) as JsonObject & {
      schemaVersion: 1;
      supportedModes: readonly ['individual', 'teams'];
    },
  });
}
