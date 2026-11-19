import { EngineError, type EngineConfig, type EngineState } from '../engine/types';
import { copyBoundedJson, immutable } from '../engine/validation';
import { recordedGame } from './recorded';
import { createX01Game } from './darts';
import { createCricketGame } from './cricket';

// Keep the longest possible set match within the engine's bounded history array.
export const MAX_DARTS_LEGS_PER_SET = 7;
export const MAX_DARTS_SETS_TO_WIN = 5;

export interface DartsMatchOptions {
  legsToWin: number;
  setsToWin?: number;
  startingRule: 'alternate' | 'loser';
  firstStarterId: string;
}
export interface DartsMatchState extends EngineState {
  legState: EngineState;
  legWinners: string[];
  starterId: string;
}
export function dartsMatchOptions(input: unknown): Readonly<DartsMatchOptions> {
  const value = copyBoundedJson(input) as DartsMatchOptions;
  if (
    !value ||
    typeof value !== 'object' ||
    Object.keys(value).length !== (Object.hasOwn(value, 'setsToWin') ? 4 : 3) ||
    !Number.isInteger(value.legsToWin) ||
    value.legsToWin < 2 ||
    value.legsToWin > 15 ||
    (Object.hasOwn(value, 'setsToWin') &&
      (typeof value.setsToWin !== 'number' ||
        !Number.isInteger(value.setsToWin) ||
        value.setsToWin < 2 ||
        value.setsToWin > MAX_DARTS_SETS_TO_WIN ||
        value.legsToWin > MAX_DARTS_LEGS_PER_SET)) ||
    !['alternate', 'loser'].includes(value.startingRule) ||
    typeof value.firstStarterId !== 'string'
  )
    throw new EngineError('invalid_config');
  return immutable(value);
}
export function createDartsMatchGame(input: unknown, optionsInput: unknown) {
  const definition = copyBoundedJson(input) as { engine?: string };
  if (!definition || typeof definition !== 'object' || Array.isArray(definition))
    throw new EngineError('invalid_rules');
  const base = definition.engine === 'cricket' ? createCricketGame(input) : createX01Game(input);
  const options = dartsMatchOptions(optionsInput);
  function validateConfig(input: unknown) {
    const config = base.validateConfig(input);
    if (config.ownerIds.length !== 2 || !config.ownerIds.includes(options.firstStarterId))
      throw new EngineError('invalid_config');
    return config;
  }
  function starter(history: readonly string[], config: EngineConfig) {
    if (!history.length) return options.firstStarterId;
    return options.startingRule === 'loser'
      ? config.ownerIds.find((id) => id !== history.at(-1))!
      : config.ownerIds[(config.ownerIds.indexOf(options.firstStarterId) + history.length) % 2]!;
  }
  function legConfig(starterId: string, config: EngineConfig): EngineConfig {
    return {
      ...config,
      ownerIds: [starterId, ...config.ownerIds.filter((id) => id !== starterId)],
    };
  }
  function standings(history: readonly string[], config: EngineConfig) {
    const empty = () => Object.fromEntries(config.ownerIds.map((id) => [id, 0]));
    let legs = empty();
    const sets = empty();
    let setWinnerId: string | undefined;
    let winnerId: string | undefined;
    for (const id of history) {
      if (setWinnerId) {
        legs = empty();
        setWinnerId = undefined;
      }
      legs[id] = legs[id]! + 1;
      if (legs[id] !== options.legsToWin) continue;
      if (options.setsToWin === undefined) {
        winnerId = id;
        break;
      }
      setWinnerId = id;
      sets[id] = sets[id]! + 1;
      if (sets[id] === options.setsToWin) {
        winnerId = id;
        break;
      }
    }
    return { legs, sets, setWinnerId, winnerId };
  }
  function derive(
    legState: EngineState,
    legWinners: string[],
    starterId: string,
    eventCount: number,
    config: EngineConfig,
  ): DartsMatchState {
    const { winnerId } = standings(legWinners, config);
    const winnerIds = winnerId ? [winnerId] : [];
    return {
      legState,
      legWinners,
      starterId,
      eventCount,
      totals: legState.totals,
      status: winnerIds.length ? 'finished' : 'in_progress',
      winnerIds,
    };
  }
  const engine = recordedGame<DartsMatchState>({
    id: base.id,
    rulesetVersion: base.rulesetVersion,
    lowest: definition.engine !== 'cricket',
    initial: (input) => {
      const config = validateConfig(input);
      return derive(
        base.initialState(legConfig(options.firstStarterId, config)),
        [],
        options.firstStarterId,
        0,
        config,
      );
    },
    check(state, input) {
      const config = validateConfig(input);
      if (
        Object.keys(state).length !== 7 ||
        !Array.isArray(state.legWinners) ||
        state.legWinners.length >
          (options.legsToWin * 2 - 1) * ((options.setsToWin ?? 1) * 2 - 1) ||
        state.legWinners.some((id) => !config.ownerIds.includes(id)) ||
        !config.ownerIds.includes(state.starterId)
      )
        throw new EngineError('invalid_state');
      const leg = base.inspect(state.legState, legConfig(state.starterId, config));
      const completed = leg.status === 'finished';
      const prior = completed ? state.legWinners.slice(0, -1) : state.legWinners;
      if (
        (completed &&
          (!state.legWinners.length ||
            leg.winnerIds.length !== 1 ||
            state.legWinners.at(-1) !== leg.winnerIds[0])) ||
        state.starterId !== starter(prior, config) ||
        standings(prior, config).winnerId !== undefined ||
        state.eventCount < state.legWinners.length
      )
        throw new EngineError('invalid_state');
      const expected = derive(leg, state.legWinners, state.starterId, state.eventCount, config);
      if (
        state.status !== expected.status ||
        JSON.stringify(state.winnerIds) !== JSON.stringify(expected.winnerIds) ||
        config.ownerIds.some((id) => state.totals[id] !== expected.totals[id])
      )
        throw new EngineError('invalid_state');
    },
    reduce(state, action, input) {
      const config = validateConfig(input);
      if (state.legState.status === 'finished') {
        const next = starter(state.legWinners, config);
        if (
          Object.keys(action.values).length !== 1 ||
          action.values.nextLeg !== 1 ||
          action.ownerId !== next
        )
          throw new EngineError('invalid_command');
        return derive(
          base.initialState(legConfig(next, config)),
          [...state.legWinners],
          next,
          state.eventCount + 1,
          config,
        );
      }
      if (Object.hasOwn(action.values, 'nextLeg')) throw new EngineError('invalid_command');
      const settings = legConfig(state.starterId, config);
      const leg = base
        .decide(state.legState, action, settings)
        .reduce((s, e) => base.evolve(s, e, settings), state.legState);
      const history =
        leg.status === 'finished'
          ? [...state.legWinners, leg.winnerIds[0]!]
          : [...state.legWinners];
      return derive(leg, history, state.starterId, state.eventCount + 1, config);
    },
  });
  return Object.freeze({
    ...engine,
    definition: base.definition,
    options,
    validateConfig,
    getLegConfig: (state: EngineState, config: EngineConfig) => {
      const value = engine.inspect(state, validateConfig(config));
      return immutable(legConfig(value.starterId, config));
    },
    getProgress: (state: EngineState, input: EngineConfig) => {
      const config = validateConfig(input);
      const value = engine.inspect(state, config);
      const completed = value.legState.status === 'finished';
      const { legs, sets, setWinnerId } = standings(value.legWinners, config);
      const newSet = !completed && setWinnerId !== undefined;
      const wins = newSet ? Object.fromEntries(config.ownerIds.map((id) => [id, 0])) : legs;
      const setNumber =
        Object.values(sets).reduce((total, wins) => total + wins, 0) +
        (completed && setWinnerId ? 0 : 1);
      return immutable({
        number: Object.values(wins).reduce((total, wins) => total + wins, 0) + (completed ? 0 : 1),
        wins,
        sets: options.setsToWin === undefined ? undefined : sets,
        setNumber,
        setWinnerId: completed ? setWinnerId : undefined,
        legWinnerId: completed ? value.legState.winnerIds[0] : undefined,
        nextStarterId:
          completed && value.status !== 'finished' ? starter(value.legWinners, config) : undefined,
      });
    },
  });
}
