import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { seedJournal, timestamp } from '../fixtures/journal';
import { LocalDatabase } from '../../src/lib/storage/database';
import { CatalogRepository } from '../../src/lib/storage/catalog';
import { DeclarativeRepository } from '../../src/lib/storage/declarative';
import { MatchJournal, type JournalSubmission } from '../../src/lib/storage/journal';
import { submitSixNimmtRound, type SixNimmtRoundSubmission } from '../../src/lib/storage/six-nimmt';
import { sixNimmtVersion } from '../../src/lib/domain/games/six-nimmt';

const databases: LocalDatabase[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) await db.delete();
});
async function setup() {
  const db = new LocalDatabase(`six-round-${crypto.randomUUID()}`);
  databases.push(db);
  await seedJournal(db);
  await new CatalogRepository(db).initialize(timestamp);
  const match = await new DeclarativeRepository(db).create({
    id: 'six-round',
    versionId: sixNimmtVersion('').id,
    mode: 'individual',
    playerIds: ['alice', 'lucas', 'emma'],
    teams: [],
    organizerPlayerId: 'alice',
    cooperativeName: '',
    createdAt: timestamp,
  });
  const journal = new MatchJournal(db);
  await db.readOrCreateDeviceId('test-device');
  await journal.submit({
    matchId: match.id,
    eventId: 'start',
    commandId: 'start',
    actorPlayerId: 'alice',
    deviceId: 'test-device',
    timestamp,
    expectedVersion: 0,
    action: { type: 'start' },
  });
  const input = (
    scores: SixNimmtRoundSubmission['scores'],
    expectedVersion = 1,
  ): SixNimmtRoundSubmission => ({
    matchId: match.id,
    round: 1,
    expectedVersion,
    actorPlayerId: 'alice',
    deviceId: 'test-device',
    timestamp,
    scores,
  });
  return { db, journal, match, input };
}
describe('atomic 6 nimmt! round forms', () => {
  it('stores one replayable event per player, including explicit zeroes, and shares lowest-score victory', async () => {
    const { db, journal, match, input } = await setup();
    await submitSixNimmtRound(
      db,
      journal,
      input([
        { ownerId: 'alice', points: 66 },
        { ownerId: 'lucas', points: 0 },
        { ownerId: 'emma', points: 0 },
      ]),
    );
    const view = await journal.read(match.id);
    expect(view.projection).toMatchObject({
      status: 'finished',
      totals: { alice: 66, lucas: 0, emma: 0 },
      winnerIds: ['lucas', 'emma'],
      lastEventSequence: 4,
    });
    expect(view.audit).toHaveLength(4);
  });
  it('rolls back every new entry when an existing partial round would exceed171', async () => {
    const { db, journal, match, input } = await setup();
    await submitSixNimmtRound(db, journal, input([{ ownerId: 'alice', points: 100 }]));
    const before = await journal.read(match.id);
    await expect(
      submitSixNimmtRound(
        db,
        journal,
        input(
          [
            { ownerId: 'lucas', points: 60 },
            { ownerId: 'emma', points: 20 },
          ],
          2,
        ),
      ),
    ).rejects.toMatchObject({ code: 'invalid_command' });
    expect(await journal.read(match.id)).toEqual(before);
    await submitSixNimmtRound(
      db,
      journal,
      input(
        [
          { ownerId: 'lucas', points: 60 },
          { ownerId: 'emma', points: 11 },
        ],
        2,
      ),
    );
    expect((await journal.read(match.id)).projection.totals).toEqual({
      alice: 100,
      lucas: 60,
      emma: 11,
    });
  });
  it('rolls back earlier writes on a later quota failure', async () => {
    const { db, journal, match, input } = await setup();
    const before = await journal.read(match.id);
    let calls = 0;
    const failing = {
      submit(submission: JournalSubmission) {
        if (++calls === 2) throw new DOMException('Injected failure', 'QuotaExceededError');
        return journal.submit(submission);
      },
    };
    await expect(
      submitSixNimmtRound(
        db,
        failing,
        input([
          { ownerId: 'alice', points: 1 },
          { ownerId: 'lucas', points: 2 },
          { ownerId: 'emma', points: 3 },
        ]),
      ),
    ).rejects.toMatchObject({ code: 'quota_exceeded' });
    expect(await journal.read(match.id)).toEqual(before);
  });
  it('rejects a stale submission after another tab changes the match', async () => {
    const { db, journal, match, input } = await setup();
    await journal.submit({
      matchId: match.id,
      eventId: 'pause',
      commandId: 'pause',
      actorPlayerId: 'alice',
      deviceId: 'test-device',
      timestamp,
      expectedVersion: 1,
      action: { type: 'pause' },
    });
    const before = await journal.read(match.id);
    await expect(
      submitSixNimmtRound(db, journal, input([{ ownerId: 'alice', points: 1 }])),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(await journal.read(match.id)).toEqual(before);
  });
  it('retains organizer authorization for every row', async () => {
    const { db, journal, match, input } = await setup();
    const before = await journal.read(match.id);
    await expect(
      submitSixNimmtRound(db, journal, {
        ...input([{ ownerId: 'alice', points: 1 }]),
        actorPlayerId: 'lucas',
      }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
    expect(await journal.read(match.id)).toEqual(before);
  });
  it.each<{ scores: SixNimmtRoundSubmission['scores'] }>([
    { scores: [] },
    { scores: [{ ownerId: 'alice', points: -1 }] },
    { scores: [{ ownerId: 'alice', points: 172 }] },
    { scores: [{ ownerId: 'alice', points: 1.5 }] },
    {
      scores: [
        { ownerId: 'alice', points: 1 },
        { ownerId: 'alice', points: 2 },
      ],
    },
  ])('rejects invalid or duplicate row values %#', async ({ scores }) => {
    const { db, journal, match, input } = await setup();
    await expect(submitSixNimmtRound(db, journal, input(scores))).rejects.toMatchObject({
      code: 'invalid_command',
    });
    expect((await journal.read(match.id)).audit).toHaveLength(1);
  });
  it('allows only one of two concurrent round forms to commit', async () => {
    const { db, journal, match, input } = await setup();
    const other = new LocalDatabase(db.name);
    try {
      const submission = input([
        { ownerId: 'alice', points: 1 },
        { ownerId: 'lucas', points: 2 },
        { ownerId: 'emma', points: 3 },
      ]);
      const results = await Promise.allSettled([
        submitSixNimmtRound(db, journal, submission),
        submitSixNimmtRound(other, new MatchJournal(other), submission),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect((await journal.read(match.id)).audit).toHaveLength(4);
    } finally {
      other.close();
    }
  });
});
