import { EngineError, type EngineConfig, type EngineState } from '../engine/types';
import { copyBoundedJson, immutable, parseConfig } from '../engine/validation';
import type { GameVersionRecord, JsonObject } from '../records';
import { recordedGame } from './recorded';
export interface SkullKingOptions {
  readonly advancedCards: boolean;
  readonly expansion: boolean;
  readonly loot: boolean;
  readonly scoring: 'classic' | 'rascal';
}
export const defaultSkullKingOptions: SkullKingOptions = {
  advancedCards: false,
  expansion: false,
  loot: false,
  scoring: 'classic',
};
export function skullKingVersion(publishedAt: string): GameVersionRecord {
  return configuredSkullKingVersion(defaultSkullKingOptions, publishedAt);
}
export function configuredSkullKingVersion(
  options: SkullKingOptions,
  publishedAt: string,
): GameVersionRecord {
  if (
    !options ||
    ['advancedCards', 'expansion', 'loot'].some(
      (key) => typeof options[key as keyof SkullKingOptions] !== 'boolean',
    ) ||
    !['classic', 'rascal'].includes(options.scoring)
  )
    throw new EngineError('invalid_rules');
  const rulesetVersion = `a${+options.advancedCards}-e${+options.expansion}-l${+options.loot}-${options.scoring}-v1`;
  return {
    id: `skull-${rulesetVersion}`,
    gameId: 'skull-king',
    rulesetVersion,
    schemaVersion: 1,
    publishedAt,
    name: `Skull King · ${options.scoring}`,
    definition: {
      schemaVersion: 1,
      id: 'skull-king',
      rulesetVersion,
      engine: 'skull-classic-2021',
      supportedModes: ['individual'],
      advancedCards: options.advancedCards,
      expansion: options.expansion,
      loot: options.loot,
      scoring: options.scoring,
    },
  };
}
export interface SkullEntry {
  bid: number | null;
  won: number | null;
  c14: number;
  b14: number;
  mermaids: number;
  pirates: number;
  king: number;
  sevens?: number;
  eights?: number;
  mate?: number;
  monsters?: number;
  loot?: number;
}
export interface SkullState extends EngineState {
  round: number;
  entries: Record<string, SkullEntry>;
}
export function skullCards(
  round: number,
  players: number,
  options: SkullKingOptions = defaultSkullKingOptions,
) {
  const deck =
    70 + (options.advancedCards ? 2 : 0) + (options.expansion ? 19 : 0) + (options.loot ? 2 : 0);
  return Math.min(round, 10, Math.floor(deck / players));
}
export function skullScore(
  cards: number,
  bid: number,
  won: number,
  bonus: number,
  scoring: SkullKingOptions['scoring'] = 'classic',
) {
  if (scoring === 'rascal') {
    const factor = bid === won ? 1 : Math.abs(bid - won) === 1 ? 0.5 : 0;
    return (cards * 10 + bonus) * factor;
  }
  return bid === 0
    ? won === 0
      ? cards * 10 + bonus
      : -cards * 10
    : bid === won
      ? bid * 20 + bonus
      : -Math.abs(bid - won) * 10;
}
export const skullCaptureCaps = { c14: 3, b14: 1, mermaids: 2, pirates: 6, king: 1 } as const;
export type SkullCapture =
  keyof typeof skullCaptureCaps | 'sevens' | 'eights' | 'mate' | 'monsters' | 'loot';
export function skullCaptures(options: SkullKingOptions): Partial<Record<SkullCapture, number>> {
  return {
    ...skullCaptureCaps,
    pirates: options.expansion ? 7 : 6,
    ...(options.expansion
      ? { sevens: 4, eights: 4, mate: 1, monsters: options.advancedCards ? 3 : 1 }
      : {}),
    ...(options.loot ? { loot: 4 } : {}),
  };
}
export function skullBonus(row: Partial<Record<SkullCapture, number>>) {
  return (
    (row.c14 ?? 0) * 10 +
    (row.b14 ?? 0) * 20 +
    (row.mermaids ?? 0) * 20 +
    (row.pirates ?? 0) * 30 +
    (row.king ?? 0) * 40 -
    (row.sevens ?? 0) * 5 +
    (row.eights ?? 0) * 5 +
    (row.mate ?? 0) * 30 +
    (row.monsters ?? 0) * 20
  );
}
export function skullResultScore(
  cards: number,
  bid: number,
  won: number,
  captures: Partial<Record<SkullCapture, number>>,
  options: SkullKingOptions,
) {
  // Loot pays only for exact bids, including under Rascal scoring.
  return (
    skullScore(cards, bid, won, skullBonus(captures), options.scoring) +
    (bid === won ? (captures.loot ?? 0) * 20 : 0)
  );
}
export function createSkullKingGame(input: unknown) {
  const rules = copyBoundedJson(input) as JsonObject;
  const options: SkullKingOptions = {
    advancedCards: rules?.advancedCards as boolean,
    expansion: rules?.expansion as boolean,
    loot: rules?.loot as boolean,
    scoring: rules?.scoring as SkullKingOptions['scoring'],
  };
  const version = configuredSkullKingVersion(options, '');
  if (JSON.stringify(rules) !== JSON.stringify(version.definition))
    throw new EngineError('invalid_rules');
  const captureCaps = skullCaptures(options);
  const bonusFields = Object.keys(captureCaps) as SkullCapture[];
  const caps = bonusFields.map((field) => captureCaps[field]!);
  const fresh = (): SkullEntry => ({
    bid: null,
    won: null,
    c14: 0,
    b14: 0,
    mermaids: 0,
    pirates: 0,
    king: 0,
    ...Object.fromEntries(bonusFields.map((key) => [key, 0])),
  });
  const requiresTrick = (key: SkullCapture) => key !== 'monsters' && key !== 'loot';
  const discardedTricks = options.advancedCards || options.expansion;
  function validateConfig(input: unknown) {
    const config = parseConfig(input);
    if (config.mode !== 'individual' || config.ownerIds.length < 3 || config.ownerIds.length > 8)
      throw new EngineError('invalid_config');
    return immutable(config);
  }
  function resultStatus(state: SkullState, config: EngineConfig) {
    const finished =
      state.round >= 10 && config.ownerIds.every((id) => state.entries[id]!.won !== null);
    const best = Math.max(...Object.values(state.totals));
    const winners = config.ownerIds.filter((id) => state.totals[id] === best);
    return {
      status: finished && winners.length === 1 ? ('finished' as const) : ('in_progress' as const),
      winnerIds: finished && winners.length === 1 ? winners : [],
    };
  }
  const engine = recordedGame<SkullState>({
    id: 'skull-king',
    rulesetVersion: version.rulesetVersion,
    initial: (input) => {
      const config = validateConfig(input);
      return {
        totals: Object.fromEntries(config.ownerIds.map((id) => [id, 0])),
        eventCount: 0,
        status: 'in_progress',
        winnerIds: [],
        round: 1,
        entries: Object.fromEntries(config.ownerIds.map((id) => [id, fresh()])),
      };
    },
    check(state, input) {
      const config = validateConfig(input);
      const cards = skullCards(state.round, config.ownerIds.length, options);
      if (
        Object.keys(state).length !== 6 ||
        !Number.isInteger(state.round) ||
        state.round < 1 ||
        state.round > 1000 ||
        !state.entries ||
        typeof state.entries !== 'object' ||
        Object.keys(state.entries).length !== config.ownerIds.length
      )
        throw new EngineError('invalid_state');
      for (const id of config.ownerIds) {
        const row = state.entries[id];
        if (
          !row ||
          Object.keys(row).length !== bonusFields.length + 2 ||
          ![row.bid, row.won].every(
            (n) => n === null || (Number.isInteger(n) && n >= 0 && n <= cards),
          ) ||
          bonusFields.some(
            (key, i) => !Number.isInteger(row[key]) || row[key]! < 0 || row[key]! > caps[i]!,
          ) ||
          (row.won === null && bonusFields.some((key) => row[key] !== 0)) ||
          (row.won === 0 && bonusFields.some((key) => requiresTrick(key) && row[key] !== 0)) ||
          (row.loot ?? 0) > 2
        )
          throw new EngineError('invalid_state');
      }
      const rows = Object.values(state.entries);
      const allBids = rows.every((row) => row.bid !== null);
      const allResults = rows.every((row) => row.won !== null);
      if (
        (!allBids && rows.some((row) => row.won !== null)) ||
        rows.reduce((n, row) => n + (row.won ?? 0), 0) > cards ||
        (!discardedTricks && allResults && rows.reduce((n, row) => n + row.won!, 0) !== cards) ||
        bonusFields.some((key, i) => rows.reduce((n, row) => n + row[key]!, 0) > caps[i]!) ||
        (rows.some((row) => row.king) && rows.some((row) => row.pirates))
      )
        throw new EngineError('invalid_state');
      const expected = resultStatus(state, config);
      if (
        state.status !== expected.status ||
        JSON.stringify(state.winnerIds) !== JSON.stringify(expected.winnerIds)
      )
        throw new EngineError('invalid_state');
    },
    reduce(state, action, input) {
      const config = validateConfig(input);
      const row = state.entries[action.ownerId]!;
      const cards = skullCards(state.round, config.ownerIds.length, options);
      const values = action.values;
      if (values.round !== state.round) throw new EngineError('invalid_command');
      const complete = Object.values(state.entries).every((row) => row.won !== null);
      if (complete) {
        if (
          action.ownerId !== config.ownerIds[0] ||
          Object.keys(values).length !== 2 ||
          values.nextRound !== 1
        )
          throw new EngineError('invalid_command');
        return {
          ...state,
          eventCount: state.eventCount + 1,
          round: state.round + 1,
          entries: Object.fromEntries(config.ownerIds.map((id) => [id, fresh()])),
        };
      }
      let nextRow: SkullEntry;
      let delta = 0;
      if (!Object.values(state.entries).every((row) => row.bid !== null)) {
        if (
          values.kind !== 0 ||
          Object.keys(values).length !== 3 ||
          row.bid !== null ||
          !Number.isInteger(values.bid) ||
          values.bid! < 0 ||
          values.bid! > cards
        )
          throw new EngineError('invalid_command');
        nextRow = { ...row, bid: values.bid! };
      } else {
        if (
          values.kind !== 1 ||
          Object.keys(values).length !== bonusFields.length + 3 ||
          row.won !== null ||
          !Number.isInteger(values.won) ||
          values.won! < 0 ||
          values.won! > cards ||
          bonusFields.some(
            (key, i) =>
              !Number.isInteger(values[key]) || values[key]! < 0 || values[key]! > caps[i]!,
          ) ||
          (values.won === 0 &&
            bonusFields.some((key) => requiresTrick(key) && values[key] !== 0)) ||
          (values.loot ?? 0) > 2
        )
          throw new EngineError('invalid_command');
        nextRow = {
          ...fresh(),
          bid: row.bid,
          won: values.won!,
          ...Object.fromEntries(bonusFields.map((key) => [key, values[key]!])),
        };
        const others = Object.entries(state.entries)
          .filter(([id]) => id !== action.ownerId)
          .map(([, entry]) => entry);
        const rows = [...others, nextRow];
        if (
          rows.reduce((sum, row) => sum + (row.won ?? 0), 0) > cards ||
          (!discardedTricks &&
            rows.every((row) => row.won !== null) &&
            rows.reduce((sum, row) => sum + row.won!, 0) !== cards) ||
          bonusFields.some((key, i) => rows.reduce((n, row) => n + row[key]!, 0) > caps[i]!) ||
          (rows.some((row) => row.king) && rows.some((row) => row.pirates))
        )
          throw new EngineError('invalid_command');
        delta = skullResultScore(cards, row.bid!, values.won!, nextRow, options);
      }
      const next = {
        ...state,
        eventCount: state.eventCount + 1,
        totals: { ...state.totals, [action.ownerId]: state.totals[action.ownerId]! + delta },
        entries: { ...state.entries, [action.ownerId]: nextRow },
      };
      return { ...next, ...resultStatus(next, config) };
    },
  });
  return Object.freeze({
    ...engine,
    options: immutable(options),
    captureCaps: immutable(captureCaps),
    validateConfig,
    supportedModes: ['individual'] as const,
    definition: immutable(version.definition) as JsonObject & {
      schemaVersion: 1;
      supportedModes: readonly ['individual'];
    },
  });
}
