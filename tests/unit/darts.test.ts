import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createX01Game, dartScore, x01Version } from '../../src/lib/domain/games/darts';
import type { EngineState, ScoreCommand } from '../../src/lib/domain/engine/types';
import { LocalDatabase } from '../../src/lib/storage/database';
import { CatalogRepository } from '../../src/lib/storage/catalog';
import { DeclarativeRepository } from '../../src/lib/storage/declarative';
import { MatchJournal } from '../../src/lib/storage/journal';
import { seedJournal, timestamp } from '../fixtures/journal';
const config = { mode: 'individual' as const, ownerIds: ['alice', 'bob'] };
const dart = (ownerId: string, sector: number, multiplier = 1): ScoreCommand => ({
  type: 'record',
  ownerId,
  values: { sector, multiplier },
});
function setup(start: 301 | 501 = 301, doubleOut = true) {
  return createX01Game(x01Version(start, doubleOut, '').definition);
}
function apply(game: ReturnType<typeof setup>, state: EngineState, action: ScoreCommand) {
  return game.decide(state, action, config).reduce((s, e) => game.evolve(s, e, config), state);
}
function missVisit(game: ReturnType<typeof setup>, state: EngineState) {
  for (let i = 0; i < 3; i++) state = apply(game, state, dart('bob', 0));
  return state;
}
function aliceTo40(game: ReturnType<typeof setup>) {
  let state = game.initialState(config);
  for (const [i, [sector, multiplier]] of [
    [20, 3],
    [20, 3],
    [20, 3],
    [20, 3],
    [20, 1],
    [1, 1],
  ].entries()) {
    state = apply(game, state, dart('alice', sector!, multiplier));
    if (i === 2) state = missVisit(game, state);
  }
  return missVisit(game, state);
}
describe('X01 sector scoring and visit rules', () => {
  it.each([
    [0, 1, 0],
    [20, 3, 60],
    [25, 1, 25],
    [25, 2, 50],
    [1, 2, 2],
  ])('scores sector %i multiplier %i as %i', (sector, multiplier, score) =>
    expect(dartScore(sector, multiplier)).toBe(score),
  );
  it.each([
    [25, 3],
    [0, 2],
    [21, 1],
    [-1, 1],
    [20, 4],
    [1.5, 1],
  ])('rejects impossible board input %i/%i', (sector, multiplier) =>
    expect(() => dartScore(sector, multiplier)).toThrow('invalid_command'),
  );
  it('rotates only after three darts, rejects wrong owners and counts misses', () => {
    const game = setup();
    let state = game.initialState(config);
    expect(() => apply(game, state, dart('bob', 20))).toThrow('invalid_command');
    state = apply(game, state, dart('alice', 20, 3));
    state = apply(game, state, dart('alice', 0));
    expect(game.inspect(state, config)).toMatchObject({
      turn: 0,
      dartsUsed: 2,
      visitStart: 301,
      totals: { alice: 241, bob: 301 },
    });
    state = apply(game, state, dart('alice', 20));
    expect(game.inspect(state, config)).toMatchObject({ turn: 1, dartsUsed: 0, visitStart: 301 });
  });
  it('restores the complete visit after overshoot or a non-double zero', () => {
    const game = setup();
    const initial = aliceTo40(game);
    for (const multiplier of [1, 3]) {
      let state = apply(game, initial, dart('alice', 20));
      state = apply(game, state, dart('alice', 20, multiplier));
      expect(game.inspect(state, config)).toMatchObject({
        turn: 1,
        dartsUsed: 0,
        bust: true,
        totals: { alice: 40, bob: 301 },
      });
    }
    const won = apply(game, initial, dart('alice', 20, 2));
    expect(won).toMatchObject({ status: 'finished', winnerIds: ['alice'] });
    expect(() => apply(game, won, dart('alice', 0))).toThrow('finished');
  });
  it('busts immediately on one remaining and accepts double bull checkout', () => {
    const game = setup();
    let state = game.initialState(config);
    for (let i = 0; i < 3; i++) state = apply(game, state, dart('alice', 20, 3));
    state = missVisit(game, state);
    const branch = state;
    state = apply(game, state, dart('alice', 20, 3));
    state = apply(game, state, dart('alice', 20, 3));
    expect(game.inspect(state, config)).toMatchObject({
      bust: true,
      turn: 1,
      totals: { alice: 121, bob: 301 },
    });
    state = apply(game, branch, dart('alice', 17, 3));
    state = apply(game, state, dart('alice', 20));
    state = apply(game, state, dart('alice', 25, 2));
    expect(state).toMatchObject({
      status: 'finished',
      winnerIds: ['alice'],
      totals: { alice: 0, bob: 301 },
    });
  });
  it.each([
    [301, false],
    [301, true],
    [501, false],
    [501, true],
  ] as const)('completes %i checkout double=%s with physical impacts', (start, doubleOut) => {
    const game = setup(start, doubleOut);
    let state = game.initialState(config);
    for (let i = 0; i < 100 && state.status !== 'finished'; i++) {
      const position = game.inspect(state, config);
      const id = config.ownerIds[position.turn]!;
      const left = state.totals[id]!;
      const sector =
        id === 'bob'
          ? 0
          : left > 100
            ? 20
            : left > 50
              ? 20
              : left % 2
                ? 1
                : left === 50
                  ? 25
                  : left / 2;
      const multiplier = id === 'bob' ? 1 : left > 100 ? 3 : left > 50 || left % 2 ? 1 : 2;
      state = apply(game, state, dart(id, sector, multiplier));
    }
    expect(state).toMatchObject({ status: 'finished', winnerIds: ['alice'] });
  });
  it('rejects forged events/state/rules and preserves immutable inputs', () => {
    const game = setup();
    const state = game.initialState(config);
    const event = game.decide(state, dart('alice', 20), config)[0]!;
    expect(() => game.evolve(state, { ...event, delta: 999 } as never, config)).toThrow(
      'invalid_event',
    );
    expect(() => game.inspect({ ...state, visitStart: 20 } as never, config)).toThrow(
      'invalid_state',
    );
    expect(() => createX01Game({ ...x01Version(301, true, '').definition, start: 999 })).toThrow(
      'invalid_rules',
    );
    expect(state).toEqual(game.initialState(config));
  });
  it('replays a corrected impact and confirmed undo from pinned local records', async () => {
    const db = new LocalDatabase(crypto.randomUUID());
    try {
      await seedJournal(db);
      await new CatalogRepository(db).initialize(timestamp);
      const match = await new DeclarativeRepository(db).create({
        id: 'darts-match',
        versionId: x01Version(301, true, '').id,
        mode: 'individual',
        playerIds: ['alice', 'lucas'],
        teams: [],
        organizerPlayerId: 'alice',
        cooperativeName: '',
        createdAt: timestamp,
      });
      const journal = new MatchJournal(db);
      async function submit(action: Record<string, unknown>) {
        const previous = await journal.read(match.id);
        return journal.submit({
          matchId: match.id,
          eventId: crypto.randomUUID(),
          commandId: crypto.randomUUID(),
          expectedVersion: previous.projection.lastEventSequence,
          actorPlayerId: 'alice',
          deviceId: 'test-device',
          timestamp,
          action: action as never,
        });
      }
      await submit({ type: 'start' });
      const first = await submit(dart('alice', 20, 3));
      const corrected = await submit({
        type: 'correct',
        targetEventId: first.audit.at(-1)!.event.id,
        replacement: dart('alice', 25, 2),
      });
      expect(corrected.state.totals.alice).toBe(251);
      await submit({ type: 'undo', targetEventId: corrected.audit.at(-1)!.event.id });
      db.close();
      await db.open();
      expect((await journal.read(match.id)).state.totals.alice).toBe(301);
      const aggregate = await submit({
        type: 'record',
        ownerId: 'alice',
        values: { total: 180, checkout: 0 },
      });
      expect(aggregate.state.totals.alice).toBe(121);
      const revised = await submit({
        type: 'correct',
        targetEventId: aggregate.audit.at(-1)!.event.id,
        replacement: { type: 'record', ownerId: 'alice', values: { total: 120, checkout: 0 } },
      });
      expect(revised.state.totals.alice).toBe(181);
      await submit({ type: 'undo', targetEventId: revised.audit.at(-1)!.event.id });
      db.close();
      await db.open();
      expect((await journal.read(match.id)).state.totals.alice).toBe(301);
      expect(match.rulesSnapshot).toEqual(x01Version(301, true, timestamp));
    } finally {
      db.close();
      await db.delete();
    }
  });
});
