import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { seedJournal, timestamp } from '../fixtures/journal';
import { LocalDatabase } from '../../src/lib/storage/database';
import { CatalogRepository } from '../../src/lib/storage/catalog';
import { DeclarativeRepository } from '../../src/lib/storage/declarative';
import { MatchJournal, type JournalSubmission } from '../../src/lib/storage/journal';
import { submitSkullBids, type SkullBidsSubmission } from '../../src/lib/storage/skull-bids';
import { createSkullKingGame, skullKingVersion } from '../../src/lib/domain/games/skull-king';
const databases: LocalDatabase[] = [];
afterEach(async () => {
  for (const database of databases.splice(0)) await database.delete();
});
async function setup() {
  const db = new LocalDatabase(`skull-bids-${crypto.randomUUID()}`);
  databases.push(db);
  await seedJournal(db);
  await new CatalogRepository(db).initialize(timestamp);
  const match = await new DeclarativeRepository(db).create({
    id: 'skull-bids',
    versionId: skullKingVersion('').id,
    mode: 'individual',
    playerIds: ['alice', 'lucas', 'emma'],
    teams: [],
    organizerPlayerId: 'alice',
    cooperativeName: '',
    createdAt: timestamp,
  });
  await db.readOrCreateDeviceId('test-device');
  const journal = new MatchJournal(db);
  await journal.submit({
    matchId: match.id,
    eventId: 'start',
    commandId: 'start',
    expectedVersion: 0,
    actorPlayerId: 'alice',
    deviceId: 'test-device',
    timestamp,
    action: { type: 'start' },
  });
  const input = (bids: SkullBidsSubmission['bids'], expectedVersion = 1): SkullBidsSubmission => ({
    matchId: match.id,
    round: 1,
    expectedVersion,
    actorPlayerId: 'alice',
    deviceId: 'test-device',
    timestamp,
    bids,
  });
  const inspect = async () => {
    const view = await journal.read(match.id);
    const game = createSkullKingGame(match.rulesSnapshot.definition);
    return game.inspect(view.state, game.validateConfig(match.settingsSnapshot.engineConfig));
  };
  return { db, journal, match, input, inspect };
}
describe('atomic Skull King bidding', () => {
  it('saves all bids without constraining their sum or changing scores', async () => {
    const { db, journal, match, input, inspect } = await setup();
    await submitSkullBids(
      db,
      journal,
      input(['alice', 'lucas', 'emma'].map((ownerId) => ({ ownerId, bid: 1 }))),
    );
    const state = await inspect();
    for (const row of Object.values(state.entries))
      expect(row).toMatchObject({ bid: 1, won: null });
    const view = await journal.read(match.id);
    expect(view.audit).toHaveLength(4);
    expect(view.projection).toMatchObject({
      status: 'in_progress',
      totals: { alice: 0, lucas: 0, emma: 0 },
      lastEventSequence: 4,
    });
  });
  it('completes old partial bids and supports undoing and resubmitting one bid', async () => {
    const { db, journal, match, input, inspect } = await setup();
    await submitSkullBids(db, journal, input([{ ownerId: 'alice', bid: 0 }]));
    await submitSkullBids(
      db,
      journal,
      input(
        [
          { ownerId: 'lucas', bid: 1 },
          { ownerId: 'emma', bid: 0 },
        ],
        2,
      ),
    );
    const saved = await journal.read(match.id);
    await journal.submit({
      matchId: match.id,
      eventId: 'undo',
      commandId: 'undo',
      expectedVersion: 4,
      actorPlayerId: 'alice',
      deviceId: 'test-device',
      timestamp,
      action: { type: 'undo', targetEventId: saved.audit.at(-1)!.event.id },
    });
    expect((await inspect()).entries.emma?.bid).toBeNull();
    await submitSkullBids(db, journal, input([{ ownerId: 'emma', bid: 1 }], 5));
    const rows = (await inspect()).entries;
    expect(rows.alice?.bid).toBe(0);
    expect(rows.lucas?.bid).toBe(1);
    expect(rows.emma?.bid).toBe(1);
  });
  it('rolls back preceding bids when a later bid exceeds the current hand size', async () => {
    const { db, journal, match, input } = await setup();
    const before = await journal.read(match.id);
    await expect(
      submitSkullBids(
        db,
        journal,
        input([
          { ownerId: 'alice', bid: 1 },
          { ownerId: 'lucas', bid: 2 },
        ]),
      ),
    ).rejects.toMatchObject({ code: 'invalid_command' });
    expect(await journal.read(match.id)).toEqual(before);
  });
  it('rolls back all bids after a later quota failure', async () => {
    const { db, journal, match, input } = await setup();
    const before = await journal.read(match.id);
    let writes = 0;
    const failing = {
      submit(submission: JournalSubmission) {
        if (++writes === 2) throw new DOMException('Full', 'QuotaExceededError');
        return journal.submit(submission);
      },
    };
    await expect(
      submitSkullBids(
        db,
        failing,
        input([
          { ownerId: 'alice', bid: 0 },
          { ownerId: 'lucas', bid: 0 },
        ]),
      ),
    ).rejects.toMatchObject({ code: 'quota_exceeded' });
    expect(await journal.read(match.id)).toEqual(before);
  });
  it('rejects stale bids after a concurrent pause', async () => {
    const { db, journal, match, input } = await setup();
    await journal.submit({
      matchId: match.id,
      eventId: 'pause',
      commandId: 'pause',
      expectedVersion: 1,
      actorPlayerId: 'alice',
      deviceId: 'test-device',
      timestamp,
      action: { type: 'pause' },
    });
    const before = await journal.read(match.id);
    await expect(
      submitSkullBids(db, journal, input([{ ownerId: 'alice', bid: 0 }])),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(await journal.read(match.id)).toEqual(before);
  });
  it('preserves the journal authority check', async () => {
    const { db, journal, match, input } = await setup();
    await expect(
      submitSkullBids(db, journal, {
        ...input([{ ownerId: 'alice', bid: 0 }]),
        actorPlayerId: 'lucas',
      }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
    expect((await journal.read(match.id)).audit).toHaveLength(1);
  });
  it.each<{ bids: SkullBidsSubmission['bids'] }>([
    { bids: [] },
    { bids: [{ ownerId: 'alice', bid: -1 }] },
    { bids: [{ ownerId: 'alice', bid: 1.5 }] },
    { bids: [{ ownerId: 'alice', bid: 11 }] },
    {
      bids: [
        { ownerId: 'alice', bid: 0 },
        { ownerId: 'alice', bid: 1 },
      ],
    },
  ])('rejects invalid or duplicate bids %#', async ({ bids }) => {
    const { db, journal, match, input } = await setup();
    await expect(submitSkullBids(db, journal, input(bids))).rejects.toMatchObject({
      code: 'invalid_command',
    });
    expect((await journal.read(match.id)).audit).toHaveLength(1);
  });
  it('commits only one complete set of competing tab submissions', async () => {
    const { db, journal, input, inspect } = await setup();
    const other = new LocalDatabase(db.name);
    try {
      const rows = ['alice', 'lucas', 'emma'];
      const outcomes = await Promise.allSettled([
        submitSkullBids(db, journal, input(rows.map((ownerId) => ({ ownerId, bid: 0 })))),
        submitSkullBids(
          other,
          new MatchJournal(other),
          input(rows.map((ownerId) => ({ ownerId, bid: 1 }))),
        ),
      ]);
      expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(new Set(Object.values((await inspect()).entries).map((row) => row.bid)).size).toBe(1);
    } finally {
      other.close();
    }
  });
});
