import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createYamsGame,
  yamsVersion,
  configuredYamsVersion,
  defaultYamsOptions,
  yamsPossibleScores,
  type YamsOptions,
  type YamsGame,
  yamsDiceScore,
  yamsTotals,
} from '../../src/lib/domain/games/yams';
import type { EngineState, ScoreCommand } from '../../src/lib/domain/engine/types';
import { LocalDatabase } from '../../src/lib/storage/database';
import { CatalogRepository } from '../../src/lib/storage/catalog';
import { DeclarativeRepository } from '../../src/lib/storage/declarative';
import { BackupRepository } from '../../src/lib/storage/backup';
import { createRematch } from '../../src/lib/storage/rematch';
import { MatchJournal } from '../../src/lib/storage/journal';
import { seedJournal, timestamp } from '../fixtures/journal';
const config = { mode: 'individual' as const, ownerIds: ['alice', 'bob'] };
const record = (ownerId: string, category: number, points: number): ScoreCommand => ({
  type: 'record',
  ownerId,
  values: { category, points },
});
function setup(upperBonus = true) {
  return createYamsGame(yamsVersion(upperBonus, timestamp).definition);
}
function apply(game: ReturnType<typeof setup>, state: EngineState, action: ScoreCommand) {
  return game
    .decide(state, action, config)
    .reduce((state, event) => game.evolve(state, event, config), state);
}
describe('simple thirteen-category Yams', () => {
  it.each([
    [0, [1, 1, 1, 4, 6], 3],
    [5, [6, 6, 6, 6, 6], 30],
    [6, [2, 2, 2, 4, 6], 16],
    [6, [1, 2, 3, 4, 6], 0],
    [7, [5, 5, 5, 5, 2], 22],
    [8, [2, 2, 2, 3, 3], 25],
    [8, [2, 2, 2, 2, 2], 0],
    [9, [1, 2, 3, 4, 4], 30],
    [9, [2, 3, 4, 5, 6], 30],
    [9, [1, 2, 2, 4, 5], 0],
    [10, [2, 3, 4, 5, 6], 40],
    [10, [1, 2, 3, 4, 4], 0],
    [11, [3, 3, 3, 3, 3], 50],
    [12, [1, 2, 3, 4, 6], 16],
  ])('scores category %s from dice %s as %s', (category, dice, points) => {
    expect(yamsDiceScore(category as number, dice as number[])).toBe(points);
  });
  it('awards the upper bonus exactly once at 63 and respects the no-bonus version', () => {
    for (const enabled of [true, false]) {
      const game = setup(enabled);
      let state = game.initialState(config);
      for (let category = 0; category < 6; category++)
        state = apply(game, state, record('alice', category, (category + 1) * 3));
      expect(state.totals.alice).toBe(enabled ? 98 : 63);
      const event = game.decide(state, record('alice', 8, 25), config)[0]!;
      expect(event.type === 'score_recorded' && event.delta).toBe(25);
    }
    expect(yamsTotals([2, 6, 9, 12, 15, 18], true).bonus).toBe(0);
  });
  it('keeps zero distinct from an unfilled cell and blocks duplicate categories', () => {
    const game = setup();
    const initial = game.initialState(config);
    const state = apply(game, initial, record('alice', 0, 0));
    expect(game.getGrid(state, config).alice?.[0]).toBe(0);
    expect(game.getGrid(initial, config).alice?.[0]).toBeNull();
    expect(() => apply(game, state, record('alice', 0, 5))).toThrow('invalid_command');
    expect(Object.isFrozen(game.getGrid(state, config).alice)).toBe(true);
  });
  it('finishes only after every category of every owner and keeps shared winners', () => {
    const game = setup();
    let state = game.initialState(config);
    for (const id of config.ownerIds)
      for (let category = 0; category < 13; category++) {
        if (id === 'bob' && category === 12) expect(state.status).toBe('in_progress');
        state = apply(game, state, record(id, category, 0));
      }
    expect(state.status).toBe('finished');
    expect(state.winnerIds).toEqual(['alice', 'bob']);
    expect(() => apply(game, state, record('alice', 0, 1))).toThrow('finished');
  });
  it('validates assisted dice, rejects forged deltas and reconstructs serialized events', () => {
    const game = setup();
    const initial = game.initialState(config);
    const action = {
      type: 'record' as const,
      ownerId: 'alice',
      values: { category: 11, points: 50, d1: 4, d2: 4, d3: 4, d4: 4, d5: 4 },
    };
    const event = game.decide(initial, action, config)[0]!;
    expect(game.evolve(initial, JSON.parse(JSON.stringify(event)), config).totals.alice).toBe(50);
    expect(() =>
      game.decide(initial, { ...action, values: { ...action.values, points: 0 } }, config),
    ).toThrow('invalid_command');
    expect(() => game.evolve(initial, { ...event, delta: 999 } as typeof event, config)).toThrow(
      'invalid_event',
    );
    expect(() => game.decide(initial, { type: 'finish' }, config)).toThrow('invalid_command');
  });
  it.each([
    [0, 4.5],
    [1, 3],
    [8, 24],
    [9, 40],
    [11, 100],
    [13, 0],
    [-1, 0],
  ])('rejects impossible category/score %s/%s', (category, points) => {
    const game = setup();
    expect(() => apply(game, game.initialState(config), record('alice', category, points))).toThrow(
      'invalid_command',
    );
  });
  it('rejects altered definitions, projections and unsupported owner modes', () => {
    const definition = yamsVersion(true, timestamp).definition;
    expect(() => createYamsGame({ ...definition, arbitraryCode: 'eval()' })).toThrow(
      'invalid_rules',
    );
    const game = setup();
    const initial = game.initialState(config);
    expect(() => game.getView({ ...initial, totals: { alice: 50, bob: 0 } }, config)).toThrow(
      'invalid_state',
    );
    expect(() => game.validateConfig({ ...config, mode: 'cooperative' })).toThrow('invalid_config');
  });
});

const databases: LocalDatabase[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const db of databases) db.close();
  for (const db of databases) await db.delete();
  databases.length = 0;
});
describe('Yams append-only integration', () => {
  it('recalculates upper bonus on correction, undoes a winning cell and reopens after persistence', async () => {
    const db = new LocalDatabase(crypto.randomUUID());
    databases.push(db);
    await seedJournal(db);
    await new CatalogRepository(db).initialize(timestamp);
    const version = yamsVersion(true, timestamp);
    const match = await new DeclarativeRepository(db).create({
      id: 'yams-match',
      versionId: version.id,
      mode: 'individual',
      playerIds: ['alice', 'lucas'],
      teams: [],
      organizerPlayerId: 'alice',
      cooperativeName: '',
      createdAt: timestamp,
    });
    const journal = new MatchJournal(db);
    let n = 0;
    const send = async (action: unknown) =>
      journal.submit({
        matchId: match.id,
        eventId: `e-${++n}`,
        commandId: `c-${n}`,
        actorPlayerId: 'alice',
        deviceId: 'phone',
        timestamp,
        expectedVersion: (await db.matches.get(match.id))!.version,
        action,
      });
    await send({ type: 'start' });
    for (let category = 0; category < 6; category++)
      await send(record('alice', category, (category + 1) * 3));
    expect((await journal.read(match.id)).state.totals.alice).toBe(98);
    await send({ type: 'correct', targetEventId: 'e-7', replacement: record('alice', 5, 12) });
    expect((await journal.read(match.id)).state.totals.alice).toBe(57);
    for (let category = 6; category < 13; category++) await send(record('alice', category, 0));
    for (let category = 0; category < 13; category++) await send(record('lucas', category, 0));
    const won = await journal.read(match.id);
    expect(won.projection.winnerId).toBe('alice');
    const last = won.audit.at(-1)!.event.id;
    await send({ type: 'undo', targetEventId: last });
    expect((await journal.read(match.id)).projection.status).toBe('in_progress');
    db.close();
    const reopened = new LocalDatabase(db.name);
    databases.push(reopened);
    const restored = await new MatchJournal(reopened).read(match.id);
    expect(restored.state.totals.alice).toBe(57);
    expect(restored.audit).toHaveLength(n);
    expect(restored.audit[6]!.supersededBy).toBe('e-8');
  });
});

// Historical simple13 definitions above retain their original free-order scoring.
describe('configurable turn-based Yams', () => {
  const modern = (options: Partial<YamsOptions> = {}) =>
    createYamsGame(
      configuredYamsVersion({ ...defaultYamsOptions, ...options }, timestamp).definition,
    );
  const diceRecord = (
    ownerId: string,
    category: number,
    points: number,
    face: number,
  ): ScoreCommand => ({
    type: 'record',
    ownerId,
    values: {
      category,
      points,
      ...Object.fromEntries([1, 2, 3, 4, 5].map((n) => [`d${n}`, face])),
    },
  });
  const round = (
    game: YamsGame,
    state: EngineState,
    category: number,
    points: number,
    face?: number,
  ) => {
    const next = apply(
      game,
      state,
      face === undefined
        ? record('alice', category, points)
        : diceRecord('alice', category, points, face),
    );
    const bobGrid = game.getGrid(next, config).bob!;
    return apply(
      game,
      next,
      record(
        'bob',
        bobGrid.findIndex((value) => value === null),
        0,
      ),
    );
  };
  it('enforces round-robin turns for two or more owners and preserves serialized state', () => {
    const game = modern();
    const players = { mode: 'individual' as const, ownerIds: ['alice', 'bob', 'charlie'] };
    let state = game.initialState(players);
    for (let i = 0; i < 6; i++) {
      const id = players.ownerIds[i % 3]!;
      expect(game.getActiveOwner(state, players)).toBe(id);
      expect(() =>
        game.decide(state, record(players.ownerIds[(i + 1) % 3]!, Math.floor(i / 3), 0), players),
      ).toThrow('invalid_command');
      state = game
        .decide(state, record(id, Math.floor(i / 3), 0), players)
        .reduce((current, event) => game.evolve(current, event, players), state);
      expect(game.getView(JSON.parse(JSON.stringify(state)), players).eventCount).toBe(i + 1);
    }
    expect(game.getActiveOwner(state, players)).toBe('alice');
    expect(Object.isFrozen(game.getGrid(state, players).alice)).toBe(true);
  });
  it.each(['sum', 'fixed40'] as const)('scores four of a kind in %s mode', (fourKind) => {
    const options = { ...defaultYamsOptions, fourKind };
    expect(yamsDiceScore(7, [5, 5, 5, 5, 2], options)).toBe(fourKind === 'fixed40' ? 40 : 22);
    expect(yamsDiceScore(7, [5, 5, 5, 2, 2], options)).toBe(0);
    const game = modern({ fourKind });
    expect(
      apply(game, game.initialState(config), record('alice', 7, fourKind === 'fixed40' ? 40 : 22))
        .totals.alice,
    ).toBe(fourKind === 'fixed40' ? 40 : 22);
    expect(() =>
      apply(game, game.initialState(config), record('alice', 7, fourKind === 'fixed40' ? 22 : 40)),
    ).toThrow('invalid_command');
  });
  it.each([
    [30, 40],
    [25, 30],
    [17, 58],
    [1, 1000],
  ])(
    'uses straight values %s/%s for manual and assisted entries',
    (smallStraight, largeStraight) => {
      const options = { ...defaultYamsOptions, smallStraight, largeStraight };
      const game = modern(options);
      expect(yamsDiceScore(9, [1, 2, 3, 4, 4], options)).toBe(smallStraight);
      expect(yamsDiceScore(10, [2, 3, 4, 5, 6], options)).toBe(largeStraight);
      expect(yamsPossibleScores(9, options)).toEqual([0, smallStraight]);
      expect(yamsPossibleScores(10, options)).toEqual([0, largeStraight]);
      let state = round(game, game.initialState(config), 9, smallStraight);
      state = round(game, state, 10, largeStraight);
      expect(state.totals.alice).toBe(smallStraight + largeStraight);
      expect(game.definition.smallStraight).toBe(smallStraight);
    },
  );
  it.each([
    { smallStraight: 0 },
    { largeStraight: 1001 },
    { smallStraight: 2.5 },
    { fourKind: 'other' },
    { joker: 1 },
    { extraYamsBonus: 'yes' },
    { upperBonus: 0 },
    { other: true },
  ])('rejects invalid scoring options %j', (changes) => {
    expect(() =>
      configuredYamsVersion({ ...defaultYamsOptions, ...changes } as YamsOptions, timestamp),
    ).toThrow('invalid_rules');
  });
  it('awards repeated bonuses only after a scored Yams, never for the first or a scratched Yams', () => {
    for (const yamsScore of [0, 50]) {
      const game = modern();
      let state = round(game, game.initialState(config), 11, yamsScore);
      state = round(game, state, 2, 15, 3);
      expect(game.getExtraBonus(state, 'alice', config)).toBe(yamsScore === 50 ? 100 : 0);
      state = round(game, state, 8, 25, 3);
      expect(game.getExtraBonus(state, 'alice', config)).toBe(yamsScore === 50 ? 200 : 0);
      expect(state.totals.alice).toBe(yamsScore + 15 + 25 + (yamsScore === 50 ? 200 : 0));
    }
    const game = modern();
    const first = apply(game, game.initialState(config), diceRecord('alice', 11, 50, 3));
    expect(game.getExtraBonus(first, 'alice', config)).toBe(0);
  });
  it('requires the matching upper box before a joker can fill lower boxes', () => {
    const game = modern();
    let state = round(game, game.initialState(config), 11, 50);
    expect(game.scoreRoll(state, 'alice', 8, [3, 3, 3, 3, 3], config)).toEqual({
      points: 15,
      bonus: 100,
      allowed: false,
    });
    expect(() => apply(game, state, diceRecord('alice', 8, 25, 3))).toThrow('invalid_command');
    state = round(game, state, 2, 15, 3);
    expect(game.scoreRoll(state, 'alice', 9, [3, 3, 3, 3, 3], config)).toEqual({
      points: 30,
      bonus: 100,
      allowed: true,
    });
    state = round(game, state, 9, 30, 3);
    state = round(game, state, 10, 40, 3);
    expect(game.getExtraBonus(state, 'alice', config)).toBe(300);
    expect(state.totals.alice).toBe(435);
  });
  it('uses configured fixed and straight values for jokers and scratches the upper section when the lower section is full', () => {
    const game = modern({ fourKind: 'fixed40', smallStraight: 17, largeStraight: 58 });
    let state = round(game, game.initialState(config), 11, 50);
    state = round(game, state, 2, 15, 3);
    for (const [category, points] of [
      [6, 15],
      [7, 40],
      [8, 25],
      [9, 17],
      [10, 58],
      [12, 15],
    ])
      state = round(game, state, category!, points!, 3);
    expect(game.scoreRoll(state, 'alice', 0, [3, 3, 3, 3, 3], config)).toEqual({
      points: 0,
      bonus: 100,
      allowed: true,
    });
    state = round(game, state, 0, 0, 3);
    expect(game.getExtraBonus(state, 'alice', config)).toBe(800);
  });
  it('keeps extra bonus and joker options independent and rejects forged dice', () => {
    const bonusOnly = modern({ joker: false });
    const state = round(bonusOnly, bonusOnly.initialState(config), 11, 50);
    expect(bonusOnly.scoreRoll(state, 'alice', 9, [3, 3, 3, 3, 3], config)).toEqual({
      points: 0,
      bonus: 100,
      allowed: true,
    });
    expect(apply(bonusOnly, state, diceRecord('alice', 9, 0, 3)).totals.alice).toBe(150);
    const jokerOnly = modern({ extraYamsBonus: false });
    const other = round(jokerOnly, jokerOnly.initialState(config), 11, 50);
    expect(jokerOnly.scoreRoll(other, 'alice', 2, [3, 3, 3, 3, 3], config)).toEqual({
      points: 15,
      bonus: 0,
      allowed: true,
    });
    expect(() => apply(jokerOnly, other, diceRecord('alice', 2, 12, 3))).toThrow('invalid_command');
    expect(() => jokerOnly.scoreRoll(other, 'alice', 2, [3, 3, 3, 3, 7], config)).toThrow(
      'invalid_command',
    );
  });
  it('rejects forged bonus totals, missing bonus rows and altered version identities', () => {
    const game = modern();
    const state = game.initialState(config);
    expect(() =>
      game.getView(
        {
          ...state,
          extraBonuses: { alice: Array(13).fill(100), bob: Array(13).fill(0) },
          totals: { alice: 1300, bob: 0 },
        } as EngineState,
        config,
      ),
    ).toThrow('invalid_state');
    expect(() => game.getView({ ...state, extraBonuses: {} } as EngineState, config)).toThrow(
      'invalid_state',
    );
    expect(() => createYamsGame({ ...game.definition, smallStraight: 90 })).toThrow(
      'invalid_rules',
    );
    const event = game.decide(state, record('alice', 0, 1), config)[0]!;
    expect(() => game.evolve(state, { ...event, delta: 101 } as typeof event, config)).toThrow(
      'invalid_event',
    );
  });
  it('finishes round-robin with shared winners and no remaining active owner', () => {
    const game = modern();
    let state = game.initialState(config);
    for (let category = 0; category < 13; category++) state = round(game, state, category, 0);
    expect(state.status).toBe('finished');
    expect(state.winnerIds).toEqual(['alice', 'bob']);
    expect(game.getActiveOwner(state, config)).toBeUndefined();
  });
});

describe('configured Yams persistence', () => {
  async function prepare(options: Partial<YamsOptions> = {}) {
    const db = new LocalDatabase(crypto.randomUUID());
    databases.push(db);
    await seedJournal(db);
    await new CatalogRepository(db).initialize(timestamp);
    const input = {
      id: 'configured-yams',
      versionId: yamsVersion(true, timestamp).id,
      mode: 'individual' as const,
      playerIds: ['alice', 'lucas'],
      teams: [],
      organizerPlayerId: 'alice',
      cooperativeName: '',
      createdAt: timestamp,
      yamsOptions: { ...defaultYamsOptions, ...options },
    };
    return { db, input };
  }
  it('replays bonus corrections, rejects invalid turn edits and preserves rules through backup and rematch', async () => {
    const { db, input } = await prepare({
      fourKind: 'fixed40',
      smallStraight: 17,
      largeStraight: 58,
    });
    const match = await new DeclarativeRepository(db).create(input);
    expect(match.rulesSnapshot.definition).toEqual(
      configuredYamsVersion(input.yamsOptions, timestamp).definition,
    );
    const journal = new MatchJournal(db);
    let n = 0;
    const send = async (action: unknown) =>
      journal.submit({
        matchId: match.id,
        eventId: `modern-e-${++n}`,
        commandId: `modern-c-${n}`,
        actorPlayerId: 'alice',
        deviceId: 'phone',
        timestamp,
        expectedVersion: (await db.matches.get(match.id))!.version,
        action,
      });
    const repeat = (category: number, points: number) => ({
      type: 'record',
      ownerId: 'alice',
      values: { category, points, d1: 3, d2: 3, d3: 3, d4: 3, d5: 3 },
    });
    await send({ type: 'start' });
    await send(record('alice', 11, 50));
    await expect(send(record('alice', 0, 0))).rejects.toThrow();
    await send(record('lucas', 0, 0));
    await send(repeat(2, 15));
    await send(record('lucas', 1, 0));
    await send(repeat(8, 25));
    await send(record('lucas', 2, 0));
    expect((await journal.read(match.id)).state.totals.alice).toBe(290);
    const first = (await journal.read(match.id)).audit[1]!.event.id;
    const corrected = await send({
      type: 'correct',
      targetEventId: first,
      replacement: record('alice', 11, 0),
    });
    expect((await journal.read(match.id)).state.totals.alice).toBe(40);
    const restored = await send({
      type: 'correct',
      targetEventId: corrected.audit.at(-1)!.event.id,
      replacement: record('alice', 11, 50),
    });
    const before = await journal.read(match.id);
    await expect(
      send({ type: 'undo', targetEventId: restored.audit.at(-1)!.event.id }),
    ).rejects.toThrow('invalid_correction');
    expect(await journal.read(match.id)).toEqual(before);
    const game = createYamsGame(match.rulesSnapshot.definition);
    let view = before;
    while (view.projection.status !== 'finished') {
      const owner = game.getActiveOwner(view.state, {
        mode: 'individual',
        ownerIds: ['alice', 'lucas'],
      })!;
      const category = game
        .getGrid(view.state, { mode: 'individual', ownerIds: ['alice', 'lucas'] })
        [owner]!.findIndex((score) => score === null);
      view = await send(record(owner, category, 0));
    }
    expect(view.projection.winnerIds).toEqual(['alice']);
    const original = await journal.inspect(match.id);
    const rematch = await createRematch(db, {
      sourceId: match.id,
      id: 'yams-again',
      createdAt: timestamp,
      expectedVersion: original.match.version,
      actorPlayerId: 'alice',
      deviceId: 'phone',
    });
    expect(rematch.rulesSnapshot).toEqual(match.rulesSnapshot);
    expect(rematch.settingsSnapshot.engineConfig).toEqual({
      mode: 'individual',
      ownerIds: ['lucas', 'alice'],
    });
    const next = await journal.read(rematch.id);
    expect(next.state.totals).toEqual({ alice: 0, lucas: 0 });
    expect(await journal.inspect(match.id)).toEqual(original);
    const destination = new LocalDatabase(crypto.randomUUID());
    databases.push(destination);
    const backup = await new BackupRepository(db).export(timestamp);
    await new BackupRepository(destination).restore(backup);
    expect((await new MatchJournal(destination).inspect(match.id)).match.rulesSnapshot).toEqual(
      match.rulesSnapshot,
    );
    expect((await new MatchJournal(destination).read(match.id)).state).toEqual(view.state);
    expect((await new MatchJournal(destination).read(rematch.id)).state).toEqual(next.state);
  });
  it('rolls back a new rule version together with failed match creation and allows retry', async () => {
    const { db, input } = await prepare({ smallStraight: 19, largeStraight: 61 });
    const versionId = configuredYamsVersion(input.yamsOptions, timestamp).id;
    vi.spyOn(db.matchProjections, 'put').mockRejectedValueOnce(
      new DOMException('Synthetic storage full', 'QuotaExceededError'),
    );
    await expect(new DeclarativeRepository(db).create(input)).rejects.toThrow();
    expect(await db.gameVersions.get(versionId)).toBeUndefined();
    expect(await db.matches.get(input.id)).toBeUndefined();
    const created = await new DeclarativeRepository(db).create(input);
    expect(created.gameVersionId).toBe(versionId);
    const second = await new DeclarativeRepository(db).create({
      ...input,
      id: 'same-settings',
      createdAt: '2026-11-18T12:00:00.000Z',
    });
    expect(second.rulesSnapshot).toEqual(created.rulesSnapshot);
  });
  it('keeps setup bounded to canonical choices and the selected saved Yams rules', async () => {
    const { db } = await prepare();
    const versions = Array.from({ length: 101 }, (_, index) =>
      configuredYamsVersion({ ...defaultYamsOptions, smallStraight: index + 1 }, timestamp),
    );
    await db.gameVersions.bulkAdd(versions);
    const result = await new CatalogRepository(db).readSetupVersions(versions[50]!.id);
    expect(result.selected).toEqual(versions[50]);
    expect(result.versions).toHaveLength(3);
    expect(result.versions.map((version) => version.id)).toContain(versions[50]!.id);
  });
  it('refuses mismatched saved version identities and Yams options attached to another game', async () => {
    const { db, input } = await prepare();
    const version = configuredYamsVersion(input.yamsOptions, timestamp);
    await db.gameVersions.add({
      ...version,
      definition: { ...version.definition, largeStraight: 99 },
    });
    await expect(new DeclarativeRepository(db).create(input)).rejects.toThrow('conflict');
    expect(await db.matches.get(input.id)).toBeUndefined();
    await expect(
      new DeclarativeRepository(db).create({ ...input, versionId: 'farkle-5000-0-v1' }),
    ).rejects.toThrow();
  });
});
