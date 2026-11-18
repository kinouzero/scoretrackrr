import {
  EngineError,
  type EngineConfig,
  type EngineState,
  type EngineView,
  type GameDefinition,
  type ScoreCommand,
  type ScoreEvent,
} from '../engine/types';
import {
  copyBoundedJson,
  immutable,
  parseCommand,
  parseConfig,
  parseEvent,
  parseState,
  safeKey,
} from '../engine/validation';

// A trusted reducer handles the game's phases; the journal retains the common command/event contract.
export function recordedGame<S extends EngineState>(options: {
  id: string;
  rulesetVersion: string;
  initial(config: EngineConfig): S;
  check(state: S, config: EngineConfig): void;
  reduce(state: S, action: Extract<ScoreCommand, { type: 'record' }>, config: EngineConfig): S;
  lowest?: boolean;
  minimumOwners?: number;
}): GameDefinition<EngineConfig, EngineState, ScoreCommand, ScoreEvent, EngineView> & {
  inspect(state: EngineState, config: EngineConfig): S;
} {
  function validateConfig(input: unknown) {
    const config = parseConfig(input);
    if (
      !['individual', 'teams'].includes(config.mode) ||
      config.ownerIds.length < (options.minimumOwners ?? 2) ||
      config.ownerIds.length > 16 ||
      config.ownerIds.some((id) => !safeKey(id))
    )
      throw new EngineError('invalid_config');
    return immutable(config);
  }
  function checked(input: EngineState, config: EngineConfig): S {
    const state = copyBoundedJson(input) as S;
    if (!state || typeof state !== 'object') throw new EngineError('invalid_state');
    parseState({
      totals: state.totals,
      eventCount: state.eventCount,
      status: state.status,
      winnerIds: state.winnerIds,
    });
    if (
      Object.keys(state.totals).length !== config.ownerIds.length ||
      config.ownerIds.some((id) => !Object.hasOwn(state.totals, id)) ||
      state.winnerIds.some((id) => !config.ownerIds.includes(id))
    )
      throw new EngineError('invalid_state');
    options.check(state, config);
    return immutable(state);
  }
  function transition(stateInput: EngineState, input: unknown, configInput: EngineConfig) {
    const config = validateConfig(configInput);
    const state = checked(stateInput, config);
    if (state.status === 'finished') throw new EngineError('finished');
    const action = parseCommand(input);
    if (action.type !== 'record' || !config.ownerIds.includes(action.ownerId))
      throw new EngineError('invalid_command');
    return { state, action, next: checked(options.reduce(state, action, config), config) };
  }
  return Object.freeze({
    id: options.id,
    rulesetVersion: options.rulesetVersion,
    supportedModes: ['individual', 'teams'] as const,
    validateConfig,
    initialState: (config: EngineConfig) =>
      checked(options.initial(validateConfig(config)), validateConfig(config)),
    inspect: (state: EngineState, config: EngineConfig) => checked(state, validateConfig(config)),
    validateAction: (state: EngineState, action: unknown, config: EngineConfig) =>
      immutable(transition(state, action, config).action),
    decide(state: EngineState, action: ScoreCommand, config: EngineConfig): readonly ScoreEvent[] {
      const result = transition(state, action, config);
      return immutable([
        {
          type: 'score_recorded',
          gameId: options.id,
          rulesetVersion: options.rulesetVersion,
          ownerId: result.action.ownerId,
          values: result.action.values,
          delta:
            result.next.totals[result.action.ownerId]! -
            result.state.totals[result.action.ownerId]!,
        },
      ]);
    },
    evolve(state: EngineState, input: ScoreEvent, config: EngineConfig) {
      const event = parseEvent(input);
      if (
        event.type !== 'score_recorded' ||
        event.gameId !== options.id ||
        event.rulesetVersion !== options.rulesetVersion
      )
        throw new EngineError('invalid_event');
      const result = transition(
        state,
        { type: 'record', ownerId: event.ownerId, values: event.values },
        config,
      );
      if (event.delta !== result.next.totals[event.ownerId]! - result.state.totals[event.ownerId]!)
        throw new EngineError('invalid_event');
      return result.next;
    },
    isFinished: (state: EngineState, config: EngineConfig) =>
      checked(state, validateConfig(config)).status === 'finished',
    getView(state: EngineState, input: EngineConfig): EngineView {
      const config = validateConfig(input);
      const value = checked(state, config);
      const sorted = config.ownerIds
        .map((ownerId) => ({ ownerId, total: value.totals[ownerId]! }))
        .sort((a, b) => (options.lowest ? a.total - b.total : b.total - a.total));
      let rank = 1;
      return immutable({
        ...value,
        ranking: sorted.map((row, index) => {
          if (index && row.total !== sorted[index - 1]!.total) rank = index + 1;
          return { ...row, rank };
        }),
      });
    },
  });
}
