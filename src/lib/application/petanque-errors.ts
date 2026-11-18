import { EngineError } from '#lib/domain/engine/types';
import { JournalError } from '#lib/domain/journal';
import { StorageError } from '#lib/storage/errors';
import { messages } from '#lib/i18n/index';

export function petanqueErrorMessage(error: unknown, setup = false): string {
  if (error instanceof StorageError) {
    if (error.code === 'quota_exceeded') return messages.settings.quota;
    if (error.code === 'conflict' || error.code === 'missing_reference')
      return messages.petanque.conflict;
  }
  if (error instanceof JournalError) {
    if (error.code === 'history_limit') return messages.petanque.limit;
    if (error.code === 'invalid_correction') return messages.petanque.invalidCorrection;
  }
  if (
    error instanceof EngineError ||
    (error instanceof StorageError && error.code === 'invalid_record')
  )
    return setup ? messages.petanque.invalidSetup : messages.petanque.invalidEnd;
  return messages.petanque.error;
}
