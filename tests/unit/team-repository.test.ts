import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalDatabase } from '../../src/lib/storage/database';
import { LocalRepository } from '../../src/lib/storage/repository';
import { TeamRepository } from '../../src/lib/storage/teams';
import type { TeamRecord } from '../../src/lib/domain/records';

const timestamp = '2026-11-16T12:00:00.000Z';
const later = '2026-11-16T13:00:00.000Z';
const databases: LocalDatabase[] = [];
function open(name: string = crypto.randomUUID()) {
  const database = new LocalDatabase(name);
  databases.push(database);
  return { database, players: new LocalRepository(database), teams: new TeamRepository(database) };
}
afterEach(async () => {
  for (const database of databases) database.close();
  for (const database of databases) await database.delete();
  databases.length = 0;
});
function team(id = 'blue'): TeamRecord {
  return {
    id,
    name: id,
    color: '#153e35',
    avatar: 'flag',
    format: 'petanque_doublette',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
async function seed() {
  const context = open();
  for (const id of ['alice', 'lucas', 'emma', 'hugo'])
    await context.players.createPlayer({
      id,
      displayName: id,
      color: '#153e35',
      isGuest: id === 'hugo',
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  await context.players.saveGame({
    id: 'fixture',
    name: 'Roster fixture',
    slug: 'fixture',
    state: 'coming_soon',
  });
  await context.players.publishGameVersion({
    id: 'rules',
    gameId: 'fixture',
    rulesetVersion: '1',
    schemaVersion: 1,
    definition: {},
    publishedAt: timestamp,
  });
  return context;
}
function match(id: string, teamIds = ['blue']) {
  return {
    id,
    gameVersionId: 'rules',
    playerIds: ['alice', 'lucas', 'emma', 'hugo'],
    teamIds,
    organizerPlayerId: 'alice',
    mode: 'teams' as const,
    settings: {},
    createdAt: later,
  };
}

describe('team storage', () => {
  it('keeps stable IDs, appearance and membership history through edit/delete/reopen', async () => {
    const { database, teams } = await seed();
    await teams.saveTeam(team(), ['alice', 'lucas'], { create: true });
    await teams.saveTeam(
      { ...team(), name: 'Renamed', avatar: 'star', updatedAt: later },
      ['alice', 'emma'],
      { expectedRevision: 1 },
    );
    await teams.deleteTeam('blue', 2, later);
    expect((await teams.listTeams()).items).toHaveLength(0);
    expect((await database.teams.get('blue'))?.deletedAt).toBe(later);
    await teams.deleteTeam('blue', 2, later);
    database.close();
    const reopened = open(database.name);
    expect((await reopened.teams.listTeams()).items).toHaveLength(0);
    const stored = await reopened.database.teams.get('blue');
    expect(stored).toMatchObject({
      id: 'blue',
      name: 'Renamed',
      avatar: 'star',
      createdAt: timestamp,
      revision: 3,
      deletedAt: later,
    });
    expect(stored?.memberOrder).toEqual(['alice', 'emma']);
    expect(
      (await reopened.database.teamMemberships.toArray()).find(
        (member) => member.playerId === 'lucas',
      )?.leftAt,
    ).toBe(later);
  });
  it('rejects stale edits, duplicate IDs and inactive/missing members without changing the roster', async () => {
    const { database, teams, players } = await seed();
    await teams.saveTeam(team(), ['alice', 'lucas'], { create: true });
    await expect(teams.saveTeam(team(), ['emma', 'hugo'], { create: true })).rejects.toMatchObject({
      code: 'conflict',
    });
    await expect(
      teams.saveTeam(team(), ['emma', 'hugo'], { expectedRevision: 0 }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await players.deletePlayer('emma', 1, later);
    await expect(
      teams.saveTeam(team(), ['emma', 'hugo'], { expectedRevision: 1 }),
    ).rejects.toMatchObject({ code: 'invalid_record' });
    await expect(
      teams.saveTeam(team(), ['missing', 'hugo'], { expectedRevision: 1 }),
    ).rejects.toMatchObject({ code: 'missing_reference' });
    expect((await teams.listTeams()).items[0]?.members.map((player) => player.id)).toEqual([
      'alice',
      'lucas',
    ]);
    expect((await database.teams.get('blue'))?.revision).toBe(1);
  });
  it('rolls back every team and membership if batch storage fails', async () => {
    const { database, teams } = await seed();
    database.teams.hook('creating', (_key, record) => {
      if (record.id === 'red') throw new DOMException('Full', 'QuotaExceededError');
    });
    await expect(
      teams.createTeams([
        { team: team(), playerIds: ['alice', 'lucas'] },
        { team: team('red'), playerIds: ['emma', 'hugo'] },
      ]),
    ).rejects.toMatchObject({ code: 'quota_exceeded' });
    expect(await database.teams.count()).toBe(0);
    expect(await database.teamMemberships.count()).toBe(0);
    expect(await database.players.count()).toBe(4);
  });
  it('rejects duplicate player allocation in a generated batch', async () => {
    const { database, teams } = await seed();
    await expect(
      teams.createTeams([
        { team: team(), playerIds: ['alice', 'lucas'] },
        { team: team('red'), playerIds: ['alice', 'hugo'] },
      ]),
    ).rejects.toMatchObject({ code: 'invalid_record' });
    expect(await database.teams.count()).toBe(0);
  });
  it('supports legacy team defaults, prefix search and bounded pages', async () => {
    const { database, teams } = await seed();
    await database.teams.add({
      id: 'legacy',
      name: 'Legacy',
      color: '#153e35',
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await database.teamMemberships.add({
      id: 'membership',
      teamId: 'legacy',
      playerId: 'alice',
      joinedAt: timestamp,
    });
    expect((await teams.listTeams()).items[0]?.members[0]?.id).toBe('alice');
    await teams.saveTeam(
      { id: 'legacy', name: 'Updated', color: '#153e35', createdAt: timestamp, updatedAt: later },
      ['alice'],
      { expectedRevision: 0 },
    );
    for (let index = 0; index < 25; index++)
      await teams.saveTeam(
        { ...team(`team-${index}`), name: `Team ${String(index).padStart(2, '0')}` },
        ['alice', 'lucas'],
        { create: true },
      );
    expect((await teams.listTeams()).items).toHaveLength(24);
    expect((await teams.listTeams({ page: 1 })).items).toHaveLength(2);
    expect((await teams.listTeams({ search: 'tEaM 24' })).items[0]?.team.id).toBe('team-24');
    expect(database.verno).toBe(7);
  });
});

describe('match team snapshots', () => {
  it('marks a deleted member unavailable until the roster is repaired without rewriting match history', async () => {
    const { database, teams, players } = await seed();
    await teams.saveTeam(team(), ['alice', 'lucas'], { create: true });
    const original = await players.createMatch(match('first'));
    await players.deletePlayer('alice', 1, later);
    expect(
      (await teams.listTeams()).items[0]?.members.find((row) => row.id === 'alice')?.deletedAt,
    ).toBe(later);
    expect((await database.teams.get('blue'))?.revision).toBe(2);
    await expect(players.createMatch(match('blocked'))).rejects.toMatchObject({
      code: 'invalid_record',
    });
    await teams.saveTeam({ ...team(), updatedAt: later }, ['emma', 'lucas'], {
      expectedRevision: 2,
    });
    expect((await teams.listTeams()).items[0]?.members.map((row) => row.id)).toEqual([
      'emma',
      'lucas',
    ]);
    expect((await players.readMatch('first')).match.teamsSnapshot).toEqual(original.teamsSnapshot);
    expect((await database.teamMemberships.where('playerId').equals('alice').first())?.leftAt).toBe(
      later,
    );
  });
  it('preserves historical teams after their names, avatars and rosters change', async () => {
    const { teams, players } = await seed();
    await teams.saveTeam(team(), ['alice', 'lucas'], { create: true });
    const original = await players.createMatch(match('first'));
    await teams.saveTeam(
      { ...team(), name: 'Changed', avatar: 'leaf', updatedAt: later },
      ['emma', 'hugo'],
      { expectedRevision: 1 },
    );
    await teams.deleteTeam('blue', 2, later);
    expect((await players.readMatch('first')).match.teamsSnapshot).toEqual(original.teamsSnapshot);
    expect(original.teamsSnapshot[0]).toMatchObject({
      avatar: 'flag',
      kind: 'permanent',
      format: 'petanque_doublette',
      playerIds: ['alice', 'lucas'],
    });
  });
  it('reuses a team across drafts without archiving or changing its historical snapshots', async () => {
    const { database, teams, players } = await seed();
    await teams.saveTeam({ ...team(), kind: 'temporary' }, ['alice', 'lucas'], { create: true });
    const original = await players.createMatch(match('first'));
    const second = await players.createMatch(match('second'));
    expect(second.teamsSnapshot).toEqual(original.teamsSnapshot);
    expect(await database.teams.get('blue')).toMatchObject({ kind: 'permanent', revision: 1 });
    expect((await database.teams.get('blue'))?.archivedAt).toBeUndefined();
    expect((await database.teams.get('blue'))?.assignedMatchId).toBeUndefined();
    expect((await teams.listTeams()).items).toHaveLength(1);
    await teams.deleteTeam('blue', 1, later);
    expect((await players.readMatch('first')).match.teamsSnapshot).toEqual(original.teamsSnapshot);
    expect(await database.matches.count()).toBe(2);
  });
  it('leaves teams reusable if creation of the draft fails', async () => {
    const { database, teams, players } = await seed();
    await teams.saveTeam({ ...team(), kind: 'temporary' }, ['alice', 'lucas'], { create: true });
    database.matchProjections.hook('creating', () => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    await expect(players.createMatch(match('first'))).rejects.toMatchObject({
      code: 'quota_exceeded',
    });
    expect((await database.teams.get('blue'))?.assignedMatchId).toBeUndefined();
    expect((await teams.listTeams()).items).toHaveLength(1);
    expect(await database.matches.count()).toBe(0);
  });
  it('rejects overlap between two match teams', async () => {
    const { database, teams, players } = await seed();
    await teams.saveTeam(team(), ['alice', 'lucas'], { create: true });
    await teams.saveTeam(team('red'), ['alice', 'hugo'], { create: true });
    await expect(players.createMatch(match('first', ['blue', 'red']))).rejects.toMatchObject({
      code: 'invalid_record',
    });
    expect(await database.matches.count()).toBe(0);
  });
});

describe('confirmed team deletion', () => {
  it('rejects stale deletion and prevents edits, ID reuse and new matches after deletion', async () => {
    const { database, teams, players } = await seed();
    await teams.saveTeam(team(), ['alice', 'lucas'], { create: true });
    const original = await players.createMatch(match('saved-before-delete'));
    await expect(teams.deleteTeam('blue', 0, later)).rejects.toMatchObject({ code: 'conflict' });
    expect((await teams.listTeams()).items).toHaveLength(1);
    await expect(teams.deleteTeam('blue', 1, 'not-a-date')).rejects.toMatchObject({
      code: 'invalid_record',
    });
    await teams.deleteTeam('blue', 1, later);
    await expect(teams.saveTeam(team(), ['alice', 'lucas'])).rejects.toMatchObject({
      code: 'conflict',
    });
    await expect(
      teams.saveTeam(team(), ['alice', 'lucas'], { create: true }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(players.createMatch(match('blocked-after-delete'))).rejects.toMatchObject({
      code: 'invalid_record',
    });
    expect(await database.matches.get(original.id)).toEqual(original);
    expect((await teams.listTeams({ search: 'blue' })).items).toHaveLength(0);
    expect(await database.teamMemberships.count()).toBe(2);
    expect((await database.teams.get('blue'))?.deletedAt).toBe(later);
  });
  it('rolls back deletion on quota failure and leaves the roster usable', async () => {
    const { database, teams } = await seed();
    await teams.saveTeam(team(), ['alice', 'lucas'], { create: true });
    const before = await database.teams.get('blue');
    database.teams.hook('updating', (changes) => {
      if ('deletedAt' in changes) throw new DOMException('Full', 'QuotaExceededError');
    });
    await expect(teams.deleteTeam('blue', 1, later)).rejects.toMatchObject({
      code: 'quota_exceeded',
    });
    expect(await database.teams.get('blue')).toEqual(before);
    expect((await teams.listTeams()).items).toHaveLength(1);
  });
});
