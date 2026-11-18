import { EngineError, type EngineState } from '../engine/types';
import { copyBoundedJson, immutable, parseConfig } from '../engine/validation';
import type { GameVersionRecord, JsonObject } from '../records';
import { recordedGame } from './recorded';
export function flip7Version(publishedAt: string): GameVersionRecord {
  return {
    id: 'flip7-3_1-v1',
    gameId: 'flip-7',
    rulesetVersion: 'edition-3_1-v1',
    schemaVersion: 1,
    publishedAt,
    name: 'Édition 3.1 · 200 points',
    definition: {
      schemaVersion: 1,
      id: 'flip-7',
      rulesetVersion: 'edition-3_1-v1',
      engine: 'flip7-3_1',
      supportedModes: ['individual'],
    },
  };
}
export interface FlipHand {
  cards: number;
  modifiers: number;
  double: number;
  bust: number;
}
export interface FlipState extends EngineState {
  round: number;
  hands: Record<string, FlipHand | null>;
}
export function flip7Count(mask: number) {
  return Array.from({ length: 13 }, (_, n) => (mask >> n) & 1).reduce((a, b) => a + b, 0);
}
export function flip7Score(hand: FlipHand) {
  // A score-only bust omits card details; historical retained-card busts stay valid.
  const emptyBust =
    hand?.bust === 1 && hand.cards === 0 && hand.modifiers === 0 && hand.double === 0;
  if (
    !hand ||
    Object.keys(hand).length !== 4 ||
    !Number.isInteger(hand.cards) ||
    hand.cards < 0 ||
    hand.cards > 8191 ||
    !Number.isInteger(hand.modifiers) ||
    hand.modifiers < 0 ||
    hand.modifiers > 31 ||
    ![0, 1].includes(hand.double) ||
    ![0, 1].includes(hand.bust) ||
    flip7Count(hand.cards) > 7 ||
    (hand.bust === 1 && !emptyBust && (flip7Count(hand.cards) >= 7 || (hand.cards & ~3) === 0))
  )
    throw new EngineError('invalid_command');
  if (hand.bust) return 0;
  const sum = Array.from({ length: 13 }, (_, n) => (hand.cards & (1 << n) ? n : 0)).reduce(
    (a, b) => a + b,
    0,
  );
  const bonus = [2, 4, 6, 8, 10].reduce(
    (sum, n, i) => sum + (hand.modifiers & (1 << i) ? n : 0),
    0,
  );
  return sum * (hand.double ? 2 : 1) + bonus + (flip7Count(hand.cards) === 7 ? 15 : 0);
}
export function createFlip7Game(input: unknown) {
  if (JSON.stringify(copyBoundedJson(input)) !== JSON.stringify(flip7Version('').definition))
    throw new EngineError('invalid_rules');
  function validateConfig(input: unknown) {
    const config = parseConfig(input);
    if (config.mode !== 'individual' || config.ownerIds.length < 3 || config.ownerIds.length > 16)
      throw new EngineError('invalid_config');
    return immutable(config);
  }
  function resultStatus(state: FlipState) {
    const best = Math.max(...Object.values(state.totals));
    const winners = Object.keys(state.totals).filter((id) => state.totals[id] === best);
    const finished =
      Object.values(state.hands).every((hand) => hand !== null) &&
      best >= 200 &&
      winners.length === 1;
    return {
      status: finished ? ('finished' as const) : ('in_progress' as const),
      winnerIds: finished ? winners : [],
    };
  }
  function checkHands(hands: Readonly<Record<string, FlipHand | null>>) {
    const rows = Object.values(hands).filter((hand): hand is FlipHand => hand !== null);
    rows.forEach(flip7Score);
    if (
      rows.filter((hand) => flip7Count(hand.cards) === 7).length > 1 ||
      rows.reduce((sum, hand) => sum + hand.double, 0) > 1 ||
      [0, 1, 2, 3, 4].some((i) => rows.filter((hand) => hand.modifiers & (1 << i)).length > 1) ||
      Array.from({ length: 13 }, (_, n) => n).some(
        (n) => rows.filter((hand) => hand.cards & (1 << n)).length > Math.max(1, n),
      )
    )
      throw new EngineError('invalid_command');
  }
  const engine = recordedGame<FlipState>({
    id: 'flip-7',
    rulesetVersion: 'edition-3_1-v1',
    initial: (input) => {
      const config = validateConfig(input);
      return {
        totals: Object.fromEntries(config.ownerIds.map((id) => [id, 0])),
        eventCount: 0,
        status: 'in_progress',
        winnerIds: [],
        round: 1,
        hands: Object.fromEntries(config.ownerIds.map((id) => [id, null])),
      };
    },
    check(state, input) {
      const config = validateConfig(input);
      if (
        Object.keys(state).length !== 6 ||
        !Number.isInteger(state.round) ||
        state.round < 1 ||
        state.round > 1000 ||
        !state.hands ||
        typeof state.hands !== 'object' ||
        Object.keys(state.hands).length !== config.ownerIds.length ||
        config.ownerIds.some((id) => !Object.hasOwn(state.hands, id)) ||
        Object.values(state.totals).some((n) => !Number.isSafeInteger(n) || n < 0)
      )
        throw new EngineError('invalid_state');
      checkHands(state.hands);
      const expected = resultStatus(state);
      if (
        state.status !== expected.status ||
        JSON.stringify(state.winnerIds) !== JSON.stringify(expected.winnerIds)
      )
        throw new EngineError('invalid_state');
    },
    reduce(state, action, input) {
      const config = validateConfig(input);
      const values = action.values;
      if (values.round !== state.round) throw new EngineError('invalid_command');
      if (Object.values(state.hands).every((hand) => hand !== null)) {
        if (
          Object.keys(values).length !== 2 ||
          values.nextRound !== 1 ||
          action.ownerId !== config.ownerIds[0]
        )
          throw new EngineError('invalid_command');
        return {
          ...state,
          eventCount: state.eventCount + 1,
          round: state.round + 1,
          hands: Object.fromEntries(config.ownerIds.map((id) => [id, null])),
        };
      }
      if (Object.keys(values).length !== 5 || state.hands[action.ownerId] !== null)
        throw new EngineError('invalid_command');
      const hand = {
        cards: values.cards!,
        modifiers: values.modifiers!,
        double: values.double!,
        bust: values.bust!,
      };
      const score = flip7Score(hand);
      const hands = { ...state.hands, [action.ownerId]: hand };
      checkHands(hands);
      const next = {
        ...state,
        eventCount: state.eventCount + 1,
        hands,
        totals: { ...state.totals, [action.ownerId]: state.totals[action.ownerId]! + score },
      };
      return { ...next, ...resultStatus(next) };
    },
  });
  return Object.freeze({
    ...engine,
    validateConfig,
    supportedModes: ['individual'] as const,
    definition: immutable(flip7Version('').definition) as JsonObject & {
      schemaVersion: 1;
      supportedModes: readonly ['individual'];
    },
  });
}
