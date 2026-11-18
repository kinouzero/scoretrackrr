import 'fake-indexeddb/auto';
import { initialX01Start } from '../../src/lib/application/game-settings';
import { afterEach, expect, it } from 'vitest';
import { moveParticipant, shuffleParticipants } from '../../src/lib/application/participant-order';
import {
  readPreference,
  writePreference,
  isDraftValue,
} from '../../src/lib/application/local-preferences';
import { isSetupPresets } from '../../src/lib/application/setup-presets';
import { presetParticipants } from '../../src/lib/storage/preset-participants';
import { previewScore, createScorePreview } from '../../src/lib/application/score-preview';
import { createGame } from '../../src/lib/domain/games/engine';
import { x01Version } from '../../src/lib/domain/games/darts';
import { molkkyVersion } from '../../src/lib/domain/games/molkky';
import { CatalogRepository } from '../../src/lib/storage/catalog';
import { DeclarativeRepository } from '../../src/lib/storage/declarative';
import { LocalDatabase, seedJournal, timestamp } from '../fixtures/journal';
const databases: LocalDatabase[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) {
    db.close();
    await db.delete();
  }
});
it('moves participants without mutating the source and guards boundaries', () => {
  const items = ['a', 'b', 'c'];
  expect(moveParticipant(items, 1, -1)).toEqual(['b', 'a', 'c']);
  expect(moveParticipant(items, 1, 1)).toEqual(['a', 'c', 'b']);
  expect(moveParticipant(items, 0, -1)).toEqual(items);
  expect(moveParticipant(items, -1, 1)).toEqual(items);
  expect(items).toEqual(['a', 'b', 'c']);
});
it('shuffles every participant exactly once with injectable randomness', () => {
  expect(shuffleParticipants(['a', 'b', 'c'], () => 0)).toEqual(['b', 'c', 'a']);
  expect(shuffleParticipants([], () => 0)).toEqual([]);
  expect(() => shuffleParticipants(['a', 'b'], () => 1)).toThrow();
});
it('rejects malformed, oversized, duplicate and unsafe setup preferences', () => {
  const good = {
    id: 'a',
    gameId: 'darts',
    name: '501 evening',
    options: { playerIds: ['alice'], x01Start: 501 },
  };
  expect(isSetupPresets([good])).toBe(true);
  expect(isSetupPresets([good, good])).toBe(false);
  expect(isSetupPresets([{ ...good, name: ' ' }])).toBe(false);
  expect(isSetupPresets([{ ...good, options: { x: Infinity } }])).toBe(false);
  expect(isDraftValue(JSON.parse('{"__proto__":1}'))).toBe(false);
});
it('handles unavailable or corrupted optional storage without throwing', () => {
  const storage = {
    getItem: () => '{bad',
    setItem: () => {
      throw new Error('quota');
    },
    removeItem: () => undefined,
  };
  expect(readPreference('x', isSetupPresets, storage)).toBeUndefined();
  expect(writePreference('x', [], storage)).toBe(false);
  expect(writePreference('x', 'a'.repeat(100001), storage)).toBe(false);
});
async function setup() {
  const db = new LocalDatabase(crypto.randomUUID());
  databases.push(db);
  await seedJournal(db);
  await new CatalogRepository(db).initialize(timestamp);
  return db;
}
it('hydrates current ordered participants and rejects deleted references', async () => {
  const db = await setup();
  expect(
    (await presetParticipants(db, ['lucas', 'alice'], [])).players.map((player) => player.id),
  ).toEqual(['lucas', 'alice']);
  await db.players.update('lucas', { deletedAt: timestamp });
  await expect(presetParticipants(db, ['lucas', 'alice'], [])).rejects.toThrow();
  await expect(presetParticipants(db, ['alice', 'alice'], [])).rejects.toThrow();
  await expect(presetParticipants(db, [], ['missing'])).rejects.toThrow();
});
it.each([x01Version(101, true, ''), molkkyVersion('')])(
  'previews frozen $gameId rules without changing state or writing events',
  async (version) => {
    const db = await setup();
    const match = await new DeclarativeRepository(db).create({
      id: 'preview',
      versionId: version.gameId === 'darts' ? x01Version(301, true, '').id : version.id,
      mode: 'individual',
      playerIds: ['alice', 'lucas'],
      teams: [],
      organizerPlayerId: 'alice',
      cooperativeName: '',
      createdAt: timestamp,
      ...(version.gameId === 'darts' ? { x01Start: 101 } : {}),
    });
    const game = createGame(match.rulesSnapshot),
      config = game.validateConfig(match.settingsSnapshot.engineConfig),
      state = game.initialState(config);
    const before = JSON.stringify(state);
    const result = previewScore(match, state, {
      type: 'record',
      ownerId: 'alice',
      values: version.gameId === 'darts' ? { sector: 20, multiplier: 3 } : { points: 12, turn: 0 },
    });
    expect(result.changes[0]).toMatchObject({
      id: 'alice',
      after: version.gameId === 'darts' ? 41 : 12,
    });
    expect(JSON.stringify(state)).toBe(before);
    expect(await db.scoreEvents.count()).toBe(0);
    expect(() =>
      previewScore(match, state, { type: 'record', ownerId: 'missing', values: { points: 999 } }),
    ).toThrow();
  },
);
it('previews X01 bust restoration and winning checkout correctly', async () => {
  const db = await setup();
  const match = await new DeclarativeRepository(db).create({
    id: 'bust',
    versionId: x01Version(301, true, '').id,
    mode: 'individual',
    playerIds: ['alice', 'lucas'],
    teams: [],
    organizerPlayerId: 'alice',
    cooperativeName: '',
    createdAt: timestamp,
    x01Start: 101,
  });
  const game = createGame(match.rulesSnapshot),
    config = game.validateConfig(match.settingsSnapshot.engineConfig);
  let state = game.initialState(config);
  for (const event of game.decide(
    state,
    { type: 'record', ownerId: 'alice', values: { sector: 20, multiplier: 3 } },
    config,
  ))
    state = game.evolve(state, event, config);
  expect(
    previewScore(match, state, {
      type: 'record',
      ownerId: 'alice',
      values: { sector: 20, multiplier: 3 },
    }),
  ).toMatchObject({ bust: true, changes: [{ id: 'alice', before: 41, after: 101 }] });
  expect(
    previewScore(match, state, {
      type: 'record',
      ownerId: 'alice',
      values: { sector: 1, multiplier: 1 },
    }).changes[0]?.after,
  ).toBe(40);
});
it('hydrates team order from current memberships and refuses deleted members', async () => {
  const db = await setup();
  const restored = await presetParticipants(db, [], ['red', 'blue']);
  expect(restored.rosters.map((roster) => roster.team.id)).toEqual(['red', 'blue']);
  expect(restored.rosters[0]?.members.map((player) => player.id)).toEqual(['emma', 'hugo']);
  await db.players.update('hugo', { deletedAt: timestamp });
  await expect(presetParticipants(db, [], ['red'])).rejects.toThrow();
});

it('opens legacy custom X01 rules with a valid fixed setup choice without changing saved rules', () => {
  expect(initialX01Start(350)).toBe(301);
  expect(initialX01Start(undefined)).toBe(301);
  expect(initialX01Start(601)).toBe(601);
});

it('reuses preview context with fresh states and retains command validation', async () => {
  const db = await setup();
  const match = await new DeclarativeRepository(db).create({
    id: 'reused-preview',
    versionId: x01Version(301, true, '').id,
    mode: 'individual',
    playerIds: ['alice', 'lucas'],
    teams: [],
    organizerPlayerId: 'alice',
    cooperativeName: '',
    createdAt: timestamp,
  });
  const game = createGame(match.rulesSnapshot),
    config = game.validateConfig(match.settingsSnapshot.engineConfig),
    evaluate = createScorePreview(match);
  let state = game.initialState(config);
  for (let index = 0; index < 4; index++) {
    const command = {
      type: 'record' as const,
      ownerId: index < 3 ? 'alice' : 'lucas',
      values: { sector: 20, multiplier: 1 },
    };
    const before = JSON.stringify(state);
    expect(evaluate(state, command)).toEqual(previewScore(match, state, command));
    expect(JSON.stringify(state)).toBe(before);
    for (const event of game.decide(state, command, config))
      state = game.evolve(state, event, config);
  }
  expect(() =>
    evaluate(state, { type: 'record', ownerId: 'missing', values: { sector: 20, multiplier: 1 } }),
  ).toThrow();
  expect(await db.scoreEvents.count()).toBe(0);
});
it('creates independent preview contexts for different frozen settings', async () => {
  const db = await setup();
  for (const start of [301, 601]) {
    const match = await new DeclarativeRepository(db).create({
      id: `preview-${start}`,
      versionId: x01Version(301, true, '').id,
      mode: 'individual',
      playerIds: ['alice', 'lucas'],
      teams: [],
      organizerPlayerId: 'alice',
      cooperativeName: '',
      createdAt: timestamp,
      x01Start: start,
    });
    const game = createGame(match.rulesSnapshot),
      config = game.validateConfig(match.settingsSnapshot.engineConfig);
    expect(
      createScorePreview(match)(game.initialState(config), {
        type: 'record',
        ownerId: 'alice',
        values: { sector: 20, multiplier: 1 },
      }).changes[0],
    ).toMatchObject({ before: start, after: start - 20 });
  }
});
