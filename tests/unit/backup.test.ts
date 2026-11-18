import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  BackupRepository,
  exportHistoryCsv,
  exportStatisticsCsv,
} from '../../src/lib/storage/backup';
import { CatalogRepository } from '../../src/lib/storage/catalog';
import { MatchJournal } from '../../src/lib/storage/journal';
import { LocalDatabase } from '../../src/lib/storage/database';
import { TeamRepository } from '../../src/lib/storage/teams';
import { LocalRepository } from '../../src/lib/storage/repository';
import { serializeCsv } from '../../src/lib/domain/csv';
import { seedJournal, timestamp } from '../fixtures/journal';
async function source(db: LocalDatabase) {
  await seedJournal(db);
  await new CatalogRepository(db).initialize(timestamp);
  const journal = new MatchJournal(db);
  let n = 0;
  for (const action of [
    { type: 'start' },
    { type: 'record', ownerId: 'blue', values: { points: 6 } },
    { type: 'record', ownerId: 'blue', values: { points: 6 } },
    { type: 'record', ownerId: 'blue', values: { points: 1 } },
  ])
    await journal.submit({
      matchId: 'match',
      eventId: `backup-event-${++n}`,
      commandId: `backup-command-${n}`,
      expectedVersion: n - 1,
      actorPlayerId: 'alice',
      deviceId: 'source-device',
      timestamp,
      action: action as never,
    });
  await db.readOrCreateDeviceId('source-device');
  await db.saveDeviceName('Source device');
  return new BackupRepository(db).export(timestamp);
}
describe('non-destructive complete local backups', () => {
  it('restores all references and exact event identities on another device, rebuilding projections and detecting identical duplicates', async () => {
    const a = new LocalDatabase(crypto.randomUUID()),
      b = new LocalDatabase(crypto.randomUUID());
    try {
      const text = await source(a);
      expect(text).not.toContain('"matchProjections"');
      await new CatalogRepository(b).initialize('2026-11-17T12:00:00.000Z');
      await b.readOrCreateDeviceId('destination-device');
      await b.saveDeviceName('Destination device');
      const result = await new BackupRepository(b).restore(text);
      expect(result.matches).toBe(1);
      expect(await b.players.toArray()).toEqual(await a.players.toArray());
      expect(await b.scoreEvents.toArray()).toEqual(await a.scoreEvents.toArray());
      expect((await new MatchJournal(b).read('match')).projection).toMatchObject({
        status: 'finished',
        totals: { blue: 13, red: 0 },
      });
      expect(await b.readOrCreateDeviceId('ignored')).toBe('destination-device');
      expect(await b.readDeviceName()).toBe('Destination device');
      const duplicate = await new BackupRepository(b).restore(text);
      expect(duplicate.added).toBe(0);
      expect(duplicate.duplicates).toBeGreaterThan(0);
      expect(JSON.parse(await new BackupRepository(b).export(timestamp)).tables.matches).toEqual(
        JSON.parse(text).tables.matches,
      );
    } finally {
      a.close();
      b.close();
      await a.delete();
      await b.delete();
    }
  });
  it.each([
    { formatVersion: 1, schemaVersion: 3 },
    { formatVersion: 2, schemaVersion: 4 },
  ])(
    'restores reusable teams from legacy backup $formatVersion/schema$schemaVersion without rewriting history',
    async (legacy) => {
      const a = new LocalDatabase(crypto.randomUUID()),
        b = new LocalDatabase(crypto.randomUUID());
      try {
        const data = JSON.parse(await source(a));
        Object.assign(data, legacy);
        if (legacy.formatVersion === 1) {
          delete data.tables.matchAuthorities;
          delete data.tables.peerReplicas;
        }
        const team = data.tables.teams.find((team: { id: string }) => team.id === 'blue');
        Object.assign(team, {
          kind: 'temporary',
          assignedMatchId: 'match',
          archivedAt: timestamp,
          revision: 2,
        });
        const text = JSON.stringify(data);
        await new BackupRepository(b).restore(text);
        expect(await b.teams.get('blue')).toMatchObject({ kind: 'permanent', revision: 3 });
        expect((await b.teams.get('blue'))?.archivedAt).toBeUndefined();
        expect((await b.teams.get('blue'))?.assignedMatchId).toBeUndefined();
        expect(await b.matches.toArray()).toEqual(data.tables.matches);
        expect(await b.scoreEvents.toArray()).toEqual(data.tables.scoreEvents);
        expect((await new BackupRepository(b).restore(text)).added).toBe(0);
        const current = JSON.parse(await new BackupRepository(b).export(timestamp));
        expect(current.schemaVersion).toBe(7);
        expect(current.formatVersion).toBe(2);
      } finally {
        a.close();
        b.close();
        await a.delete();
        await b.delete();
      }
    },
  );
  it.each([5, 6])(
    'imports schema%s team archives as existing teams without rewriting history',
    async (schemaVersion) => {
      const a = new LocalDatabase(crypto.randomUUID()),
        b = new LocalDatabase(crypto.randomUUID());
      try {
        const data = JSON.parse(await source(a));
        data.schemaVersion = schemaVersion;
        const team = data.tables.teams.find((row: { id: string }) => row.id === 'blue');
        team.archivedAt = timestamp;
        const revision = team.revision ?? 0;
        const text = JSON.stringify(data);
        await new BackupRepository(b).restore(text);
        expect((await b.teams.get('blue'))?.archivedAt).toBeUndefined();
        expect((await b.teams.get('blue'))?.deletedAt).toBeUndefined();
        expect((await b.teams.get('blue'))?.revision).toBe(revision + 1);
        expect(
          (await new TeamRepository(b).listTeams()).items.some((row) => row.team.id === 'blue'),
        ).toBe(true);
        expect(await b.matches.toArray()).toEqual(data.tables.matches);
        expect(await b.scoreEvents.toArray()).toEqual(data.tables.scoreEvents);
        expect((await new BackupRepository(b).restore(text)).added).toBe(0);
      } finally {
        a.close();
        b.close();
        await a.delete();
        await b.delete();
      }
    },
  );
  it('roundtrips deleted teams without restoring them or damaging saved matches', async () => {
    const a = new LocalDatabase(crypto.randomUUID()),
      b = new LocalDatabase(crypto.randomUUID());
    try {
      const liveBackup = await source(a);
      const team = (await a.teams.get('blue'))!;
      await new TeamRepository(a).deleteTeam(team.id, team.revision ?? 0, timestamp);
      const text = await new BackupRepository(a).export(timestamp);
      expect(JSON.parse(text).schemaVersion).toBe(7);
      await new BackupRepository(b).restore(text);
      expect((await b.teams.get('blue'))?.deletedAt).toBe(timestamp);
      expect(
        (await new TeamRepository(b).listTeams()).items.some((row) => row.team.id === 'blue'),
      ).toBe(false);
      expect((await new MatchJournal(b).read('match')).projection).toMatchObject({
        status: 'finished',
        totals: { blue: 13, red: 0 },
      });
      expect(await b.matches.toArray()).toEqual(await a.matches.toArray());
      await expect(new BackupRepository(b).restore(liveBackup)).rejects.toMatchObject({
        code: 'conflict',
      });
      expect((await b.teams.get('blue'))?.deletedAt).toBe(timestamp);
      const archived = JSON.parse(text);
      archived.tables.teams.find((row: { id: string }) => row.id === 'blue').archivedAt = timestamp;
      await expect(new BackupRepository(b).restore(JSON.stringify(archived))).rejects.toMatchObject(
        { code: 'invalid_record' },
      );
      const malformed = JSON.parse(text);
      malformed.tables.teams.find((row: { id: string }) => row.id === 'blue').deletedAt = 'invalid';
      await expect(
        new BackupRepository(b).restore(JSON.stringify(malformed)),
      ).rejects.toMatchObject({ code: 'invalid_record' });
      expect((await b.teams.get('blue'))?.deletedAt).toBe(timestamp);
    } finally {
      a.close();
      b.close();
      await a.delete();
      await b.delete();
    }
  });
  it('imports schema5 player archives as existing profiles without deleting data', async () => {
    const a = new LocalDatabase(crypto.randomUUID()),
      b = new LocalDatabase(crypto.randomUUID());
    try {
      const data = JSON.parse(await source(a));
      data.schemaVersion = 5;
      const profile = data.tables.players.find((row: { id: string }) => row.id === 'alice');
      profile.archivedAt = timestamp;
      profile.revision = 2;
      const text = JSON.stringify(data);
      await new BackupRepository(b).restore(text);
      expect(
        (await new LocalRepository(b).listPlayers()).items.some((row) => row.id === 'alice'),
      ).toBe(true);
      expect((await b.players.get('alice'))?.archivedAt).toBeUndefined();
      expect((await b.players.get('alice'))?.revision).toBe(3);
      expect(await b.matches.toArray()).toEqual(data.tables.matches);
      expect((await new BackupRepository(b).restore(text)).added).toBe(0);
    } finally {
      a.close();
      b.close();
      await a.delete();
      await b.delete();
    }
  });
  it('backs up deleted references without restoring live profiles or changing historical journals', async () => {
    const a = new LocalDatabase(crypto.randomUUID()),
      b = new LocalDatabase(crypto.randomUUID());
    try {
      const before = await source(a);
      const player = (await a.players.get('alice'))!;
      await new LocalRepository(a).deletePlayer('alice', player.revision ?? 0, timestamp);
      const text = await new BackupRepository(a).export(timestamp);
      await new BackupRepository(b).restore(text);
      expect(
        (await new LocalRepository(b).listPlayers()).items.some((row) => row.id === 'alice'),
      ).toBe(false);
      expect((await b.players.get('alice'))?.deletedAt).toBe(timestamp);
      expect(await b.matches.toArray()).toEqual(await a.matches.toArray());
      expect(await b.scoreEvents.toArray()).toEqual(await a.scoreEvents.toArray());
      expect((await new MatchJournal(b).read('match')).projection.status).toBe('finished');
      await expect(new BackupRepository(b).restore(before)).rejects.toMatchObject({
        code: 'conflict',
      });
      expect((await b.players.get('alice'))?.deletedAt).toBe(timestamp);
      expect((await new BackupRepository(b).restore(text)).added).toBe(0);
    } finally {
      a.close();
      b.close();
      await a.delete();
      await b.delete();
    }
  });
  it('rejects invalid schemas, references, executable rules, event tampering and conflicting existing data without partial writes', async () => {
    const a = new LocalDatabase(crypto.randomUUID()),
      b = new LocalDatabase(crypto.randomUUID());
    try {
      const text = await source(a);
      const valid = JSON.parse(text);
      const cases = [
        { ...valid, formatVersion: 99 },
        { ...valid, tables: { ...valid.tables, players: [] } },
        JSON.parse(text),
        JSON.parse(text),
      ];
      cases[2].tables.gameVersions[0].definition.script = 'run';
      cases[3].tables.scoreEvents[0].payload.action = { type: 'finish' };
      for (const deletedAt of ['', null, false, 'invalid-date']) {
        const invalid = JSON.parse(text);
        invalid.tables.players[0].deletedAt = deletedAt;
        cases.push(invalid);
      }
      const retainedEmail = JSON.parse(text);
      retainedEmail.tables.players[0].deletedAt = timestamp;
      retainedEmail.tables.players[0].email = 'removed@example.com';
      cases.push(retainedEmail);
      for (const invalid of cases) {
        await expect(new BackupRepository(b).restore(JSON.stringify(invalid))).rejects.toThrow();
        expect(await b.players.count()).toBe(0);
        expect(await b.matches.count()).toBe(0);
      }
      await b.players.add({ ...valid.tables.players[0], displayName: 'Existing local choice' });
      await expect(new BackupRepository(b).restore(text)).rejects.toThrow('conflict');
      expect(await b.players.count()).toBe(1);
      expect(await b.matches.count()).toBe(0);
      expect((await b.players.toArray())[0]!.displayName).toBe('Existing local choice');
    } finally {
      a.close();
      b.close();
      await a.delete();
      await b.delete();
    }
  });
  it('rolls back all staged tables when storage becomes full during restoration', async () => {
    const a = new LocalDatabase(crypto.randomUUID()),
      b = new LocalDatabase(crypto.randomUUID());
    try {
      const text = await source(a);
      b.scoreEvents.hook('creating', () => {
        throw new DOMException('Full', 'QuotaExceededError');
      });
      await expect(new BackupRepository(b).restore(text)).rejects.toThrow();
      expect(await b.players.count()).toBe(0);
      expect(await b.games.count()).toBe(0);
      expect(await b.matches.count()).toBe(0);
    } finally {
      a.close();
      b.close();
      await a.delete();
      await b.delete();
    }
  });
  it('preserves cached Gravatar metadata while keeping email out of historical snapshots', async () => {
    const a = new LocalDatabase(crypto.randomUUID()),
      b = new LocalDatabase(crypto.randomUUID());
    try {
      const data = JSON.parse(await source(a));
      const image =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2rS8AAAAASUVORK5CYII=';
      const player = data.tables.players.find((row: { id: string }) => row.id === 'alice');
      Object.assign(player, {
        isGuest: false,
        avatar: 'gravatar',
        email: 'test@example.invalid',
        avatarImage: image,
      });
      const snapshot = data.tables.matches[0].playersSnapshot.find(
        (row: { id: string }) => row.id === 'alice',
      );
      Object.assign(snapshot, { isGuest: false, avatar: 'gravatar', avatarImage: image });
      await new BackupRepository(b).restore(JSON.stringify(data));
      expect((await b.players.get('alice'))?.avatarImage).toBe(image);
      expect((await b.players.get('alice'))?.email).toBe('test@example.invalid');
      const match = await b.matches.get('match');
      expect(match!.playersSnapshot.find((row) => row.id === 'alice')!.avatarImage).toBe(image);
      expect(JSON.stringify(match!.playersSnapshot)).not.toContain('email');
    } finally {
      a.close();
      b.close();
      await a.delete();
      await b.delete();
    }
  });
  it('exports historical/statistical CSV with formula-safe quoted text', async () => {
    expect(
      serializeCsv([
        ['name', 'score'],
        ['=HYPERLINK("bad")', -10],
        ['a,b\nc', 2],
      ]),
    ).toContain('"\'=HYPERLINK(""bad"")"');
    const db = new LocalDatabase(crypto.randomUUID());
    try {
      await source(db);
      expect(await exportHistoryCsv(db)).toContain('"match","journal-fixture","1"');
      expect(await exportStatisticsCsv(db)).toContain('"team","blue"');
    } finally {
      db.close();
      await db.delete();
    }
  });
});
