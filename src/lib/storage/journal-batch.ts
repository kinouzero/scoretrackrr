import type { LocalDatabase } from './database';
import type { MatchJournal } from './journal';
import { requireRecord, StorageError, storageOperation } from './errors';
import { EngineError } from '#lib/domain/engine/types';
import { JournalError, MAX_JOURNAL_EVENTS, type JournalAction } from '#lib/domain/journal';

export interface JournalBatchSubmission {
  matchId: string;
  gameId: string;
  expectedVersion: number;
  actorPlayerId: string;
  deviceId: string;
  timestamp: string;
  actions: readonly JournalAction[];
}

/** The journal must target this database so its writes share the outer transaction. */
export async function submitJournalBatch(
  database: LocalDatabase,
  journal: Pick<MatchJournal, 'submit'>,
  input: JournalBatchSubmission,
) {
  if (!input.actions.length) throw new EngineError('invalid_command');
  if (input.expectedVersion + input.actions.length > MAX_JOURNAL_EVENTS)
    throw new JournalError('history_limit');
  return storageOperation(() =>
    database.transaction(
      'rw',
      [
        database.matches,
        database.scoreEvents,
        database.matchProjections,
        database.matchPermissions,
        database.matchAuthorities,
        database.deviceSettings,
      ],
      async () => {
        const match = requireRecord(await database.matches.get(input.matchId));
        if (match.rulesSnapshot.gameId !== input.gameId) throw new EngineError('invalid_command');
        if (match.version !== input.expectedVersion) throw new StorageError('conflict');
        for (const [index, action] of input.actions.entries())
          await journal.submit({
            matchId: input.matchId,
            eventId: crypto.randomUUID(),
            commandId: crypto.randomUUID(),
            expectedVersion: input.expectedVersion + index,
            actorPlayerId: input.actorPlayerId,
            deviceId: input.deviceId,
            timestamp: input.timestamp,
            action,
          });
      },
    ),
  );
}
