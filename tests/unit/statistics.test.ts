import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { LocalStatistics } from '../../src/lib/domain/statistics';
import { calculateStatistics } from '../../src/lib/storage/statistics';
import { LocalDatabase } from '../../src/lib/storage/database';
import { MatchJournal } from '../../src/lib/storage/journal';
import { seedJournal, timestamp } from '../fixtures/journal';
describe('local historical statistics', () => {
  it('keeps team/individual and version aggregates separate with ties and duel results', async () => {
    const db = new LocalDatabase(crypto.randomUUID());
    try {
      const match = await seedJournal(db);
      const stats = new LocalStatistics();
      stats.add(match, { blue: 13, red: 7 }, ['blue']);
      stats.add(match, { blue: 11, red: 11 }, ['blue', 'red']);
      const individual = { ...match, teamsSnapshot: [], mode: 'individual' as const };
      stats.add(individual, { alice: 3, lucas: 5 }, ['lucas']);
      stats.add({ ...individual, gameVersionId: 'different-version' }, { alice: 7, lucas: 8 }, [
        'lucas',
      ]);
      const result = stats.result();
      const blue = result.rows.find((row) => row.ownerId === 'blue')!;
      expect(blue).toMatchObject({
        kind: 'team',
        played: 2,
        wins: 2,
        average: 12,
        rate: 1,
        best: 13,
      });
      expect(result.rows.filter((row) => row.ownerId === 'alice')).toHaveLength(2);
      expect(result.confrontations.find((row) => row.kind === 'team')).toMatchObject({
        played: 2,
        firstWins: 2,
        secondWins: 1,
      });
      expect(match.teamsSnapshot).toHaveLength(2);
    } finally {
      db.close();
      await db.delete();
    }
  });
  it('replays finished games rather than trusting a stale cached projection and honors version filters', async () => {
    const db = new LocalDatabase(crypto.randomUUID());
    try {
      await seedJournal(db);
      const journal = new MatchJournal(db);
      let sequence = 0;
      for (const action of [
        { type: 'start' },
        { type: 'record', ownerId: 'blue', values: { points: 6 } },
        { type: 'record', ownerId: 'blue', values: { points: 6 } },
        { type: 'record', ownerId: 'blue', values: { points: 1 } },
      ])
        await journal.submit({
          matchId: 'match',
          eventId: `stats-event-${++sequence}`,
          commandId: `stats-command-${sequence}`,
          expectedVersion: sequence - 1,
          actorPlayerId: 'alice',
          deviceId: 'stats-device',
          timestamp,
          action: action as never,
        });
      await db.matchProjections.update('match', { totals: { blue: 999, red: 999 } });
      const result = await calculateStatistics(journal, {});
      expect(result.rows.find((row) => row.ownerId === 'blue')).toMatchObject({
        wins: 1,
        average: 13,
      });
      expect((await calculateStatistics(journal, { variant: 'unknown' })).rows).toHaveLength(0);
      const controller = new AbortController();
      controller.abort();
      await expect(calculateStatistics(journal, {}, { signal: controller.signal })).rejects.toThrow(
        'STATS_CANCELLED',
      );
    } finally {
      db.close();
      await db.delete();
    }
  });
});
