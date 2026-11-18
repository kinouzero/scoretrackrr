import type { LocalDatabase } from './database';
import type { MatchJournal } from './journal';
import { submitJournalBatch, type JournalBatchSubmission } from './journal-batch';
import { EngineError } from '#lib/domain/engine/types';

export interface SkullBidsSubmission extends Omit<JournalBatchSubmission, 'gameId' | 'actions'> {
  round: number;
  bids: readonly { ownerId: string; bid: number }[];
}
export async function submitSkullBids(
  database: LocalDatabase,
  journal: Pick<MatchJournal, 'submit'>,
  input: SkullBidsSubmission,
) {
  if (
    !Array.isArray(input.bids) ||
    input.bids.length < 1 ||
    input.bids.length > 8 ||
    new Set(input.bids.map((row) => row.ownerId)).size !== input.bids.length ||
    input.bids.some((row) => !Number.isInteger(row.bid) || row.bid < 0 || row.bid > 10)
  )
    throw new EngineError('invalid_command');
  const { bids, round, ...submission } = input;
  return submitJournalBatch(database, journal, {
    ...submission,
    gameId: 'skull-king',
    actions: bids.map(({ ownerId, bid }) => ({
      type: 'record',
      ownerId,
      values: { round, kind: 0, bid },
    })),
  });
}
