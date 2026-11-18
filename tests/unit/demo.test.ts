import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { seedDemoData, demoMatchIds } from '../../src/lib/development/demo';
import { LocalDatabase } from '../../src/lib/storage/database';
import { MatchJournal } from '../../src/lib/storage/journal';
import { LocalRepository } from '../../src/lib/storage/repository';
import { BackupRepository } from '../../src/lib/storage/backup';
import { gameCatalog } from '../../src/lib/domain/games/catalog';

describe('explicit local demo fixtures', () => {
  it('creates playable scored histories for every game and preserves existing data on repeat', async () => {
    const database = new LocalDatabase(`demo-${crypto.randomUUID()}`);
    try {
      const existingPlayer = {
        id: 'existing-player',
        displayName: 'Existing player',
        color: '#2563eb',
        isGuest: true,
        createdAt: '2026-11-16T12:00:00.000Z',
        updatedAt: '2026-11-16T12:00:00.000Z',
      };
      await new LocalRepository(database).createPlayer(existingPlayer);
      const preservedPlayer = await database.players.get(existingPlayer.id);
      await database.saveLanguage('en');
      await database.saveDeviceName('My phone');
      expect(await seedDemoData(database)).toEqual({
        created: true,
        players: 6,
        teams: 3,
        matches: demoMatchIds.length,
      });
      const matches = await database.matches.toArray();
      expect(new Set(matches.map((match) => match.rulesSnapshot.gameId))).toEqual(
        new Set(gameCatalog.map((game) => game.id)),
      );
      for (const id of demoMatchIds) {
        const { match, journal } = await new MatchJournal(database).inspect(id);
        expect(['in_progress', 'finished']).toContain(match.status);
        expect(journal.audit.length).toBeGreaterThan(1);
      }
      const first = await new MatchJournal(database).inspect(demoMatchIds[0]!);
      await new MatchJournal(database).submit({
        matchId: first.match.id,
        eventId: 'user-pause',
        commandId: 'user-pause',
        expectedVersion: first.match.version,
        actorPlayerId: first.match.organizerPlayerId,
        deviceId: await database.readOrCreateDeviceId('unused'),
        timestamp: new Date().toISOString(),
        action: { type: 'pause' },
      });
      const before = await database.scoreEvents.toArray();
      expect((await seedDemoData(database)).created).toBe(false);
      expect(await database.matches.count()).toBe(demoMatchIds.length);
      expect(await database.scoreEvents.toArray()).toEqual(before);
      expect(await database.players.get(existingPlayer.id)).toEqual(preservedPlayer);
      expect((await database.matches.get(demoMatchIds[0]!))?.status).toBe('paused');
      expect(await database.readLanguage()).toBe('en');
      expect(await new BackupRepository(database).export(new Date().toISOString())).toContain(
        'scoretrackrr-backup',
      );
      expect(await database.readDeviceName()).toBe('My phone');
    } finally {
      await database.delete();
    }
  });
  it('refuses reserved-ID collisions without adding partial fixtures', async () => {
    const database = new LocalDatabase(`demo-conflict-${crypto.randomUUID()}`);
    try {
      await new LocalRepository(database).createPlayer({
        id: 'local-demo-v1-player-0',
        displayName: 'Existing identity',
        color: '#2563eb',
        isGuest: true,
        createdAt: '2026-11-16T12:00:00.000Z',
        updatedAt: '2026-11-16T12:00:00.000Z',
      });
      await expect(seedDemoData(database)).rejects.toThrow('DEMO_ID_CONFLICT');
      expect(await database.players.count()).toBe(1);
      expect(await database.teams.count()).toBe(0);
      expect(await database.matches.count()).toBe(0);
    } finally {
      await database.delete();
    }
  });
  it('rolls back fixture creation if recording a match fails', async () => {
    const database = new LocalDatabase(`demo-rollback-${crypto.randomUUID()}`);
    const submit = vi
      .spyOn(MatchJournal.prototype, 'submit')
      .mockRejectedValueOnce(new Error('INJECTED_WRITE_FAILURE'));
    try {
      await database.saveLanguage('en');
      await expect(seedDemoData(database)).rejects.toThrow('INJECTED_WRITE_FAILURE');
      expect(await database.players.count()).toBe(0);
      expect(await database.teams.count()).toBe(0);
      expect(await database.matches.count()).toBe(0);
      expect(await database.scoreEvents.count()).toBe(0);
      expect(await database.readLanguage()).toBe('en');
    } finally {
      submit.mockRestore();
      await database.delete();
    }
  });
  it('serializes two tabs loading the demo into one set of examples', async () => {
    const database = new LocalDatabase(`demo-parallel-${crypto.randomUUID()}`);
    const other = new LocalDatabase(database.name);
    try {
      const results = await Promise.all([seedDemoData(database), seedDemoData(other)]);
      expect(results.filter((result) => result.created)).toHaveLength(1);
      expect(await database.players.count()).toBe(6);
      expect(await database.teams.count()).toBe(3);
      expect(await database.matches.count()).toBe(demoMatchIds.length);
    } finally {
      other.close();
      await database.delete();
    }
  });
});
