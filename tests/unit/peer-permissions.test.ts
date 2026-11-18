import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { LocalDatabase, MatchJournal, seedJournal, timestamp } from '../fixtures/journal';
import { replayJournal } from '../../src/lib/domain/journal';
import { BackupRepository } from '../../src/lib/storage/backup';

async function fixture(custom = true) {
  const db = new LocalDatabase(crypto.randomUUID());
  const match = await seedJournal(db);
  if (custom)
    await db.matches.update(match.id, {
      rulesSnapshot: {
        ...match.rulesSnapshot,
        gameId: 'custom-test',
        definition: { ...match.rulesSnapshot.definition, id: 'custom-test' },
      },
    });
  const journal = new MatchJournal(db);
  const input = { matchId: 'match', actorPlayerId: 'alice', deviceId: 'host-device', timestamp };
  await journal.submit({
    ...input,
    eventId: 'start-event',
    commandId: 'start-command',
    expectedVersion: 0,
    action: { type: 'start' },
  });
  const grant = (role: 'viewer' | 'scorer' | 'manager', revision = 0, sessionId = 'channel-1') =>
    journal.setPeerPermission({
      matchId: 'match',
      organizerPlayerId: 'alice',
      playerId: 'emma',
      sessionId,
      role,
      expectedRevision: revision,
    });
  const command = (id: string, ownerId = 'red', version = 1) => ({
    ...input,
    eventId: `event-${id}`,
    commandId: `command-${id}`,
    expectedVersion: version,
    action: { type: 'record', ownerId, values: { points: 2 } },
  });
  return { db, journal, grant, command, input };
}
describe('organizer-bound peer permissions and proposals', () => {
  it('limits self scores, binds identity to the session and revision, deduplicates identical commands and refuses stale or revoked proposals', async () => {
    const { db, journal, grant, command } = await fixture();
    try {
      const binding = { playerId: 'emma', sessionId: 'channel-1', permissionRevision: 1 };
      await expect(journal.submitPeer(command('denied'), binding)).rejects.toThrow('unauthorized');
      await grant('scorer');
      await expect(journal.submitPeer(command('other', 'blue'), binding)).rejects.toThrow(
        'unauthorized',
      );
      await expect(
        journal.submitPeer(command('session'), { ...binding, sessionId: 'other-channel' }),
      ).rejects.toThrow('unauthorized');
      const accepted = await journal.submitPeer(command('once'), binding);
      expect(accepted.projection.totals.red).toBe(2);
      expect(accepted.audit.at(-1)!.event.payload.proposal).toMatchObject({
        ...binding,
        role: 'scorer',
      });
      expect(
        (await journal.submitPeer(command('once'), binding)).projection.lastEventSequence,
      ).toBe(2);
      await expect(
        journal.submitPeer(
          { ...command('once'), action: { type: 'record', ownerId: 'red', values: { points: 3 } } },
          binding,
        ),
      ).rejects.toThrow('conflict');
      await expect(journal.submitPeer(command('stale'), binding)).rejects.toThrow('conflict');
      await expect(grant('manager', 0)).rejects.toThrow('conflict');
      await grant('viewer', 1);
      await expect(journal.submitPeer(command('revoked', 'red', 2), binding)).rejects.toThrow(
        'unauthorized',
      );
      expect(await db.scoreEvents.count()).toBe(2);
      const inspected = await journal.inspect('match');
      const events = inspected.journal.audit.map((entry) => entry.event);
      const tampered = events.map((event, index) =>
        index === 1
          ? {
              ...event,
              payload: {
                ...event.payload,
                action: { type: 'record', ownerId: 'blue', values: { points: 2 } },
              },
            }
          : event,
      );
      expect(() => replayJournal(inspected.match, tampered)).toThrow();
      await expect(
        journal.setPeerPermission({
          matchId: 'match',
          organizerPlayerId: 'emma',
          playerId: 'hugo',
          sessionId: 'x',
          role: 'manager',
          expectedRevision: 0,
        }),
      ).rejects.toThrow('unauthorized');
    } finally {
      db.close();
      await db.delete();
    }
  });
  it('delegates management with organizer-approved attribution and preserves it in full backup/restore', async () => {
    const { db, journal, grant, command, input } = await fixture(false);
    const target = new LocalDatabase(crypto.randomUUID());
    try {
      await grant('manager');
      const binding = { playerId: 'emma', sessionId: 'channel-1', permissionRevision: 1 };
      await journal.submitPeer(command('manager', 'blue'), binding);
      await journal.submitPeer(
        {
          ...input,
          eventId: 'pause-event',
          commandId: 'pause-command',
          expectedVersion: 2,
          action: { type: 'pause' },
        },
        binding,
      );
      expect((await journal.read('match')).projection.status).toBe('paused');
      await new BackupRepository(target).restore(await new BackupRepository(db).export(timestamp));
      expect((await target.matchPermissions.get(['match', 'emma']))!.sessionId).toBe('channel-1');
      expect(
        (await new MatchJournal(target).read('match')).audit.at(-1)!.event.payload.proposal,
      ).toMatchObject({ playerId: 'emma', role: 'manager' });
      await grant('manager', 1, 'new-channel');
      await expect(
        journal.submitPeer(
          {
            ...input,
            eventId: 'resume-event',
            commandId: 'resume-command',
            expectedVersion: 3,
            action: { type: 'resume' },
          },
          binding,
        ),
      ).rejects.toThrow('unauthorized');
    } finally {
      db.close();
      target.close();
      await db.delete();
      await target.delete();
    }
  });
});

describe('built-in personal score boundaries', () => {
  it('allows personal records across built-ins but reserves shared adjudication, transitions and corrections for managers', async () => {
    const { db, journal, grant, command } = await fixture();
    try {
      const { match } = await journal.inspect('match');
      const { validatePeerAttribution } = await import('../../src/lib/domain/journal');
      const attribution = {
        playerId: 'emma',
        sessionId: 'channel-1',
        permissionRevision: 1,
        role: 'scorer',
      };
      const examples = [
        ['petanque', { kind: 0, points: 1, remainingFirst: 0, remainingSecond: 0 }],
        ['darts', { sector: 20, multiplier: 3 }],
        ['yams', { category: 0, points: 3 }],
        ['421', { d1: 4, d2: 2, d3: 1, throws: 1 }],
        ['5000-10000', { kind: 1 }],
        ['skull-king', { round: 1, kind: 0, bid: 0 }],
        ['flip-7', { round: 1, cards: 1, modifiers: 0, double: 0, bust: 0 }],
      ] as const;
      for (const [gameId, values] of examples) {
        const snapshot = { ...match, rulesSnapshot: { ...match.rulesSnapshot, gameId } };
        expect(
          validatePeerAttribution(
            snapshot,
            { type: 'record', ownerId: 'red', values },
            attribution,
          ),
        ).toMatchObject({ role: 'scorer' });
        expect(() =>
          validatePeerAttribution(
            snapshot,
            { type: 'record', ownerId: 'blue', values },
            attribution,
          ),
        ).toThrow();
        for (const values of [{ nextRound: 1 }, { nextLeg: 1 }, { best: 0, worst: 1 }])
          expect(() =>
            validatePeerAttribution(
              snapshot,
              { type: 'record', ownerId: 'red', values },
              attribution,
            ),
          ).toThrow();
        expect(() => validatePeerAttribution(snapshot, { type: 'pause' }, attribution)).toThrow();
      }
      for (const kind of [1, 2])
        expect(() =>
          validatePeerAttribution(
            { ...match, rulesSnapshot: { ...match.rulesSnapshot, gameId: 'petanque' } },
            {
              type: 'record',
              ownerId: 'red',
              values: { kind, points: 0, remainingFirst: 0, remainingSecond: 0 },
            },
            attribution,
          ),
        ).toThrow();
      await grant('scorer');
      await expect(
        journal.submitPeer(
          { ...command('bad-control'), action: { type: 'undo', targetEventId: 'start-event' } },
          { playerId: 'emma', sessionId: 'channel-1', permissionRevision: 1 },
        ),
      ).rejects.toThrow('unauthorized');
    } finally {
      db.close();
      await db.delete();
    }
  });
});
