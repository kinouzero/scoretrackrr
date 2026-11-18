import 'fake-indexeddb/auto';
import { afterEach, expect, it } from 'vitest';
import { dartsCorkOrder } from '../../src/lib/domain/games/darts-cork';
import { x01Version } from '../../src/lib/domain/games/darts';
import { yamsVersion } from '../../src/lib/domain/games/yams';
import { cricketVersion } from '../../src/lib/domain/games/cricket';
import { CatalogRepository } from '../../src/lib/storage/catalog';
import {
  DeclarativeRepository,
  type CreateDeclarativeInput,
} from '../../src/lib/storage/declarative';
import { BackupRepository } from '../../src/lib/storage/backup';
import { replayJournal } from '../../src/lib/domain/journal';
import { matchOptions } from '../../src/lib/application/match-options';
import { ruleGuide } from '../../src/lib/application/rule-guide';
import { LocalDatabase, MatchJournal, seedJournal, timestamp } from '../fixtures/journal';
const databases: LocalDatabase[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) {
    db.close();
    await db.delete();
  }
});
async function setup() {
  const db = new LocalDatabase(crypto.randomUUID());
  databases.push(db);
  await seedJournal(db);
  await new CatalogRepository(db).initialize(timestamp);
  const input: CreateDeclarativeInput = {
    id: 'cork',
    versionId: x01Version(301, false, '').id,
    mode: 'individual',
    playerIds: ['alice', 'lucas', 'emma'],
    teams: [],
    organizerPlayerId: 'alice',
    cooperativeName: '',
    createdAt: timestamp,
    dartsCorkWinnerId: 'emma',
  };
  return { db, input, repository: new DeclarativeRepository(db) };
}
it('keeps all other sides in order and leaves the input unchanged', () => {
  const sides = ['alice', 'lucas', 'emma'];
  expect(dartsCorkOrder(sides, 'emma')).toEqual(['emma', 'alice', 'lucas']);
  expect(sides).toEqual(['alice', 'lucas', 'emma']);
});
it.each(['', 'absent', null, 1])('rejects invalid winners %j', (winner) => {
  expect(() => dartsCorkOrder(['alice', 'lucas'], winner)).toThrow();
});
it.each([x01Version(301, false, ''), cricketVersion(true, ''), cricketVersion(false, '')])(
  'pins $id cork order and starts with the selected player',
  async (version) => {
    const { db, input, repository } = await setup();
    const match = await repository.create({ ...input, versionId: version.id });
    expect(match.settingsSnapshot.engineConfig).toEqual({
      mode: 'individual',
      ownerIds: ['emma', 'alice', 'lucas'],
    });
    expect(match.settingsSnapshot.dartsCorkWinnerId).toBe('emma');
    const journal = new MatchJournal(db);
    await journal.submit({
      matchId: match.id,
      eventId: 'start',
      commandId: 'start',
      expectedVersion: 0,
      actorPlayerId: 'alice',
      deviceId: 'device',
      timestamp,
      action: { type: 'start' },
    });
    const view = await journal.read(match.id);
    expect(view.projection.status).toBe('in_progress');
    await expect(
      journal.submit({
        matchId: match.id,
        eventId: 'wrong',
        commandId: 'wrong',
        expectedVersion: 1,
        actorPlayerId: 'alice',
        deviceId: 'device',
        timestamp,
        action: { type: 'record', ownerId: 'alice', values: { total: 0, checkout: 0 } },
      }),
    ).rejects.toThrow();
    expect((await journal.read(match.id)).projection.lastEventSequence).toBe(1);
  },
);
it('starts the winning team without changing its member order', async () => {
  const { db, input, repository } = await setup();
  const match = await repository.create({
    ...input,
    mode: 'teams',
    playerIds: [],
    teams: [
      { id: 'blue', revision: (await db.teams.get('blue'))?.revision ?? 0 },
      { id: 'red', revision: (await db.teams.get('red'))?.revision ?? 0 },
    ],
    dartsCorkWinnerId: 'red',
  });
  expect(match.settingsSnapshot.engineConfig).toEqual({ mode: 'teams', ownerIds: ['red', 'blue'] });
  expect(match.teamsSnapshot.find((team) => team.id === 'red')?.playerIds).toEqual([
    'emma',
    'hugo',
  ]);
});
it.each(['alternate', 'loser'] as const)(
  'pins the first-leg winner while preserving the %s policy',
  async (startingRule) => {
    const { input, repository } = await setup();
    const match = await repository.create({
      ...input,
      playerIds: ['alice', 'emma'],
      dartsMatch: { legsToWin: 2, startingRule, firstStarterId: 'emma' },
    });
    expect(match.settingsSnapshot.dartsMatch).toMatchObject({
      startingRule,
      firstStarterId: 'emma',
    });
    expect(replayJournal(match, []).projection.status).toBe('draft');
  },
);
it('rejects conflicting first-leg settings atomically', async () => {
  const { db, input, repository } = await setup();
  await expect(
    repository.create({
      ...input,
      playerIds: ['alice', 'emma'],
      dartsMatch: { legsToWin: 2, startingRule: 'alternate', firstStarterId: 'alice' },
    }),
  ).rejects.toThrow();
  expect(await db.matches.get(input.id)).toBeUndefined();
});
it.each([{ dartsCorkWinnerId: 'absent' }, { versionId: 'not-found' }])(
  'rejects invalid setup %j without writing a match',
  async (override) => {
    const { db, input, repository } = await setup();
    await expect(repository.create({ ...input, ...override })).rejects.toThrow();
    expect(await db.matches.get(input.id)).toBeUndefined();
  },
);
it('rejects cork metadata on other games and inconsistent imported history', async () => {
  const { input, repository } = await setup();
  await expect(
    repository.create({ ...input, versionId: yamsVersion(true, '').id }),
  ).rejects.toThrow();
  const match = await repository.create(input);
  for (const dartsCorkWinnerId of ['alice', 'absent', 1])
    expect(() =>
      replayJournal(
        { ...match, settingsSnapshot: { ...match.settingsSnapshot, dartsCorkWinnerId } },
        [],
      ),
    ).toThrow();
});
it('preserves cork evidence in JSON backups and localized presentation descriptors', async () => {
  const { db, input, repository } = await setup();
  const match = await repository.create(input);
  expect(matchOptions(match)).toContainEqual({ key: 'dartsCork', values: { name: 'emma' } });
  expect(ruleGuide(match).play).toContainEqual({ key: 'ruleGuide.dartsCork.play' });
  const target = new LocalDatabase(crypto.randomUUID());
  databases.push(target);
  await new BackupRepository(target).restore(await new BackupRepository(db).export(timestamp));
  const restored = await target.matches.get(match.id);
  expect(restored?.settingsSnapshot).toEqual(match.settingsSnapshot);
  expect(replayJournal(restored!, []).projection).toEqual(replayJournal(match, []).projection);
});
it('keeps legacy settings and initial order unchanged when cork is not enabled', async () => {
  const { input, repository } = await setup();
  const legacy = { ...input };
  delete legacy.dartsCorkWinnerId;
  const match = await repository.create(legacy);
  expect(match.settingsSnapshot.dartsCorkWinnerId).toBeUndefined();
  expect(match.settingsSnapshot.engineConfig).toEqual({
    mode: 'individual',
    ownerIds: ['alice', 'lucas', 'emma'],
  });
});
