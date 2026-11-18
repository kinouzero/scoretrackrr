import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  createSixNimmtGame,
  sixNimmtVersion,
  SIX_NIMMT_ROUND_LIMIT,
} from '../../src/lib/domain/games/six-nimmt';
import { createGame } from '../../src/lib/domain/games/engine';
import { decodeGameTransfer, encodeGameTransfer } from '../../src/lib/domain/games/transfer';
import type { EngineState, ScoreCommand } from '../../src/lib/domain/engine/types';
import { LocalDatabase } from '../../src/lib/storage/database';
import { CatalogRepository } from '../../src/lib/storage/catalog';
import { DeclarativeRepository } from '../../src/lib/storage/declarative';
import { MatchJournal } from '../../src/lib/storage/journal';
import { BackupRepository } from '../../src/lib/storage/backup';
import { LocalStatistics } from '../../src/lib/domain/statistics';
import { seedJournal, timestamp } from '../fixtures/journal';
const config = { mode: 'individual' as const, ownerIds: ['alice', 'bob'] };
const game = createSixNimmtGame(sixNimmtVersion('').definition);
const score = (ownerId: string, points: number, round = 1): ScoreCommand => ({
  type: 'record',
  ownerId,
  values: { points, round },
});
function apply(state: EngineState, action: ScoreCommand, cfg = config) {
  return game.decide(state, action, cfg).reduce((s, e) => game.evolve(s, e, cfg), state);
}
describe('6 qui prend classic66', () => {
  it('waits for a complete round at66 and ranks the lowest penalty total first', () => {
    const initial = game.initialState(config);
    let state = apply(initial, score('alice', 66));
    expect(state.status).toBe('in_progress');
    expect(state.winnerIds).toEqual([]);
    state = apply(state, score('bob', 1));
    expect(state).toMatchObject({
      status: 'finished',
      winnerIds: ['bob'],
      totals: { alice: 66, bob: 1 },
    });
    expect(game.getView(state, config).ranking[0]).toMatchObject({
      ownerId: 'bob',
      rank: 1,
      total: 1,
    });
    expect(() => apply(state, score('bob', 0))).toThrow('finished');
    expect(initial).toEqual(game.initialState(config));
  });
  it('distinguishes zero from a missing entry and shares a tied lowest-score victory', () => {
    const cfg = { mode: 'individual' as const, ownerIds: ['alice', 'bob', 'cara'] };
    let state = game.initialState(cfg);
    state = apply(state, score('alice', 66), cfg);
    state = apply(state, score('bob', 0), cfg);
    expect(state.status).toBe('in_progress');
    expect(game.inspect(state, cfg).entries.cara).toBeNull();
    state = apply(state, score('cara', 0), cfg);
    expect(state.winnerIds).toEqual(['bob', 'cara']);
  });
  it('accumulates complete rounds and keeps partial next-round results below the finish boundary', () => {
    let state = apply(game.initialState(config), score('alice', 30));
    state = apply(state, score('bob', 10));
    state = apply(state, { type: 'record', ownerId: 'alice', values: { round: 1, nextRound: 1 } });
    expect(game.inspect(state, config)).toMatchObject({
      round: 2,
      entries: { alice: null, bob: null },
      totals: { alice: 30, bob: 10 },
    });
    state = apply(state, score('alice', 36, 2));
    expect(state.status).toBe('in_progress');
    state = apply(state, score('bob', 0, 2));
    expect(state).toMatchObject({
      status: 'finished',
      winnerIds: ['bob'],
      totals: { alice: 66, bob: 10 },
    });
  });
  it.each([-1, 172, 1.5, NaN, Infinity])('rejects impossible round penalty %s', (points) => {
    expect(() => apply(game.initialState(config), score('alice', points))).toThrow();
  });
  it('bounds the full round to the171 bullheads in the104-card deck', () => {
    const sum = Array.from({ length: 104 }, (_, i) => i + 1).reduce(
      (total, n) =>
        total + (n === 55 ? 7 : n % 11 === 0 ? 5 : n % 10 === 0 ? 3 : n % 5 === 0 ? 2 : 1),
      0,
    );
    expect(sum).toBe(SIX_NIMMT_ROUND_LIMIT);
    const state = apply(game.initialState(config), score('alice', 171));
    expect(() => apply(state, score('bob', 1))).toThrow('invalid_command');
    expect(apply(state, score('bob', 0)).winnerIds).toEqual(['bob']);
  });
  it('rejects duplicates, stale rounds, premature/wrong-actor advancement and extra inputs', () => {
    const initial = game.initialState(config);
    const partial = apply(initial, score('alice', 0));
    for (const action of [
      score('alice', 1),
      score('bob', 1, 2),
      { type: 'record', ownerId: 'alice', values: { round: 1, nextRound: 1 } },
      { type: 'record', ownerId: 'bob', values: { round: 1, points: 1, extra: 1 } },
    ] as ScoreCommand[])
      expect(() => apply(partial, action)).toThrow('invalid_command');
    const complete = apply(partial, score('bob', 1));
    expect(() =>
      apply(complete, { type: 'record', ownerId: 'bob', values: { round: 1, nextRound: 1 } }),
    ).toThrow('invalid_command');
  });
  it('validates rules, player bounds, serialized state and replayed deltas', () => {
    for (const cfg of [
      { ...config, mode: 'teams' },
      { ...config, ownerIds: ['a'] },
      { ...config, ownerIds: Array.from({ length: 11 }, (_, i) => `p${i}`) },
    ])
      expect(() => game.initialState(cfg as never)).toThrow('invalid_config');
    expect(() => createSixNimmtGame({ ...sixNimmtVersion('').definition, target: 100 })).toThrow(
      'invalid_rules',
    );
    const initial = game.initialState(config);
    expect(() => game.inspect({ ...initial, round: 0 } as never, config)).toThrow('invalid_state');
    expect(() =>
      game.inspect({ ...initial, totals: { alice: 1, bob: 0 } } as never, config),
    ).toThrow('invalid_state');
    expect(() =>
      game.inspect({ ...initial, entries: { alice: 172, bob: null } } as never, config),
    ).toThrow('invalid_state');
    const event = game.decide(initial, score('alice', 1), config)[0]!;
    expect(() => game.evolve(initial, { ...event, delta: 9 } as never, config)).toThrow(
      'invalid_event',
    );
    expect(createGame(sixNimmtVersion('')).id).toBe('6-qui-prend');
    expect(
      decodeGameTransfer(encodeGameTransfer(sixNimmtVersion(''), '6 qui prend !')).gameId,
    ).toBe('6-qui-prend');
  });
  it('reopens a winning round by correction, undoes its slot and restores the complete backup', async () => {
    const db = new LocalDatabase(crypto.randomUUID()),
      copy = new LocalDatabase(crypto.randomUUID());
    try {
      await seedJournal(db);
      await new CatalogRepository(db).initialize(timestamp);
      const match = await new DeclarativeRepository(db).create({
        id: 'six-match',
        versionId: sixNimmtVersion('').id,
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
      await submit(score('alice', 5));
      const winning = await submit(score('lucas', 66));
      expect(winning.projection.status).toBe('finished');
      const corrected = await submit({
        type: 'correct',
        targetEventId: winning.audit.at(-1)!.event.id,
        replacement: score('lucas', 65),
      });
      expect(corrected.projection.status).toBe('in_progress');
      await submit({ type: 'undo', targetEventId: corrected.audit.at(-1)!.event.id });
      expect(
        game.inspect((await journal.read(match.id)).state, {
          ...config,
          ownerIds: ['alice', 'lucas'],
        }).entries.lucas,
      ).toBeNull();
      await submit(score('lucas', 66));
      await new BackupRepository(copy).restore(await new BackupRepository(db).export(timestamp));
      expect((await new MatchJournal(copy).read(match.id)).projection.winnerIds).toEqual(['alice']);
      const stats = new LocalStatistics();
      stats.add(match, { alice: 5, lucas: 66 }, ['alice']);
      stats.add({ ...match, id: 'six-second-match' }, { alice: 2, lucas: 70 }, ['alice']);
      expect(stats.result().rows.find((row) => row.ownerId === 'alice')).toMatchObject({
        best: 2,
        played: 2,
        wins: 2,
      });
      expect(stats.result().rows.find((row) => row.ownerId === 'lucas')?.best).toBe(66);
      db.close();
      await db.open();
      expect((await new MatchJournal(db).read(match.id)).state.totals).toEqual({
        alice: 5,
        lucas: 66,
      });
    } finally {
      for (const database of [db, copy]) {
        database.close();
        await database.delete();
      }
    }
  });
});
