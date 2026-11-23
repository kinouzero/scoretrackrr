import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { LocalDatabase } from '../../src/lib/storage/database';
import { MatchJournal } from '../../src/lib/storage/journal';
import { matchesHistory, historyGameName, type HistoryCursor } from '../../src/lib/domain/history';
import { seedJournal, timestamp } from '../fixtures/journal';
describe('bounded snapshot-based match history', () => {
  it('searches frozen game, player and team names together regardless of case, accents or punctuation', async () => {
    const db = new LocalDatabase(crypto.randomUUID());
    try {
      const original = await seedJournal(db);
      const match = {
        ...original,
        rulesSnapshot: { ...original.rulesSnapshot, gameId: 'petanque' },
        playersSnapshot: original.playersSnapshot.map((player, index) => ({
          ...player,
          displayName: index === 0 ? 'Élodie Martin' : player.displayName,
        })),
        teamsSnapshot: original.teamsSnapshot.map((team, index) => ({
          ...team,
          name: index === 0 ? 'Les Éléphants' : team.name,
        })),
      };
      for (const search of [
        'PETANQUE',
        'elodie',
        'elephants',
        'martin PETANQUE eleph',
        '  ÉLODIE — éléphants  ',
        '   ',
        '…',
      ])
        expect(matchesHistory(match, { search }), search).toBe(true);
      for (const search of ['inconnu', 'petanque inconnu', 'elodie cricket'])
        expect(matchesHistory(match, { search }), search).toBe(false);
      expect(matchesHistory(match, { search: 'elodie', status: 'paused' })).toBe(false);
      expect(matchesHistory(match, { search: 'elodie', team: 'red', from: timestamp })).toBe(true);
      expect(matchesHistory(match, { search: 'elodie', until: timestamp })).toBe(false);
    } finally {
      db.close();
      await db.delete();
    }
  });
  it('supports localized game aliases and stored custom game names', async () => {
    const db = new LocalDatabase(crypto.randomUUID());
    try {
      const match = await seedJournal(db);
      expect(
        matchesHistory(
          { ...match, rulesSnapshot: { ...match.rulesSnapshot, gameId: '6-qui-prend' } },
          { search: '6 NIMMT alice' },
        ),
      ).toBe(true);
      expect(
        matchesHistory(
          { ...match, rulesSnapshot: { ...match.rulesSnapshot, gameId: 'darts' } },
          { search: 'FLECHETTES blue' },
        ),
      ).toBe(true);
      expect(
        matchesHistory(
          { ...match, rulesSnapshot: { ...match.rulesSnapshot, name: 'Course Étoilée' } },
          { search: 'etoilee lucas' },
        ),
      ).toBe(true);
      expect(
        matchesHistory(
          {
            ...match,
            rulesSnapshot: { ...match.rulesSnapshot, gameId: 'constructor', name: 'Custom' },
          },
          { search: 'function' },
        ),
      ).toBe(false);
    } finally {
      db.close();
      await db.delete();
    }
  });
  it('searches historical snapshots after current profiles and teams are renamed', async () => {
    const db = new LocalDatabase(crypto.randomUUID());
    try {
      await seedJournal(db);
      await db.players.update('alice', { displayName: 'New nickname' });
      await db.teams.update('blue', { name: 'New team name' });
      const journal = new MatchJournal(db);
      expect((await journal.history({ search: 'alice blue' })).items).toHaveLength(1);
      expect((await journal.history({ search: 'New nickname' })).items).toHaveLength(0);
      for (const search of ['x'.repeat(121), 42, null, ['alice']])
        await expect(journal.history({ search: search as string })).rejects.toMatchObject({
          code: 'invalid_record',
        });
      expect((await journal.history({ search: ' '.repeat(120) })).items).toHaveLength(1);
    } finally {
      db.close();
      await db.delete();
    }
  });
  it('filters immutable names, states and exclusive date bounds', async () => {
    const db = new LocalDatabase(crypto.randomUUID());
    try {
      const match = await seedJournal(db);
      expect(matchesHistory(match, { player: 'ALICE', team: 'bleu' })).toBe(false);
      expect(
        matchesHistory(match, {
          player: match.playersSnapshot[0]!.displayName.toUpperCase(),
          team: match.teamsSnapshot[0]!.name,
          status: 'draft',
          from: timestamp,
        }),
      ).toBe(true);
      expect(matchesHistory(match, { until: timestamp })).toBe(false);
      expect(
        historyGameName({
          ...match,
          rulesSnapshot: { ...match.rulesSnapshot, gameId: 'darts', name: '501 · sortie double' },
        }),
      ).toBe('X01');
      expect(
        historyGameName({
          ...match,
          rulesSnapshot: {
            ...match.rulesSnapshot,
            gameId: 'darts',
            definition: { ...match.rulesSnapshot.definition, engine: 'cricket' },
          },
        }),
      ).toBe('Cricket');
    } finally {
      db.close();
      await db.delete();
    }
  });
  it('scans at most120 candidates, preserves tied-timestamp cursors and does not lose sparse results', async () => {
    const db = new LocalDatabase(crypto.randomUUID());
    try {
      const match = await seedJournal(db);
      await db.matches.clear();
      for (let i = 0; i < 145; i++)
        await db.matches.add({
          ...match,
          id: `history-${String(i).padStart(3, '0')}`,
          status: i < 5 ? 'paused' : 'draft',
        });
      const journal = new MatchJournal(db);
      const seen: string[] = [];
      let cursor: HistoryCursor | undefined;
      let pages = 0;
      let more = true;
      while (more) {
        const page = await journal.history(
          { search: 'journal alice blue', status: 'paused' },
          cursor,
        );
        seen.push(...page.items.map((match) => match.id));
        cursor = page.nextCursor;
        more = page.hasMore;
        pages++;
        expect(pages).toBeLessThan(5);
      }
      expect(pages).toBe(2);
      expect(seen).toEqual([
        'history-004',
        'history-003',
        'history-002',
        'history-001',
        'history-000',
      ]);
      const page = await journal.history();
      expect(page.items).toHaveLength(24);
      expect(
        new Set(
          [...page.items, ...(await journal.history({}, page.nextCursor)).items].map(
            (row) => row.id,
          ),
        ).size,
      ).toBe(48);
    } finally {
      db.close();
      await db.delete();
    }
  });
  it('exports the authoritative replay/audit and snapshot without requiring any connected player', async () => {
    const db = new LocalDatabase(crypto.randomUUID());
    try {
      const match = await seedJournal(db);
      const journal = new MatchJournal(db);
      const data = JSON.parse(await journal.exportMatch(match.id));
      expect(data).toMatchObject({
        format: 'scoretrackrr-match',
        formatVersion: 1,
        match: { id: match.id },
        events: [],
      });
      expect(data.match.rulesSnapshot).toEqual(match.rulesSnapshot);
      await expect(journal.history({ from: 'invalid' })).rejects.toThrow('invalid_record');
    } finally {
      db.close();
      await db.delete();
    }
  });
});
