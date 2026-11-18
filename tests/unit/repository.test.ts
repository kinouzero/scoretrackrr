import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalDatabase } from '../../src/lib/storage/database';
import { LocalRepository } from '../../src/lib/storage/repository';

const timestamp = '2026-11-16T12:00:00.000Z';
const later = '2026-11-16T13:00:00.000Z';
const databases: LocalDatabase[] = [];
function open(name: string = crypto.randomUUID()) {
  const db = new LocalDatabase(name);
  databases.push(db);
  return { db, repository: new LocalRepository(db) };
}
afterEach(async () => {
  for (const db of databases) db.close();
  for (const db of databases) await db.delete();
  databases.length = 0;
});

function player(id: string) {
  return {
    id,
    displayName: id,
    color: '#153e35',
    isGuest: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
function team(id = 'blue') {
  return { id, name: id, color: '#153e35', createdAt: timestamp, updatedAt: timestamp };
}
function version(id = 'rules-v1', rulesetVersion = '1') {
  return {
    id,
    gameId: 'petanque',
    rulesetVersion,
    schemaVersion: 1,
    definition: { target: 13, nested: { mode: 'teams' } },
    publishedAt: timestamp,
  };
}
function match(id = 'match') {
  return {
    id,
    gameVersionId: 'rules-v1',
    variantId: 'short',
    playerIds: ['alice', 'lucas'],
    teamIds: ['blue'],
    organizerPlayerId: 'alice',
    mode: 'teams' as const,
    settings: { outdoor: true },
    createdAt: timestamp,
  };
}
function event(id = 'event-1', commandId = 'command-1', expectedVersion = 0) {
  return {
    id,
    matchId: 'match',
    commandId,
    expectedVersion,
    actorPlayerId: 'alice',
    payload: { type: 'test-event', points: 4 },
    timestamp: later,
    projection: { status: 'in_progress' as const, totals: { blue: 4 } },
  };
}
async function seed() {
  const context = open();
  const { repository } = context;
  await repository.savePlayer(player('alice'));
  await repository.savePlayer(player('lucas'));
  await repository.saveTeam(team(), ['alice', 'lucas']);
  await repository.saveGame({
    id: 'petanque',
    slug: 'petanque',
    name: 'Pétanque',
    state: 'coming_soon',
  });
  await repository.publishGameVersion(version());
  await repository.saveVariant({
    id: 'short',
    gameVersionId: 'rules-v1',
    name: 'Short game',
    settings: { target: 11 },
  });
  return context;
}

describe('local repository integrity', () => {
  it('preserves frozen rules, roster and settings after master records change and the database reopens', async () => {
    const { db, repository } = await seed();
    const original = await repository.createMatch(match());
    await repository.savePlayer({ ...player('alice'), displayName: 'Renamed', archivedAt: later });
    await repository.saveTeam({ ...team(), name: 'New team', updatedAt: later }, ['lucas']);
    await repository.saveVariant({
      id: 'short',
      gameVersionId: 'rules-v1',
      name: 'Changed',
      settings: { target: 7 },
    });
    await repository.publishGameVersion({
      ...version('rules-v2', '2'),
      definition: { target: 21 },
    });
    db.close();
    const { repository: reopened, db: reopenedDb } = open(db.name);
    const restored = await reopened.readMatch('match');
    expect(restored.match).toEqual(original);
    expect(restored.match.settingsSnapshot).toEqual({ target: 11, outdoor: true });
    expect(restored.match.playersSnapshot.map((player) => player.displayName)).toEqual([
      'alice',
      'lucas',
    ]);
    expect(restored.match.teamsSnapshot[0]?.playerIds).toEqual(['alice', 'lucas']);
    expect(restored.match.rulesSnapshot.definition.target).toBe(13);
    expect(restored.permissions).toEqual([
      { matchId: 'match', playerId: 'alice', role: 'organizer', grantedBy: 'alice', revision: 1 },
    ]);
    const memberships = await reopenedDb.teamMemberships.where('teamId').equals('blue').toArray();
    expect(memberships.find((member) => member.playerId === 'alice')?.leftAt).toBe(later);
    expect(memberships.find((member) => member.playerId === 'lucas')?.leftAt).toBeUndefined();
  });

  it('rejects overwriting either a published rules ID or its game/version pair', async () => {
    const { db, repository } = await seed();
    await expect(
      repository.publishGameVersion({ ...version(), definition: { target: 7 } }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(repository.publishGameVersion(version('other-id'))).rejects.toMatchObject({
      code: 'conflict',
    });
    expect((await db.gameVersions.get('rules-v1'))?.definition.target).toBe(13);
    expect(await db.gameVersions.count()).toBe(1);
  });

  it('rejects missing references and preserves the previous team roster', async () => {
    const { db, repository } = await seed();
    await expect(repository.saveTeam(team(), ['missing'])).rejects.toMatchObject({
      code: 'missing_reference',
    });
    expect((await db.teamMemberships.toArray()).filter((member) => !member.leftAt)).toHaveLength(2);
    await expect(
      repository.saveVariant({ id: 'bad', name: 'Bad', gameVersionId: 'missing', settings: {} }),
    ).rejects.toMatchObject({ code: 'missing_reference' });
    await expect(
      repository.createMatch({ ...match(), gameVersionId: 'missing' }),
    ).rejects.toMatchObject({ code: 'missing_reference' });
    await expect(
      repository.createMatch({ ...match(), playerIds: ['alice'] }),
    ).rejects.toMatchObject({ code: 'invalid_record' });
    await expect(
      repository.createMatch({ ...match(), playerIds: ['alice', 'alice'] }),
    ).rejects.toMatchObject({ code: 'invalid_record' });
    await expect(
      repository.createMatch({ ...match(), organizerPlayerId: 'missing' }),
    ).rejects.toMatchObject({ code: 'invalid_record' });
    expect(await db.matches.count()).toBe(0);
    expect(await db.matchPermissions.count()).toBe(0);
  });

  it('does not create a partial match if projection storage is full', async () => {
    const { db, repository } = await seed();
    db.matchProjections.hook('creating', () => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    await expect(repository.createMatch(match())).rejects.toMatchObject({ code: 'quota_exceeded' });
    expect(await db.matches.count()).toBe(0);
    expect(await db.matchPermissions.count()).toBe(0);
    expect(await db.matchProjections.count()).toBe(0);
    expect(await db.players.count()).toBe(2);
  });
});

describe('atomic append-only event storage', () => {
  it('reopens rounds, ordered events, corrections and projections without rewriting earlier events', async () => {
    const { db, repository } = await seed();
    await repository.createMatch(match());
    await repository.addRound({ id: 'round', matchId: 'match', sequence: 1, status: 'open' });
    const first = await repository.appendScoreEvent({ ...event(), roundId: 'round' });
    await repository.appendScoreEvent({
      ...event('event-2', 'command-2', 1),
      roundId: 'round',
      supersedesId: first.id,
      payload: { type: 'test-correction', points: 3 },
      projection: { totals: { blue: 3 }, status: 'in_progress' },
    });
    db.close();
    const restored = await open(db.name).repository.readMatch('match');
    expect(restored.events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(restored.events[0]).toEqual(first);
    expect(restored.events[1]?.supersedesId).toBe(first.id);
    expect(restored.match.version).toBe(2);
    expect(restored.projection).toEqual({
      matchId: 'match',
      lastEventSequence: 2,
      status: 'in_progress',
      totals: { blue: 3 },
    });
    expect(restored.rounds.map((round) => round.id)).toEqual(['round']);
  });

  it('rejects duplicate commands, stale versions, unauthorized actors and invalid score owners', async () => {
    const { db, repository } = await seed();
    await repository.createMatch(match());
    await repository.appendScoreEvent(event());
    await expect(
      repository.appendScoreEvent(event('duplicate', 'command-1', 1)),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(repository.appendScoreEvent(event('stale', 'command-2', 0))).rejects.toMatchObject(
      { code: 'conflict' },
    );
    await expect(
      repository.appendScoreEvent({
        ...event('forbidden', 'command-3', 1),
        actorPlayerId: 'lucas',
      }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(
      repository.appendScoreEvent({
        ...event('bad-owner', 'command-4', 1),
        projection: { status: 'in_progress', totals: { missing: 3 } },
      }),
    ).rejects.toMatchObject({ code: 'invalid_record' });
    expect(await db.scoreEvents.count()).toBe(1);
    expect((await db.matches.get('match'))?.version).toBe(1);
  });

  it('allows only one of two concurrent commands with the same expected version', async () => {
    const { db, repository } = await seed();
    await repository.createMatch(match());
    const otherConnection = open(db.name).repository;
    const results = await Promise.allSettled([
      repository.appendScoreEvent(event()),
      otherConnection.appendScoreEvent(event('other', 'other-command')),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await db.scoreEvents.count()).toBe(1);
    expect((await repository.readMatch('match')).projection.lastEventSequence).toBe(1);
  });

  it('rolls back the event, version and projection together on quota failure', async () => {
    const { db, repository } = await seed();
    await repository.createMatch(match());
    await repository.appendScoreEvent(event());
    const before = await repository.readMatch('match');
    db.matchProjections.hook('updating', () => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    await expect(
      repository.appendScoreEvent(event('event-2', 'command-2', 1)),
    ).rejects.toMatchObject({ code: 'quota_exceeded' });
    expect(await repository.readMatch('match')).toEqual(before);
  });

  it('rejects cross-match rounds and correction references', async () => {
    const { db, repository } = await seed();
    await repository.createMatch(match());
    await repository.createMatch(match('other-match'));
    await repository.addRound({
      id: 'other-round',
      matchId: 'other-match',
      sequence: 1,
      status: 'open',
    });
    await repository.appendScoreEvent({ ...event(), matchId: 'other-match' });
    await expect(
      repository.appendScoreEvent({ ...event('event-2', 'command-2'), roundId: 'other-round' }),
    ).rejects.toMatchObject({ code: 'invalid_record' });
    await expect(
      repository.appendScoreEvent({ ...event('event-3', 'command-3'), supersedesId: 'event-1' }),
    ).rejects.toMatchObject({ code: 'invalid_record' });
    expect((await db.matches.get('match'))?.version).toBe(0);
  });
});
