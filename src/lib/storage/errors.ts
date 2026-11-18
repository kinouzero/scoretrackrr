import { TeamValidationError } from '#lib/domain/teams';
import { EngineError } from '#lib/domain/engine/types';
import { JournalError } from '#lib/domain/journal';

export type StorageErrorCode =
  | 'quota_exceeded'
  | 'unavailable'
  | 'conflict'
  | 'missing_reference'
  | 'invalid_record'
  | 'unauthorized';

export class StorageError extends Error {
  constructor(
    readonly code: StorageErrorCode,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = 'StorageError';
  }
}

export async function storageOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (
      error instanceof StorageError ||
      error instanceof TeamValidationError ||
      error instanceof EngineError ||
      error instanceof JournalError
    )
      throw error;
    const name = error instanceof Error ? error.name : '';
    if (name === 'QuotaExceededError') throw new StorageError('quota_exceeded', { cause: error });
    if (name === 'ConstraintError') throw new StorageError('conflict', { cause: error });
    throw new StorageError('unavailable', { cause: error });
  }
}

export function requireRecord<T>(record: T | undefined): T {
  if (record === undefined) throw new StorageError('missing_reference');
  return record;
}

export function validateRecord(condition: boolean): asserts condition {
  if (!condition) throw new StorageError('invalid_record');
}
