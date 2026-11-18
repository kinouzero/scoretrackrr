import { EngineError, type EngineState } from '../engine/types';
import { copyBoundedJson, immutable, parseConfig } from '../engine/validation';
import type { GameVersionRecord, JsonObject } from '../records';
import { recordedGame } from './recorded';

export function molkkyVersion(publishedAt: string, teams = true): GameVersionRecord {
  return {
    id: teams ? 'molkky-50-v2' : 'molkky-50-v1',
    gameId: 'molkky',
    rulesetVersion: teams ? 'classic-50-v2' : 'classic-50-v1',
    schemaVersion: 1,
    publishedAt,
    name: teams ? 'Classique · 50 points · joueurs ou équipes' : 'Classique · 50 points',
    definition: {
      schemaVersion: 1,
      id: 'molkky',
      rulesetVersion: teams ? 'classic-50-v2' : 'classic-50-v1',
      engine: 'molkky',
      supportedModes: teams ? ['individual', 'teams'] : ['individual'],
    },
  };
}
export interface MolkkyState extends EngineState {
  turn: number;
  misses: Record<string, number>;
}
export function createMolkkyGame(input: unknown) {
  const serialized = JSON.stringify(copyBoundedJson(input));
  const legacy = serialized === JSON.stringify(molkkyVersion('', false).definition);
  const version = molkkyVersion('', !legacy);
  if (serialized !== JSON.stringify(version.definition)) throw new EngineError('invalid_rules');
  const supportedModes = legacy ? (['individual'] as const) : (['individual', 'teams'] as const);
  function validateConfig(input: unknown) {
    const config = parseConfig(input);
    if (
      !(supportedModes as readonly string[]).includes(config.mode) ||
      config.ownerIds.length < 2 ||
      config.ownerIds.length > 16
    )
      throw new EngineError('invalid_config');
    return immutable(config);
  }
  const engine = recordedGame<MolkkyState>({
    id: 'molkky',
    rulesetVersion: version.rulesetVersion,
    initial(config) {
      validateConfig(config);
      return {
        totals: Object.fromEntries(config.ownerIds.map((id) => [id, 0])),
        eventCount: 0,
        status: 'in_progress',
        winnerIds: [],
        turn: 0,
        misses: Object.fromEntries(config.ownerIds.map((id) => [id, 0])),
      };
    },
    check(state, config) {
      validateConfig(config);
      if (
        Object.keys(state).length !== 6 ||
        !Number.isInteger(state.turn) ||
        state.turn < 0 ||
        state.turn >= config.ownerIds.length ||
        !state.misses ||
        Object.keys(state.misses).length !== config.ownerIds.length ||
        config.ownerIds.some(
          (id) =>
            !Number.isInteger(state.misses[id]) ||
            state.misses[id]! < 0 ||
            state.misses[id]! > 3 ||
            state.totals[id]! < 0 ||
            state.totals[id]! > 50 ||
            (state.misses[id] === 3 && state.totals[id] !== 0),
        ) ||
        state.misses[config.ownerIds[state.turn]!] === 3
      )
        throw new EngineError('invalid_state');
      const active = config.ownerIds.filter((id) => state.misses[id]! < 3);
      const fifty = active.filter((id) => state.totals[id] === 50);
      const winners = fifty.length ? fifty : active.length === 1 ? active : [];
      if (
        active.length === 0 ||
        fifty.length > 1 ||
        state.status !== (winners.length ? 'finished' : 'in_progress') ||
        JSON.stringify(state.winnerIds) !== JSON.stringify(winners)
      )
        throw new EngineError('invalid_state');
    },
    reduce(state, action, config) {
      const { points, turn } = action.values;
      if (
        Object.keys(action.values).length !== 2 ||
        turn !== state.eventCount ||
        !Number.isInteger(points) ||
        points! < 0 ||
        points! > 12 ||
        action.ownerId !== config.ownerIds[state.turn]
      )
        throw new EngineError('invalid_command');
      const id = action.ownerId;
      const misses = { ...state.misses, [id]: points === 0 ? state.misses[id]! + 1 : 0 };
      const total = state.totals[id]! + points!;
      const totals = { ...state.totals, [id]: misses[id] === 3 ? 0 : total > 50 ? 25 : total };
      const active = config.ownerIds.filter((owner) => misses[owner]! < 3);
      const winnerIds = totals[id] === 50 ? [id] : active.length === 1 ? active : [];
      let next = winnerIds.length
        ? config.ownerIds.indexOf(winnerIds[0]!)
        : (state.turn + 1) % config.ownerIds.length;
      while (misses[config.ownerIds[next]!] === 3) next = (next + 1) % config.ownerIds.length;
      return {
        totals,
        misses,
        turn: next,
        eventCount: state.eventCount + 1,
        status: winnerIds.length ? 'finished' : 'in_progress',
        winnerIds,
      };
    },
  });
  return Object.freeze({
    ...engine,
    validateConfig,
    supportedModes,
    definition: immutable(version.definition) as JsonObject & {
      schemaVersion: 1;
      supportedModes: readonly ('individual' | 'teams')[];
    },
    getView(state: EngineState, config: ReturnType<typeof validateConfig>) {
      const value = engine.getView(state, config);
      const checked = engine.inspect(state, config);
      const rows = [...value.ranking].sort(
        (a, b) =>
          Number(checked.misses[a.ownerId] === 3) - Number(checked.misses[b.ownerId] === 3) ||
          b.total - a.total,
      );
      let rank = 1;
      return immutable({
        ...value,
        ranking: rows.map((row, index) => {
          const previous = rows[index - 1];
          if (
            previous &&
            (row.total !== previous.total ||
              (checked.misses[row.ownerId] === 3) !== (checked.misses[previous.ownerId] === 3))
          )
            rank = index + 1;
          return { ...row, rank };
        }),
      });
    },
  });
}
