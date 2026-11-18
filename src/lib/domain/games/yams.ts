import type {
  EngineConfig,
  EngineState,
  EngineView,
  GameDefinition,
  ScoreCommand,
  ScoreEvent,
} from '../engine/types';
import { EngineError } from '../engine/types';
import {
  copyBoundedJson,
  immutable,
  parseCommand,
  parseConfig,
  parseEvent,
  parseState,
  safeKey,
} from '../engine/validation';
import type { GameVersionRecord, JsonObject } from '../records';

export const yamsCategories = [
  'ones',
  'twos',
  'threes',
  'fours',
  'fives',
  'sixes',
  'three_kind',
  'four_kind',
  'full_house',
  'small_straight',
  'large_straight',
  'yams',
  'chance',
] as const;
export type YamsGrid = Readonly<Record<string, readonly (number | null)[]>>;
interface YamsState extends EngineState {
  readonly grid: YamsGrid;
  readonly extraBonuses?: Readonly<Record<string, readonly number[]>>;
}
interface YamsRules {
  readonly schemaVersion: 1;
  readonly id: 'yams';
  readonly rulesetVersion: string;
  readonly engine: 'yams-simple13' | 'yams-turns13';
  readonly fourKind?: 'sum' | 'fixed40';
  readonly smallStraight?: number;
  readonly largeStraight?: number;
  readonly extraYamsBonus?: boolean;
  readonly joker?: boolean;
  readonly upperBonus: boolean;
  readonly supportedModes: readonly ['individual', 'teams'];
}
export function yamsVersion(upperBonus: boolean, publishedAt: string): GameVersionRecord {
  const definition: YamsRules = {
    schemaVersion: 1,
    id: 'yams',
    rulesetVersion: `simple13-${upperBonus ? 'upper' : 'no-upper'}-v1`,
    engine: 'yams-simple13',
    upperBonus,
    supportedModes: ['individual', 'teams'],
  };
  return {
    id: `yams-${definition.rulesetVersion}`,
    gameId: 'yams',
    rulesetVersion: definition.rulesetVersion,
    schemaVersion: 1,
    definition: definition as unknown as JsonObject,
    publishedAt,
  };
}
export interface YamsOptions {
  readonly upperBonus: boolean;
  readonly fourKind: 'sum' | 'fixed40';
  readonly smallStraight: number;
  readonly largeStraight: number;
  readonly extraYamsBonus: boolean;
  readonly joker: boolean;
}
export const defaultYamsOptions: YamsOptions = Object.freeze({
  upperBonus: true,
  fourKind: 'sum',
  smallStraight: 30,
  largeStraight: 40,
  extraYamsBonus: true,
  joker: true,
});
export function configuredYamsVersion(input: YamsOptions, publishedAt: string): GameVersionRecord {
  const options = copyBoundedJson(input) as YamsOptions;
  if (
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    Object.keys(options).length !== 6 ||
    typeof options.upperBonus !== 'boolean' ||
    typeof options.extraYamsBonus !== 'boolean' ||
    typeof options.joker !== 'boolean' ||
    !['sum', 'fixed40'].includes(options.fourKind) ||
    [options.smallStraight, options.largeStraight].some(
      (n) => !Number.isSafeInteger(n) || n < 1 || n > 1000,
    )
  )
    throw new EngineError('invalid_rules');
  const rulesetVersion = `turns13-${+options.upperBonus}-${options.fourKind === 'fixed40' ? 40 : 0}-${options.smallStraight}-${options.largeStraight}-${+options.extraYamsBonus}-${+options.joker}-v2`;
  return {
    id: `yams-${rulesetVersion}`,
    gameId: 'yams',
    rulesetVersion,
    schemaVersion: 1,
    publishedAt,
    definition: {
      schemaVersion: 1,
      id: 'yams',
      rulesetVersion,
      engine: 'yams-turns13',
      upperBonus: options.upperBonus,
      fourKind: options.fourKind,
      smallStraight: options.smallStraight,
      largeStraight: options.largeStraight,
      extraYamsBonus: options.extraYamsBonus,
      joker: options.joker,
      supportedModes: ['individual', 'teams'],
    },
  };
}
export function yamsScoring(rules: YamsRules): YamsOptions {
  return {
    upperBonus: rules.upperBonus,
    fourKind: rules.fourKind ?? 'sum',
    smallStraight: rules.smallStraight ?? 30,
    largeStraight: rules.largeStraight ?? 40,
    extraYamsBonus: rules.extraYamsBonus ?? false,
    joker: rules.joker ?? false,
  };
}
export function yamsPossibleScores(
  category: number,
  options: YamsOptions = { ...defaultYamsOptions, extraYamsBonus: false, joker: false },
): readonly number[] {
  if (!Number.isInteger(category) || category < 0 || category >= 13)
    throw new EngineError('invalid_command');
  if (category < 6) return Array.from({ length: 6 }, (_, n) => n * (category + 1));
  if (category === 7 && options.fourKind === 'fixed40') return [0, 40];
  if (category === 6 || category === 7 || category === 12)
    return [0, ...Array.from({ length: 26 }, (_, n) => n + 5)];
  return [0, [25, options.smallStraight, options.largeStraight, 50][category - 8]!];
}
export function yamsDiceScore(
  category: number,
  dice: readonly number[],
  options: YamsOptions = defaultYamsOptions,
): number {
  yamsPossibleScores(category);
  if (
    !Array.isArray(dice) ||
    dice.length !== 5 ||
    dice.some((die) => !Number.isInteger(die) || die < 1 || die > 6)
  )
    throw new EngineError('invalid_command');
  const counts = Array.from({ length: 6 }, (_, n) => dice.filter((die) => die === n + 1).length);
  const sum = dice.reduce((a, b) => a + b, 0);
  if (category < 6) return counts[category]! * (category + 1);
  if (category === 6) return Math.max(...counts) >= 3 ? sum : 0;
  if (category === 7)
    return Math.max(...counts) >= 4 ? (options.fourKind === 'fixed40' ? 40 : sum) : 0;
  if (category === 8) return counts.includes(3) && counts.includes(2) ? 25 : 0;
  if (category === 9)
    return [0, 1, 2].some((start) => counts.slice(start, start + 4).every((n) => n > 0))
      ? options.smallStraight
      : 0;
  if (category === 10)
    return [0, 1].some((start) => counts.slice(start, start + 5).every((n) => n > 0))
      ? options.largeStraight
      : 0;
  if (category === 11) return counts.includes(5) ? 50 : 0;
  return sum;
}
export function yamsTotals(row: readonly (number | null)[], bonusEnabled: boolean) {
  const upper = row.slice(0, 6).reduce<number>((sum, score) => sum + (score ?? 0), 0);
  const lower = row.slice(6).reduce<number>((sum, score) => sum + (score ?? 0), 0);
  const bonus = bonusEnabled && upper >= 63 ? 35 : 0;
  return { upper, lower, bonus, total: upper + lower + bonus };
}
export interface YamsGame extends GameDefinition<
  EngineConfig,
  EngineState,
  ScoreCommand,
  ScoreEvent,
  EngineView
> {
  readonly definition: YamsRules;
  getGrid(state: EngineState, config: EngineConfig): YamsGrid;
  getExtraBonus(state: EngineState, ownerId: string, config: EngineConfig): number;
  getActiveOwner(state: EngineState, config: EngineConfig): string | undefined;
  scoreRoll(
    state: EngineState,
    ownerId: string,
    category: number,
    dice: readonly number[],
    config: EngineConfig,
  ): { points: number; bonus: number; allowed: boolean };
}
export function createYamsGame(input: unknown): YamsGame {
  const data = copyBoundedJson(input) as YamsRules;
  if (
    !data ||
    typeof data !== 'object' ||
    typeof data.upperBonus !== 'boolean' ||
    JSON.stringify(data) !==
      JSON.stringify(
        (data.engine === 'yams-turns13'
          ? configuredYamsVersion(yamsScoring(data), '')
          : yamsVersion(data.upperBonus, '')
        ).definition,
      )
  )
    throw new EngineError('invalid_rules');
  const definition = immutable(data);
  const options = yamsScoring(definition);
  const turns = definition.engine === 'yams-turns13';
  const emptyBonuses = (config: EngineConfig) =>
    Object.fromEntries(config.ownerIds.map((id) => [id, Array<number>(13).fill(0)]));
  function scoreRoll(state: YamsState, ownerId: string, category: number, dice: readonly number[]) {
    const normal = yamsDiceScore(category, dice, options);
    const row = state.grid[ownerId];
    if (!row) throw new EngineError('invalid_command');
    const repeat = dice.every((die) => die === dice[0]) && row[11] !== null;
    const bonus = repeat && row[11] === 50 && options.extraYamsBonus ? 100 : 0;
    if (!repeat || !options.joker) return { points: normal, bonus, allowed: true };
    const upper = dice[0]! - 1;
    if (row[upper] === null) return { points: dice[0]! * 5, bonus, allowed: category === upper };
    if (row.slice(6).some((score) => score === null))
      return {
        points:
          category >= 8 && category <= 10
            ? [25, options.smallStraight, options.largeStraight][category - 8]!
            : normal,
        bonus,
        allowed: category >= 6 && category !== 11,
      };
    return { points: 0, bonus, allowed: category < 6 };
  }

  function validateConfig(input: unknown) {
    const config = parseConfig(input);
    if (
      !definition.supportedModes.includes(config.mode as 'individual' | 'teams') ||
      config.ownerIds.length > 16 ||
      config.ownerIds.some((id) => !safeKey(id))
    )
      throw new EngineError('invalid_config');
    return immutable(config);
  }
  function derive(
    grid: YamsGrid,
    config: EngineConfig,
    extraBonuses: Readonly<Record<string, readonly number[]>> = emptyBonuses(config),
  ): YamsState {
    const totals = Object.fromEntries(
      config.ownerIds.map((id) => [
        id,
        yamsTotals(grid[id]!, definition.upperBonus).total +
          (turns ? extraBonuses[id]!.reduce((sum, n) => sum + n, 0) : 0),
      ]),
    );
    const finished = config.ownerIds.every((id) => grid[id]!.every((score) => score !== null));
    const best = Math.max(...Object.values(totals));
    return immutable({
      grid,
      ...(turns ? { extraBonuses } : {}),
      totals,
      eventCount: config.ownerIds.reduce(
        (n, id) => n + grid[id]!.filter((score) => score !== null).length,
        0,
      ),
      status: finished ? 'finished' : 'in_progress',
      winnerIds: finished ? config.ownerIds.filter((id) => totals[id] === best) : [],
    });
  }
  function checked(input: EngineState, config: EngineConfig): YamsState {
    const value = copyBoundedJson(input) as YamsState;
    if (
      !value ||
      typeof value !== 'object' ||
      Object.keys(value).length !== (turns ? 6 : 5) ||
      !value.grid ||
      Array.isArray(value.grid) ||
      typeof value.grid !== 'object' ||
      Object.keys(value.grid).length !== config.ownerIds.length
    )
      throw new EngineError('invalid_state');
    const { grid, extraBonuses, ...base } = value;
    parseState(base);
    for (const id of config.ownerIds) {
      const row = grid[id];
      if (
        !Array.isArray(row) ||
        row.length !== 13 ||
        row.some(
          (score, category) =>
            score !== null && !yamsPossibleScores(category, options).includes(score),
        )
      )
        throw new EngineError('invalid_state');
    }
    if (turns) {
      if (
        !extraBonuses ||
        typeof extraBonuses !== 'object' ||
        Array.isArray(extraBonuses) ||
        Object.keys(extraBonuses).length !== config.ownerIds.length
      )
        throw new EngineError('invalid_state');
      for (const [index, id] of config.ownerIds.entries()) {
        const row = extraBonuses[id];
        const count = grid[id]!.filter((score) => score !== null).length;
        if (
          count !==
            Math.floor(value.eventCount / config.ownerIds.length) +
              (index < value.eventCount % config.ownerIds.length ? 1 : 0) ||
          !Array.isArray(row) ||
          row.length !== 13 ||
          row.some(
            (n, category) =>
              n !== 0 &&
              (n !== 100 ||
                !options.extraYamsBonus ||
                grid[id]![11] !== 50 ||
                category === 11 ||
                grid[id]![category] === null),
          )
        )
          throw new EngineError('invalid_state');
      }
    }
    const expected = derive(grid, config, extraBonuses);
    if (
      value.eventCount !== expected.eventCount ||
      value.status !== expected.status ||
      JSON.stringify(value.winnerIds) !== JSON.stringify(expected.winnerIds) ||
      Object.keys(value.totals).length !== config.ownerIds.length ||
      config.ownerIds.some((id) => value.totals[id] !== expected.totals[id])
    )
      throw new EngineError('invalid_state');
    return expected;
  }
  function initialState(input: EngineConfig): EngineState {
    const config = validateConfig(input);
    return derive(
      Object.fromEntries(config.ownerIds.map((id) => [id, Array<number | null>(13).fill(null)])),
      config,
    );
  }
  function validateAction(
    stateInput: EngineState,
    input: unknown,
    configInput: EngineConfig,
  ): ScoreCommand {
    const config = validateConfig(configInput);
    const state = checked(stateInput, config);
    if (state.status === 'finished') throw new EngineError('finished');
    const action = parseCommand(input);
    if (
      action.type !== 'record' ||
      !config.ownerIds.includes(action.ownerId) ||
      (turns && action.ownerId !== config.ownerIds[state.eventCount % config.ownerIds.length])
    )
      throw new EngineError('invalid_command');
    const { category, points } = action.values;
    if (
      !yamsPossibleScores(category!, options).includes(points!) ||
      state.grid[action.ownerId]![category!] !== null
    )
      throw new EngineError('invalid_command');
    const keys = Object.keys(action.values);
    if (keys.length === 7) {
      const dice = [1, 2, 3, 4, 5].map((n) => action.values[`d${n}`]!);
      const roll = scoreRoll(state, action.ownerId, category!, dice);
      if (!roll.allowed || roll.points !== points) throw new EngineError('invalid_command');
    } else if (keys.length !== 2) throw new EngineError('invalid_command');
    return immutable(action);
  }
  function result(
    state: YamsState,
    action: Extract<ScoreCommand, { type: 'record' }>,
    config: EngineConfig,
  ): YamsState {
    const row = [...state.grid[action.ownerId]!];
    row[action.values.category!] = action.values.points!;
    const bonuses = [...(state.extraBonuses?.[action.ownerId] ?? Array<number>(13).fill(0))];
    if (action.values.d1 !== undefined)
      bonuses[action.values.category!] = scoreRoll(
        state,
        action.ownerId,
        action.values.category!,
        [1, 2, 3, 4, 5].map((n) => action.values[`d${n}`]!),
      ).bonus;
    return derive({ ...state.grid, [action.ownerId]: row }, config, {
      ...state.extraBonuses,
      [action.ownerId]: bonuses,
    });
  }
  function decide(
    stateInput: EngineState,
    input: ScoreCommand,
    configInput: EngineConfig,
  ): readonly ScoreEvent[] {
    const config = validateConfig(configInput);
    const state = checked(stateInput, config);
    const action = validateAction(state, input, config) as Extract<
      ScoreCommand,
      { type: 'record' }
    >;
    const next = result(state, action, config);
    return immutable([
      {
        type: 'score_recorded',
        gameId: definition.id,
        rulesetVersion: definition.rulesetVersion,
        ownerId: action.ownerId,
        values: action.values,
        delta: next.totals[action.ownerId]! - state.totals[action.ownerId]!,
      },
    ]);
  }
  function evolve(
    stateInput: EngineState,
    input: ScoreEvent,
    configInput: EngineConfig,
  ): EngineState {
    const config = validateConfig(configInput);
    const state = checked(stateInput, config);
    const event = parseEvent(input);
    if (
      event.type !== 'score_recorded' ||
      event.gameId !== definition.id ||
      event.rulesetVersion !== definition.rulesetVersion
    )
      throw new EngineError('invalid_event');
    const action = validateAction(
      state,
      { type: 'record', ownerId: event.ownerId, values: event.values },
      config,
    ) as Extract<ScoreCommand, { type: 'record' }>;
    const next = result(state, action, config);
    if (event.delta !== next.totals[event.ownerId]! - state.totals[event.ownerId]!)
      throw new EngineError('invalid_event');
    return next;
  }
  return Object.freeze({
    id: definition.id,
    rulesetVersion: definition.rulesetVersion,
    supportedModes: definition.supportedModes,
    definition,
    validateConfig,
    initialState,
    validateAction,
    decide,
    evolve,
    getGrid: (state: EngineState, config: EngineConfig) =>
      checked(state, validateConfig(config)).grid,
    getActiveOwner: (state: EngineState, config: EngineConfig) => {
      const value = checked(state, validateConfig(config));
      return turns && value.status !== 'finished'
        ? config.ownerIds[value.eventCount % config.ownerIds.length]
        : undefined;
    },
    getExtraBonus: (state: EngineState, ownerId: string, config: EngineConfig) =>
      checked(state, validateConfig(config)).extraBonuses?.[ownerId]?.reduce(
        (sum, n) => sum + n,
        0,
      ) ?? 0,
    scoreRoll: (
      state: EngineState,
      ownerId: string,
      category: number,
      dice: readonly number[],
      config: EngineConfig,
    ) => scoreRoll(checked(state, validateConfig(config)), ownerId, category, dice),
    isFinished: (state: EngineState, config: EngineConfig) =>
      checked(state, validateConfig(config)).status === 'finished',
    getView(stateInput: EngineState, configInput: EngineConfig): EngineView {
      const config = validateConfig(configInput);
      const state = checked(stateInput, config);
      const sorted = config.ownerIds
        .map((ownerId, order) => ({ ownerId, order, total: state.totals[ownerId]! }))
        .sort((a, b) => b.total - a.total || a.order - b.order);
      let rank = 1;
      return immutable({
        ...state,
        ranking: sorted.map((owner, index) => {
          if (index && owner.total !== sorted[index - 1]!.total) rank = index + 1;
          return { ownerId: owner.ownerId, total: owner.total, rank };
        }),
      });
    },
  });
}
