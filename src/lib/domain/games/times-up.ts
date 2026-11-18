import { EngineError, type EngineState } from '../engine/types';
import { copyBoundedJson, immutable, parseConfig } from '../engine/validation';
import type { GameVersionRecord, JsonObject } from '../records';
import { recordedGame } from './recorded';

export interface TimesUpOptions {
  readonly cardCount: number;
  readonly durationSeconds: number;
}
export const defaultTimesUpOptions: TimesUpOptions = { cardCount: 40, durationSeconds: 30 };
const DAY = 86_400_000;
// Split wall time to stay within the shared numeric command contract.
export function timerClock(at: number) {
  return { day: Math.floor(at / DAY), ms: at % DAY };
}
export function timesUpVersion(publishedAt: string): GameVersionRecord {
  return configuredTimesUpVersion(defaultTimesUpOptions, publishedAt);
}
export function configuredTimesUpVersion(
  options: TimesUpOptions,
  publishedAt: string,
): GameVersionRecord {
  if (
    !options ||
    !Number.isInteger(options.cardCount) ||
    options.cardCount < 1 ||
    options.cardCount > 1000 ||
    !Number.isInteger(options.durationSeconds) ||
    options.durationSeconds < 1 ||
    options.durationSeconds > 600
  )
    throw new EngineError('invalid_rules');
  const rulesetVersion = `party-c${options.cardCount}-t${options.durationSeconds}-v1`;
  return {
    id: `times-up-${rulesetVersion}`,
    gameId: 'times-up',
    rulesetVersion,
    schemaVersion: 1,
    publishedAt,
    name: `Party · ${options.cardCount} cards · ${options.durationSeconds}s`,
    definition: {
      schemaVersion: 1,
      id: 'times-up',
      rulesetVersion,
      engine: 'times-up',
      supportedModes: ['teams'],
      cardCount: options.cardCount,
      durationSeconds: options.durationSeconds,
    },
  };
}
export interface TimesUpState extends EngineState {
  round: number;
  cards: number;
  turn: number;
  clockAt: number;
  remainingMs: number;
  deadline: number | null;
  started: boolean;
}
export function timerRemaining(state: Pick<TimesUpState, 'deadline' | 'remainingMs'>, at: number) {
  return state.deadline === null
    ? state.remainingMs
    : Math.max(0, Math.min(state.remainingMs, state.deadline - at));
}
export function createTimesUpGame(input: unknown) {
  const rules = copyBoundedJson(input) as JsonObject;
  const options = {
    cardCount: rules?.cardCount as number,
    durationSeconds: rules?.durationSeconds as number,
  };
  const version = configuredTimesUpVersion(options, '');
  if (JSON.stringify(rules) !== JSON.stringify(version.definition))
    throw new EngineError('invalid_rules');
  const { cardCount } = options;
  const duration = options.durationSeconds * 1000;
  function validateConfig(input: unknown) {
    const config = parseConfig(input);
    if (config.mode !== 'teams' || config.ownerIds.length < 2 || config.ownerIds.length > 6)
      throw new EngineError('invalid_config');
    return immutable(config);
  }
  const engine = recordedGame<TimesUpState>({
    id: 'times-up',
    rulesetVersion: version.rulesetVersion,
    initial(config) {
      validateConfig(config);
      return {
        totals: Object.fromEntries(config.ownerIds.map((id) => [id, 0])),
        eventCount: 0,
        status: 'in_progress',
        winnerIds: [],
        round: 1,
        cards: cardCount,
        turn: 0,
        clockAt: 0,
        remainingMs: duration,
        deadline: null,
        started: false,
      };
    },
    check(state, config) {
      validateConfig(config);
      const finished = state.round === 3 && state.cards === 0;
      const best = Math.max(...Object.values(state.totals));
      const winners = finished ? config.ownerIds.filter((id) => state.totals[id] === best) : [];
      if (
        Object.keys(state).length !== 11 ||
        !Number.isInteger(state.round) ||
        state.round < 1 ||
        state.round > 3 ||
        !Number.isInteger(state.cards) ||
        state.cards < (finished ? 0 : 1) ||
        state.cards > cardCount ||
        !Number.isSafeInteger(state.turn) ||
        state.turn < 0 ||
        state.turn > state.eventCount ||
        !Number.isSafeInteger(state.clockAt) ||
        state.clockAt < 0 ||
        !Number.isInteger(state.remainingMs) ||
        state.remainingMs < 0 ||
        state.remainingMs > duration ||
        typeof state.started !== 'boolean' ||
        (state.deadline !== null &&
          (!Number.isSafeInteger(state.deadline) ||
            !state.started ||
            state.deadline !== state.clockAt + state.remainingMs)) ||
        (!state.started && (state.remainingMs !== duration || state.deadline !== null)) ||
        Object.values(state.totals).some((n) => n < 0 || n > cardCount * 3) ||
        Object.values(state.totals).reduce((a, b) => a + b, 0) !==
          cardCount * (state.round - 1) + cardCount - state.cards ||
        state.status !== (finished ? 'finished' : 'in_progress') ||
        JSON.stringify(state.winnerIds) !== JSON.stringify(winners)
      )
        throw new EngineError('invalid_state');
    },
    reduce(state, action, config) {
      const { kind, day, ms, turn, points } = action.values;
      const at = day! * DAY + ms!;
      if (
        Object.keys(action.values).length !== (kind === 2 ? 5 : 4) ||
        !Number.isInteger(day) ||
        day! < 0 ||
        !Number.isInteger(ms) ||
        ms! < 0 ||
        ms! >= DAY ||
        !Number.isSafeInteger(at) ||
        at < state.clockAt ||
        turn !== state.turn ||
        action.ownerId !== config.ownerIds[state.turn % config.ownerIds.length]
      )
        throw new EngineError('invalid_command');
      const next = { ...state, eventCount: state.eventCount + 1, clockAt: at };
      if (kind === 0) {
        if (state.deadline !== null || state.remainingMs === 0)
          throw new EngineError('invalid_command');
        return { ...next, started: true, deadline: at + state.remainingMs };
      }
      if (kind === 1) {
        if (state.deadline === null) throw new EngineError('invalid_command');
        return { ...next, remainingMs: timerRemaining(state, at), deadline: null };
      }
      if (kind === 3) return { ...next, started: false, remainingMs: duration, deadline: null };
      if (
        kind !== 2 ||
        !state.started ||
        !Number.isInteger(points) ||
        points! < 0 ||
        points! > state.cards
      )
        throw new EngineError('invalid_command');
      const totals = { ...state.totals, [action.ownerId]: state.totals[action.ownerId]! + points! };
      const finished = state.round === 3 && points === state.cards;
      const best = Math.max(...Object.values(totals));
      return {
        ...next,
        totals,
        turn: state.turn + 1,
        cards: points === state.cards && !finished ? cardCount : state.cards - points!,
        round: points === state.cards && !finished ? state.round + 1 : state.round,
        started: false,
        deadline: null,
        remainingMs: duration,
        status: finished ? 'finished' : 'in_progress',
        winnerIds: finished ? config.ownerIds.filter((id) => totals[id] === best) : [],
      };
    },
  });
  return Object.freeze({
    ...engine,
    options: immutable(options),
    validateConfig,
    supportedModes: ['teams'] as const,
    definition: immutable(version.definition) as JsonObject & {
      schemaVersion: 1;
      supportedModes: readonly ['teams'];
    },
  });
}
