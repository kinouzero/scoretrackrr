import { PlayerValidationError } from '#lib/domain/players';
import { StorageError } from '#lib/storage/errors';
import { messages } from '#lib/i18n/index';

export function playerErrorMessage(error: unknown): string {
  if (error instanceof PlayerValidationError) {
    if (error.field === 'displayName') return messages.players.invalidName;
    if (error.field === 'email') return messages.players.invalidEmail;
    return messages.players.invalidAppearance;
  }
  if (error instanceof StorageError) {
    if (error.code === 'quota_exceeded') return messages.settings.quota;
    if (error.code === 'conflict' || error.code === 'missing_reference')
      return messages.players.conflict;
  }
  return messages.players.error;
}
