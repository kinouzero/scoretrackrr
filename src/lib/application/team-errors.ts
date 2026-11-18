import { TeamValidationError } from '#lib/domain/teams';
import { StorageError } from '#lib/storage/errors';
import { messages } from '#lib/i18n/index';

export function teamErrorMessage(error: unknown): string {
  if (error instanceof TeamValidationError) {
    if (error.field === 'name') return messages.teams.invalidName;
    if (error.field === 'appearance') return messages.teams.invalidAppearance;
    if (error.field === 'distribution') return messages.teams.invalidDistribution;
    return messages.teams.invalidMembers;
  }
  if (error instanceof StorageError) {
    if (error.code === 'quota_exceeded') return messages.settings.quota;
    if (error.code === 'conflict') return messages.teams.conflict;
    if (error.code === 'missing_reference' || error.code === 'invalid_record')
      return messages.teams.invalidMembers;
  }
  return messages.teams.error;
}
