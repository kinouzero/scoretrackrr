import { describe, expect, it } from 'vitest';
import { normalizeDeviceName, normalizeLanguagePreference } from '../../src/lib/domain/settings';

describe('device name', () => {
  it('normalizes whitespace without changing a user’s name', () => {
    expect(normalizeDeviceName('  Téléphone de Zoé  ')).toBe('Téléphone de Zoé');
  });
  it.each(['', '   ', 'a'.repeat(61)])('rejects an invalid name', (input) => {
    expect(() => normalizeDeviceName(input)).toThrow('INVALID_DEVICE_NAME');
  });
  it('accepts the length boundary', () => {
    expect(normalizeDeviceName('a'.repeat(60))).toHaveLength(60);
  });
});

describe('language preference', () => {
  it('accepts following the device and canonicalizes explicit languages', () => {
    expect(normalizeLanguagePreference('system')).toBe('system');
    expect(normalizeLanguagePreference('FR')).toBe('fr');
    expect(normalizeLanguagePreference('pt_BR')).toBe('pt-BR');
  });
  it.each([null, '', 'auto', '../fr', {}, 'a'.repeat(65)])(
    'rejects malformed language preferences: %j',
    (input) => {
      expect(() => normalizeLanguagePreference(input)).toThrow('INVALID_LANGUAGE');
    },
  );
});
