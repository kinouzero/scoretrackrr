import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  createSkullKingGame,
  skullKingVersion,
  skullCards,
  skullScore,
} from '../../src/lib/domain/games/skull-king';
import type { EngineState, ScoreCommand } from '../../src/lib/domain/engine/types';
import { LocalDatabase } from '../../src/lib/storage/database';
import { CatalogRepository } from '../../src/lib/storage/catalog';
import { DeclarativeRepository } from '../../src/lib/storage/declarative';
import { MatchJournal } from '../../src/lib/storage/journal';
import { seedJournal, timestamp } from '../fixtures/journal';
const config = { mode: 'individual' as const, ownerIds: ['alice', 'bob', 'cara'] };
const game = createSkullKingGame(skullKingVersion('').definition);
const bid = (ownerId: string, round: number, value: number): ScoreCommand => ({
  type: 'record',
  ownerId,
  values: { round, kind: 0, bid: value },
});
const result = (
  ownerId: string,
  round: number,
  won: number,
  bonus: Record<string, number> = {},
): ScoreCommand => ({
  type: 'record',
  ownerId,
  values: { round, kind: 1, won, c14: 0, b14: 0, mermaids: 0, pirates: 0, king: 0, ...bonus },
});
function apply(state: EngineState, action: ScoreCommand) {
  return game.decide(state, action, config).reduce((s, e) => game.evolve(s, e, config), state);
}
function round(state: EngineState, number: number, wins = [number, 0, 0], bids = [number, 0, 0]) {
  for (let i = 0; i < 3; i++) state = apply(state, bid(config.ownerIds[i]!, number, bids[i]!));
  for (let i = 0; i < 3; i++) state = apply(state, result(config.ownerIds[i]!, number, wins[i]!));
  return state;
}
describe('Skull King classic 2021', () => {
  it.each([
    [3, 3, 3, 40, 100],
    [3, 3, 2, 40, -10],
    [7, 0, 0, 0, 70],
    [7, 0, 2, 99, -70],
    [5, 2, 4, 0, -20],
  ])('scores cards%s bid%s won%s bonus%s as%s', (cards, bid, won, bonus, expected) =>
    expect(skullScore(cards, bid, won, bonus)).toBe(expected),
  );
  it('limits eight-player hands to eight cards and validates the supported roster', () => {
    expect(skullCards(10, 8)).toBe(8);
    expect(skullCards(11, 8)).toBe(8);
    expect(skullCards(11, 7)).toBe(10);
    expect(() => game.validateConfig({ mode: 'individual', ownerIds: ['alice', 'bob'] })).toThrow(
      'invalid_config',
    );
    expect(() => game.validateConfig({ ...config, mode: 'teams' })).toThrow('invalid_config');
  });
  it('records all bids before results, rejects duplicate/stale entries and preserves token-free state', () => {
    let state = game.initialState(config);
    expect(() => apply(state, result('alice', 1, 1))).toThrow('invalid_command');
    state = apply(state, bid('alice', 1, 1));
    expect(() => apply(state, bid('alice', 1, 0))).toThrow('invalid_command');
    expect(() => apply(state, bid('bob', 2, 1))).toThrow('invalid_command');
    expect(state.totals.alice).toBe(0);
  });
  it('calculates captured-card bonuses only for an exact bid and checks global captures/trick counts', () => {
    let state = game.initialState(config);
    state = apply(state, bid('alice', 1, 1));
    state = apply(state, bid('bob', 1, 0));
    state = apply(state, bid('cara', 1, 0));
    state = apply(state, result('alice', 1, 1, { c14: 1, pirates: 1 }));
    expect(state.totals.alice).toBe(60);
    expect(() => apply(state, result('bob', 1, 1))).toThrow('invalid_command');
    expect(() => apply(state, result('bob', 1, 0, { king: 1 }))).toThrow('invalid_command');
    state = apply(state, result('bob', 1, 0));
    state = apply(state, result('cara', 1, 0));
    expect(state.totals).toEqual({ alice: 60, bob: 10, cara: 10 });
  });
  it('finishes after ten rounds with a unique highest score', () => {
    let state = game.initialState(config);
    for (let n = 1; n <= 10; n++) {
      state = round(state, n);
      if (n < 10)
        state = apply(state, {
          type: 'record',
          ownerId: 'alice',
          values: { round: n, nextRound: 1 },
        });
    }
    expect(state).toMatchObject({
      status: 'finished',
      winnerIds: ['alice'],
      totals: { alice: 1100, bob: 550, cara: 550 },
    });
    expect(() => apply(state, bid('alice', 11, 1))).toThrow('finished');
  });
  it('continues a tied tenth round with a ten-card overtime until one winner remains', () => {
    let state = game.initialState(config);
    for (let n = 1; n <= 9; n++) {
      state = round(state, n);
      state = apply(state, {
        type: 'record',
        ownerId: 'alice',
        values: { round: n, nextRound: 1 },
      });
    }
    // Reach a valid tied pre-round projection, then use real inputs for the tie/extra round.
    state = { ...state, totals: { alice: 0, bob: 200, cara: -100 } };
    state = round(state, 10, [0, 10, 0], [0, 0, 0]);
    expect(state.status).toBe('in_progress');
    expect(state.totals).toEqual({ alice: 100, bob: 100, cara: 0 });
    state = apply(state, { type: 'record', ownerId: 'alice', values: { round: 10, nextRound: 1 } });
    state = round(state, 11, [10, 0, 0], [10, 0, 0]);
    expect(state).toMatchObject({ status: 'finished', winnerIds: ['alice'] });
  });
  it('rejects forged definitions, deltas and partial round totals without changing inputs', () => {
    const state = game.initialState(config);
    const event = game.decide(state, bid('alice', 1, 1), config)[0]!;
    expect(() => game.evolve(state, { ...event, delta: 1 } as never, config)).toThrow(
      'invalid_event',
    );
    expect(() => createSkullKingGame({ ...skullKingVersion('').definition, code: 'run' })).toThrow(
      'invalid_rules',
    );
    let next = apply(state, bid('alice', 1, 0));
    next = apply(next, bid('bob', 1, 0));
    next = apply(next, bid('cara', 1, 0));
    next = apply(next, result('alice', 1, 0));
    next = apply(next, result('bob', 1, 0));
    expect(() => apply(next, result('cara', 1, 0))).toThrow('invalid_command');
    expect(state).toEqual(game.initialState(config));
  });
  it('pins the edition and replays an undone result after reopening IndexedDB', async () => {
    const db = new LocalDatabase(crypto.randomUUID());
    try {
      await seedJournal(db);
      await new CatalogRepository(db).initialize(timestamp);
      const match = await new DeclarativeRepository(db).create({
        id: 'skull-match',
        versionId: skullKingVersion('').id,
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
      for (const id of ['alice', 'lucas', 'emma']) await submit(bid(id, 1, id === 'alice' ? 1 : 0));
      const saved = await submit(result('alice', 1, 1, { c14: 1 }));
      expect(saved.state.totals.alice).toBe(30);
      await submit({ type: 'undo', targetEventId: saved.audit.at(-1)!.event.id });
      db.close();
      await db.open();
      expect((await journal.read(match.id)).state.totals.alice).toBe(0);
      expect(match.rulesSnapshot).toEqual(skullKingVersion(timestamp));
    } finally {
      db.close();
      await db.delete();
    }
  });
});
