import { describe, expect, it } from 'vitest';
import { x01VisitResult } from '../../src/lib/domain/games/visits';
import { createX01Game, x01Version } from '../../src/lib/domain/games/darts';
import type { EngineState } from '../../src/lib/domain/engine/types';
const config = { mode: 'individual' as const, ownerIds: ['alice', 'bob'] };
describe('X01 aggregate visit entry', () => {
  it('accepts exactly the physical board sums within the available dart budget', () => {
    const impacts = new Set([0, 25, 50]);
    for (let n = 1; n <= 20; n++) for (let m = 1; m <= 3; m++) impacts.add(n * m);
    let sums = new Set([0]);
    for (let darts = 1; darts <= 3; darts++) {
      sums = new Set([...sums].flatMap((sum) => [...impacts].map((points) => sum + points)));
      for (let total = 0; total <= 180; total++) {
        if (sums.has(total))
          expect(x01VisitResult(501, darts, false, total, 0)).toEqual({
            remaining: 501 - total,
            bust: false,
            finished: false,
          });
        else expect(() => x01VisitResult(501, darts, false, total, 0)).toThrow('invalid_command');
      }
    }
  });
  it('requires a physically reachable declared double checkout, including bull', () => {
    expect(x01VisitResult(170, 3, true, 170, 1)).toMatchObject({ finished: true, bust: false });
    expect(x01VisitResult(50, 1, true, 50, 1)).toMatchObject({ finished: true });
    expect(() => x01VisitResult(169, 3, true, 169, 1)).toThrow('invalid_command');
    expect(() => x01VisitResult(40, 1, true, 40, 0)).toThrow('invalid_command');
    expect(x01VisitResult(20, 1, true, 20, 0)).toMatchObject({ bust: true, finished: false });
    expect(x01VisitResult(20, 1, true, 20, 1)).toMatchObject({ finished: true, bust: false });
  });
  it('detects leaving one and overshoot while rejecting false checkout declarations', () => {
    expect(x01VisitResult(61, 1, true, 60, 0)).toMatchObject({ bust: true });
    expect(x01VisitResult(40, 1, true, 60, 0)).toMatchObject({ bust: true });
    expect(() => x01VisitResult(40, 1, true, 60, 1)).toThrow('invalid_command');
    expect(() => x01VisitResult(60, 1, false, 60, 1)).toThrow('invalid_command');
    expect(x01VisitResult(60, 1, false, 60, 0)).toMatchObject({ finished: true });
    // No route can reach80 from20 without having already busted on an earlier dart.
    expect(() => x01VisitResult(20, 3, true, 80, 0)).toThrow('invalid_command');
  });
  it('mixes individual impacts and a total for remaining darts and ends the visit once', () => {
    const game = createX01Game(x01Version(301, true, '').definition);
    let state = game.initialState(config);
    for (const values of [
      { sector: 20, multiplier: 3 },
      { total: 120, checkout: 0 },
    ] as Record<string, number>[]) {
      state = game
        .decide(state, { type: 'record', ownerId: 'alice', values }, config)
        .reduce((s, e) => game.evolve(s, e, config), state);
    }
    expect(game.inspect(state, config)).toMatchObject({
      turn: 1,
      dartsUsed: 0,
      totals: { alice: 121, bob: 301 },
    });
    expect(() =>
      game.decide(
        state,
        { type: 'record', ownerId: 'alice', values: { total: 0, checkout: 0 } },
        config,
      ),
    ).toThrow('invalid_command');
  });
  it('restores the entire starting score when a partial visit ends in an aggregate bust', () => {
    const game = createX01Game(x01Version(301, true, '').definition);
    let state: EngineState = {
      ...game.initialState(config),
      ...{ totals: { alice: 40, bob: 301 }, visitStart: 40 },
    };
    for (const values of [
      { sector: 10, multiplier: 1 },
      { total: 60, checkout: 0 },
    ] as Record<string, number>[])
      state = game
        .decide(state, { type: 'record', ownerId: 'alice', values }, config)
        .reduce((s, e) => game.evolve(s, e, config), state);
    expect(game.inspect(state, config)).toMatchObject({
      bust: true,
      turn: 1,
      dartsUsed: 0,
      totals: { alice: 40, bob: 301 },
    });
  });
  it.each([
    [-1, 0],
    [181, 0],
    [179, 0],
    [NaN, 0],
    [1.5, 0],
    [40, 2],
  ])('rejects malformed or impossible visit input %s/%s', (total, checkout) =>
    expect(() => x01VisitResult(301, 3, true, total, checkout)).toThrow('invalid_command'),
  );
});
