import 'fake-indexeddb/auto';
import { afterEach, expect, it } from 'vitest';
import { resumePausedMatch } from '../../src/lib/application/resume-match';
import { LocalDatabase, MatchJournal, seedJournal, timestamp } from '../fixtures/journal';
const databases: LocalDatabase[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) {
    db.close();
    await db.delete();
  }
});
async function setup() {
  const db = new LocalDatabase(`resume-${crypto.randomUUID()}`);
  databases.push(db);
  await seedJournal(db);
  const journal = new MatchJournal(db);
  let index = 0;
  const send = async (type: 'start' | 'pause' | 'resume' | 'cancel') =>
    journal.submit({
      matchId: 'match',
      expectedVersion: (await db.matches.get('match'))!.version,
      actorPlayerId: 'alice',
      deviceId: 'phone-a',
      eventId: `event-${++index}`,
      commandId: `command-${index}`,
      timestamp,
      action: { type },
    });
  await send('start');
  await send('pause');
  return { db, journal, send, paused: (await db.matches.get('match'))! };
}
it('resumes immediately using the saved authority and preserves existing scores', async () => {
  const { db, journal, paused } = await setup();
  const before = await journal.read('match');
  const result = await resumePausedMatch(journal, paused, 'phone-a');
  expect(result.projection.status).toBe('in_progress');
  expect(result.projection.totals).toEqual(before.projection.totals);
  const last = (await db.scoreEvents.toArray()).sort((a, b) => a.sequence - b.sequence).at(-1);
  expect(last?.actorPlayerId).toBe('alice');
  expect((await db.matches.get('match'))?.version).toBe(paused.version + 1);
});
it('rejects a stale list entry after another window resumes without appending history', async () => {
  const { db, journal, paused, send } = await setup();
  await send('resume');
  const count = await db.scoreEvents.count();
  await expect(resumePausedMatch(journal, paused, 'phone-a')).rejects.toMatchObject({
    code: 'conflict',
  });
  expect(await db.scoreEvents.count()).toBe(count);
  expect((await db.matches.get('match'))?.status).toBe('in_progress');
});
it('never resumes a cancelled match or changes its history', async () => {
  const { db, journal, send } = await setup();
  await send('cancel');
  const cancelled = (await db.matches.get('match'))!;
  const count = await db.scoreEvents.count();
  await expect(resumePausedMatch(journal, cancelled, 'phone-a')).rejects.toMatchObject({
    code: 'invalid_transition',
  });
  expect(await db.scoreEvents.count()).toBe(count);
  expect((await db.matches.get('match'))?.status).toBe('cancelled');
});
it('reports a deleted match instead of creating a replacement', async () => {
  const { db, journal, paused } = await setup();
  await db.matches.delete('match');
  const count = await db.scoreEvents.count();
  await expect(resumePausedMatch(journal, paused, 'phone-a')).rejects.toMatchObject({
    code: 'missing_reference',
  });
  expect(await db.matches.count()).toBe(0);
  expect(await db.scoreEvents.count()).toBe(count);
});
