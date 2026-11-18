import { EngineError } from '../engine/types';
import { immutable } from '../engine/validation';
import { dartScore, scoringDarts } from './dartboard';

export interface CheckoutDart {
  readonly sector: number;
  readonly multiplier: number;
}
// Enumerate legal ordered finishes. Misses add no useful route and are omitted.
export function x01Checkouts(
  remaining: number,
  dartsLeft: number,
  doubleOut: boolean,
): readonly (readonly CheckoutDart[])[] {
  if (
    !Number.isSafeInteger(remaining) ||
    remaining < 0 ||
    remaining > 701 ||
    !Number.isInteger(dartsLeft) ||
    dartsLeft < 0 ||
    dartsLeft > 3 ||
    typeof doubleOut !== 'boolean'
  )
    throw new EngineError('invalid_config');
  if (
    !remaining ||
    !dartsLeft ||
    remaining > (doubleOut ? (dartsLeft - 1) * 60 + 50 : dartsLeft * 60)
  )
    return immutable([]);
  const routes: CheckoutDart[][] = [];
  function visit(left: number, slots: number, path: CheckoutDart[]) {
    if (left > (doubleOut ? (slots - 1) * 60 + 50 : slots * 60)) return;
    for (const dart of scoringDarts) {
      const next = left - dartScore(dart.sector, dart.multiplier);
      if (next < 0) continue;
      if (next === 0) {
        if (!doubleOut || dart.multiplier === 2) routes.push([...path, dart]);
      } else if (slots > 1 && (!doubleOut || next > 1)) visit(next, slots - 1, [...path, dart]);
    }
  }
  visit(remaining, dartsLeft, []);
  routes.sort((a, b) => a.length - b.length);
  return immutable(routes);
}
