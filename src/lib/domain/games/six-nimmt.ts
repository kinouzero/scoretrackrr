import { EngineError, type EngineState } from '../engine/types';
import { copyBoundedJson, immutable, parseConfig } from '../engine/validation';
import type { GameVersionRecord, JsonObject } from '../records';
import { recordedGame } from './recorded';

// Sum of bullheads in the 104-card base deck; actual dealt piles may contain fewer.
export const SIX_NIMMT_ROUND_LIMIT = 171;
export interface SixNimmtOptions {
  readonly expansion: 'none' | 'jokers' | 'surprises';
  readonly passCards: boolean;
  readonly variableRows: boolean;
}
export const defaultSixNimmtOptions: SixNimmtOptions = {
  expansion: 'none',
  passCards: false,
  variableRows: false,
};
export function sixNimmtVersion(publishedAt: string): GameVersionRecord {
  return configuredSixNimmtVersion(defaultSixNimmtOptions, publishedAt);
}
export function configuredSixNimmtVersion(
  options: SixNimmtOptions,
  publishedAt: string,
): GameVersionRecord {
  if (
    !options ||
    !['none', 'jokers', 'surprises'].includes(options.expansion) ||
    typeof options.passCards !== 'boolean' ||
    typeof options.variableRows !== 'boolean' ||
    (options.expansion === 'surprises' && (options.passCards || options.variableRows))
  )
    throw new EngineError('invalid_rules');
  const rulesetVersion = `${options.expansion}-p${+options.passCards}-r${+options.variableRows}-v1`;
  return {
    id: `six-nimmt-${rulesetVersion}`,
    gameId: '6-qui-prend',
    rulesetVersion,
    schemaVersion: 1,
    publishedAt,
    name: `6 qui prend! · ${options.expansion}`,
    definition: {
      schemaVersion: 1,
      id: '6-qui-prend',
      rulesetVersion,
      engine: 'six-nimmt',
      supportedModes: ['individual'],
      expansion: options.expansion,
      passCards: options.passCards,
      variableRows: options.variableRows,
    },
  };
}
export interface SixNimmtState extends EngineState {
  round: number;
  entries: Record<string, number | null>;
}
export function createSixNimmtGame(input: unknown) {
  const rules = copyBoundedJson(input) as JsonObject;
  const options: SixNimmtOptions = {
    expansion: rules?.expansion as SixNimmtOptions['expansion'],
    passCards: rules?.passCards as boolean,
    variableRows: rules?.variableRows as boolean,
  };
  const version = configuredSixNimmtVersion(options, '');
  if (JSON.stringify(rules) !== JSON.stringify(version.definition))
    throw new EngineError('invalid_rules');
  const maxPlayers = options.expansion === 'surprises' ? 8 : 10;
  function roundLimit(players: number) {
    return SIX_NIMMT_ROUND_LIMIT + (options.expansion === 'jokers' ? players : 0);
  }
  function validateConfig(input: unknown) {
    const config = parseConfig(input);
    if (
      config.mode !== 'individual' ||
      config.ownerIds.length < 2 ||
      config.ownerIds.length > maxPlayers
    )
      throw new EngineError('invalid_config');
    return immutable(config);
  }
  function outcome(state: SixNimmtState) {
    const finished =
      Object.values(state.entries).every((points) => points !== null) &&
      (options.expansion === 'surprises'
        ? state.round === 2
        : Math.max(...Object.values(state.totals)) >= 66);
    const best = Math.min(...Object.values(state.totals));
    return {
      status: finished ? ('finished' as const) : ('in_progress' as const),
      winnerIds: finished
        ? Object.keys(state.totals).filter((id) => state.totals[id] === best)
        : [],
    };
  }
  const engine = recordedGame<SixNimmtState>({
    id: '6-qui-prend',
    rulesetVersion: version.rulesetVersion,
    lowest: true,
    initial(config) {
      validateConfig(config);
      return {
        totals: Object.fromEntries(config.ownerIds.map((id) => [id, 0])),
        entries: Object.fromEntries(config.ownerIds.map((id) => [id, null])),
        round: 1,
        eventCount: 0,
        status: 'in_progress',
        winnerIds: [],
      };
    },
    check(state, config) {
      validateConfig(config);
      if (
        Object.keys(state).length !== 6 ||
        !Number.isInteger(state.round) ||
        state.round < 1 ||
        state.round > (options.expansion === 'surprises' ? 2 : 1000) ||
        !state.entries ||
        typeof state.entries !== 'object' ||
        Object.keys(state.entries).length !== config.ownerIds.length ||
        config.ownerIds.some(
          (id) =>
            !Object.hasOwn(state.entries, id) ||
            (state.entries[id] !== null &&
              (!Number.isInteger(state.entries[id]) ||
                state.entries[id]! < 0 ||
                state.entries[id]! > roundLimit(config.ownerIds.length))) ||
            state.totals[id]! < (state.entries[id] ?? 0),
        )
      )
        throw new EngineError('invalid_state');
      const roundPoints = Object.values(state.entries).reduce<number>(
        (sum, n) => sum + (n ?? 0),
        0,
      );
      const previousPoints =
        Object.values(state.totals).reduce((sum, n) => sum + n, 0) - roundPoints;
      const expected = outcome(state);
      if (
        roundPoints > roundLimit(config.ownerIds.length) ||
        previousPoints < 0 ||
        previousPoints > roundLimit(config.ownerIds.length) * (state.round - 1) ||
        state.status !== expected.status ||
        JSON.stringify(state.winnerIds) !== JSON.stringify(expected.winnerIds)
      )
        throw new EngineError('invalid_state');
    },
    reduce(state, action, config) {
      const values = action.values;
      if (values.round !== state.round || Object.keys(values).length !== 2)
        throw new EngineError('invalid_command');
      if (Object.values(state.entries).every((points) => points !== null)) {
        if (values.nextRound !== 1 || action.ownerId !== config.ownerIds[0])
          throw new EngineError('invalid_command');
        return {
          ...state,
          round: state.round + 1,
          eventCount: state.eventCount + 1,
          entries: Object.fromEntries(config.ownerIds.map((id) => [id, null])),
        };
      }
      if (
        !Number.isInteger(values.points) ||
        values.points! < 0 ||
        values.points! > roundLimit(config.ownerIds.length) ||
        state.entries[action.ownerId] !== null ||
        Object.values(state.entries).reduce<number>((sum, n) => sum + (n ?? 0), 0) +
          values.points! >
          roundLimit(config.ownerIds.length)
      )
        throw new EngineError('invalid_command');
      const next = {
        ...state,
        entries: { ...state.entries, [action.ownerId]: values.points! },
        totals: {
          ...state.totals,
          [action.ownerId]: state.totals[action.ownerId]! + values.points!,
        },
        eventCount: state.eventCount + 1,
      };
      return { ...next, ...outcome(next) };
    },
  });
  return Object.freeze({
    ...engine,
    options: immutable(options),
    roundLimit,
    validateConfig,
    supportedModes: ['individual'] as const,
    definition: immutable(version.definition) as JsonObject & {
      schemaVersion: 1;
      supportedModes: readonly ['individual'];
    },
  });
}
