import { EngineError } from '../engine/types';
import { dartScore, scoringDarts } from './dartboard';

// A visit total is accepted only if a legal physical sequence can produce it,
// stopping at the first bust or finish. The declared checkout disambiguates zero.
export function x01VisitResult(
  score: number,
  dartsLeft: number,
  doubleOut: boolean,
  total: number,
  checkout: number,
) {
  if (
    !Number.isInteger(score) ||
    score < 1 ||
    score > 701 ||
    !Number.isInteger(dartsLeft) ||
    dartsLeft < 1 ||
    dartsLeft > 3 ||
    typeof doubleOut !== 'boolean' ||
    !Number.isInteger(total) ||
    total < 0 ||
    total > dartsLeft * 60 ||
    ![0, 1].includes(checkout) ||
    (checkout === 1 && (!doubleOut || total !== score))
  )
    throw new EngineError('invalid_command');
  const remaining = score - total;
  const bust =
    remaining < 0 || (doubleOut && (remaining === 1 || (remaining === 0 && checkout === 0)));
  const finished = remaining === 0 && !bust;
  const memo = new Map<string, boolean>();
  function possible(wanted: number, slots: number): boolean {
    if (wanted === 0) return !bust && !finished;
    if (slots === 0 || wanted > slots * 60) return false;
    const key = `${wanted}:${slots}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    const before = remaining + wanted;
    for (const dart of scoringDarts) {
      const points = dartScore(dart.sector, dart.multiplier);
      if (points > wanted) continue;
      const after = before - points;
      const dartBust =
        after < 0 || (doubleOut && (after === 1 || (after === 0 && dart.multiplier !== 2)));
      const dartFinish = after === 0 && !dartBust;
      if (dartBust || dartFinish) {
        if (points === wanted && dartBust === bust && dartFinish === finished) {
          memo.set(key, true);
          return true;
        }
      } else if (possible(wanted - points, slots - 1)) {
        memo.set(key, true);
        return true;
      }
    }
    memo.set(key, false);
    return false;
  }
  if (!possible(total, dartsLeft)) throw new EngineError('invalid_command');
  return { remaining, bust, finished };
}
