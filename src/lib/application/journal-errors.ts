import { JournalError } from '#lib/domain/journal';
import { EngineError } from '#lib/domain/engine/types';
import { StorageError } from '#lib/storage/errors';
import { messages } from '#lib/i18n/index';

export function journalErrorMessage(error: unknown): string {
  if (error instanceof JournalError || error instanceof EngineError)
    return messages.matches.invalid;
  if (error instanceof StorageError && error.code === 'missing_reference')
    return messages.matches.missing;
  return messages.matches.error;
}
