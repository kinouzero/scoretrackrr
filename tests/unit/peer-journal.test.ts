import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  encodePeerJournal,
  decodePeerJournal,
  verifyPeerJournal,
  journalParts,
  JournalAssembly,
  MAX_PEER_JOURNAL,
} from '../../src/lib/domain/peer-journal';
import { decodePeerView, encodePeerView } from '../../src/lib/domain/peer-view';
import { seedJournal, timestamp, LocalDatabase, MatchJournal } from '../fixtures/journal';

describe('bounded replayed peer journals', () => {
  it('replays authoritative corrections and winning undo, excluding profile photos/emails and unrelated settings', async () => {
    const db = new LocalDatabase(crypto.randomUUID());
    try {
      await seedJournal(db);
      const journal = new MatchJournal(db);
      let n = 0;
      for (const action of [
        { type: 'start' },
        { type: 'record', ownerId: 'blue', values: { points: 6 } },
        { type: 'record', ownerId: 'blue', values: { points: 6 } },
        { type: 'record', ownerId: 'blue', values: { points: 1 } },
        { type: 'undo', targetEventId: 'peer-e4' },
      ])
        await journal.submit({
          matchId: 'match',
          eventId: `peer-e${++n}`,
          commandId: `peer-c${n}`,
          expectedVersion: n - 1,
          actorPlayerId: 'alice',
          deviceId: 'host',
          timestamp,
          action,
        });
      const { match, journal: view } = await journal.inspect('match');
      const text = encodePeerJournal(
        {
          ...match,
          settingsSnapshot: { ...match.settingsSnapshot, email: 'excluded@example.test' },
          playersSnapshot: match.playersSnapshot.map((p) => ({
            ...p,
            email: 'excluded@example.test',
            avatarImage: 'data:image/png;base64,excluded',
          })),
        },
        view.audit.map((entry) => entry.event),
      );
      expect(text).not.toContain('excluded');
      const expected = decodePeerView(encodePeerView(match, view.projection));
      const recovered = verifyPeerJournal(text, expected);
      expect(recovered.journal).toEqual(view);
      expect(Object.isFrozen(recovered.match)).toBe(true);
      for (const alter of [
        (p: ReturnType<typeof JSON.parse>) => {
          p.protocol = 2;
        },
        (p: ReturnType<typeof JSON.parse>) => {
          p.events[1].payload.action.values.points = 100;
        },
        (p: ReturnType<typeof JSON.parse>) => {
          p.events[1].actorPlayerId = 'emma';
        },
        (p: ReturnType<typeof JSON.parse>) => {
          p.events.pop();
        },
        (p: ReturnType<typeof JSON.parse>) => {
          p.match.playersSnapshot[0].email = 'rejected@example.test';
        },
        (p: ReturnType<typeof JSON.parse>) => {
          p.match.rulesSnapshot.email = 'rejected@example.test';
        },
        (p: ReturnType<typeof JSON.parse>) => {
          p.match.status = 'finished';
        },
      ]) {
        const packet = JSON.parse(text);
        alter(packet);
        expect(() => verifyPeerJournal(JSON.stringify(packet), expected)).toThrow();
      }
      expect(() =>
        verifyPeerJournal(text, { ...expected, version: expected.version + 1 }),
      ).toThrow();
      expect(() => decodePeerJournal('x'.repeat(MAX_PEER_JOURNAL + 1))).toThrow();
    } finally {
      db.close();
      await db.delete();
    }
  });
  it('assembles large Unicode journals in order, with bounded packets and explicit request identity/deadline', () => {
    const text = '🙂\n"é'.repeat(20000);
    const parts = journalParts(text, 'request-1');
    expect(parts.length).toBeGreaterThan(8);
    expect(parts.every((part) => part.length <= 65536)).toBe(true);
    const assembly = new JournalAssembly('request-1', 0);
    let result;
    for (const part of parts) result = assembly.accept(part, 100);
    expect(result).toBe(text);
    expect(() => assembly.accept(parts.at(-1)!, 100)).toThrow();
    expect(() => new JournalAssembly('other', 0).accept(parts[0]!, 100)).toThrow();
    expect(() => new JournalAssembly('request-1', 0).accept(parts[1]!, 100)).toThrow();
    expect(() => new JournalAssembly('request-1', 0).accept(parts[0]!, 15001)).toThrow();
    const first = JSON.parse(parts[0]!);
    for (const changes of [
      { count: 97 },
      { count: 0 },
      { index: -1 },
      { text: 'short' },
      { count: 1, index: 1 },
    ])
      expect(() =>
        new JournalAssembly('request-1', 0).accept(JSON.stringify({ ...first, ...changes }), 100),
      ).toThrow();
    expect(() => journalParts('x'.repeat(MAX_PEER_JOURNAL + 1), 'request-1')).toThrow();
  });
});
