import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalDatabase } from '../../src/lib/storage/database';
import Dexie from 'dexie';

const databases: LocalDatabase[] = [];
function open(name: string = crypto.randomUUID()) {
  const database = new LocalDatabase(name);
  databases.push(database);
  return database;
}
afterEach(async () => {
  for (const database of databases) database.close();
  for (const database of databases) await database.delete();
  databases.length = 0;
});

describe('local schema', () => {
  it('upgrades former one-use teams restoring manual archives without changing memberships or match history', async () => {
    const name = crypto.randomUUID();
    const legacy = new Dexie(name);
    legacy.version(4).stores({
      teams: '&id, name, archivedAt',
      teamMemberships: '&id, teamId, playerId, [teamId+playerId]',
      matches: '&id',
      scoreEvents: '&id',
      deviceSettings: '&key',
    });
    const date = '2026-11-16T10:00:00.000Z';
    const base = {
      name: 'Original',
      color: '#153e35',
      createdAt: date,
      updatedAt: date,
      revision: 2,
      extra: { keep: true },
    };
    const used = {
      ...base,
      id: 'used',
      kind: 'temporary',
      assignedMatchId: 'match',
      archivedAt: date,
    };
    const manual = { ...base, id: 'manual', kind: 'temporary', archivedAt: date };
    const reusable = { ...base, id: 'reusable', kind: 'permanent' };
    const match = {
      id: 'match',
      teamsSnapshot: [{ id: 'used', kind: 'temporary', name: 'Historical' }],
    };
    const event = { id: 'event', matchId: 'match', payload: { immutable: true } };
    const member = { id: 'member', teamId: 'used', playerId: 'alice', joinedAt: date };
    await legacy
      .table('teams')
      .bulkAdd([used, manual, reusable, { ...base, id: 'unused', kind: 'temporary' }]);
    await legacy.table('matches').add(match);
    await legacy.table('scoreEvents').add(event);
    await legacy.table('teamMemberships').add(member);
    legacy.close();
    const db = open(name);
    await db.open();
    expect(await db.teams.get('used')).toEqual({
      ...base,
      id: 'used',
      kind: 'permanent',
      revision: 3,
    });
    const manualProfile = { ...manual };
    delete (manualProfile as Partial<typeof manual>).archivedAt;
    expect(await db.teams.get('manual')).toEqual({
      ...manualProfile,
      kind: 'permanent',
      revision: 4,
    });
    expect((await db.teams.get('manual'))?.deletedAt).toBeUndefined();
    expect(await db.teams.get('unused')).toEqual({
      ...base,
      id: 'unused',
      kind: 'permanent',
      revision: 3,
    });
    expect(await db.teams.get('reusable')).toEqual(reusable);
    expect(await db.matches.get('match')).toEqual(match);
    expect(await db.scoreEvents.get('event')).toEqual(event);
    expect(await db.teamMemberships.get('member')).toEqual(member);
    db.close();
    const reopened = open(name);
    await reopened.open();
    expect((await reopened.teams.get('used'))?.revision).toBe(3);
    expect(await reopened.teams.count()).toBe(4);
  });
  it('upgrades populated schema6 team archives without deletion, preserving metadata and references', async () => {
    const name = crypto.randomUUID();
    const legacy = new Dexie(name);
    legacy.version(6).stores({
      teams: '&id, name, archivedAt',
      teamMemberships: '&id, teamId, playerId',
      matches: '&id',
      scoreEvents: '&id',
    });
    const date = '2026-11-16T10:00:00.000Z';
    const team = {
      id: 'archived',
      name: 'Original',
      color: '#153e35',
      kind: 'permanent',
      archivedAt: date,
      createdAt: date,
      updatedAt: date,
      revision: 2,
      extra: { keep: true },
    };
    const record = { id: 'historical', teamsSnapshot: [{ id: 'archived', name: 'Pinned' }] };
    const event = { id: 'event', matchId: 'historical', payload: { keep: true } };
    const member = { id: 'membership', teamId: 'archived', playerId: 'alice', joinedAt: date };
    await legacy.table('teams').add(team);
    await legacy.table('matches').add(record);
    await legacy.table('scoreEvents').add(event);
    await legacy.table('teamMemberships').add(member);
    legacy.close();
    const db = open(name);
    await db.open();
    const restored = await db.teams.get('archived');
    expect(restored).toMatchObject({
      id: 'archived',
      name: 'Original',
      revision: 3,
      extra: { keep: true },
    });
    expect(restored?.archivedAt).toBeUndefined();
    expect(restored?.deletedAt).toBeUndefined();
    expect(await db.matches.get('historical')).toEqual(record);
    expect(await db.scoreEvents.get('event')).toEqual(event);
    expect(await db.teamMemberships.get('membership')).toEqual(member);
    db.close();
    const reopened = open(name);
    await reopened.open();
    expect((await reopened.teams.get('archived'))?.revision).toBe(3);
    expect(reopened.verno).toBe(7);
  });
  it('converts former player archives to existing profiles without silently deleting them', async () => {
    const name = crypto.randomUUID();
    const legacy = new Dexie(name);
    legacy.version(5).stores({ players: '&id, displayName, archivedAt', deviceSettings: '&key' });
    const date = '2026-11-16T10:00:00.000Z';
    const archived = {
      id: 'alice',
      displayName: 'Alice',
      color: '#153e35',
      isGuest: false,
      createdAt: date,
      updatedAt: date,
      archivedAt: date,
      revision: 2,
      email: 'alice@example.com',
      extra: { keep: true },
    };
    await legacy.table('players').add(archived);
    legacy.close();
    const db = open(name);
    await db.open();
    const expected = Object.fromEntries(
      Object.entries(archived).filter(([key]) => key !== 'archivedAt'),
    );
    expect(await db.players.get('alice')).toEqual({ ...expected, revision: 3 });
    expect((await db.players.get('alice'))?.deletedAt).toBeUndefined();
    db.close();
    const again = open(name);
    await again.open();
    expect((await again.players.get('alice'))?.revision).toBe(3);
  });
  it('adds the v3 catalog name index to a populated v2 database without changing any historical record', async () => {
    const name = crypto.randomUUID();
    const legacy = new Dexie(name);
    legacy.version(2).stores({
      deviceSettings: '&key',
      players: '&id, displayName, archivedAt',
      teams: '&id, name, archivedAt',
      teamMemberships: '&id, teamId, playerId, [teamId+playerId]',
      games: '&id, &slug, state',
      gameVersions: '&id, gameId, &[gameId+rulesetVersion]',
      variants: '&id, gameVersionId',
      matches: '&id, status, gameVersionId, createdAt, updatedAt',
      rounds: '&id, matchId, &[matchId+sequence]',
      scoreEvents: '&id, &[matchId+sequence], &[matchId+commandId], roundId',
      matchProjections: '&matchId',
      matchPermissions: '[matchId+playerId], matchId',
    });
    const records: Record<string, object> = {
      deviceSettings: { key: 'futureSetting', value: { keep: true } },
      players: {
        id: 'alice',
        displayName: 'Alice',
        avatarImage: 'cached-avatar',
        extra: { keep: true },
      },
      games: { id: 'old', slug: 'old', name: 'Old', state: 'coming_soon', favorite: true },
      gameVersions: { id: 'v1', gameId: 'old', rulesetVersion: '1', definition: { pinned: true } },
      matches: {
        id: 'm1',
        gameVersionId: 'v1',
        rulesSnapshot: { definition: { pinned: true } },
        playersSnapshot: [{ id: 'alice', displayName: 'Original' }],
      },
      scoreEvents: {
        id: 'e1',
        matchId: 'm1',
        commandId: 'c1',
        sequence: 1,
        payload: { immutable: true },
      },
      matchProjections: { matchId: 'm1', totals: { alice: 4 }, status: 'in_progress' },
      matchPermissions: { matchId: 'm1', playerId: 'alice', role: 'organizer' },
    };
    for (const [table, record] of Object.entries(records)) await legacy.table(table).add(record);
    legacy.close();
    const upgraded = open(name);
    await upgraded.open();
    expect(upgraded.verno).toBe(7);
    for (const [table, record] of Object.entries(records))
      expect(await upgraded.table(table).toArray()).toEqual([record]);
    expect((await upgraded.games.where('name').startsWithIgnoreCase('ol').toArray())[0]?.id).toBe(
      'old',
    );
  });
  it('starts empty and persists a setting after reopening', async () => {
    const database = open();
    expect(database.verno).toBe(7);
    expect(await database.readDeviceName()).toBe('');
    await database.saveDeviceName('  Mon téléphone  ');
    database.close();
    const reopened = open(database.name);
    expect(await reopened.readDeviceName()).toBe('Mon téléphone');
  });
  it('preserves an existing setting when invalid input is rejected', async () => {
    const database = open();
    await database.saveDeviceName('Original');
    await expect(database.saveDeviceName(' ')).rejects.toThrow();
    expect(await database.readDeviceName()).toBe('Original');
    expect(await database.deviceSettings.count()).toBe(1);
  });
  it('upgrades a populated v1 database without changing settings or seeding demo data', async () => {
    const name = crypto.randomUUID();
    const legacy = new Dexie(name);
    legacy.version(1).stores({ deviceSettings: '&key' });
    await legacy.table('deviceSettings').put({ key: 'deviceName', value: 'Existing device' });
    await legacy.table('deviceSettings').put({ key: 'futureSetting', value: { preserve: true } });
    legacy.close();
    const upgraded = open(name);
    expect(await upgraded.readDeviceName()).toBe('Existing device');
    expect(await upgraded.deviceSettings.get('futureSetting')).toEqual({
      key: 'futureSetting',
      value: { preserve: true },
    });
    expect(upgraded.verno).toBe(7);
    for (const table of upgraded.tables.filter((table) => table.name !== 'deviceSettings'))
      expect(await table.count()).toBe(0);
    upgraded.close();
    expect(await open(name).readDeviceName()).toBe('Existing device');
  });
});
