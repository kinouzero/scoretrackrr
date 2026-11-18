import 'fake-indexeddb/auto';
import { afterAll, expect, test } from 'vitest';
import { presetRosterFixture } from '../fixtures/preset-rosters';
import { presetParticipants } from '../../src/lib/storage/preset-participants';
const { db, counter, teamIds } = await presetRosterFixture(16);
afterAll(async () => {
  db.close();
  await db.delete();
});
test('sixteen-team preset hydration', async ({ bench }) => {
  const result = await presetParticipants(db, [], teamIds);
  expect(result.rosters).toHaveLength(16);
  console.log(JSON.stringify({ teams: 16, readOperations: counter.reads }));
  await bench('hydrate current rosters', () => presetParticipants(db, [], teamIds)).run({
    time: 200,
    warmupTime: 100,
    iterations: 20,
    warmupIterations: 10,
  });
});
