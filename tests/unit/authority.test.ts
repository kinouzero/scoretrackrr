import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { LocalDatabase, MatchJournal, seedJournal, timestamp } from '../fixtures/journal';
import { AuthorityRepository } from '../../src/lib/storage/authority';
import { encodePeerJournal } from '../../src/lib/domain/peer-journal';
import { BackupRepository } from '../../src/lib/storage/backup';

async function fixture() {
  const db = new LocalDatabase(crypto.randomUUID());
  await seedJournal(db);
  await db.readOrCreateDeviceId('source-device');
  const journal = new MatchJournal(db);
  await journal.submit({
    matchId: 'match',
    eventId: 'start',
    commandId: 'start',
    expectedVersion: 0,
    actorPlayerId: 'alice',
    deviceId: 'source-device',
    timestamp,
    action: { type: 'start' },
  });
  await journal.setPeerPermission({
    matchId: 'match',
    organizerPlayerId: 'alice',
    playerId: 'emma',
    sessionId: 'channel-1',
    role: 'manager',
    expectedRevision: 0,
  });
  const repository = new AuthorityRepository(db);
  const prepare = (id = 'handoff-1', expectedVersion = 1) =>
    repository.prepare({
      matchId: 'match',
      playerId: 'alice',
      deviceId: 'source-device',
      targetPlayerId: 'emma',
      targetSessionId: 'channel-1',
      transferId: id,
      expectedVersion,
    });
  const score = (id: string, player = 'alice', device = 'source-device', version = 1) =>
    journal.submit({
      matchId: 'match',
      eventId: id,
      commandId: id,
      expectedVersion: version,
      actorPlayerId: player,
      deviceId: device,
      timestamp,
      action: { type: 'record', ownerId: 'blue', values: { points: 1 } },
    });
  return { db, journal, repository, prepare, score };
}
describe('durable explicit authority handoff', () => {
  it('fences prepared writes, allows cancellation only before release and keeps the original journal intact', async () => {
    const { db, repository, prepare, score } = await fixture();
    try {
      await expect(prepare('stale', 0)).rejects.toThrow('conflict');
      await prepare();
      await expect(score('blocked')).rejects.toThrow('unauthorized');
      await expect(
        repository.commit('match', 'handoff-1', 'source-device', timestamp),
      ).rejects.toThrow('unauthorized');
      await expect(
        repository.ready({
          matchId: 'match',
          transferId: 'handoff-1',
          sessionId: 'other',
          targetDeviceId: 'target-device',
        }),
      ).rejects.toThrow('unauthorized');
      await repository.cancel('match', 'handoff-1', 'source-device');
      await score('allowed');
      expect(await db.scoreEvents.count()).toBe(2);
      expect(await db.matchAuthorities.get('match')).toBeUndefined();
    } finally {
      db.close();
      await db.delete();
    }
  });
  it('stages, releases and activates on one device; old device stays fenced after response loss and reload, and restored backups preserve authority', async () => {
    const { db, journal, repository, prepare, score } = await fixture();
    const target = new LocalDatabase(crypto.randomUUID()),
      restored = new LocalDatabase(crypto.randomUUID());
    try {
      await target.readOrCreateDeviceId('target-device');
      const peer = new AuthorityRepository(target);
      await prepare();
      const initial = await journal.inspect('match');
      await peer.stage(
        'handoff-1',
        encodePeerJournal(
          initial.match,
          initial.journal.audit.map((e) => e.event),
        ),
        'target-device',
        timestamp,
        1,
        'emma',
      );
      await repository.ready({
        matchId: 'match',
        transferId: 'handoff-1',
        sessionId: 'channel-1',
        targetDeviceId: 'target-device',
      });
      await expect(
        journal.submitPeer(
          {
            matchId: 'match',
            eventId: 'premature',
            commandId: 'premature',
            expectedVersion: 1,
            actorPlayerId: 'alice',
            deviceId: 'source-device',
            timestamp,
            action: {
              type: 'authority_transfer',
              playerId: 'emma',
              deviceId: 'target-device',
              transferId: 'handoff-1',
              epoch: 1,
            },
          },
          { playerId: 'emma', sessionId: 'channel-1', permissionRevision: 1 },
        ),
      ).rejects.toThrow('unauthorized');
      await repository.commit('match', 'handoff-1', 'source-device', timestamp);
      await expect(score('old-host', 'alice', 'source-device', 2)).rejects.toThrow('unauthorized');
      await expect(score('spoofed-host', 'emma', 'target-device', 2)).rejects.toThrow(
        'unauthorized',
      );
      await expect(repository.cancel('match', 'handoff-1', 'source-device')).rejects.toThrow(
        'unauthorized',
      );
      const released = await journal.inspect('match');
      expect(released.journal.authority).toMatchObject({
        playerId: 'emma',
        deviceId: 'target-device',
        epoch: 1,
      });
      db.close();
      await db.open();
      await expect(score('after-reload', 'alice', 'source-device', 2)).rejects.toThrow(
        'unauthorized',
      );
      const text = encodePeerJournal(
        released.match,
        released.journal.audit.map((e) => e.event),
      );
      await expect(peer.activate(text, 'other-device')).rejects.toThrow('unauthorized');
      const activeId = await peer.activate(text, 'target-device');
      expect(activeId).toBe('match');
      await peer.activate(text, 'target-device');
      const current = new MatchJournal(target);
      await current.submit({
        matchId: 'match',
        eventId: 'new-score',
        commandId: 'new-score',
        expectedVersion: 2,
        actorPlayerId: 'emma',
        deviceId: 'target-device',
        timestamp,
        action: { type: 'record', ownerId: 'red', values: { points: 2 } },
      });
      await peer.activate(text, 'target-device');
      expect((await current.read('match')).projection.totals.red).toBe(2);
      expect(await target.scoreEvents.count()).toBe(3);
      await restored.readOrCreateDeviceId('third-device');
      await new BackupRepository(restored).restore(
        await new BackupRepository(target).export(timestamp),
      );
      await expect(
        new MatchJournal(restored).submit({
          matchId: 'match',
          eventId: 'third',
          commandId: 'third',
          expectedVersion: 3,
          actorPlayerId: 'emma',
          deviceId: 'third-device',
          timestamp,
          action: { type: 'pause' },
        }),
      ).rejects.toThrow('unauthorized');
      expect((await new MatchJournal(restored).read('match')).projection.totals.red).toBe(2);
      await current.setPeerPermission({
        matchId: 'match',
        organizerPlayerId: 'emma',
        deviceId: 'target-device',
        playerId: 'alice',
        sessionId: 'return-channel',
        role: 'manager',
        expectedRevision: (await target.matchPermissions.get(['match', 'alice']))?.revision ?? 0,
      });
      await peer.prepare({
        matchId: 'match',
        playerId: 'emma',
        deviceId: 'target-device',
        targetPlayerId: 'alice',
        targetSessionId: 'return-channel',
        transferId: 'handoff-back',
        expectedVersion: 3,
      });
      const backBase = await current.inspect('match');
      await repository.stage(
        'handoff-back',
        encodePeerJournal(
          backBase.match,
          backBase.journal.audit.map((e) => e.event),
        ),
        'source-device',
        timestamp,
        3,
        'alice',
      );
      await peer.ready({
        matchId: 'match',
        transferId: 'handoff-back',
        sessionId: 'return-channel',
        targetDeviceId: 'source-device',
      });
      await peer.commit('match', 'handoff-back', 'target-device', timestamp);
      const backFinal = await current.inspect('match');
      await repository.activate(
        encodePeerJournal(
          backFinal.match,
          backFinal.journal.audit.map((e) => e.event),
        ),
        'source-device',
      );
      await score('returned-host', 'alice', 'source-device', 4);
      expect((await journal.read('match')).authority).toMatchObject({
        playerId: 'alice',
        epoch: 2,
      });
      await expect(
        current.submit({
          matchId: 'match',
          eventId: 'old-target',
          commandId: 'old-target',
          expectedVersion: 4,
          actorPlayerId: 'emma',
          deviceId: 'target-device',
          timestamp,
          action: { type: 'pause' },
        }),
      ).rejects.toThrow('unauthorized');
    } finally {
      db.close();
      target.close();
      restored.close();
      await db.delete();
      await target.delete();
      await restored.delete();
    }
  });
  it('refuses rule conflicts during staging before the source releases authority', async () => {
    const { db, journal, repository, prepare } = await fixture();
    const target = new LocalDatabase(crypto.randomUUID());
    try {
      await prepare();
      const base = await journal.inspect('match');
      await target.gameVersions.add({
        ...base.match.rulesSnapshot,
        definition: { ...base.match.rulesSnapshot.definition, initialScore: 1 },
      });
      const text = encodePeerJournal(
        base.match,
        base.journal.audit.map((e) => e.event),
      );
      await expect(
        new AuthorityRepository(target).stage(
          'handoff-1',
          text,
          'target-device',
          timestamp,
          1,
          'emma',
        ),
      ).rejects.toThrow('conflict');
      expect(await target.peerReplicas.count()).toBe(0);
      await target.gameVersions.put(base.match.rulesSnapshot);
      await target.matches.add({
        ...base.match,
        playersSnapshot: base.match.playersSnapshot.map((p) => ({ ...p, color: '#000000' })),
      });
      await target.scoreEvents.bulkAdd(base.journal.audit.map((e) => e.event));
      await expect(
        new AuthorityRepository(target).stage(
          'handoff-1',
          text,
          'target-device',
          timestamp,
          1,
          'emma',
        ),
      ).rejects.toThrow('conflict');
      expect(await target.peerReplicas.count()).toBe(0);

      await repository.cancel('match', 'handoff-1', 'source-device');
      expect((await journal.read('match')).authority.epoch).toBe(0);
    } finally {
      db.close();
      target.close();
      await db.delete();
      await target.delete();
    }
  });
  it('rolls back partial activation after quota errors and accepts older format1 backups without operational stores', async () => {
    const { db, journal, repository, prepare } = await fixture();
    const target = new LocalDatabase(crypto.randomUUID());
    try {
      const legacy = JSON.parse(await new BackupRepository(db).export(timestamp));
      legacy.formatVersion = 1;
      legacy.schemaVersion = 3;
      delete legacy.tables.matchAuthorities;
      delete legacy.tables.peerReplicas;
      await new BackupRepository(target).restore(JSON.stringify(legacy));
      expect(await target.matches.count()).toBe(1);
      await prepare();
      const peer = new AuthorityRepository(target),
        base = await journal.inspect('match');
      await peer.stage(
        'handoff-1',
        encodePeerJournal(
          base.match,
          base.journal.audit.map((e) => e.event),
        ),
        'target-device',
        timestamp,
        1,
        'emma',
      );
      await repository.ready({
        matchId: 'match',
        transferId: 'handoff-1',
        sessionId: 'channel-1',
        targetDeviceId: 'target-device',
      });
      await repository.commit('match', 'handoff-1', 'source-device', timestamp);
      const final = await journal.inspect('match'),
        text = encodePeerJournal(
          final.match,
          final.journal.audit.map((e) => e.event),
        );
      const fail = () => {
        throw new DOMException('full', 'QuotaExceededError');
      };
      target.matchProjections.hook('updating', fail);
      await expect(peer.activate(text, 'target-device')).rejects.toThrow('quota_exceeded');
      expect(await target.scoreEvents.count()).toBe(1);
      expect((await target.matches.get('match'))!.version).toBe(1);
      expect(await target.matchAuthorities.get('match')).toBeUndefined();
      target.matchProjections.hook('updating').unsubscribe(fail);
      await peer.activate(text, 'target-device');
      expect((await new MatchJournal(target).read('match')).authority.epoch).toBe(1);
    } finally {
      db.close();
      target.close();
      await db.delete();
      await target.delete();
    }
  });
});
