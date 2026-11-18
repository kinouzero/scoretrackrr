import type { EngineState } from '../../src/lib/domain/engine/types';
import { describe, expect, it } from 'vitest';
import { x01Checkouts, type CheckoutDart } from '../../src/lib/domain/games/checkouts';
import { createX01Game, dartScore, x01Version } from '../../src/lib/domain/games/darts';
const compact = (route: readonly CheckoutDart[]) =>
  route.map((d) => `${d.sector}x${d.multiplier}`).join(',');
describe('offline X01 checkout suggestions', () => {
  it('finds the maximum three-dart double finish and excludes bogey scores', () => {
    expect(x01Checkouts(170, 3, true).map(compact)).toEqual(['20x3,20x3,25x2']);
    for (const score of [159, 162, 163, 165, 166, 168, 169, 171])
      expect(x01Checkouts(score, 3, true)).toEqual([]);
  });
  it('uses the exact darts left and accepts inner bull as a finishing double', () => {
    expect(x01Checkouts(110, 2, true).map(compact)).toEqual(['20x3,25x2']);
    expect(x01Checkouts(110, 1, true)).toEqual([]);
    expect(x01Checkouts(50, 1, true).map(compact)).toEqual(['25x2']);
    expect(x01Checkouts(40, 1, true).map(compact)).toEqual(['20x2']);
    expect(x01Checkouts(2, 1, true).map(compact)).toEqual(['1x2']);
    expect(x01Checkouts(1, 3, true)).toEqual([]);
    expect(x01Checkouts(0, 3, true)).toEqual([]);
    expect(x01Checkouts(40, 0, true)).toEqual([]);
  });
  it('distinguishes straight checkout, including a last single/triple and outer bull', () => {
    expect(x01Checkouts(1, 1, false).map(compact)).toEqual(['1x1']);
    expect(x01Checkouts(25, 1, false).map(compact)).toEqual(['25x1']);
    expect(x01Checkouts(60, 1, false).map(compact)).toEqual(['20x3']);
    expect(x01Checkouts(180, 3, false).map(compact)).toEqual(['20x3,20x3,20x3']);
    expect(x01Checkouts(180, 3, true)).toEqual([]);
  });
  it('lists distinct physical routes in shortest-first order without misses', () => {
    const routes = x01Checkouts(40, 3, true);
    expect(routes[0]!.map((d) => [d.sector, d.multiplier])).toEqual([[20, 2]]);
    expect(new Set(routes.map(compact)).size).toBe(routes.length);
    expect(routes.some((route) => compact(route) === '20x1,10x2')).toBe(true);
    expect(routes.some((route) => compact(route) === '10x2,10x2')).toBe(true);
    expect(
      routes.every(
        (route, i) =>
          route.length <= 3 &&
          route.every((d) => d.sector > 0) &&
          (!i || routes[i - 1]!.length <= route.length),
      ),
    ).toBe(true);
  });
  it.each(
    [true, false].flatMap((doubleOut) =>
      [1, 2, 25, 40, 50, 61, 100, 110, 170, 180].flatMap((remaining) => {
        const routes = x01Checkouts(remaining, 3, doubleOut);
        // Bound each exhaustive reducer case independently of runner/coverage overhead.
        return Array.from({ length: Math.max(1, Math.ceil(routes.length / 128)) }, (_, batch) => ({
          doubleOut,
          remaining,
          batch,
          routes: routes.slice(batch * 128, (batch + 1) * 128),
        }));
      }),
    ),
  )(
    'all suggested routes are accepted by the actual game reducer (double=$doubleOut, remaining=$remaining, batch=$batch)',
    ({ doubleOut, remaining, routes }) => {
      const config = { mode: 'individual' as const, ownerIds: ['alice', 'bob'] };
      const game = createX01Game(x01Version(301, doubleOut, '').definition);
      for (const route of routes) {
        let state: EngineState = {
          ...game.initialState(config),
          ...{ totals: { alice: remaining, bob: 301 }, visitStart: remaining },
        };
        // One remaining is already a bust under double-out and has no routes.
        for (const dart of route) {
          const action = {
            type: 'record' as const,
            ownerId: 'alice',
            values: { sector: dart.sector, multiplier: dart.multiplier },
          };
          state = game
            .decide(state, action, config)
            .reduce((s, e) => game.evolve(s, e, config), state);
        }
        expect(state.status).toBe('finished');
        expect(state.totals.alice).toBe(0);
      }
    },
  );
  it('never advertises an overshoot or an invalid double-out prefix', () => {
    for (const remaining of [3, 39, 60, 99, 160])
      for (const route of x01Checkouts(remaining, 3, true)) {
        let left = remaining;
        for (const [index, dart] of route.entries()) {
          left -= dartScore(dart.sector, dart.multiplier);
          expect(left).toBeGreaterThanOrEqual(0);
          if (index < route.length - 1) expect(left).toBeGreaterThan(1);
          else {
            expect(left).toBe(0);
            expect(dart.multiplier).toBe(2);
          }
        }
      }
  });
  it.each([
    [-1, 3, true],
    [702, 3, true],
    [1.5, 3, true],
    [40, 4, true],
    [40, -1, true],
    [40, 1.5, true],
    [40, 3, 'yes'],
  ])('rejects invalid boundary inputs %s/%s/%s', (score, darts, double) =>
    expect(() => x01Checkouts(score as number, darts as number, double as boolean)).toThrow(
      'invalid_config',
    ),
  );
});
