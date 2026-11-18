import type {
  DeclarativeRules,
  EngineConfig,
  EngineState,
  EngineView,
  GameDefinition,
  ScoreCommand,
  ScoreEvent,
} from './types';
import { EngineError } from './types';
import { boundedNumber, evaluate } from './expressions';
import {
  immutable,
  parseRules,
  parseConfig,
  parseState,
  parseCommand,
  parseEvent,
  safeKey,
} from './validation';

export interface DeclarativeGame extends GameDefinition<
  EngineConfig,
  EngineState,
  ScoreCommand,
  ScoreEvent,
  EngineView
> {
  readonly definition: DeclarativeRules;
}

export function createDeclarativeGame(input: unknown): DeclarativeGame {
  const definition = parseRules(input);
  const { id, rulesetVersion, supportedModes, objective } = definition;

  function validateConfig(input: unknown): EngineConfig {
    const config = parseConfig(input);
    if (!supportedModes.includes(config.mode) || config.ownerIds.some((id) => !safeKey(id)))
      throw new EngineError('invalid_config');
    if (definition.turns && definition.turns.rounds * config.ownerIds.length > 900)
      throw new EngineError('invalid_config');
    return immutable(config);
  }

  function bestOwners(totals: Readonly<Record<string, number>>, config: EngineConfig): string[] {
    const scores = config.ownerIds.map((id) => totals[id]!);
    const best = objective.direction === 'highest' ? Math.max(...scores) : Math.min(...scores);
    return config.ownerIds.filter((id) => totals[id] === best);
  }

  function reached(totals: Readonly<Record<string, number>>, config: EngineConfig): boolean {
    if (objective.target === undefined) return false;
    return config.ownerIds.some((id) =>
      objective.direction === 'highest'
        ? totals[id]! >= objective.target!
        : totals[id]! <= objective.target!,
    );
  }

  function roundBoundary(count: number, config: EngineConfig) {
    return !definition.turns || count % config.ownerIds.length === 0;
  }
  function scheduleComplete(count: number, config: EngineConfig) {
    return !!definition.turns && count === definition.turns.rounds * config.ownerIds.length;
  }
  function shouldFinish(
    totals: Readonly<Record<string, number>>,
    count: number,
    config: EngineConfig,
  ) {
    return (
      scheduleComplete(count, config) || (roundBoundary(count, config) && reached(totals, config))
    );
  }

  function checkedState(input: EngineState, config: EngineConfig): EngineState {
    const state = parseState(input);
    if (
      Object.keys(state.totals).length !== config.ownerIds.length ||
      config.ownerIds.some((id) => !Object.hasOwn(state.totals, id)) ||
      (state.status === 'in_progress' && state.winnerIds.length !== 0)
    )
      throw new EngineError('invalid_state');
    if (
      state.eventCount === 0 &&
      (state.status !== 'in_progress' ||
        config.ownerIds.some((id) => state.totals[id] !== definition.initialScore))
    )
      throw new EngineError('invalid_state');
    if (definition.turns && state.eventCount > definition.turns.rounds * config.ownerIds.length)
      throw new EngineError('invalid_state');
    const winners = bestOwners(state.totals, config);
    const resolvable = winners.length === 1 || definition.ties === 'shared';
    if (
      state.status === 'finished' &&
      (state.eventCount === 0 ||
        !resolvable ||
        state.winnerIds.length !== winners.length ||
        winners.some((id, index) => state.winnerIds[index] !== id) ||
        ((definition.turns || objective.target !== undefined) &&
          !shouldFinish(state.totals, state.eventCount, config)))
    )
      throw new EngineError('invalid_state');
    if (
      state.status === 'in_progress' &&
      shouldFinish(state.totals, state.eventCount, config) &&
      resolvable
    )
      throw new EngineError('invalid_state');
    return state;
  }

  function initialState(input: EngineConfig): EngineState {
    const config = validateConfig(input);
    return immutable({
      totals: Object.fromEntries(config.ownerIds.map((id) => [id, definition.initialScore])),
      eventCount: 0,
      status: 'in_progress',
      winnerIds: [],
    });
  }

  function valuesValid(values: Readonly<Record<string, number>>): boolean {
    return (
      Object.keys(values).length === definition.fields.length &&
      definition.fields.every(
        (field) =>
          Object.hasOwn(values, field.id) &&
          values[field.id]! >= field.minimum &&
          values[field.id]! <= field.maximum &&
          (!field.integer || Number.isInteger(values[field.id])),
      )
    );
  }

  function validateAction(
    stateInput: EngineState,
    input: unknown,
    configInput: EngineConfig,
  ): ScoreCommand {
    const config = validateConfig(configInput);
    const state = checkedState(stateInput, config);
    if (state.status === 'finished') throw new EngineError('finished');
    if (state.eventCount >= 10_000) throw new EngineError('input_limit');
    const command = parseCommand(input);
    if (command.type === 'record') {
      if (
        (definition.turns &&
          command.ownerId !== config.ownerIds[state.eventCount % config.ownerIds.length]) ||
        !config.ownerIds.includes(command.ownerId) ||
        !valuesValid(command.values)
      )
        throw new EngineError('invalid_command');
    } else {
      if (definition.turns) throw new EngineError('invalid_command');
      if (state.eventCount === 0) throw new EngineError('empty_game');
      if (objective.target !== undefined) throw new EngineError('target_not_reached');
      if (definition.ties === 'continue' && bestOwners(state.totals, config).length > 1)
        throw new EngineError('tie');
    }
    return immutable(command);
  }

  function decide(
    state: EngineState,
    command: ScoreCommand,
    config: EngineConfig,
  ): readonly ScoreEvent[] {
    const action = validateAction(state, command, config);
    const identity = { gameId: id, rulesetVersion };
    if (action.type === 'record') {
      const delta = evaluate(definition.score, action.values);
      boundedNumber(state.totals[action.ownerId]! + delta);
      return immutable([
        {
          ...identity,
          type: 'score_recorded',
          ownerId: action.ownerId,
          values: action.values,
          delta,
        },
      ]);
    }
    return immutable([{ ...identity, type: 'game_finished' }]);
  }

  function evolve(
    stateInput: EngineState,
    input: ScoreEvent,
    configInput: EngineConfig,
  ): EngineState {
    const config = validateConfig(configInput);
    const state = checkedState(stateInput, config);
    const event = parseEvent(input);
    if (event.gameId !== id || event.rulesetVersion !== rulesetVersion)
      throw new EngineError('invalid_event');
    const command: ScoreCommand =
      event.type === 'score_recorded'
        ? { type: 'record', ownerId: event.ownerId, values: event.values }
        : { type: 'finish' };
    validateAction(state, command, config);
    const totals = { ...state.totals };
    if (event.type === 'score_recorded') {
      if (evaluate(definition.score, event.values) !== event.delta)
        throw new EngineError('invalid_event');
      totals[event.ownerId] = boundedNumber(totals[event.ownerId]! + event.delta);
    }
    const winners = bestOwners(totals, config);
    const finished =
      (event.type === 'game_finished' || shouldFinish(totals, state.eventCount + 1, config)) &&
      (winners.length === 1 || definition.ties === 'shared');
    return immutable({
      totals,
      eventCount: state.eventCount + 1,
      status: finished ? 'finished' : 'in_progress',
      winnerIds: finished ? winners : [],
    });
  }

  function getView(stateInput: EngineState, configInput: EngineConfig): EngineView {
    const config = validateConfig(configInput);
    const state = checkedState(stateInput, config);
    const sorted = config.ownerIds
      .map((ownerId, order) => ({ ownerId, order, total: state.totals[ownerId]! }))
      .sort(
        (left, right) =>
          (objective.direction === 'highest'
            ? right.total - left.total
            : left.total - right.total) || left.order - right.order,
      );
    let rank = 1;
    const ranking = sorted.map((owner, index) => {
      if (index > 0 && owner.total !== sorted[index - 1]!.total) rank = index + 1;
      return { ownerId: owner.ownerId, total: owner.total, rank };
    });
    return immutable({ ...state, ranking });
  }

  return Object.freeze({
    id,
    rulesetVersion,
    supportedModes,
    definition,
    validateConfig,
    initialState,
    validateAction,
    decide,
    evolve,
    getView,
    isFinished: (state: EngineState, config: EngineConfig) =>
      checkedState(state, validateConfig(config)).status === 'finished',
  });
}

export function replayEvents(
  game: DeclarativeGame,
  configInput: unknown,
  events: readonly unknown[],
): EngineState {
  if (!Array.isArray(events) || events.length > 10_000) throw new EngineError('input_limit');
  const config = game.validateConfig(configInput);
  return events.reduce<EngineState>(
    (state, event) => game.evolve(state, parseEvent(event), config),
    game.initialState(config),
  );
}
