import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalDatabase } from '../../src/lib/storage/database';
import { CatalogRepository } from '../../src/lib/storage/catalog';
import { DeclarativeRepository } from '../../src/lib/storage/declarative';
import { MatchJournal } from '../../src/lib/storage/journal';
import { LocalRepository } from '../../src/lib/storage/repository';
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
const gameId = `custom-${'12345678-1234-1234-1234-123456789abc'}`;
const definition = {
  gameId,
  versionId: 'counter-v1',
  rulesetVersion: '1',
  name: 'My counter',
  minimum: -100,
  maximum: 100,
  initialScore: 0,
  target: 10,
  direction: 'highest' as const,
  publishedAt: timestamp,
};
async function setup() {
  const db = open();
  const catalog = new CatalogRepository(db);
  await catalog.initialize(timestamp);
  return { db, catalog };
}

describe('local catalog and immutable versions', () => {
  it('rejects an oversized variant family instead of scanning unbounded records', async () => {
    const { catalog, db } = await setup();
    await catalog.publishCounter(definition);
    const selected = await catalog.readVersion(definition.versionId);
    await db.gameVersions.bulkAdd(
      Array.from({ length: 100 }, (_, index) => ({
        ...selected,
        id: `extra-${index}`,
        rulesetVersion: `extra-${index}`,
        definition: { ...selected.definition, rulesetVersion: `extra-${index}` },
      })),
    );
    await expect(catalog.readSetupVersions(definition.versionId)).rejects.toMatchObject({
      code: 'invalid_record',
    });
  });
  it('loads setup variants from one family and keeps an explicitly requested historical version', async () => {
    const { catalog, db } = await setup();
    await catalog.publishCounter(definition);
    await catalog.publishCounter({
      ...definition,
      versionId: 'counter-v2',
      rulesetVersion: '2',
      target: 20,
      expectedVersionId: definition.versionId,
      publishedAt: '2026-11-17T12:00:00.000Z',
    });
    const result = await catalog.readSetupVersions(definition.versionId);
    expect(result.selected.id).toBe(definition.versionId);
    expect(result.versions.map((row) => row.id)).toEqual(['counter-v1', 'counter-v2']);
    expect((await db.games.get(gameId))?.currentVersionId).toBe('counter-v2');
    const darts = await catalog.readSetupVersions('x01-301-double-v1');
    expect(darts.versions).toHaveLength(6);
    expect(darts.versions.every((row) => row.gameId === 'darts')).toBe(true);
    await expect(catalog.readSetupVersions('missing')).rejects.toMatchObject({
      code: 'missing_reference',
    });
  });
  it('initializes exactly twenty families and immutable built-in presets without resetting favorites', async () => {
    const { db, catalog } = await setup();
    expect(await db.games.count()).toBe(20);
    expect(await db.gameVersions.count()).toBe(32);
    expect(await db.variants.count()).toBe(4);
    await catalog.setFavorite('petanque', true);
    const original = await db.gameVersions.toArray();
    await catalog.initialize('2026-11-17T12:00:00.000Z');
    expect(await db.gameVersions.toArray()).toEqual(original);
    expect((await catalog.list({ favorites: true })).items.map((game) => game.id)).toEqual([
      'petanque',
    ]);
    expect((await catalog.list({ state: 'coming_soon' })).items).toHaveLength(0);
    expect((await catalog.list({ search: 'Pé' })).items[0]?.versions).toHaveLength(4);
  });
  it('publishes a custom version, changes only the current pointer and retains old definitions after reopen', async () => {
    const { db, catalog } = await setup();
    const first = await catalog.publishCounter(definition);
    await catalog.setFavorite(gameId, true);
    await catalog.publishCounter({
      ...definition,
      versionId: 'counter-v2',
      rulesetVersion: '2',
      expectedVersionId: first.id,
      target: 20,
      name: 'Updated counter',
    });
    expect(await catalog.readVersion(first.id)).toEqual(first);
    expect((await catalog.list({ favorites: true })).items[0]).toMatchObject({
      name: 'Updated counter',
      currentVersionId: 'counter-v2',
      favorite: true,
    });
    db.close();
    expect(await new CatalogRepository(open(db.name)).readVersion(first.id)).toEqual(first);
  });
  it('rejects conflicting publications without overwriting an existing rule version', async () => {
    const { db, catalog } = await setup();
    await catalog.publishCounter(definition);
    const results = await Promise.allSettled([
      catalog.publishCounter({
        ...definition,
        versionId: 'v2-a',
        rulesetVersion: '2-a',
        expectedVersionId: definition.versionId,
      }),
      new CatalogRepository(open(db.name)).publishCounter({
        ...definition,
        versionId: 'v2-b',
        rulesetVersion: '2-b',
        expectedVersionId: definition.versionId,
      }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await db.gameVersions.where('gameId').equals(gameId).count()).toBe(2);
    await expect(
      catalog.publishCounter({
        ...definition,
        expectedVersionId: (await db.games.get(gameId))!.currentVersionId,
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect((await catalog.readVersion(definition.versionId)).rulesetVersion).toBe('1');
  });
  it('rolls the publication back completely when metadata storage fails', async () => {
    const { db, catalog } = await setup();
    await catalog.publishCounter(definition);
    db.games.hook('updating', () => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    await expect(
      catalog.publishCounter({
        ...definition,
        versionId: 'new',
        rulesetVersion: '2',
        expectedVersionId: definition.versionId,
      }),
    ).rejects.toMatchObject({ code: 'quota_exceeded' });
    expect(await db.gameVersions.get('new')).toBeUndefined();
    expect((await db.games.get(gameId))?.currentVersionId).toBe(definition.versionId);
  });
  it.each([{ minimum: 10, maximum: 1 }, { target: 0 }, { initialScore: Infinity }, { name: '\n' }])(
    'rejects invalid counter publication %#',
    async (change) => {
      const { db, catalog } = await setup();
      await expect(catalog.publishCounter({ ...definition, ...change })).rejects.toThrow();
      expect(await db.games.get(gameId)).toBeUndefined();
    },
  );
});

describe('declarative match creation', () => {
  const modes = ['individual', 'teams', 'cooperative', 'mixed'] as const;
  it.each(modes)('creates and plays %s ownership locally', async (mode) => {
    const { db, catalog } = await setup();
    await seedJournal(db);
    await catalog.publishCounter(definition);
    const match = await new DeclarativeRepository(db).create({
      id: `generic-${mode}`,
      versionId: definition.versionId,
      mode,
      playerIds:
        mode === 'teams'
          ? []
          : mode === 'mixed'
            ? ['emma', 'hugo']
            : ['alice', 'lucas', 'emma', 'hugo'],
      teams:
        mode === 'teams'
          ? [
              { id: 'blue', revision: 1 },
              { id: 'red', revision: 1 },
            ]
          : mode === 'mixed'
            ? [{ id: 'blue', revision: 1 }]
            : [],
      organizerPlayerId: 'alice',
      cooperativeName: 'Together',
      createdAt: timestamp,
    });
    const journal = new MatchJournal(db);
    const initial = await journal.read(match.id);
    const owners = Object.keys(initial.projection.totals);
    expect(owners).toHaveLength(
      mode === 'cooperative' ? 1 : mode === 'teams' ? 2 : mode === 'mixed' ? 3 : 4,
    );
    await journal.submit({
      matchId: match.id,
      eventId: 'start',
      commandId: 'start',
      actorPlayerId: 'alice',
      deviceId: 'phone',
      timestamp,
      expectedVersion: 0,
      action: { type: 'start' },
    });
    const won = await journal.submit({
      matchId: match.id,
      eventId: 'score',
      commandId: 'score',
      actorPlayerId: 'alice',
      deviceId: 'phone',
      timestamp,
      expectedVersion: 1,
      action: { type: 'record', ownerId: owners[0]!, values: { points: 10 } },
    });
    expect(won.projection.winnerId).toBe(owners[0]);
    await catalog.publishCounter({
      ...definition,
      versionId: 'later',
      rulesetVersion: '2',
      target: 20,
      expectedVersionId: definition.versionId,
    });
    expect(await journal.read(match.id)).toEqual(won);
    expect((await db.matches.get(match.id))?.rulesSnapshot).toEqual(match.rulesSnapshot);
  });
  it('rejects overlap in mixed mode and preserves reusable teams on failed creation', async () => {
    const { db, catalog } = await setup();
    await seedJournal(db);
    await catalog.publishCounter(definition);
    const create = new DeclarativeRepository(db);
    const input = {
      id: 'bad',
      versionId: definition.versionId,
      mode: 'mixed' as const,
      playerIds: ['alice'],
      teams: [{ id: 'blue', revision: 1 }],
      organizerPlayerId: 'alice',
      cooperativeName: 'Together',
      createdAt: timestamp,
    };
    await expect(create.create(input)).rejects.toMatchObject({ code: 'invalid_record' });
    expect((await db.teams.get('blue'))?.assignedMatchId).toBeUndefined();
    await db.players.update('emma', { archivedAt: timestamp });
    await expect(create.create({ ...input, playerIds: ['emma'] })).rejects.toMatchObject({
      code: 'invalid_record',
    });
    expect((await db.teams.get('blue'))?.assignedMatchId).toBeUndefined();
    expect(await db.matches.get('bad')).toBeUndefined();
  });
  it('rolls back cooperative group creation if writing the projection fails', async () => {
    const { db, catalog } = await setup();
    await seedJournal(db);
    await catalog.publishCounter(definition);
    db.matchProjections.hook('creating', () => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    await expect(
      new DeclarativeRepository(db).create({
        id: 'full',
        versionId: definition.versionId,
        mode: 'cooperative',
        playerIds: ['alice', 'lucas'],
        teams: [],
        organizerPlayerId: 'alice',
        cooperativeName: 'Together',
        createdAt: timestamp,
      }),
    ).rejects.toMatchObject({ code: 'quota_exceeded' });
    expect(await db.teams.get('full-group')).toBeUndefined();
    expect(await db.matches.get('full')).toBeUndefined();
    expect(await db.teamMemberships.where('teamId').equals('full-group').count()).toBe(0);
  });
  it('requires active participants and refuses built-in versions on the generic creation path', async () => {
    const { db } = await setup();
    await seedJournal(db);
    const input = {
      id: 'bad',
      versionId: 'petanque-free-individual-13-v1',
      mode: 'individual' as const,
      playerIds: ['alice', 'lucas'],
      teams: [],
      organizerPlayerId: 'alice',
      cooperativeName: 'Together',
      createdAt: timestamp,
    };
    await expect(new DeclarativeRepository(db).create(input)).rejects.toMatchObject({
      code: 'invalid_record',
    });
    expect(await db.matches.get('bad')).toBeUndefined();
    expect(await new LocalRepository(db).readMatch('match')).toBeDefined();
  });
});
