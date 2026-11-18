import { expect, it } from 'vitest';
import {
  skullCounterLimits,
  type SkullResultDraft,
} from '../../src/lib/application/skull-counters';
import { skullCaptureCaps, type SkullEntry } from '../../src/lib/domain/games/skull-king';
const fresh = (): SkullEntry => ({
  bid: 0,
  won: null,
  c14: 0,
  b14: 0,
  mermaids: 0,
  pirates: 0,
  king: 0,
});
const draft = (values: Partial<SkullResultDraft> = {}): SkullResultDraft => ({
  won: 0,
  c14: 0,
  b14: 0,
  mermaids: 0,
  pirates: 0,
  king: 0,
  ...values,
});
it('offers the round trick count and pinned category inventory initially', () => {
  expect(skullCounterLimits({ a: fresh(), b: fresh(), c: fresh() }, {}, 'a', 3)).toEqual({
    won: 3,
    ...skullCaptureCaps,
  });
});
it.each(Object.keys(skullCaptureCaps) as (keyof typeof skullCaptureCaps)[])(
  'shares the entire %s stock across pending and saved players',
  (field) => {
    const cap = skullCaptureCaps[field];
    const rows = {
      a: fresh(),
      b: fresh(),
      c: { ...fresh(), won: 1, [field]: Math.max(0, cap - 1) },
    };
    const pending = { b: draft({ won: 1, [field]: 1 }) };
    const original = JSON.stringify({ rows, pending });
    expect(skullCounterLimits(rows, pending, 'a', 3)[field]).toBe(0);
    expect(skullCounterLimits(rows, { b: draft() }, 'a', 3)[field]).toBe(1);
    expect(JSON.stringify({ rows, pending })).toBe(original);
  },
);
it('does not subtract the edited player from its own maximum and ignores a saved players stale draft', () => {
  const rows = { a: fresh(), b: { ...fresh(), won: 2, c14: 2 } };
  expect(
    skullCounterLimits(
      rows,
      { a: draft({ won: 1, c14: 1 }), b: draft({ won: 9, c14: 9 }) },
      'a',
      3,
    ),
  ).toMatchObject({ won: 1, c14: 1 });
});
it('shares trick allocation including unsubmitted players and releases it when reduced', () => {
  const rows = { a: fresh(), b: fresh(), c: fresh() };
  expect(skullCounterLimits(rows, { b: draft({ won: 2 }), c: draft({ won: 1 }) }, 'a', 3).won).toBe(
    0,
  );
  expect(skullCounterLimits(rows, { b: draft({ won: 1 }), c: draft({ won: 1 }) }, 'a', 3).won).toBe(
    1,
  );
});
it('blocks incompatible king/pirate bonuses across both own and other drafts', () => {
  const rows = { a: fresh(), b: fresh() };
  expect(skullCounterLimits(rows, { a: draft({ king: 1 }) }, 'a', 2).pirates).toBe(0);
  expect(skullCounterLimits(rows, { b: draft({ king: 1 }) }, 'a', 2).pirates).toBe(0);
  expect(skullCounterLimits(rows, { b: draft({ pirates: 2 }) }, 'a', 2).king).toBe(0);
  expect(skullCounterLimits(rows, {}, 'a', 2).king).toBe(1);
});
