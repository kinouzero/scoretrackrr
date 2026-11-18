import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { LocalDatabase, MatchJournal, seedJournal, timestamp } from '../fixtures/journal';

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
  await journal.submit({
    matchId: match.id,
    expectedVersion: 0,
    actorPlayerId: 'alice',
    deviceId: 'phone',
    eventId: 'start',
    commandId: 'start',
    timestamp,
    action: { type: 'start' },
  });
  const input = {
    matchId: match.id,
    expectedVersion: 1,
    actorPlayerId: 'alice',
    deviceId: 'phone',
  };
  await db.rounds.add({ id: 'round', matchId: match.id, sequence: 1, status: 'open' });
  await db.matchAuthorities.put({
    matchId: match.id,
    playerId: 'alice',
    deviceId: 'phone',
    epoch: 0,
    state: 'active',
  });
  await db.peerReplicas.put({
    id: 'replica',
    matchId: match.id,
    deviceId: 'peer',
    baseVersion: 1,
    acceptedAt: timestamp,
    targetPlayerId: 'emma',
    text: '{}',
  });
  return { db, journal, input, match };
}

it('atomically deletes only the selected match and its owned records', async () => {
  const { db, journal, input, match } = await setup();
  await db.matches.add({ ...match, id: 'other' });
  await db.rounds.add({ id: 'other-round', matchId: 'other', sequence: 1, status: 'open' });
  const shared = await Promise.all([
    db.players.toArray(),
    db.teams.toArray(),
    db.teamMemberships.toArray(),
    db.gameVersions.toArray(),
  ]);
  await journal.deleteMatch(input);
  expect(await db.matches.toArray()).toEqual([{ ...match, id: 'other' }]);
  expect(await db.rounds.toArray()).toEqual([
    { id: 'other-round', matchId: 'other', sequence: 1, status: 'open' },
  ]);
  for (const table of [
    db.scoreEvents,
    db.matchProjections,
    db.matchPermissions,
    db.matchAuthorities,
    db.peerReplicas,
  ])
    expect(await table.count()).toBe(0);
  expect(
    await Promise.all([
      db.players.toArray(),
      db.teams.toArray(),
      db.teamMemberships.toArray(),
      db.gameVersions.toArray(),
    ]),
  ).toEqual(shared);
});
it('rejects stale confirmations without deleting history', async () => {
  const { db, journal, input } = await setup();
  await expect(journal.deleteMatch({ ...input, expectedVersion: 0 })).rejects.toMatchObject({
    code: 'conflict',
  });
  expect(await db.scoreEvents.count()).toBe(1);
  expect(await db.matches.count()).toBe(1);
});
it.each(['actor', 'device', 'prepared', 'released', 'local-device'])(
  'enforces authority for %s',
  async (kind) => {
    const { db, journal, input } = await setup();
    if (kind === 'prepared' || kind === 'released')
      await db.matchAuthorities.update('match', { state: kind });
    if (kind === 'local-device')
      await db.deviceSettings.put({ key: 'deviceId', value: 'different' });
    await expect(
      journal.deleteMatch({
        ...input,
        actorPlayerId: kind === 'actor' ? 'emma' : input.actorPlayerId,
        deviceId: kind === 'device' ? 'different' : input.deviceId,
      }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
    expect(await db.scoreEvents.count()).toBe(1);
    expect(await db.matches.count()).toBe(1);
  },
);
it('rolls back all owned deletions if the final write fails, then permits retry', async () => {
  const { db, journal, input } = await setup();
  const tables = [
    db.matches,
    db.rounds,
    db.scoreEvents,
    db.matchProjections,
    db.matchPermissions,
    db.matchAuthorities,
    db.peerReplicas,
  ];
  const before = await Promise.all(tables.map((table) => table.toArray()));
  vi.spyOn(db.matches, 'delete').mockRejectedValueOnce(
    new DOMException('full', 'QuotaExceededError'),
  );
  await expect(journal.deleteMatch(input)).rejects.toMatchObject({ code: 'quota_exceeded' });
  expect(await Promise.all(tables.map((table) => table.toArray()))).toEqual(before);
  await journal.deleteMatch(input);
  expect(await db.matches.count()).toBe(0);
});
it('serializes concurrent scoring and deletion without orphaned history', async () => {
  const { db, journal, input } = await setup();
  const results = await Promise.allSettled([
    journal.submit({
      ...input,
      eventId: 'pause',
      commandId: 'pause',
      timestamp,
      action: { type: 'pause' },
    }),
    journal.deleteMatch(input),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  if (await db.matches.count()) expect(await db.scoreEvents.count()).toBe(2);
  else expect(await db.scoreEvents.count()).toBe(0);
});
it.each([-1, 0.5, Number.NaN])('rejects invalid versions (%s)', async (expectedVersion) => {
  const { journal, input, db } = await setup();
  await expect(journal.deleteMatch({ ...input, expectedVersion })).rejects.toThrow();
  expect(await db.matches.count()).toBe(1);
});
