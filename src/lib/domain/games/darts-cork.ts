import { EngineError } from '../engine/types';

/** Move the observed cork winner first without changing the other sides' relative order. */
export function dartsCorkOrder(ownerIds: readonly string[], winnerId: unknown): string[] {
  if (typeof winnerId !== 'string' || !ownerIds.includes(winnerId))
    throw new EngineError('invalid_config');
  return [winnerId, ...ownerIds.filter((id) => id !== winnerId)];
}
