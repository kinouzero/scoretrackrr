import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  createTranslator,
  translate,
  supportedLocale,
  resolveLocale,
  locales,
} from '../../src/lib/i18n/catalog';
import { bindMessages } from '../../src/lib/i18n/bindings';
import { normalizeLanguage } from '../../src/lib/domain/settings';
import { LocalDatabase } from '../../src/lib/storage/database';
import { BackupRepository } from '../../src/lib/storage/backup';

const french = bindMessages((key, values) => translate('fr', key, values));
const english = bindMessages((key, values) => translate('en', key, values));
describe('offline localization', () => {
  it('keeps typed labels, arrays and dynamic messages in both languages', () => {
    expect(french.nav.settings).toBe('Réglages');
    expect(english.nav.settings).toBe('Settings');
    expect(english.yams.categories[6]).toBe('Three of a kind');
    expect(english.yams.categories.map((value) => value)).toHaveLength(13);
    expect(french.timesUp.cards(0)).toBe('0 cartes restantes');
    expect(english.timesUp.cards(1)).toBe('1 card remaining');
    expect(english.timesUp.cards(2)).toBe('2 cards remaining');
    expect(french.players.selectedCount(0)).toBe('0 joueur sélectionné');
    expect(english.players.selectedCount(0)).toBe('0 players selected');
  });
  it('formats select branches, optional values and interpolated names as text', () => {
    expect(english.darts.entry('Zoé', 0, 1)).toBe('Zoé: miss (0 points)');
    expect(english.skull.entry('Zoé', 2, 0, 3)).toBe('Round 2 · Zoé: bid 3');
    expect(english.timesUp.entry('Bleus', 0)).toBe('Bleus · timer started');
    expect(english.yams.cell('Zoé', 'Ones', null)).toBe('Zoé — Ones: not entered');
    expect(english.yams.cell('Zoé', 'Ones', 0)).toBe('Zoé — Ones: 0');
    expect(english.players.edit('<b>Zoé</b> {name}')).toBe('Edit <b>Zoé</b> {name}');
    expect(french.darts.visitEntry('Alice', 12, 0)).toBe('Alice : volée 12 points');
  });
  it('falls back to English for missing or empty community translations with English plurals', () => {
    const t = createTranslator({
      en: {
        count: { defaultMessage: '{n, plural, one {# card} other {# cards}}' },
        title: { defaultMessage: 'Title' },
      },
      es: { title: { defaultMessage: '' } },
    });
    expect(t('es', 'count', { n: 0 })).toBe('0 cards');
    expect(t('es', 'title')).toBe('Title');
    expect(() => t('es', 'unknown')).toThrow('UNKNOWN_MESSAGE');
    expect(supportedLocale('unknown')).toBe('en');
    expect(locales.map((locale) => locale.code)).toEqual(expect.arrayContaining(['en', 'fr']));
  });
  it('canonicalizes Weblate language codes and rejects invalid storage input', () => {
    expect(normalizeLanguage('en_GB')).toBe('en-GB');
    expect(normalizeLanguage('FR')).toBe('fr');
    for (const invalid of [null, '', '../../fr', '<script>', 'a'.repeat(65)])
      expect(() => normalizeLanguage(invalid)).toThrow('INVALID_LANGUAGE');
  });
  it('persists the device language without changing schema or exporting it in backups', async () => {
    const name = `locale-${crypto.randomUUID()}`;
    const database = new LocalDatabase(name);
    try {
      expect(await database.readLanguage()).toBe('system');
      await database.saveLanguage('en');
      await expect(database.saveLanguage('../fr')).rejects.toThrow('INVALID_LANGUAGE');
      database.close();
      await database.open();
      expect(await database.readLanguage()).toBe('en');
      const backup = await new BackupRepository(database).export('2026-11-16T12:00:00.000Z');
      expect(backup).not.toContain('"language"');
      await new BackupRepository(database).restore(backup);
      expect(await database.readLanguage()).toBe('en');
    } finally {
      await database.delete();
    }
  });
});

describe('device language selection', () => {
  it.each([
    ['fr-FR', 'fr'],
    ['fr-CA', 'fr'],
    ['FR_be', 'fr'],
    ['fr-Latn-CA', 'fr'],
    ['en-US', 'en'],
    ['en-GB', 'en'],
    ['de-DE', 'en'],
    ['es', 'en'],
    ['', 'en'],
    [undefined, 'en'],
    [null, 'en'],
    ['../fr', 'en'],
  ])('resolves device language %s to %s', (deviceLanguage, expected) => {
    expect(resolveLocale('system', deviceLanguage)).toBe(expected);
  });
  it('preserves manual choices regardless of the current device language', () => {
    expect(resolveLocale('fr', 'en-US')).toBe('fr');
    expect(resolveLocale('en', 'fr-FR')).toBe('en');
    expect(resolveLocale('de', 'fr-FR')).toBe('en');
    expect(supportedLocale('fr-CA')).toBe('fr');
    expect(translate('unsupported', 'nav.settings')).toBe('Settings');
  });
  it('keeps automatic preferences distinct from resolved languages and out of JSON backups', async () => {
    const database = new LocalDatabase(`automatic-${crypto.randomUUID()}`);
    try {
      expect(await database.readLanguage()).toBe('system');
      expect(await database.readTheme()).toBe('system');
      expect(await database.deviceSettings.get('language')).toBeUndefined();
      expect(await database.deviceSettings.get('theme')).toBeUndefined();
      await database.saveLanguage('fr');
      expect(await database.readLanguage()).toBe('fr');
      await database.saveLanguage('system');
      database.close();
      await database.open();
      expect(await database.readLanguage()).toBe('system');
      const backup = await new BackupRepository(database).export('2026-11-17T12:00:00.000Z');
      expect(backup).not.toContain('"language"');
      await database.saveLanguage('en');
      await new BackupRepository(database).restore(backup);
      expect(await database.readLanguage()).toBe('en');
      await database.deviceSettings.put({ key: 'language', value: 'fr' });
      expect(await database.readLanguage()).toBe('fr');
    } finally {
      await database.delete();
    }
  });
});
