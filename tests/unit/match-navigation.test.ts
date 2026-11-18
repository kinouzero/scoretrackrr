import 'fake-indexeddb/auto';
import { afterEach, expect, it } from 'vitest';
import { LocalDatabase, seedJournal } from '../fixtures/journal';
import { findActiveMatch } from '../../src/lib/storage/match-navigation';

const databases: LocalDatabase[] = [];
afterEach(async () => {
  for (const database of databases) {
    database.close();
    await database.delete();
  }
  databases.length = 0;
});
async function setup() {
  const database = new LocalDatabase(crypto.randomUUID());
  databases.push(database);
  const match = await seedJournal(database);
  return { database, match };
}
it('finds persisted running play without a session preference', async () => {
  const { database, match } = await setup();
  await database.matches.put({ ...match, status: 'in_progress' });
  expect((await findActiveMatch(database))?.id).toBe(match.id);
});
it('prioritizes the explicitly open running game over older concurrent games', async () => {
  const { database, match } = await setup();
  await database.matches.put({ ...match, status: 'in_progress' });
  await database.matches.add({ ...match, id: 'selected', status: 'in_progress' });
  expect((await findActiveMatch(database, 'selected', match.id))?.id).toBe('selected');
});
it.each(['draft', 'paused', 'cancelled', 'finished'] as const)(
  'releases navigation for a %s foreground game without silently selecting another',
  async (status) => {
    const { database, match } = await setup();
    await database.matches.put({ ...match, status });
    await database.matches.add({ ...match, id: 'other', status: 'in_progress' });
    expect(await findActiveMatch(database, match.id, match.id)).toBeUndefined();
    expect((await database.matches.get('other'))?.status).toBe('in_progress');
  },
);
it('releases a deleted preferred game and never treats a paused game as running', async () => {
  const { database, match } = await setup();
  await database.matches.put({ ...match, status: 'paused' });
  expect(await findActiveMatch(database)).toBeUndefined();
  expect(await findActiveMatch(database, undefined, 'missing')).toBeUndefined();
});
