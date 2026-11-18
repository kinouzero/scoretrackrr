import type { AuditEntry } from './journal';
import type { ScoreCommand } from './engine/types';
import { EngineError } from './engine/types';

export interface ScoreSlot {
  readonly number: number;
  readonly revisionId: string;
  readonly command: Extract<ScoreCommand, { type: 'record' }> | null;
}
export function scoreSlots(audit: readonly AuditEntry[]): ScoreSlot[] {
  const slots: ScoreSlot[] = [];
  const revisions = new Map<string, number>();
  for (const entry of audit) {
    const action = entry.action;
    if (action.type === 'record') {
      revisions.set(entry.event.id, slots.length);
      slots.push({ number: slots.length + 1, revisionId: entry.event.id, command: action });
    } else if (action.type === 'correct' || action.type === 'undo') {
      const index = revisions.get(action.targetEventId);
      // Generic journals can also undo a manual finish, which has no scoring slot.
      if (index === undefined) {
        if (action.type === 'undo') continue;
        throw new EngineError('invalid_event');
      }
      slots[index] = {
        ...slots[index]!,
        revisionId: entry.event.id,
        command: action.type === 'correct' ? action.replacement : null,
      };
      revisions.set(entry.event.id, index);
    }
  }
  return slots;
}
