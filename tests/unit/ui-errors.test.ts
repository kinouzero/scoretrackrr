import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bindMessages } from '../../src/lib/i18n/bindings';
import { translate } from '../../src/lib/i18n/catalog';
import { PlayerValidationError } from '../../src/lib/domain/players';
import { TeamValidationError } from '../../src/lib/domain/teams';
import { EngineError } from '../../src/lib/domain/engine/types';
import { JournalError } from '../../src/lib/domain/journal';
import { StorageError } from '../../src/lib/storage/errors';
import { journalErrorMessage } from '../../src/lib/application/journal-errors';
import { petanqueErrorMessage } from '../../src/lib/application/petanque-errors';
import { playerErrorMessage } from '../../src/lib/application/player-errors';
import { teamErrorMessage } from '../../src/lib/application/team-errors';

const locale = vi.hoisted(() => ({ value: 'en' }));
vi.mock('#lib/i18n/index', async () => {
  const { bindMessages } = await import('../../src/lib/i18n/bindings');
  const { translate } = await import('../../src/lib/i18n/catalog');
  return { messages: bindMessages((key, values) => translate(locale.value, key, values)) };
});

beforeEach(() => {
  locale.value = 'en';
});

describe.each(['en', 'fr'])('actionable UI errors (%s)', (language) => {
  const text = bindMessages((key, values) => translate(language, key, values));
  beforeEach(() => {
    locale.value = language;
  });

  it.each([
    [new PlayerValidationError('displayName'), text.players.invalidName],
    [new PlayerValidationError('email'), text.players.invalidEmail],
    [new PlayerValidationError('color'), text.players.invalidAppearance],
    [new PlayerValidationError('avatar'), text.players.invalidAppearance],
    [new PlayerValidationError('isGuest'), text.players.invalidAppearance],
    [new StorageError('quota_exceeded'), text.settings.quota],
    [new StorageError('conflict'), text.players.conflict],
    [new StorageError('missing_reference'), text.players.conflict],
    [new StorageError('unavailable'), text.players.error],
    [new Error('private diagnostic'), text.players.error],
    [null, text.players.error],
  ])('gives a safe player message for %s', (error, expected) => {
    expect(playerErrorMessage(error)).toBe(expected);
  });

  it.each([
    [new TeamValidationError('name'), text.teams.invalidName],
    [new TeamValidationError('appearance'), text.teams.invalidAppearance],
    [new TeamValidationError('distribution'), text.teams.invalidDistribution],
    [new TeamValidationError('members'), text.teams.invalidMembers],
    [new StorageError('quota_exceeded'), text.settings.quota],
    [new StorageError('conflict'), text.teams.conflict],
    [new StorageError('missing_reference'), text.teams.invalidMembers],
    [new StorageError('invalid_record'), text.teams.invalidMembers],
    [new StorageError('unavailable'), text.teams.error],
    [new Error('private diagnostic'), text.teams.error],
  ])('distinguishes team validation and storage failures for %s', (error, expected) => {
    expect(teamErrorMessage(error)).toBe(expected);
  });

  it.each([
    [new JournalError('invalid_action'), text.matches.invalid],
    [new EngineError('invalid_command'), text.matches.invalid],
    [new StorageError('missing_reference'), text.matches.missing],
    [new StorageError('unavailable'), text.matches.error],
    [new Error('private diagnostic'), text.matches.error],
  ])('gives a safe journal message for %s', (error, expected) => {
    expect(journalErrorMessage(error)).toBe(expected);
  });

  it.each([
    [new StorageError('quota_exceeded'), text.settings.quota],
    [new StorageError('conflict'), text.petanque.conflict],
    [new StorageError('missing_reference'), text.petanque.conflict],
    [new JournalError('history_limit'), text.petanque.limit],
    [new JournalError('invalid_correction'), text.petanque.invalidCorrection],
    [new JournalError('invalid_action'), text.petanque.error],
    [new StorageError('unavailable'), text.petanque.error],
    [new Error('private diagnostic'), text.petanque.error],
  ])('distinguishes retry, limit and correction failures for %s', (error, expected) => {
    expect(petanqueErrorMessage(error)).toBe(expected);
  });

  it.each([new EngineError('invalid_command'), new StorageError('invalid_record')])(
    'distinguishes invalid setup from invalid end entry for %s',
    (error) => {
      expect(petanqueErrorMessage(error, true)).toBe(text.petanque.invalidSetup);
      expect(petanqueErrorMessage(error)).toBe(text.petanque.invalidEnd);
    },
  );
});
