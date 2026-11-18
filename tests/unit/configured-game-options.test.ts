import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  configuredTimesUpVersion,
  createTimesUpGame,
  timerClock,
} from '../../src/lib/domain/games/times-up';
import {
  configuredSixNimmtVersion,
  createSixNimmtGame,
  defaultSixNimmtOptions,
} from '../../src/lib/domain/games/six-nimmt';
import {
  configuredSkullKingVersion,
  createSkullKingGame,
  defaultSkullKingOptions,
  skullCards,
  skullResultScore,
} from '../../src/lib/domain/games/skull-king';
import type { EngineState, ScoreCommand } from '../../src/lib/domain/engine/types';
import { skullCounterLimits } from '../../src/lib/application/skull-counters';
import { LocalDatabase } from '../../src/lib/storage/database';
import { CatalogRepository } from '../../src/lib/storage/catalog';
import { DeclarativeRepository } from '../../src/lib/storage/declarative';
import { BackupRepository } from '../../src/lib/storage/backup';
import { MatchJournal } from '../../src/lib/storage/journal';
import { seedJournal, timestamp } from '../fixtures/journal';

const individual = { mode: 'individual' as const, ownerIds: ['alice', 'bob', 'cara'] };

describe('configured Time’s Up', () => {
  it('uses the same custom pool in all rounds and preserves the custom timer on pause/reset', () => {
    const game = createTimesUpGame(
      configuredTimesUpVersion({ cardCount: 7, durationSeconds: 90 }, '').definition,
    );
    const config = { mode: 'teams' as const, ownerIds: ['blue', 'red'] };
    let state = game.initialState(config);
    function record(kind: number, turn: number, ms: number, points?: number) {
      const action: ScoreCommand = {
        type: 'record',
        ownerId: config.ownerIds[turn % 2]!,
        values: { kind, turn, ...timerClock(ms), ...(points === undefined ? {} : { points }) },
      };
      state = game.decide(state, action, config).reduce((s, e) => game.evolve(s, e, config), state);
    }
    expect(game.inspect(state, config)).toMatchObject({ cards: 7, remainingMs: 90_000 });
    record(0, 0, 0);
    record(1, 0, 20_000);
    expect(game.inspect(state, config).remainingMs).toBe(70_000);
    record(3, 0, 20_000);
    expect(game.inspect(state, config).remainingMs).toBe(90_000);
    for (let turn = 0; turn < 3; turn++) {
      record(0, turn, 20_000);
      expect(() => record(2, turn, 20_000, 8)).toThrow('invalid_command');
      record(2, turn, 20_000, 7);
      expect(game.inspect(state, config).cards).toBe(turn === 2 ? 0 : 7);
    }
    expect(state).toMatchObject({ status: 'finished', totals: { blue: 14, red: 7 } });
  });
  it.each([
    { cardCount: 0, durationSeconds: 30 },
    { cardCount: 1001, durationSeconds: 30 },
    { cardCount: 4.5, durationSeconds: 30 },
    { cardCount: 40, durationSeconds: 0 },
    { cardCount: 40, durationSeconds: 601 },
  ])('rejects invalid settings %o', (options) => {
    expect(() => configuredTimesUpVersion(options, '')).toThrow('invalid_rules');
  });
});

describe('6 qui prend expansions', () => {
  it('plays exactly two complete Surprises rounds even above 66, then shares tied victories', () => {
    const game = createSixNimmtGame(
      configuredSixNimmtVersion({ ...defaultSixNimmtOptions, expansion: 'surprises' }, '')
        .definition,
    );
    const config = { ...individual, ownerIds: ['alice', 'bob'] };
    let state = game.initialState(config);
    function record(ownerId: string, values: Record<string, number>) {
      const action: ScoreCommand = { type: 'record', ownerId, values };
      state = game.decide(state, action, config).reduce((s, e) => game.evolve(s, e, config), state);
    }
    record('alice', { round: 1, points: 70 });
    record('bob', { round: 1, points: 0 });
    expect(state.status).toBe('in_progress');
    record('alice', { round: 1, nextRound: 1 });
    record('alice', { round: 2, points: 0 });
    expect(state.status).toBe('in_progress');
    record('bob', { round: 2, points: 70 });
    expect(state).toMatchObject({
      status: 'finished',
      totals: { alice: 70, bob: 70 },
      winnerIds: ['alice', 'bob'],
    });
    expect(() =>
      game.validateConfig({ ...config, ownerIds: Array.from({ length: 9 }, (_, i) => `p${i}`) }),
    ).toThrow('invalid_config');
  });
  it('counts one bullhead per dealt Joker and keeps base limits for other mini-expansions', () => {
    const game = createSixNimmtGame(
      configuredSixNimmtVersion({ expansion: 'jokers', passCards: true, variableRows: true }, '')
        .definition,
    );
    expect(game.roundLimit(3)).toBe(174);
    let state = game.initialState(individual);
    const action: ScoreCommand = {
      type: 'record',
      ownerId: 'alice',
      values: { round: 1, points: 174 },
    };
    state = game
      .decide(state, action, individual)
      .reduce((s, e) => game.evolve(s, e, individual), state);
    expect(() =>
      game.decide(
        state,
        { ...action, ownerId: 'bob', values: { round: 1, points: 1 } },
        individual,
      ),
    ).toThrow('invalid_command');
    expect(
      createSixNimmtGame(
        configuredSixNimmtVersion({ ...defaultSixNimmtOptions, passCards: true }, '').definition,
      ).roundLimit(3),
    ).toBe(171);
    expect(() =>
      configuredSixNimmtVersion(
        { expansion: 'surprises', passCards: true, variableRows: false },
        '',
      ),
    ).toThrow('invalid_rules');
  });
});

describe('Skull King configured scoring and inventory', () => {
  const options = { advancedCards: true, expansion: true, loot: true, scoring: 'rascal' as const };
  const game = createSkullKingGame(configuredSkullKingVersion(options, '').definition);
  const record = (state: EngineState, ownerId: string, values: Record<string, number>) => {
    const action: ScoreCommand = { type: 'record', ownerId, values: { round: 1, ...values } };
    return game
      .decide(state, action, individual)
      .reduce((s, e) => game.evolve(s, e, individual), state);
  };
  const result = (won: number, extra: Record<string, number> = {}) => ({
    kind: 1,
    won,
    c14: 0,
    b14: 0,
    mermaids: 0,
    pirates: 0,
    king: 0,
    sevens: 0,
    eights: 0,
    mate: 0,
    monsters: 0,
    loot: 0,
    ...extra,
  });
  it('keeps fractional Rascal bonuses and requires exact bids for Loot', () => {
    expect(skullResultScore(3, 1, 2, { eights: 1, loot: 1 }, options)).toBe(17.5);
    expect(skullResultScore(3, 1, 1, { sevens: 1, loot: 1 }, options)).toBe(45);
    expect(skullResultScore(3, 0, 2, { monsters: 1 }, options)).toBe(0);
    expect(skullCards(10, 8, options)).toBe(10);
  });
  it('allows discarded tricks and Davy bonuses without winning, with bounded shared inventories', () => {
    let state = game.initialState(individual);
    for (const id of individual.ownerIds) state = record(state, id, { kind: 0, bid: 0 });
    expect(() => record(state, 'alice', result(0, { eights: 1 }))).toThrow('invalid_command');
    expect(() => record(state, 'alice', result(0, { monsters: 4 }))).toThrow('invalid_command');
    expect(() => record(state, 'alice', result(0, { loot: 3 }))).toThrow('invalid_command');
    state = record(state, 'alice', result(0, { monsters: 3, loot: 2 }));
    expect(state.totals.alice).toBe(110);
    expect(() => record(state, 'bob', result(0, { monsters: 1 }))).toThrow('invalid_command');
    state = record(state, 'bob', result(0, { loot: 2 }));
    expect(() => record(state, 'cara', result(0, { loot: 1 }))).toThrow('invalid_command');
    state = record(state, 'cara', result(0));
    const entries = game.inspect(state, individual).entries;
    expect(skullCounterLimits(entries, {}, 'cara', 1, game.captureCaps)).toMatchObject({
      monsters: 0,
      loot: 0,
    });
    expect(record(state, 'alice', { nextRound: 1 })).toMatchObject({ round: 2 });
  });
  it('replays fractional Rascal event deltas without rounding', () => {
    let state = game.initialState(individual);
    for (const id of individual.ownerIds) state = record(state, id, { kind: 0, bid: 0 });
    const action: ScoreCommand = {
      type: 'record',
      ownerId: 'alice',
      values: { round: 1, ...result(1, { eights: 1 }) },
    };
    const events = game.decide(state, action, individual);
    expect(events[0]).toMatchObject({ delta: 7.5 });
    state = events.reduce(
      (position, event) => game.evolve(position, JSON.parse(JSON.stringify(event)), individual),
      state,
    );
    expect(state.totals.alice).toBe(7.5);
  });
  it('rejects extra counters when their cards are disabled and validates scoring choices', () => {
    const base = createSkullKingGame(
      configuredSkullKingVersion(defaultSkullKingOptions, '').definition,
    );
    expect(base.captureCaps).not.toHaveProperty('loot');
    expect(base.captureCaps).not.toHaveProperty('sevens');
    expect(() =>
      configuredSkullKingVersion({ ...options, scoring: 'unknown' as never }, ''),
    ).toThrow('invalid_rules');
  });
});

it.each(['6-qui-prend', 'skull-king'] as const)(
  'freezes configured %s options through database creation and backup replay',
  async (gameId) => {
    const db = new LocalDatabase(crypto.randomUUID());
    const restored = new LocalDatabase(crypto.randomUUID());
    try {
      await seedJournal(db);
      const catalog = new CatalogRepository(db);
      await catalog.initialize(timestamp);
      const version =
        gameId === '6-qui-prend'
          ? configuredSixNimmtVersion(defaultSixNimmtOptions, timestamp)
          : configuredSkullKingVersion(defaultSkullKingOptions, timestamp);
      const match = await new DeclarativeRepository(db).create({
        id: crypto.randomUUID(),
        versionId: version.id,
        mode: 'individual',
        playerIds: ['alice', 'lucas', 'emma'],
        teams: [],
        organizerPlayerId: 'alice',
        cooperativeName: '',
        createdAt: timestamp,
        ...(gameId === '6-qui-prend'
          ? { sixNimmtOptions: { ...defaultSixNimmtOptions, expansion: 'surprises' as const } }
          : {
              skullKingOptions: {
                ...defaultSkullKingOptions,
                expansion: true,
                scoring: 'rascal' as const,
              },
            }),
      });
      expect(match.rulesSnapshot.definition).toMatchObject(
        gameId === '6-qui-prend'
          ? { expansion: 'surprises' }
          : { expansion: true, scoring: 'rascal' },
      );
      await new BackupRepository(restored).restore(
        await new BackupRepository(db).export(timestamp),
      );
      expect((await restored.matches.get(match.id))?.rulesSnapshot).toEqual(match.rulesSnapshot);
      expect((await new MatchJournal(restored).read(match.id)).projection.status).toBe('draft');
    } finally {
      for (const database of [db, restored]) {
        database.close();
        await database.delete();
      }
    }
  },
);

it('creates canonical rules regardless of option property order', () => {
  expect(() =>
    createSixNimmtGame(
      configuredSixNimmtVersion({ variableRows: false, passCards: true, expansion: 'jokers' }, '')
        .definition,
    ),
  ).not.toThrow();
  expect(() =>
    createSkullKingGame(
      configuredSkullKingVersion(
        { scoring: 'rascal', loot: true, expansion: true, advancedCards: false },
        '',
      ).definition,
    ),
  ).not.toThrow();
});
