import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalDatabase } from '../../src/lib/storage/database';
import { LocalRepository } from '../../src/lib/storage/repository';

const timestamp = '2026-11-16T12:00:00.000Z';
const later = '2026-11-16T13:00:00.000Z';
const databases: LocalDatabase[] = [];
function open(name: string = crypto.randomUUID()) {
  const database = new LocalDatabase(name);
  databases.push(database);
  return { database, repository: new LocalRepository(database) };
}
afterEach(async () => {
  for (const database of databases) database.close();
  for (const database of databases) await database.delete();
  databases.length = 0;
});
function player(id = 'alice') {
  return {
    id,
    displayName: 'Alice',
    color: '#153e35',
    isGuest: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

describe('profile mutations and selection', () => {
  it('keeps deletion irreversible through normal profile writes and after reopening', async () => {
    const { database, repository } = open();
    await repository.createPlayer({
      ...player(),
      email: 'alice@example.com',
      avatar: 'gravatar',
      avatarImage: 'data:image/png;base64,iVBORw0KGgo=',
    });
    const saved = (await database.players.get('alice'))!;
    await repository.updatePlayer('alice', { ...saved, displayName: 'Alice Martin' }, 1, later);
    expect((await database.players.get('alice'))?.email).toBe('alice@example.com');
    expect((await database.players.get('alice'))?.avatarImage).toBe(saved.avatarImage);
    await repository.deletePlayer('alice', 2, later);
    expect((await repository.listPlayers()).items).toHaveLength(0);
    expect(await database.players.get('alice')).toMatchObject({
      id: 'alice',
      deletedAt: later,
      revision: 3,
      createdAt: timestamp,
      avatar: 'initials',
    });
    expect((await database.players.get('alice'))?.email).toBeUndefined();
    expect((await database.players.get('alice'))?.avatarImage).toBeUndefined();
    await repository.deletePlayer('alice', 2, later);
    await expect(repository.savePlayer(player())).rejects.toMatchObject({ code: 'conflict' });
    database.close();
    expect((await open(database.name).repository.listPlayers()).items).toHaveLength(0);
  });
  it('edits legacy v2 records without optional fields and preserves unrelated settings', async () => {
    const { database, repository } = open();
    await database.players.add(player());
    await database.saveDeviceName('Original');
    await repository.updatePlayer('alice', { ...player(), isGuest: true }, 0, later);
    expect(await database.players.get('alice')).toMatchObject({
      revision: 1,
      isGuest: true,
      avatar: 'initials',
    });
    expect(await database.readDeviceName()).toBe('Original');
    expect(database.verno).toBe(7);
  });
  it('rejects duplicate IDs, stale edits and edits to deleted players', async () => {
    const { database, repository } = open();
    await expect(
      repository.createPlayer({ ...player('invalid'), deletedAt: '' }),
    ).rejects.toMatchObject({ code: 'invalid_record' });
    await repository.createPlayer(player());
    await expect(repository.createPlayer(player())).rejects.toMatchObject({ code: 'conflict' });
    await repository.updatePlayer('alice', { ...player(), displayName: 'First edit' }, 1, later);
    await expect(
      repository.updatePlayer('alice', { ...player(), displayName: 'Stale edit' }, 1, later),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(repository.deletePlayer('alice', 1, later)).rejects.toMatchObject({
      code: 'conflict',
    });
    await repository.deletePlayer('alice', 2, later);
    await expect(repository.updatePlayer('alice', player(), 3, later)).rejects.toMatchObject({
      code: 'conflict',
    });
    expect((await database.players.get('alice'))?.deletedAt).toBe(later);
  });
  it('bounds list pages and supports case-insensitive prefix selection', async () => {
    const { repository } = open();
    for (let index = 0; index < 26; index++)
      await repository.createPlayer({
        ...player(`id-${index}`),
        displayName: `Player ${String(index).padStart(2, '0')}`,
      });
    const first = await repository.listPlayers();
    const second = await repository.listPlayers({ page: 1 });
    expect(first.items).toHaveLength(24);
    expect(first.hasMore).toBe(true);
    expect(second.items).toHaveLength(2);
    expect(second.hasMore).toBe(false);
    expect(new Set([...first.items, ...second.items].map((player) => player.id)).size).toBe(26);
    expect((await repository.listPlayers({ search: ' pLaYeR 25 ' })).items[0]?.id).toBe('id-25');
  });
  it('preserves profile data after a failed save', async () => {
    const { database, repository } = open();
    await repository.createPlayer(player());
    const before = await database.players.get('alice');
    database.players.hook('updating', () => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    await expect(
      repository.updatePlayer('alice', { ...player(), displayName: 'Not saved' }, 1, later),
    ).rejects.toMatchObject({ code: 'quota_exceeded' });
    expect(await database.players.get('alice')).toEqual(before);
  });
  it('deletes a batch atomically and advances shared team revisions once', async () => {
    const { database, repository } = open();
    for (const id of ['alice', 'bob', 'carol'])
      await repository.createPlayer({ ...player(id), email: `${id}@example.com` });
    await repository.saveTeam(
      { id: 'duo', name: 'Duo', color: '#153e35', createdAt: timestamp, updatedAt: timestamp },
      ['alice', 'bob'],
    );
    const team = await database.teams.get('duo');
    const memberships = await database.teamMemberships.toArray();
    const targets = ['alice', 'bob'].map((id) => ({ id, expectedRevision: 1 }));
    await repository.deletePlayers(targets, later);
    for (const id of ['alice', 'bob']) {
      expect(await database.players.get(id)).toMatchObject({ deletedAt: later, revision: 2 });
      expect((await database.players.get(id))?.email).toBeUndefined();
    }
    expect((await repository.listPlayers()).items.map((row) => row.id)).toEqual(['carol']);
    expect((await database.teams.get('duo'))?.revision).toBe((team?.revision ?? 0) + 1);
    expect(await database.teamMemberships.toArray()).toEqual(memberships);
    await repository.deletePlayers(targets, later);
    expect((await database.teams.get('duo'))?.revision).toBe((team?.revision ?? 0) + 1);
  });

  it('rolls back the whole batch when a later profile is stale or missing', async () => {
    const { database, repository } = open();
    for (const id of ['alice', 'bob']) await repository.createPlayer(player(id));
    await repository.updatePlayer(
      'bob',
      { ...player('bob'), displayName: 'Bob changed' },
      1,
      later,
    );
    const before = await database.players.toArray();
    await expect(
      repository.deletePlayers(
        [
          { id: 'alice', expectedRevision: 1 },
          { id: 'bob', expectedRevision: 1 },
        ],
        later,
      ),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(await database.players.toArray()).toEqual(before);
    await expect(
      repository.deletePlayers(
        [
          { id: 'alice', expectedRevision: 1 },
          { id: 'missing', expectedRevision: 1 },
        ],
        later,
      ),
    ).rejects.toMatchObject({ code: 'missing_reference' });
    expect(await database.players.toArray()).toEqual(before);
    for (const targets of [
      [],
      [{ id: 'alice', expectedRevision: -1 }],
      [
        { id: 'alice', expectedRevision: 1 },
        { id: 'alice', expectedRevision: 1 },
      ],
      Array.from({ length: 257 }, (_, i) => ({ id: `player-${i}`, expectedRevision: 1 })),
    ])
      await expect(repository.deletePlayers(targets, later)).rejects.toMatchObject({
        code: 'invalid_record',
      });
    expect(await database.players.toArray()).toEqual(before);
  });

  it('rolls every batch profile back when a later write exceeds quota', async () => {
    const { database, repository } = open();
    for (const id of ['alice', 'bob']) await repository.createPlayer(player(id));
    const before = await database.players.toArray();
    database.players.hook('updating', (_changes, id) => {
      if (id === 'bob') throw new DOMException('Full', 'QuotaExceededError');
    });
    await expect(
      repository.deletePlayers(
        [
          { id: 'alice', expectedRevision: 1 },
          { id: 'bob', expectedRevision: 1 },
        ],
        later,
      ),
    ).rejects.toMatchObject({ code: 'quota_exceeded' });
    expect(await database.players.toArray()).toEqual(before);
  });

  it('rolls deletion and affected-team revisions back together when a write fails', async () => {
    const { database, repository } = open();
    await repository.createPlayer(player());
    await repository.saveTeam(
      { id: 'solo', name: 'Solo', color: '#153e35', createdAt: timestamp, updatedAt: timestamp },
      ['alice'],
    );
    const before = await database.players.get('alice');
    const team = await database.teams.get('solo');
    database.teams.hook('updating', () => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    await expect(repository.deletePlayer('alice', 1, later)).rejects.toMatchObject({
      code: 'quota_exceeded',
    });
    expect(await database.players.get('alice')).toEqual(before);
    expect(await database.teams.get('solo')).toEqual(team);
  });
  it('pins cached avatars in match snapshots but excludes email metadata', async () => {
    const { database, repository } = open();
    await repository.createPlayer({
      ...player(),
      avatar: 'gravatar',
      email: 'a@example.com',
      avatarImage: 'data:image/png;base64,iVBORw0KGgo=',
    });
    await repository.saveGame({ id: 'game', name: 'Test', slug: 'test', state: 'coming_soon' });
    await repository.publishGameVersion({
      id: 'version',
      gameId: 'game',
      rulesetVersion: '1',
      schemaVersion: 1,
      definition: {},
      publishedAt: timestamp,
    });
    await repository.createMatch({
      id: 'match',
      gameVersionId: 'version',
      playerIds: ['alice'],
      teamIds: [],
      organizerPlayerId: 'alice',
      mode: 'individual',
      settings: {},
      createdAt: timestamp,
    });
    const before = (await repository.readMatch('match')).match.playersSnapshot;
    await repository.updatePlayer(
      'alice',
      { ...player(), displayName: 'Changed', avatar: 'star' },
      1,
      later,
    );
    await repository.deletePlayer('alice', 2, later);
    const snapshot = (await repository.readMatch('match')).match.playersSnapshot[0];
    expect(snapshot).toEqual(before[0]);
    expect(snapshot).toMatchObject({
      avatar: 'gravatar',
      avatarImage: 'data:image/png;base64,iVBORw0KGgo=',
    });
    expect(snapshot).not.toHaveProperty('email');
    expect((await database.players.get('alice'))?.email).toBeUndefined();
  });
});
