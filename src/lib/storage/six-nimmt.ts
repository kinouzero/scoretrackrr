import type { LocalDatabase } from './database';
import type { MatchJournal } from './journal';
import { submitJournalBatch, type JournalBatchSubmission } from './journal-batch';
import { EngineError } from '#lib/domain/engine/types';
import { SIX_NIMMT_ROUND_LIMIT } from '#lib/domain/games/six-nimmt';

export interface SixNimmtRoundSubmission extends Omit<
  JournalBatchSubmission,
  'gameId' | 'actions'
> {
  round: number;
  scores: readonly { ownerId: string; points: number }[];
}

/** Keep per-player journal events while committing the entire form atomically. */
export async function submitSixNimmtRound(
  database: LocalDatabase,
  journal: Pick<MatchJournal, 'submit'>,
  input: SixNimmtRoundSubmission,
) {
  if (
    !Array.isArray(input.scores) ||
    input.scores.length < 1 ||
    input.scores.length > 10 ||
    new Set(input.scores.map((score) => score.ownerId)).size !== input.scores.length ||
    input.scores.some(
      (score) =>
        !Number.isInteger(score.points) ||
        score.points < 0 ||
        score.points > SIX_NIMMT_ROUND_LIMIT + 10,
    )
  ) {
    throw new EngineError('invalid_command');
  }
  const { scores, round, ...submission } = input;
  return submitJournalBatch(database, journal, {
    ...submission,
    gameId: '6-qui-prend',
    actions: scores.map(({ ownerId, points }) => ({
      type: 'record',
      ownerId,
      values: { round, points },
    })),
  });
}
