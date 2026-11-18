import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalDatabase } from '../../src/lib/storage/database';
import { MatchJournal, type JournalSubmission } from '../../src/lib/storage/journal';
import { parseJournalAction, replayJournal } from '../../src/lib/domain/journal';
import { seedJournal, timestamp } from '../fixtures/journal';

const databases: LocalDatabase[] = [];
function open(name: string = crypto.randomUUID()) {
  const db = new LocalDatabase(name);
  databases.push(db);
  return db;
}
afterEach(async () => {
  for (const db of databases) db.close();
  for (const db of databases) await db.delete();
  databases.length = 0;
});
const score = (ownerId: string, points: number) => ({
  type: 'record',
  ownerId,
  values: { points },
});
async function setup(target: number | undefined = 13) {
  const db = open();
  const match = await seedJournal(db, target);
  const journal = new MatchJournal(db);
  let counter = 0;
  async function send(action: unknown, overrides: Partial<JournalSubmission> = {}) {
    counter++;
    return journal.submit({
      matchId: 'match',
      eventId: `e-${counter}`,
      commandId: `c-${counter}`,
      expectedVersion: (await db.matches.get('match'))!.version,
      actorPlayerId: 'alice',
      deviceId: 'phone-a',
      timestamp,
      action,
      ...overrides,
    });
  }
  return { db, match, journal, send };
}

describe('persistent authoritative scoring journal', () => {
  it('records author/device/version, reopens and deterministically replays a finished match', async () => {
    const { db, journal, send } = await setup();
    expect((await journal.read('match')).projection.status).toBe('draft');
    await send({ type: 'start' });
    await send(score('blue', 4));
    await send(score('red', 2));
    await send(score('blue', 6));
    const finished = await send(score('blue', 3));
    expect(finished.projection).toMatchObject({
      status: 'finished',
      totals: { blue: 13, red: 2 },
      winnerId: 'blue',
      winnerIds: ['blue'],
    });
    expect(finished.audit.at(-1)?.event).toMatchObject({
      actorPlayerId: 'alice',
      deviceId: 'phone-a',
      timestamp,
      sequence: 5,
      commandId: 'c-5',
    });
    db.close();
    expect(await new MatchJournal(open(db.name)).read('match')).toEqual(finished);
    expect(Object.isFrozen(finished.audit[0]?.event.payload)).toBe(true);
  });

  it('preserves every original event, chains corrections and restores an undone score', async () => {
    const { db, send } = await setup();
    await send({ type: 'start' });
    await send(score('blue', 4));
    await send(score('red', 2));
    const before = await db.scoreEvents.toArray();
    const corrected = await send({
      type: 'correct',
      targetEventId: 'e-2',
      replacement: score('blue', 3),
    });
    expect(corrected.projection.totals).toEqual({ blue: 3, red: 2 });
    expect(corrected.audit[1]?.supersededBy).toBe('e-4');
    expect(corrected.audit[3]?.event.supersedesId).toBe('e-2');
    expect((await db.scoreEvents.toArray()).slice(0, 3)).toEqual(before);
    const undone = await send({ type: 'undo', targetEventId: 'e-4' });
    expect(undone.projection.totals).toEqual({ blue: 0, red: 2 });
    const restored = await send({
      type: 'correct',
      targetEventId: 'e-5',
      replacement: score('red', 5),
    });
    expect(restored.projection.totals).toEqual({ blue: 0, red: 7 });
    await expect(send({ type: 'undo', targetEventId: 'e-2' })).rejects.toMatchObject({
      code: 'invalid_correction',
    });
    expect(await db.scoreEvents.count()).toBe(6);
  });

  it('reopens a finished match after undoing its winning entry and permits continued scoring', async () => {
    const { send } = await setup(6);
    await send({ type: 'start' });
    await send(score('blue', 6));
    await expect(send(score('red', 1))).rejects.toMatchObject({ code: 'invalid_transition' });
    const reopened = await send({ type: 'undo', targetEventId: 'e-2' });
    expect(reopened.projection).toMatchObject({
      status: 'in_progress',
      totals: { blue: 0, red: 0 },
      winnerIds: [],
    });
    expect(reopened.projection.winnerId).toBeUndefined();
    expect((await send(score('red', 6))).projection.winnerId).toBe('red');
  });

  it('rejects a correction that would invalidate a later retained score without changing storage', async () => {
    const { db, journal, send } = await setup(6);
    await send({ type: 'start' });
    await send(score('blue', 2));
    await send(score('red', 2));
    const before = await journal.read('match');
    await expect(
      send({ type: 'correct', targetEventId: 'e-2', replacement: score('blue', 6) }),
    ).rejects.toMatchObject({ code: 'invalid_correction' });
    expect(await journal.read('match')).toEqual(before);
    expect(await db.scoreEvents.count()).toBe(3);
  });

  it('enforces pause/resume/cancel transitions and retains paused status after corrections', async () => {
    const { send } = await setup();
    await expect(send(score('blue', 1))).rejects.toMatchObject({ code: 'invalid_transition' });
    await send({ type: 'start' });
    await send(score('blue', 4));
    await send({ type: 'pause' });
    await expect(send(score('blue', 1))).rejects.toMatchObject({ code: 'invalid_transition' });
    expect(
      (await send({ type: 'correct', targetEventId: 'e-3', replacement: score('blue', 3) }))
        .projection.status,
    ).toBe('paused');
    await send({ type: 'resume' });
    await send(score('red', 2));
    expect((await send({ type: 'cancel' })).projection.status).toBe('cancelled');
    await expect(send({ type: 'undo', targetEventId: 'e-3' })).rejects.toMatchObject({
      code: 'invalid_transition',
    });
    await expect(send({ type: 'resume' })).rejects.toMatchObject({ code: 'invalid_transition' });
  });

  it('recalculates a shared manual finish, then undoes finish before more scoring', async () => {
    const { db, send } = await setup();
    const match = (await db.matches.get('match'))!;
    await db.matches.put({
      ...match,
      rulesSnapshot: {
        ...match.rulesSnapshot,
        definition: {
          ...match.rulesSnapshot.definition,
          objective: { direction: 'highest' },
        },
      },
    });
    await send({ type: 'start' });
    await expect(send({ type: 'finish' })).rejects.toMatchObject({ code: 'empty_game' });
    await send(score('blue', 2));
    await send(score('red', 2));
    const finished = await send({ type: 'finish' });
    expect(finished.projection.winnerIds).toEqual(['blue', 'red']);
    expect(finished.projection.winnerId).toBeUndefined();
    await expect(
      send({ type: 'correct', targetEventId: 'e-5', replacement: score('blue', 1) }),
    ).rejects.toMatchObject({ code: 'invalid_correction' });
    expect(
      (await send({ type: 'correct', targetEventId: 'e-3', replacement: score('blue', 3) }))
        .projection.winnerId,
    ).toBe('blue');
    expect((await send({ type: 'undo', targetEventId: 'e-5' })).projection.status).toBe(
      'in_progress',
    );
    await send(score('red', 2));
  });

  it('rejects unauthorized actors, duplicate IDs and stale versions', async () => {
    const { db, send } = await setup();
    await send({ type: 'start' });
    await expect(send(score('blue', 1), { actorPlayerId: 'emma' })).rejects.toMatchObject({
      code: 'unauthorized',
    });
    await expect(send(score('blue', 1), { commandId: 'c-1' })).rejects.toMatchObject({
      code: 'conflict',
    });
    await expect(send(score('blue', 1), { eventId: 'e-1' })).rejects.toMatchObject({
      code: 'invalid_journal',
    });
    await expect(send(score('blue', 1), { expectedVersion: 0 })).rejects.toMatchObject({
      code: 'conflict',
    });
    expect(await db.scoreEvents.count()).toBe(1);
  });

  it('arbitrates concurrent cross-connection submissions atomically', async () => {
    const { db, send } = await setup();
    await send({ type: 'start' });
    const other = new MatchJournal(open(db.name));
    const input = {
      matchId: 'match',
      expectedVersion: 1,
      actorPlayerId: 'alice',
      deviceId: 'phone-b',
      timestamp,
      action: score('red', 2),
      eventId: 'other',
      commandId: 'other',
    };
    const results = await Promise.allSettled([
      send(score('blue', 4), { expectedVersion: 1 }),
      other.submit(input),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(await db.scoreEvents.count()).toBe(2);
    expect((await db.matches.get('match'))?.version).toBe(2);
  });

  it('rolls back event/version/projection on quota failure and allows a safe retry', async () => {
    const { db, journal, send } = await setup();
    await send({ type: 'start' });
    const before = await journal.read('match');
    const fail = () => {
      throw new DOMException('Full', 'QuotaExceededError');
    };
    db.matchProjections.hook('updating', fail);
    await expect(
      send(score('blue', 4), { eventId: 'retry', commandId: 'retry' }),
    ).rejects.toMatchObject({ code: 'quota_exceeded' });
    expect(await journal.read('match')).toEqual(before);
    expect(await db.scoreEvents.count()).toBe(1);
    db.matchProjections.hook('updating').unsubscribe(fail);
    await send(score('blue', 4), { eventId: 'retry', commandId: 'retry' });
    expect((await journal.read('match')).projection.totals.blue).toBe(4);
  });

  it('rebuilds a corrupt/missing cache using pinned rules and rejects a stale rebuild', async () => {
    const { db, journal, send } = await setup();
    await send({ type: 'start' });
    const before = await send(score('blue', 4));
    await db.matchProjections.delete('match');
    await db.matches.update('match', { status: 'cancelled' });
    await db.players.update('alice', { displayName: 'Changed', archivedAt: timestamp });
    await db.gameVersions.update('fixture-v1', { definition: { unsupported: true } });
    expect(await journal.read('match')).toEqual(before);
    await expect(journal.rebuild('match', 0)).rejects.toMatchObject({ code: 'conflict' });
    expect(await journal.rebuild('match', 2)).toEqual(before);
    expect(await db.matchProjections.get('match')).toEqual(before.projection);
    expect((await db.matches.get('match'))?.status).toBe('in_progress');
  });

  it.each([
    [
      'sequence gap',
      (e: Record<string, unknown>) => {
        e.sequence = 4;
      },
    ],
    [
      'wrong match',
      (e: Record<string, unknown>) => {
        e.matchId = 'other';
      },
    ],
    [
      'wrong author',
      (e: Record<string, unknown>) => {
        e.actorPlayerId = 'hugo';
      },
    ],
    [
      'missing device',
      (e: Record<string, unknown>) => {
        delete e.deviceId;
      },
    ],
    [
      'invalid date',
      (e: Record<string, unknown>) => {
        e.timestamp = '2026-02-31T12:00:00.000Z';
      },
    ],
    [
      'invalid format',
      (e: Record<string, unknown>) => {
        e.payload = { journalVersion: 9, action: { type: 'start' } };
      },
    ],
    [
      'forged correction link',
      (e: Record<string, unknown>) => {
        e.supersedesId = 'absent';
      },
    ],
  ])('rejects invalid journal data: %s', async (_, mutate) => {
    const { db, journal, send } = await setup();
    await send({ type: 'start' });
    const match = (await db.matches.get('match'))!;
    const event = { ...(await db.scoreEvents.get('e-1'))! };
    mutate(event);
    expect(() => replayJournal(match, [event])).toThrow();
    expect((await journal.read('match')).audit).toHaveLength(1);
  });

  it('rejects unknown/lifecycle/stale correction targets and invalid score input', async () => {
    const { send } = await setup();
    await send({ type: 'start' });
    for (const targetEventId of ['absent', 'e-1'])
      await expect(send({ type: 'undo', targetEventId })).rejects.toMatchObject({
        code: 'invalid_correction',
      });
    await expect(send(score('ghost', 1))).rejects.toMatchObject({ code: 'invalid_command' });
    await expect(send(score('blue', 7))).rejects.toMatchObject({ code: 'invalid_command' });
    await expect(send({ type: 'finish' })).rejects.toMatchObject({ code: 'empty_game' });
  });

  it('bounds histories and detects rule identity and version inconsistencies', async () => {
    const { match } = await setup();
    expect(() => replayJournal(match, Array(1001))).toThrow('history_limit');
    expect(() => replayJournal({ ...match, version: 1 }, [])).toThrow('invalid_journal');
    expect(() =>
      replayJournal(
        { ...match, rulesSnapshot: { ...match.rulesSnapshot, rulesetVersion: '2' } },
        [],
      ),
    ).toThrow('invalid_journal');
    expect(() =>
      replayJournal(
        { ...match, settingsSnapshot: { engineConfig: { mode: 'teams', ownerIds: ['blue'] } } },
        [],
      ),
    ).toThrow('invalid_journal');
  });

  it('maps individual, team, cooperative and mixed ownership without counting a participant twice', async () => {
    const { match } = await setup();
    const individual = replayJournal({ ...match, mode: 'individual' }, []);
    expect(Object.keys(individual.state.totals)).toEqual(['alice', 'lucas', 'emma', 'hugo']);
    const cooperative = replayJournal(
      {
        ...match,
        mode: 'cooperative',
        teamsSnapshot: [
          {
            id: 'all',
            name: 'All',
            color: '#153e35',
            playerIds: ['alice', 'lucas', 'emma', 'hugo'],
          },
        ],
        settingsSnapshot: { engineConfig: { mode: 'cooperative', ownerIds: ['all'] } },
      },
      [],
    );
    expect(cooperative.state.totals).toEqual({ all: 0 });
    const mixed = {
      ...match,
      mode: 'mixed' as const,
      settingsSnapshot: {
        engineConfig: { mode: 'mixed', ownerIds: ['blue', 'emma', 'hugo'] },
      },
    };
    expect(replayJournal(mixed, []).state.totals).toEqual({ blue: 0, emma: 0, hugo: 0 });
    expect(() =>
      replayJournal(
        {
          ...mixed,
          settingsSnapshot: {
            engineConfig: {
              mode: 'mixed',
              ownerIds: ['blue', 'alice', 'red'],
            },
          },
        },
        [],
      ),
    ).toThrow('invalid_journal');
  });

  it('pages local matches in creation order without modifying caller-owned actions', async () => {
    const { db, match, journal, send } = await setup();
    const action = score('blue', 4);
    await send({ type: 'start' });
    await send(action);
    expect(Object.isFrozen(action)).toBe(false);
    action.values.points = 6;
    expect((await journal.read('match')).projection.totals.blue).toBe(4);
    await db.matches.bulkAdd(
      Array.from({ length: 24 }, (_, i) => ({
        ...match,
        id: `extra-${i}`,
        createdAt: new Date(Date.parse(timestamp) + (i + 1) * 1000).toISOString(),
      })),
    );
    const first = await journal.list();
    expect(first.items).toHaveLength(24);
    expect(first.items[0]?.id).toBe('extra-23');
    expect(first.hasMore).toBe(true);
    expect((await journal.list(1)).items.map((item) => item.id)).toEqual(['match']);
    await expect(journal.list(-1)).rejects.toMatchObject({ code: 'invalid_record' });
  });

  it.each([
    { type: 'start', injected: true },
    { type: 'undo', targetEventId: 'missing', extra: true },
    { type: 'correct', targetEventId: 'e-2', replacement: { type: 'finish' } },
    { type: 'unknown' },
    { type: 'record', ownerId: 'blue', values: { points: Infinity } },
  ])('rejects malformed actions %#', (action) => {
    expect(() => parseJournalAction(action)).toThrow();
  });
});
