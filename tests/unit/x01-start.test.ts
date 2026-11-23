import 'fake-indexeddb/auto';
import { afterEach, expect, it } from 'vitest';
import { createX01Game, x01Version } from '../../src/lib/domain/games/darts';
import { x01Checkouts } from '../../src/lib/domain/games/checkouts';
import { x01VisitResult } from '../../src/lib/domain/games/visits';
import { cricketVersion } from '../../src/lib/domain/games/cricket';
import { yamsVersion } from '../../src/lib/domain/games/yams';
import { createDartsMatchGame } from '../../src/lib/domain/games/darts-match';
import { versionForSetting } from '../../src/lib/application/game-settings';
import { CatalogRepository } from '../../src/lib/storage/catalog';
import {
  DeclarativeRepository,
  type CreateDeclarativeInput,
} from '../../src/lib/storage/declarative';
import { BackupRepository } from '../../src/lib/storage/backup';
import { createRematch } from '../../src/lib/storage/rematch';
import { matchOptions } from '../../src/lib/application/match-options';
import { LocalDatabase, MatchJournal, seedJournal, timestamp } from '../fixtures/journal';
const databases: LocalDatabase[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) {
    db.close();
    await db.delete();
  }
});
async function setup() {
  const db = new LocalDatabase(crypto.randomUUID());
  databases.push(db);
  await seedJournal(db);
  await new CatalogRepository(db).initialize(timestamp);
  const input: CreateDeclarativeInput = {
    id: 'configured-x01',
    versionId: x01Version(301, true, '').id,
    mode: 'individual',
    playerIds: ['alice', 'lucas'],
    teams: [],
    organizerPlayerId: 'alice',
    cooperativeName: '',
    createdAt: timestamp,
  };
  return { db, input, repository: new DeclarativeRepository(db) };
}
it('accepts every whole starting score in the requested inclusive range', () => {
  for (let start = 101; start <= 701; start++)
    for (const doubleOut of [true, false]) {
      const game = createX01Game(x01Version(start, doubleOut, '').definition);
      expect(
        game.initialState({ mode: 'individual', ownerIds: ['alice', 'lucas'] }).totals,
      ).toEqual({ alice: start, lucas: start });
    }
});
it.each([100, 702, 301.5, NaN, Infinity, -1])(
  'rejects invalid starts %s in both the factory and decoder',
  (start) => {
    expect(() => x01Version(start, true, '')).toThrow();
    expect(() => createX01Game({ ...x01Version(301, true, '').definition, start })).toThrow();
  },
);
it('keeps legacy301/501 identities and frozen definitions unchanged', () => {
  for (const start of [301, 501])
    for (const doubleOut of [true, false]) {
      const version = x01Version(start, doubleOut, '');
      expect(version.id).toBe(`x01-${start}-${doubleOut ? 'double' : 'straight'}-v1`);
      expect(version.definition).toEqual({
        schemaVersion: 1,
        id: 'darts',
        rulesetVersion: version.id,
        engine: 'x01',
        supportedModes: ['individual', 'teams'],
        start,
        doubleOut,
      });
    }
});
it('supports visit totals above501 and reports no impossible checkout', () => {
  expect(x01VisitResult(701, 3, true, 180, 0)).toEqual({
    remaining: 521,
    bust: false,
    finished: false,
  });
  expect(x01Checkouts(701, 3, true)).toEqual([]);
  expect(x01Checkouts(601, 3, false)).toEqual([]);
  expect(x01Checkouts(101, 3, true).length).toBeGreaterThan(0);
});
it.each([101, 350, 601, 701])(
  'pins score %i, preserves the base and round-trips JSON',
  async (x01Start) => {
    const { db, input, repository } = await setup();
    const original = await db.gameVersions.get(input.versionId);
    const match = await repository.create({ ...input, x01Start });
    expect(match.rulesSnapshot.definition.start).toBe(x01Start);
    expect(matchOptions(match)).toContainEqual({ key: 'x01', values: { value: x01Start } });
    expect(await db.gameVersions.get(input.versionId)).toEqual(original);
    expect((await new MatchJournal(db).read(match.id)).projection.totals).toEqual({
      alice: x01Start,
      lucas: x01Start,
    });
    const count = await db.gameVersions.count();
    const repeated = await repository.create({ ...input, id: `repeated-${x01Start}`, x01Start });
    expect(repeated.gameVersionId).toBe(match.gameVersionId);
    expect(await db.gameVersions.count()).toBe(count);
    const target = new LocalDatabase(crypto.randomUUID());
    databases.push(target);
    await new BackupRepository(target).restore(await new BackupRepository(db).export(timestamp));
    expect((await target.matches.get(match.id))?.rulesSnapshot).toEqual(match.rulesSnapshot);
    expect((await new MatchJournal(target).read(match.id)).projection.totals).toEqual({
      alice: x01Start,
      lucas: x01Start,
    });
  },
);
it.each([100, 702, 101.5])('rejects invalid persisted score %s atomically', async (x01Start) => {
  const { db, input, repository } = await setup();
  const before = await db.gameVersions.count();
  await expect(repository.create({ ...input, x01Start })).rejects.toThrow();
  expect(await db.matches.get(input.id)).toBeUndefined();
  expect(await db.gameVersions.count()).toBe(before);
});
it('rolls back a configured definition when match references are invalid', async () => {
  const { db, input, repository } = await setup();
  await expect(
    repository.create({ ...input, x01Start: 450, playerIds: ['alice', 'missing'] }),
  ).rejects.toThrow();
  expect(await db.gameVersions.get(x01Version(450, true, '').id)).toBeUndefined();
});
it('rejects a conflicting canonical definition without overwriting it', async () => {
  const { db, input, repository } = await setup();
  const version = x01Version(601, true, timestamp);
  await db.gameVersions.add({ ...version, definition: { ...version.definition, start: 501 } });
  await expect(repository.create({ ...input, x01Start: 601 })).rejects.toMatchObject({
    code: 'conflict',
  });
  expect((await db.gameVersions.get(version.id))?.definition.start).toBe(501);
});
it('keeps setup bounded after more than100 configured scores and supports a checkout change', async () => {
  const { db } = await setup();
  await db.gameVersions.bulkAdd(
    Array.from({ length: 120 }, (_, i) => x01Version(101 + i, true, timestamp)),
  );
  const selected = x01Version(220, true, timestamp);
  const result = await new CatalogRepository(db).readSetupVersions(selected.id);
  expect(result.selected.id).toBe(selected.id);
  expect(result.versions).toHaveLength(5);
  const next = versionForSetting(selected, result.versions, 'doubleOut', false);
  expect(next?.definition.doubleOut).toBe(false);
});
it('preserves the configured score and gives the loser the rematch start', async () => {
  const { db, input, repository } = await setup();
  const match = await repository.create({
    ...input,
    versionId: x01Version(301, false, '').id,
    x01Start: 101,
  });
  const journal = new MatchJournal(db);
  const send = async (action: Parameters<MatchJournal['submit']>[0]['action']) => {
    const view = await journal.read(match.id);
    const id = crypto.randomUUID();
    return journal.submit({
      matchId: match.id,
      eventId: id,
      commandId: id,
      expectedVersion: view.projection.lastEventSequence,
      actorPlayerId: 'alice',
      deviceId: 'device',
      timestamp,
      action,
    });
  };
  await send({ type: 'start' });
  await send({ type: 'record', ownerId: 'alice', values: { total: 101, checkout: 0 } });
  const rematch = await createRematch(db, {
    sourceId: match.id,
    id: 'rematch-x01',
    createdAt: timestamp,
    expectedVersion: 2,
    actorPlayerId: 'alice',
    deviceId: 'device',
  });
  expect(rematch.rulesSnapshot.definition.start).toBe(101);
  expect(rematch.settingsSnapshot.engineConfig).toEqual({
    mode: 'individual',
    ownerIds: ['lucas', 'alice'],
  });
  expect((await journal.read(match.id)).projection.status).toBe('finished');
});

it('resets each series leg to the configured701 points', () => {
  const game = createDartsMatchGame(x01Version(701, false, '').definition, {
    legsToWin: 2,
    startingRule: 'alternate',
    firstStarterId: 'alice',
  });
  const config = { mode: 'individual' as const, ownerIds: ['alice', 'lucas'] };
  let state = game.initialState(config);
  const record = (ownerId: string, values: Record<string, number>) => {
    state = game
      .decide(state, { type: 'record', ownerId, values }, config)
      .reduce((s, e) => game.evolve(s, e, config), state);
  };
  for (const [i, total] of [180, 180, 180, 161].entries()) {
    record('alice', { total, checkout: 0 });
    if (i < 3) record('lucas', { total: 0, checkout: 0 });
  }
  expect(game.getProgress(state, config).nextStarterId).toBe('lucas');
  record('lucas', { nextLeg: 1 });
  expect(state.totals).toEqual({ alice: 701, lucas: 701 });
});

it.each([cricketVersion(true, ''), yamsVersion(true, '')])(
  'refuses an X01 option on $id',
  async (version) => {
    const { db, input, repository } = await setup();
    await expect(
      repository.create({ ...input, versionId: version.id, x01Start: 601 }),
    ).rejects.toThrow();
    expect(await db.matches.get(input.id)).toBeUndefined();
  },
);
it('combines a custom start with team cork and series settings', async () => {
  const { db, input, repository } = await setup();
  const teams = await Promise.all(
    ['blue', 'red'].map(async (id) => ({ id, revision: (await db.teams.get(id))?.revision ?? 0 })),
  );
  const match = await repository.create({
    ...input,
    mode: 'teams',
    playerIds: [],
    teams,
    x01Start: 701,
    dartsCorkWinnerId: 'red',
    dartsMatch: { legsToWin: 2, startingRule: 'loser', firstStarterId: 'red' },
  });
  expect(match.settingsSnapshot.engineConfig).toEqual({ mode: 'teams', ownerIds: ['red', 'blue'] });
  expect((await new MatchJournal(db).read(match.id)).projection.totals).toEqual({
    red: 701,
    blue: 701,
  });
});
