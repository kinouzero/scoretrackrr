import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  createMolkkyGame,
  molkkyVersion,
  type MolkkyState,
} from '../../src/lib/domain/games/molkky';
import { createGame } from '../../src/lib/domain/games/engine';
import { decodeGameTransfer, encodeGameTransfer } from '../../src/lib/domain/games/transfer';
import type { EngineState, ScoreCommand } from '../../src/lib/domain/engine/types';
import { LocalDatabase } from '../../src/lib/storage/database';
import { CatalogRepository } from '../../src/lib/storage/catalog';
import { DeclarativeRepository } from '../../src/lib/storage/declarative';
import { BackupRepository } from '../../src/lib/storage/backup';
import { MatchJournal } from '../../src/lib/storage/journal';
import { seedJournal, timestamp } from '../fixtures/journal';

const config = { mode: 'individual' as const, ownerIds: ['alice', 'bob'] };
const game = createMolkkyGame(molkkyVersion('').definition);
function shot(
  state: EngineState,
  points: number,
  ownerId = config.ownerIds[game.inspect(state, config).turn]!,
): ScoreCommand {
  return { type: 'record', ownerId, values: { points, turn: state.eventCount } };
}
function apply(state: EngineState, points: number) {
  return game
    .decide(state, shot(state, points), config)
    .reduce((s, event) => game.evolve(s, event, config), state);
}
describe('Mölkky classic50', () => {
  it('shares misses and elimination per team while retaining the earlier individual definition', () => {
    const cfg = { mode: 'teams' as const, ownerIds: ['blue', 'red'] };
    let state = game.initialState(cfg);
    for (const points of [0, 12, 0, 12, 0]) {
      const ownerId = cfg.ownerIds[game.inspect(state, cfg).turn]!;
      const action: ScoreCommand = {
        type: 'record',
        ownerId,
        values: { points, turn: state.eventCount },
      };
      state = game
        .decide(state, action, cfg)
        .reduce((s, event) => game.evolve(s, event, cfg), state);
    }
    expect(state).toMatchObject({
      status: 'finished',
      winnerIds: ['red'],
      totals: { blue: 0, red: 24 },
      misses: { blue: 3, red: 0 },
    });
    const earlier = molkkyVersion('', false);
    expect(createMolkkyGame(earlier.definition).initialState(config).totals).toEqual({
      alice: 0,
      bob: 0,
    });
    expect(() => createMolkkyGame(earlier.definition).validateConfig(cfg)).toThrow(
      'invalid_config',
    );
    expect(decodeGameTransfer(encodeGameTransfer(earlier, 'Mölkky')).rulesetVersion).toBe(
      'classic-50-v1',
    );
  });
  it('scores a full exact50 game in order without mutating prior state', () => {
    const initial = game.initialState(config);
    let state = initial;
    for (let i = 0; i < 4; i++) {
      state = apply(state, 12);
      state = apply(state, 1);
    }
    expect(state.totals).toEqual({ alice: 48, bob: 4 });
    state = apply(state, 2);
    expect(state).toMatchObject({
      status: 'finished',
      winnerIds: ['alice'],
      totals: { alice: 50, bob: 4 },
    });
    expect(() => apply(state, 1)).toThrow('finished');
    expect(initial).toEqual(game.initialState(config));
  });
  it('resets an overshoot to25, records a negative delta and resets misses after success', () => {
    let state: MolkkyState = {
      ...game.inspect(game.initialState(config), config),
      totals: { alice: 48, bob: 1 },
      misses: { alice: 2, bob: 0 },
    };
    const event = game.decide(state, shot(state, 3), config)[0]!;
    if (event.type !== 'score_recorded') throw new Error('Expected scoring event');
    expect(event.delta).toBe(-23);
    state = game.inspect(game.evolve(state, event, config), config);
    expect(state.totals.alice).toBe(25);
    expect(game.inspect(state, config).misses.alice).toBe(0);
  });
  it('skips eliminated players after three consecutive misses and continues with the remaining players', () => {
    const cfg = { mode: 'individual' as const, ownerIds: ['a', 'b', 'c'] };
    let state = game.initialState(cfg);
    for (const points of [0, 1, 1, 0, 1, 1, 0]) {
      const action: ScoreCommand = {
        type: 'record',
        ownerId: cfg.ownerIds[game.inspect(state, cfg).turn]!,
        values: { points, turn: state.eventCount },
      };
      state = game.decide(state, action, cfg).reduce((s, e) => game.evolve(s, e, cfg), state);
    }
    expect(state).toMatchObject({ status: 'in_progress', misses: { a: 3, b: 0, c: 0 }, turn: 1 });
    for (const id of ['b', 'c']) {
      const action: ScoreCommand = {
        type: 'record',
        ownerId: id,
        values: { points: 1, turn: state.eventCount },
      };
      state = game.decide(state, action, cfg).reduce((s, e) => game.evolve(s, e, cfg), state);
    }
    expect(game.inspect(state, cfg).turn).toBe(1);
    expect(game.getView(state, cfg).ranking.at(-1)?.ownerId).toBe('a');
  });
  it('awards the last remaining player victory even when all retained scores are zero', () => {
    let state = game.initialState(config);
    for (const points of [0, 0, 0, 0, 0]) state = apply(state, points);
    expect(state).toMatchObject({
      status: 'finished',
      winnerIds: ['bob'],
      misses: { alice: 3, bob: 2 },
      totals: { alice: 0, bob: 0 },
    });
    expect(game.getView(state, config).ranking).toEqual([
      { ownerId: 'bob', total: 0, rank: 1 },
      { ownerId: 'alice', total: 0, rank: 2 },
    ]);
  });
  it.each([-1, 13, 1.5, NaN, Infinity])('rejects impossible points %s', (points) => {
    const state = game.initialState(config);
    expect(() => game.decide(state, shot(state, points), config)).toThrow();
  });
  it('rejects wrong actors, stale throws, extra fields, altered rules/config/state and forged deltas', () => {
    const state = game.initialState(config);
    for (const action of [
      shot(state, 1, 'bob'),
      { ...shot(state, 1), values: { points: 1, turn: 1 } },
      { ...shot(state, 1), values: { points: 1, turn: 0, extra: 1 } },
    ])
      expect(() => game.decide(state, action, config)).toThrow('invalid_command');
    for (const cfg of [
      { ...config, mode: 'cooperative' },
      { ...config, ownerIds: ['a'] },
      { ...config, ownerIds: ['a', 'a'] },
    ])
      expect(() => game.initialState(cfg as never)).toThrow();
    expect(() => createMolkkyGame({ ...molkkyVersion('').definition, target: 25 })).toThrow(
      'invalid_rules',
    );
    expect(() => game.inspect({ ...state, turn: 2 } as never, config)).toThrow('invalid_state');
    expect(() => game.inspect({ ...state, misses: { alice: 3, bob: 0 } } as never, config)).toThrow(
      'invalid_state',
    );
    const event = game.decide(state, shot(state, 1), config)[0]!;
    expect(() => game.evolve(state, { ...event, delta: 9 } as never, config)).toThrow(
      'invalid_event',
    );
    expect(createGame(molkkyVersion('')).id).toBe('molkky');
    expect(decodeGameTransfer(encodeGameTransfer(molkkyVersion(''), 'Mölkky')).gameId).toBe(
      'molkky',
    );
  });
  it('persists corrections and undo after reopen using the shared journal', async () => {
    const db = new LocalDatabase(crypto.randomUUID());
    try {
      await seedJournal(db);
      const earlier = molkkyVersion(timestamp, false);
      await db.gameVersions.add(earlier);
      await new CatalogRepository(db).initialize(timestamp);
      expect(await db.gameVersions.get(earlier.id)).toEqual(earlier);
      const match = await new DeclarativeRepository(db).create({
        id: 'molkky-match',
        versionId: molkkyVersion('').id,
        mode: 'individual',
        playerIds: ['alice', 'lucas'],
        teams: [],
        organizerPlayerId: 'alice',
        cooperativeName: '',
        createdAt: timestamp,
      });
      const journal = new MatchJournal(db);
      async function submit(action: Record<string, unknown>) {
        const view = await journal.read(match.id);
        return journal.submit({
          matchId: match.id,
          eventId: crypto.randomUUID(),
          commandId: crypto.randomUUID(),
          expectedVersion: view.projection.lastEventSequence,
          actorPlayerId: 'alice',
          deviceId: 'test-device',
          timestamp,
          action: action as never,
        });
      }
      await submit({ type: 'start' });
      const entry = await submit({
        type: 'record',
        ownerId: 'alice',
        values: { points: 12, turn: 0 },
      });
      const correction = await submit({
        type: 'correct',
        targetEventId: entry.audit.at(-1)!.event.id,
        replacement: { type: 'record', ownerId: 'alice', values: { points: 0, turn: 0 } },
      });
      expect((await journal.read(match.id)).state.totals.alice).toBe(0);
      await submit({ type: 'undo', targetEventId: correction.audit.at(-1)!.event.id });
      expect((await journal.read(match.id)).state.eventCount).toBe(0);
      await submit({ type: 'record', ownerId: 'alice', values: { points: 12, turn: 0 } });
      const copy = new LocalDatabase(crypto.randomUUID());
      try {
        await new BackupRepository(copy).restore(await new BackupRepository(db).export(timestamp));
        expect((await new MatchJournal(copy).read(match.id)).state.totals.alice).toBe(12);
      } finally {
        copy.close();
        await copy.delete();
      }
      db.close();
      await db.open();
      expect((await new MatchJournal(db).read(match.id)).state.totals.alice).toBe(12);
      expect(match.rulesSnapshot).toEqual(molkkyVersion(timestamp));
    } finally {
      db.close();
      await db.delete();
    }
  });
});
