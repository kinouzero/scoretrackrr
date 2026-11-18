import { LocalDatabase, seedJournal } from './journal';
export { LocalDatabase };

// Frozen history metadata is intentionally independent of current profile names.
export async function seedHistorySearch(database: LocalDatabase) {
  const base = await seedJournal(database);
  const row = (
    id: string,
    gameId: string,
    name: string,
    player: string,
    team: string,
    status: 'draft' | 'paused' = 'draft',
  ) => ({
    ...base,
    id,
    status,
    rulesSnapshot: { ...base.rulesSnapshot, gameId, name },
    playersSnapshot: base.playersSnapshot.map((profile, index) => ({
      ...profile,
      displayName: index === 0 ? player : `Guest ${index}`,
    })),
    teamsSnapshot: base.teamsSnapshot.map((profile, index) => ({
      ...profile,
      name: index === 0 ? team : 'Other team',
    })),
  });
  await database.matches.bulkAdd([
    row('search-a', 'petanque', 'Pétanque', 'Élodie Martin', 'Les Éléphants'),
    row('search-b', 'darts', 'Darts', 'Marc', 'Les Comètes', 'paused'),
    row('search-c', '6-qui-prend', '6 qui prend !', 'Inès', 'Les Étoiles'),
    ...Array.from({ length: 25 }, (_, index) =>
      row(
        `filler-${String(index).padStart(2, '0')}`,
        'journal-fixture',
        'Old game',
        'Filler',
        'Old team',
      ),
    ),
  ]);
  await database.players.update('alice', { displayName: 'New nickname' });
  await database.teams.update('blue', { name: 'New roster name' });
}
