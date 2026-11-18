import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { LocalDatabase, MatchJournal, seedJournal, timestamp } from '../fixtures/journal';
import { LocalRepository } from '../../src/lib/storage/repository';
import { createRematch } from '../../src/lib/storage/rematch';
import { TeamRepository } from '../../src/lib/storage/teams';
import { petanqueCommand, petanqueSides } from '../../src/lib/domain/games/petanque';
import { PetanqueRepository } from '../../src/lib/storage/petanque';
import { x01Version } from '../../src/lib/domain/games/darts';
import type { GameVersionRecord, JsonObject, MatchRecord } from '../../src/lib/domain/records';

const databases: LocalDatabase[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const db of databases) {
    db.close();
    await db.delete();
  }
  databases.length = 0;
});
async function setup() {
  const db = new LocalDatabase(crypto.randomUUID());
  databases.push(db);
  const match = await seedJournal(db);
  const journal = new MatchJournal(db);
  let count = 0;
  const send = async (action: unknown, id = match.id) =>
    journal.submit({
      matchId: id,
      expectedVersion: (await db.matches.get(id))!.version,
      actorPlayerId: 'alice',
      deviceId: 'phone',
      eventId: `event-${++count}`,
      commandId: `command-${count}`,
      timestamp,
      action,
    });
  const finish = async () => {
    await send({ type: 'start' });
    for (const points of [6, 6, 1])
      await send({ type: 'record', ownerId: 'blue', values: { points } });
  };
  const input = async (sourceId = match.id, id = 'again') => ({
    sourceId,
    id,
    createdAt: timestamp,
    expectedVersion: (await db.matches.get(sourceId))!.version,
    actorPlayerId: 'alice',
    deviceId: 'phone',
  });
  return { db, match, journal, send, finish, input };
}
it('starts a fresh rematch with the losing team first while preserving the old result, rules and reusable teams', async () => {
  const { db, match, journal, send, finish, input } = await setup();
  await finish();
  const before = await journal.inspect(match.id);
  const events = await db.scoreEvents.toArray();
  const next = await createRematch(db, await input());
  expect(next.status).toBe('in_progress');
  expect(next.version).toBe(1);
  expect(next.gameVersionId).toBe(match.gameVersionId);
  expect(next.rulesSnapshot).toEqual(match.rulesSnapshot);
  expect(next.settingsSnapshot.engineConfig).toEqual({ mode: 'teams', ownerIds: ['red', 'blue'] });
  expect(next.teamsSnapshot.map((team) => team.id)).toEqual(['red', 'blue']);
  expect(next.teamsSnapshot.map((team) => team.playerIds)).toEqual([
    ['emma', 'hugo'],
    ['alice', 'lucas'],
  ]);
  expect((await journal.read(next.id)).projection.totals).toEqual({ red: 0, blue: 0 });
  expect(await journal.inspect(match.id)).toEqual(before);
  expect(await db.teams.count()).toBe(2);
  expect((await db.scoreEvents.toArray()).filter((event) => event.matchId === match.id)).toEqual(
    events,
  );
  for (const points of [6, 6, 1])
    await send({ type: 'record', ownerId: 'red', values: { points } }, next.id);
  expect(
    (await createRematch(db, await input(next.id, 'third'))).settingsSnapshot.engineConfig,
  ).toEqual({ mode: 'teams', ownerIds: ['blue', 'red'] });
});
it('copies a changed team composition from its frozen roster and remaps the losing starter', async () => {
  const { db, journal, finish, input } = await setup();
  await finish();
  const red = (await db.teams.get('red'))!;
  await new TeamRepository(db).saveTeam({ ...red, name: 'Renamed' }, ['hugo', 'emma'], {
    expectedRevision: red.revision ?? 0,
  });
  const next = await createRematch(db, await input());
  expect(next.teamsSnapshot[0]).toMatchObject({
    id: 'again-team-1',
    name: 'red',
    playerIds: ['emma', 'hugo'],
  });
  expect(next.settingsSnapshot.engineConfig).toEqual({
    mode: 'teams',
    ownerIds: ['again-team-1', 'blue'],
  });
  expect((await journal.read('match')).projection.winnerIds).toEqual(['blue']);
});
it('rejects deleted participants and rolls back any copied teams and new match', async () => {
  const { db, finish, input } = await setup();
  await finish();
  await db.teams.update('blue', { name: 'Changed' });
  await db.players.update('emma', { deletedAt: timestamp });
  await expect(createRematch(db, await input())).rejects.toThrow();
  expect(await db.matches.count()).toBe(1);
  expect(await db.teams.count()).toBe(2);
});
it('rolls back copied teams, match, permission and start event if the final journal write fails', async () => {
  const { db, finish, input } = await setup();
  await finish();
  await db.teams.update('red', { name: 'Changed' });
  const tables = [
    db.matches,
    db.teams,
    db.teamMemberships,
    db.matchPermissions,
    db.matchProjections,
    db.scoreEvents,
  ];
  const before = await Promise.all(tables.map((table) => table.toArray()));
  vi.spyOn(db.matchProjections, 'put')
    .mockResolvedValueOnce('again')
    .mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'));
  await expect(createRematch(db, await input())).rejects.toMatchObject({ code: 'quota_exceeded' });
  expect(await Promise.all(tables.map((table) => table.toArray()))).toEqual(before);
});
it.each(['actor', 'device', 'prepared', 'released', 'local'])(
  'enforces source authority (%s)',
  async (kind) => {
    const { db, finish, input } = await setup();
    await finish();
    await db.matchAuthorities.put({
      matchId: 'match',
      playerId: 'alice',
      deviceId: 'phone',
      epoch: 0,
      state: kind === 'prepared' ? 'prepared' : kind === 'released' ? 'released' : 'active',
    });
    if (kind === 'local') await db.deviceSettings.put({ key: 'deviceId', value: 'different' });
    const data = await input();
    if (kind === 'actor') data.actorPlayerId = 'emma';
    if (kind === 'device') data.deviceId = 'different';
    await expect(createRematch(db, data)).rejects.toMatchObject({ code: 'unauthorized' });
    expect(await db.matches.count()).toBe(1);
  },
);
it('rejects stale and nonfinished requests without altering the source', async () => {
  const { db, send, finish, input } = await setup();
  await expect(createRematch(db, await input())).rejects.toMatchObject({ code: 'invalid_record' });
  await finish();
  const stale = { ...(await input()), expectedVersion: 0 };
  await expect(createRematch(db, stale)).rejects.toMatchObject({ code: 'conflict' });
  await send({ type: 'undo', targetEventId: 'event-4' });
  await expect(createRematch(db, await input())).rejects.toMatchObject({ code: 'invalid_record' });
  expect(await db.matches.count()).toBe(1);
});
async function customMatch(
  db: LocalDatabase,
  original: MatchRecord,
  definition: JsonObject,
  owners: string[],
  mode: 'individual' | 'teams' | 'cooperative' = 'individual',
) {
  const repository = new LocalRepository(db);
  const version: GameVersionRecord = {
    ...original.rulesSnapshot,
    id: 'custom-version',
    rulesetVersion: 'custom',
    definition: { ...definition, rulesetVersion: 'custom' },
  };
  await repository.publishGameVersion(version);
  return repository.createMatch({
    id: 'custom',
    gameVersionId: version.id,
    organizerPlayerId: 'alice',
    mode,
    playerIds:
      mode === 'individual'
        ? owners
        : owners.flatMap((id) => original.teamsSnapshot.find((team) => team.id === id)!.playerIds),
    teamIds: mode === 'individual' ? [] : owners,
    settings: { engineConfig: { mode, ownerIds: owners } },
    createdAt: timestamp,
  });
}
it('uses the lowest-score game ranking to make its highest-scoring loser start', async () => {
  const { db, match, journal, send, input } = await setup();
  const custom = await customMatch(
    db,
    match,
    {
      ...match.rulesSnapshot.definition,
      initialScore: 13,
      objective: { direction: 'lowest', target: 0 },
      score: {
        op: 'multiply',
        left: { op: 'constant', value: -1 },
        right: { op: 'input', field: 'points' },
      },
    },
    ['alice', 'emma'],
  );
  await send({ type: 'start' }, custom.id);
  for (const points of [6, 6, 1])
    await send({ type: 'record', ownerId: 'alice', values: { points } }, custom.id);
  const next = await createRematch(db, await input(custom.id));
  expect(next.settingsSnapshot.engineConfig).toEqual({
    mode: 'individual',
    ownerIds: ['emma', 'alice'],
  });
  expect((await journal.read(next.id)).state.totals).toEqual({ emma: 13, alice: 13 });
});
it('chooses the worst-ranked nonwinner among multiple players, retaining prior order for tied losers', async () => {
  const { db, match, send, input } = await setup();
  const custom = await customMatch(db, match, match.rulesSnapshot.definition, [
    'alice',
    'lucas',
    'emma',
    'hugo',
  ]);
  await send({ type: 'start' }, custom.id);
  for (const [ownerId, points] of [
    ['lucas', 3],
    ['emma', 1],
    ['hugo', 1],
    ['alice', 6],
    ['alice', 6],
    ['alice', 1],
  ] as const)
    await send({ type: 'record', ownerId, values: { points } }, custom.id);
  const next = await createRematch(db, await input(custom.id));
  expect(next.settingsSnapshot.engineConfig).toEqual({
    mode: 'individual',
    ownerIds: ['emma', 'hugo', 'alice', 'lucas'],
  });
});
it('retains original order for a shared draw and for cooperative play with no losing side', async () => {
  for (const cooperative of [false, true]) {
    const { db, match, send, input } = await setup();
    const definition = { ...match.rulesSnapshot.definition, objective: { direction: 'highest' } };
    const custom = await customMatch(
      db,
      match,
      definition,
      cooperative ? ['blue'] : ['alice', 'emma'],
      cooperative ? 'cooperative' : 'individual',
    );
    await send({ type: 'start' }, custom.id);
    for (const ownerId of cooperative ? ['blue'] : ['alice', 'emma'])
      await send({ type: 'record', ownerId, values: { points: 2 } }, custom.id);
    await send({ type: 'finish' }, custom.id);
    const next = await createRematch(db, await input(custom.id));
    expect(next.settingsSnapshot.engineConfig).toEqual(custom.settingsSnapshot.engineConfig);
  }
});
it('sets the losing side as first jack thrower for Pétanque', async () => {
  const { db, journal, send, input } = await setup();
  const match = await new PetanqueRepository(db).create({
    id: 'petanque',
    mode: 'teams',
    teams: [
      { id: 'blue', revision: 1 },
      { id: 'red', revision: 1 },
    ],
    playerIds: [],
    organizerPlayerId: 'alice',
    firstThrowOwnerId: 'blue',
    target: 13,
    boulesPerPlayer: 3,
    createdAt: timestamp,
  });
  await send({ type: 'start' }, match.id);
  for (const points of [6, 6, 1])
    await send(
      petanqueCommand({ type: 'points', teamId: 'blue', points }, petanqueSides(match), 3),
      match.id,
    );
  const next = await createRematch(db, await input(match.id));
  expect(next.settingsSnapshot.firstThrowOwnerId).toBe('red');
  expect(next.settingsSnapshot.target).toBe(13);
  expect((await journal.read(next.id)).projection.status).toBe('in_progress');
});
it('preserves darts legs and starter policy, but gives the losing player the first leg of the rematch', async () => {
  const { db, send, input } = await setup();
  const repository = new LocalRepository(db);
  const version = x01Version(301, false, timestamp);
  await repository.saveGame({ id: 'darts', slug: 'darts', name: 'Darts', state: 'available' });
  await repository.publishGameVersion(version);
  const match = await repository.createMatch({
    id: 'darts',
    gameVersionId: version.id,
    organizerPlayerId: 'alice',
    mode: 'individual',
    playerIds: ['alice', 'emma'],
    teamIds: [],
    settings: {
      engineConfig: { mode: 'individual', ownerIds: ['alice', 'emma'] },
      dartsMatch: { legsToWin: 2, startingRule: 'loser', firstStarterId: 'alice' },
      dartsCorkWinnerId: 'alice',
    },
    createdAt: timestamp,
  });
  await send({ type: 'start' }, match.id);
  const visit = async (ownerId: string, total: number) =>
    send({ type: 'record', ownerId, values: { total, checkout: 0 } }, match.id);
  await visit('alice', 180);
  await visit('emma', 0);
  await visit('alice', 121);
  await send({ type: 'record', ownerId: 'emma', values: { nextLeg: 1 } }, match.id);
  await visit('emma', 0);
  await visit('alice', 180);
  await visit('emma', 0);
  await visit('alice', 121);
  const next = await createRematch(db, await input(match.id));
  expect(next.settingsSnapshot.dartsCorkWinnerId).toBeUndefined();
  expect((await db.matches.get(match.id))?.settingsSnapshot.dartsCorkWinnerId).toBe('alice');
  expect(next.settingsSnapshot.dartsMatch).toEqual({
    legsToWin: 2,
    startingRule: 'loser',
    firstStarterId: 'emma',
  });
});

it.each(['pause', 'cancel'] as const)(
  'rejects a %s source instead of taking a revenge',
  async (action) => {
    const { db, send, input } = await setup();
    await send({ type: 'start' });
    await send({ type: action });
    await expect(createRematch(db, await input())).rejects.toMatchObject({
      code: 'invalid_record',
    });
    expect(await db.matches.count()).toBe(1);
  },
);
it.each([
  { id: '../bad' },
  { id: 'x'.repeat(111) },
  { createdAt: 'invalid' },
  { expectedVersion: 0.5 },
])('rejects malformed rematch metadata %j', async (overrides) => {
  const { db, finish, input } = await setup();
  await finish();
  await expect(createRematch(db, { ...(await input()), ...overrides })).rejects.toMatchObject({
    code: 'invalid_record',
  });
  expect(await db.matches.count()).toBe(1);
});
it('refuses changed published rules and serializes duplicate creation IDs', async () => {
  const { db, finish, input, match } = await setup();
  await finish();
  await db.gameVersions.update(match.gameVersionId, {
    definition: { ...match.rulesSnapshot.definition, initialScore: 100 },
  });
  await expect(createRematch(db, await input())).rejects.toMatchObject({ code: 'invalid_record' });
  await db.gameVersions.update(match.gameVersionId, { definition: match.rulesSnapshot.definition });
  const data = await input();
  const results = await Promise.allSettled([createRematch(db, data), createRematch(db, data)]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(await db.matches.count()).toBe(2);
  expect(
    await db.scoreEvents
      .where('[matchId+sequence]')
      .between(['again', 0], ['again', Infinity])
      .count(),
  ).toBe(1);
});
