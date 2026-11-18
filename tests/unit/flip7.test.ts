import { BackupRepository } from '../../src/lib/storage/backup';
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createFlip7Game, flip7Version, flip7Score } from '../../src/lib/domain/games/flip7';
import type { EngineState, ScoreCommand } from '../../src/lib/domain/engine/types';
import { LocalDatabase } from '../../src/lib/storage/database';
import { CatalogRepository } from '../../src/lib/storage/catalog';
import { DeclarativeRepository } from '../../src/lib/storage/declarative';
import { MatchJournal } from '../../src/lib/storage/journal';
import { seedJournal, timestamp } from '../fixtures/journal';
const mask = (cards: number[]) => cards.reduce((mask, n) => mask | (1 << n), 0);
const config = { mode: 'individual' as const, ownerIds: ['alice', 'bob', 'cara'] };
const game = createFlip7Game(flip7Version('').definition);
function hand(
  ownerId: string,
  round: number,
  cards: number[],
  modifiers = 0,
  double = 0,
  bust = 0,
): ScoreCommand {
  return {
    type: 'record',
    ownerId,
    values: { round, cards: mask(cards), modifiers, double, bust },
  };
}
function apply(state: EngineState, action: ScoreCommand) {
  return game.decide(state, action, config).reduce((s, e) => game.evolve(s, e, config), state);
}
describe('Flip7 edition3.1 round scoring', () => {
  it('doubles only number cards then adds modifiers and the seven-card bonus', () => {
    expect(flip7Score({ cards: mask([11, 5, 12]), modifiers: 2, double: 1, bust: 0 })).toBe(60);
    expect(
      flip7Score({ cards: mask([6, 7, 8, 9, 10, 11, 12]), modifiers: 31, double: 1, bust: 0 }),
    ).toBe(171);
    expect(
      flip7Score({ cards: mask([0, 1, 2, 3, 4, 5, 6]), modifiers: 0, double: 0, bust: 0 }),
    ).toBe(36);
    expect(flip7Score({ cards: mask([1, 2, 3, 4, 5, 6]), modifiers: 1, double: 0, bust: 0 })).toBe(
      23,
    );
    expect(flip7Score({ cards: 0, modifiers: 16, double: 0, bust: 0 })).toBe(10);
    expect(flip7Score({ cards: mask([2, 12]), modifiers: 31, double: 1, bust: 1 })).toBe(0);
  });
  it('records a score-only bust without card details or invented modifiers', () => {
    expect(flip7Score({ cards: 0, modifiers: 0, double: 0, bust: 1 })).toBe(0);
    let state = apply(game.initialState(config), hand('alice', 1, [], 0, 0, 1));
    expect(game.inspect(state, config).hands.alice).toEqual({
      cards: 0,
      modifiers: 0,
      double: 0,
      bust: 1,
    });
    state = apply(state, hand('bob', 1, [0, 1, 2, 3, 4, 5, 6], 31, 1));
    expect(state.totals).toEqual({ alice: 0, bob: 87, cara: 0 });
  });
  it('rejects oversized hands, impossible bust declarations and invalid modifiers', () => {
    for (const data of [
      { cards: 255, modifiers: 0, double: 0, bust: 0 },
      { cards: 127, modifiers: 0, double: 0, bust: 1 },
      { cards: 0, modifiers: 1, double: 0, bust: 1 },
      { cards: 0, modifiers: 0, double: 1, bust: 1 },
      { cards: 2, modifiers: 0, double: 0, bust: 1 },
      { cards: 4, modifiers: 32, double: 0, bust: 0 },
      { cards: 4, modifiers: 0, double: 2, bust: 0 },
    ])
      expect(() => flip7Score(data)).toThrow('invalid_command');
  });
  it('checks unique modifiers and the single immediate Flip7 across all settled hands', () => {
    let state = apply(game.initialState(config), hand('alice', 1, [6, 7, 8, 9, 10, 11, 12], 31, 1));
    expect(() => apply(state, hand('bob', 1, [0, 1, 2, 3, 4, 5, 6]))).toThrow('invalid_command');
    expect(() => apply(state, hand('bob', 1, [12], 1))).toThrow('invalid_command');
    expect(() => apply(state, hand('bob', 1, [12], 0, 1))).toThrow('invalid_command');
    state = apply(state, hand('bob', 1, [12]));
    state = apply(state, hand('cara', 1, [2], 0, 0, 1));
    expect(state.status).toBe('in_progress');
    state = apply(state, { type: 'record', ownerId: 'alice', values: { round: 1, nextRound: 1 } });
    expect(game.inspect(state, config).round).toBe(2);
  });
  it('waits for all results before threshold victory and retains tied leaders for another round', () => {
    let state: EngineState = {
      ...game.initialState(config),
      totals: { alice: 29, bob: 186, cara: 0 },
    };
    state = apply(state, hand('alice', 1, [6, 7, 8, 9, 10, 11, 12], 31, 1));
    expect(state.status).toBe('in_progress');
    state = apply(state, hand('bob', 1, [2, 3, 4, 5]));
    state = apply(state, hand('cara', 1, []));
    expect(state.status).toBe('in_progress');
    expect(state.totals).toEqual({ alice: 200, bob: 200, cara: 0 });
    state = apply(state, { type: 'record', ownerId: 'alice', values: { round: 1, nextRound: 1 } });
    state = apply(state, hand('alice', 2, [12]));
    state = apply(state, hand('bob', 2, []));
    state = apply(state, hand('cara', 2, []));
    expect(state).toMatchObject({ status: 'finished', winnerIds: ['alice'] });
    expect(() => apply(state, hand('alice', 3, []))).toThrow('finished');
  });
  it('rejects duplicate/stale entries, wrong next-round owner, invalid config and forged deltas', () => {
    const initial = game.initialState(config);
    let state = apply(initial, hand('alice', 1, [12]));
    expect(() => apply(state, hand('alice', 1, []))).toThrow('invalid_command');
    expect(() => apply(state, hand('bob', 2, []))).toThrow('invalid_command');
    expect(() => game.validateConfig({ ...config, mode: 'teams' })).toThrow('invalid_config');
    expect(() => game.validateConfig({ ...config, ownerIds: ['a', 'b'] })).toThrow(
      'invalid_config',
    );
    const event = game.decide(initial, hand('alice', 1, [12]), config)[0]!;
    expect(() => game.evolve(initial, { ...event, delta: 0 } as never, config)).toThrow(
      'invalid_event',
    );
    expect(initial).toEqual(game.initialState(config));
    state = apply(state, hand('bob', 1, []));
    state = apply(state, hand('cara', 1, []));
    expect(() =>
      apply(state, { type: 'record', ownerId: 'bob', values: { round: 1, nextRound: 1 } }),
    ).toThrow('invalid_command');
  });
  it('pins its edition and recalculates totals after a persisted reversal', async () => {
    const db = new LocalDatabase(crypto.randomUUID());
    try {
      await seedJournal(db);
      await new CatalogRepository(db).initialize(timestamp);
      const match = await new DeclarativeRepository(db).create({
        id: 'flip-match',
        versionId: flip7Version('').id,
        mode: 'individual',
        playerIds: ['alice', 'lucas', 'emma'],
        teams: [],
        organizerPlayerId: 'alice',
        cooperativeName: '',
        createdAt: timestamp,
      });
      const journal = new MatchJournal(db);
      async function submit(
        action: ScoreCommand | { type: 'start' } | { type: 'undo'; targetEventId: string },
      ) {
        const before = await journal.read(match.id);
        return journal.submit({
          matchId: match.id,
          eventId: crypto.randomUUID(),
          commandId: crypto.randomUUID(),
          expectedVersion: before.projection.lastEventSequence,
          actorPlayerId: 'alice',
          deviceId: 'test-device',
          timestamp,
          action,
        });
      }
      await submit({ type: 'start' });
      const saved = await submit(hand('alice', 1, [11, 5, 12], 2, 1));
      expect(saved.state.totals.alice).toBe(60);
      await submit({ type: 'undo', targetEventId: saved.audit.at(-1)!.event.id });
      db.close();
      await db.open();
      expect((await journal.read(match.id)).state.totals.alice).toBe(0);
      await submit(hand('alice', 1, [], 0, 0, 1));
      db.close();
      await db.open();
      const replayed = await journal.read(match.id);
      expect(
        game.inspect(replayed.state, game.validateConfig(match.settingsSnapshot.engineConfig)).hands
          .alice,
      ).toEqual({ cards: 0, modifiers: 0, double: 0, bust: 1 });
      expect(await new BackupRepository(db).export(timestamp)).toContain('scoretrackrr-backup');
      expect(match.rulesSnapshot).toEqual(flip7Version(timestamp));
    } finally {
      db.close();
      await db.delete();
    }
  });
});
