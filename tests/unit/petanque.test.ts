import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalDatabase } from '../../src/lib/storage/database';
import { LocalRepository } from '../../src/lib/storage/repository';
import { TeamRepository } from '../../src/lib/storage/teams';
import { MatchJournal } from '../../src/lib/storage/journal';
import { PetanqueRepository, type CreatePetanqueInput } from '../../src/lib/storage/petanque';
import {
  petanqueCommand,
  petanqueProgress,
  petanqueSides,
  assertPetanqueMatch,
  type PetanqueEnd,
} from '../../src/lib/domain/games/petanque';
import { seedJournal, timestamp } from '../fixtures/journal';

const databases: LocalDatabase[] = [];
afterEach(async () => {
  for (const db of databases) db.close();
  for (const db of databases) await db.delete();
  databases.length = 0;
});
function open(name: string = crypto.randomUUID()) {
  const db = new LocalDatabase(name);
  databases.push(db);
  return db;
}
async function setup(overrides: Partial<CreatePetanqueInput> = {}) {
  const db = open();
  await seedJournal(db);
  const repository = new PetanqueRepository(db);
  const input: CreatePetanqueInput = {
    id: 'petanque',
    mode: 'teams',
    playerIds: [],
    boulesPerPlayer: 3,
    teams: [
      { id: 'blue', revision: 1 },
      { id: 'red', revision: 1 },
    ],
    organizerPlayerId: 'alice',
    firstThrowOwnerId: 'blue',
    target: 13,
    createdAt: timestamp,
    ...overrides,
  };
  const match = await repository.create(input);
  const journal = new MatchJournal(db);
  let counter = 0;
  const send = async (action: unknown, version?: number) =>
    journal.submit({
      matchId: match.id,
      eventId: `p-${++counter}`,
      commandId: `pc-${counter}`,
      expectedVersion: version ?? (await db.matches.get(match.id))!.version,
      actorPlayerId: 'alice',
      deviceId: 'phone',
      timestamp,
      action,
    });
  const end = (value: PetanqueEnd) =>
    send(petanqueCommand(value, petanqueSides(match), input.boulesPerPlayer));
  return { db, match, input, repository, journal, send, end };
}

describe('Pétanque local play', () => {
  it('plays doublette through void/undo/correction, victory and reopening with immutable audit', async () => {
    const { db, match, journal, send, end } = await setup();
    expect((await journal.read(match.id)).projection).toMatchObject({
      status: 'draft',
      totals: { blue: 0, red: 0 },
    });
    await send({ type: 'start' });
    await end({ type: 'points', teamId: 'blue', points: 4 });
    await end({ type: 'points', teamId: 'red', points: 2 });
    const voided = await end({ type: 'void' });
    expect(voided.projection.totals).toEqual({ blue: 4, red: 2 });
    expect(petanqueProgress(match, voided.audit)).toMatchObject({
      nextThrowOwnerId: 'red',
      active: expect.any(Array),
    });
    expect(petanqueProgress(match, voided.audit).active).toHaveLength(3);
    const original = await db.scoreEvents.get('p-2');
    await send({ type: 'undo', targetEventId: 'p-3' });
    const corrected = await send({
      type: 'correct',
      targetEventId: 'p-2',
      replacement: petanqueCommand(
        { type: 'points', teamId: 'blue', points: 3 },
        petanqueSides(match),
        3,
      ),
    });
    expect(corrected.projection.totals).toEqual({ blue: 3, red: 0 });
    expect(petanqueProgress(match, corrected.audit).nextThrowOwnerId).toBe('blue');
    expect(await db.scoreEvents.get('p-2')).toEqual(original);
    await end({ type: 'points', teamId: 'blue', points: 6 });
    const won = await end({ type: 'points', teamId: 'blue', points: 4 });
    expect(won.projection).toMatchObject({ status: 'finished', winnerId: 'blue' });
    await expect(end({ type: 'points', teamId: 'red', points: 1 })).rejects.toMatchObject({
      code: 'invalid_transition',
    });
    const reopened = await send({
      type: 'correct',
      targetEventId: 'p-8',
      replacement: petanqueCommand(
        { type: 'points', teamId: 'blue', points: 2 },
        petanqueSides(match),
        3,
      ),
    });
    expect(reopened.projection).toMatchObject({
      status: 'in_progress',
      totals: { blue: 11, red: 0 },
      winnerIds: [],
    });
    db.close();
    expect(await new MatchJournal(open(db.name)).read(match.id)).toEqual(reopened);
  });

  it.each([
    [3, 2, 0, 'blue'],
    [0, 0, 0, 'blue'],
    [4, 0, 4, 'blue'],
    [0, 5, 5, 'red'],
  ])('computes a dead jack with %i/%i remaining boules', async (first, second, points, ownerId) => {
    const { match, send, end } = await setup();
    await send({ type: 'start' });
    const view = await end({ type: 'dead_jack', remaining: [first, second] });
    expect(view.projection.totals).toEqual({
      blue: ownerId === 'blue' ? points : 0,
      red: ownerId === 'red' ? points : 0,
    });
    expect(petanqueProgress(match, view.audit).nextThrowOwnerId).toBe(ownerId);
  });

  it('supports four individuals, per-player boule limits, target 11 and repeated rematches', async () => {
    const { match, input, repository, send, end, db } = await setup({
      mode: 'individual',
      playerIds: ['alice', 'lucas', 'emma', 'hugo'],
      teams: [],
      firstThrowOwnerId: 'emma',
      target: 11,
    });
    expect(Object.keys((await new MatchJournal(db).read(match.id)).state.totals)).toHaveLength(4);
    await send({ type: 'start' });
    expect(() =>
      petanqueCommand({ type: 'points', teamId: 'alice', points: 4 }, petanqueSides(match), 3),
    ).toThrow('invalid_command');
    for (const points of [3, 3, 3, 2]) await end({ type: 'points', teamId: 'hugo', points });
    const rematch = await repository.rematch(match.id, {
      id: 'again',
      createdAt: timestamp,
      expectedVersion: 5,
    });
    expect(rematch.mode).toBe('individual');
    expect(rematch.playersSnapshot).toHaveLength(4);
    expect(rematch.settingsSnapshot).toMatchObject({
      firstThrowOwnerId: 'emma',
      target: 11,
      boulesPerPlayer: input.boulesPerPlayer,
    });
    expect(rematch.version).toBe(0);
    expect((await db.matches.get(match.id))?.status).toBe('finished');
  });

  it('supports more than two teams and explicitly refuses automatic multi-side dead-jack scoring', async () => {
    const { db, input, repository } = await setup();
    const local = new LocalRepository(db);
    await local.createPlayer({
      id: 'fifth',
      displayName: 'Fifth',
      color: '#153e35',
      isGuest: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await local.saveTeam(
      { id: 'green', name: 'Green', color: '#153e35', createdAt: timestamp, updatedAt: timestamp },
      ['fifth'],
    );
    const match = await repository.create({
      ...input,
      id: 'three',
      teams: [...input.teams, { id: 'green', revision: 1 }],
    });
    expect(petanqueSides(match)).toHaveLength(3);
    expect(() =>
      petanqueCommand({ type: 'dead_jack', remaining: [1, 0] }, petanqueSides(match), 3),
    ).toThrow('invalid_command');
    const journal = new MatchJournal(db);
    await journal.submit({
      matchId: 'three',
      eventId: 'ts',
      commandId: 'ts',
      expectedVersion: 0,
      actorPlayerId: 'alice',
      deviceId: 'phone',
      timestamp,
      action: { type: 'start' },
    });
    const view = await journal.submit({
      matchId: 'three',
      eventId: 'te',
      commandId: 'te',
      expectedVersion: 1,
      actorPlayerId: 'alice',
      deviceId: 'phone',
      timestamp,
      action: petanqueCommand(
        { type: 'points', teamId: 'green', points: 3 },
        petanqueSides(match),
        3,
      ),
    });
    expect(view.state.totals).toEqual({ blue: 0, red: 0, green: 3 });
  });

  it.each([0, -1, 7, 1.5, Infinity])(
    'rejects invalid ordinary doublette points %s',
    async (points) => {
      const { match } = await setup();
      expect(() =>
        petanqueCommand({ type: 'points', teamId: 'blue', points }, petanqueSides(match), 3),
      ).toThrow('invalid_command');
    },
  );

  it('rejects forged end reasons/remaining counts and manual finish at the authoritative boundary', async () => {
    const { match, send } = await setup();
    await send({ type: 'start' });
    const command = petanqueCommand({ type: 'void' }, petanqueSides(match), 3);
    await expect(
      send({ ...command, values: { ...command.values, points: 6 } }),
    ).rejects.toMatchObject({ code: 'invalid_command' });
    await expect(send({ type: 'finish' })).rejects.toMatchObject({ code: 'invalid_command' });
    expect(() =>
      petanqueCommand({ type: 'dead_jack', remaining: [7, 0] }, petanqueSides(match), 3),
    ).toThrow('invalid_command');
    expect(() =>
      assertPetanqueMatch({
        ...match,
        settingsSnapshot: { ...match.settingsSnapshot, target: 15 },
      }),
    ).toThrow('invalid_config');
  });

  it('rejects stale rosters and invalid ownership without changing reusable teams on failure', async () => {
    const { db, repository, input } = await setup();
    await expect(
      repository.create({
        ...input,
        id: 'stale',
        teams: [{ id: 'blue', revision: 0 }, input.teams[1]!],
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      repository.create({ ...input, id: 'bad-first', firstThrowOwnerId: 'ghost' }),
    ).rejects.toMatchObject({ code: 'invalid_config' });
    expect((await db.teams.get('blue'))?.assignedMatchId).toBeUndefined();
    expect(await db.matches.get('bad-first')).toBeUndefined();
    const fail = () => {
      throw new DOMException('Full', 'QuotaExceededError');
    };
    db.matchProjections.hook('creating', fail);
    await expect(repository.create({ ...input, id: 'full' })).rejects.toMatchObject({
      code: 'quota_exceeded',
    });
    expect((await db.teams.get('blue'))?.assignedMatchId).toBeUndefined();
    db.matchProjections.hook('creating').unsubscribe(fail);
    await repository.create({ ...input, id: 'once' });
    expect((await db.teams.get('blue'))?.assignedMatchId).toBeUndefined();
    await repository.create({ ...input, id: 'twice' });
    expect(await db.teams.count()).toBe(2);
  });

  it('keeps a reviewed historical lineup as a reusable copy when the original team changes', async () => {
    const { db, match, repository, send } = await setup();
    await send({ type: 'cancel' });
    const current = (await db.teams.get('blue'))!;
    await new TeamRepository(db).saveTeam(
      { ...current, name: 'Renamed team' },
      match.teamsSnapshot[0]!.playerIds,
      { expectedRevision: 1 },
    );
    const next = await repository.rematch(match.id, {
      id: 'reviewed',
      createdAt: timestamp,
      expectedVersion: 1,
    });
    expect(next.teamsSnapshot.map((team) => team.id)).toEqual(['reviewed-team-0', 'red']);
    expect(next.teamsSnapshot[0]?.name).toBe(match.teamsSnapshot[0]?.name);
    expect((await db.teams.get('reviewed-team-0'))?.kind).toBe('permanent');
    expect((await db.teams.get('reviewed-team-0'))?.archivedAt).toBeUndefined();
    expect((await db.matches.get(match.id))?.teamsSnapshot).toEqual(match.teamsSnapshot);
    expect(await db.teams.count()).toBe(3);
  });
  it('reuses unchanged teams for rematches while preserving prior history', async () => {
    const { db, match, repository, send } = await setup();
    await send({ type: 'cancel' });
    const before = await db.scoreEvents.toArray();
    const next = await repository.rematch(match.id, {
      id: 'again',
      createdAt: timestamp,
      expectedVersion: 1,
    });
    expect(next.teamsSnapshot.map((team) => team.id)).toEqual(['blue', 'red']);
    expect(next.playersSnapshot.map((player) => player.id)).toEqual(
      match.playersSnapshot.map((player) => player.id),
    );
    expect((await db.teams.get('blue'))?.assignedMatchId).toBeUndefined();
    expect(await db.teams.count()).toBe(2);
    expect(await db.scoreEvents.toArray()).toEqual(before);
    await expect(
      repository.rematch(match.id, { id: 'stale', createdAt: timestamp, expectedVersion: 0 }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await db.players.update('alice', { archivedAt: timestamp });
    await expect(
      repository.rematch(match.id, { id: 'archived', createdAt: timestamp, expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: 'invalid_record' });
    expect(await db.teams.get('archived-team-0')).toBeUndefined();
  });

  it('creates a stable device identity across concurrent connections without removing older settings', async () => {
    const db = open();
    await db.saveDeviceName('Old phone');
    const other = open(db.name);
    const ids = await Promise.all([
      db.readOrCreateDeviceId('candidate-a'),
      other.readOrCreateDeviceId('candidate-b'),
    ]);
    expect(ids[0]).toBe(ids[1]);
    expect(await db.readDeviceName()).toBe('Old phone');
  });
});
