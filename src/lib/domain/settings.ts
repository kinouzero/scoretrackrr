export function normalizeDeviceName(input: string): string {
  const value = input.trim();
  if (value.length < 1 || value.length > 60) throw new Error('INVALID_DEVICE_NAME');
  return value;
}

export type ThemePreference = 'system' | 'light' | 'dark';
export function normalizeTheme(input: unknown): ThemePreference {
  if (input !== 'system' && input !== 'light' && input !== 'dark') throw new Error('INVALID_THEME');
  return input;
}

/** Canonical BCP 47 language tag; availability is a presentation concern. */
export function normalizeLanguage(input: unknown): string {
  if (
    typeof input !== 'string' ||
    input.length > 64 ||
    !/^[a-zA-Z]{2,3}(?:[-_][a-zA-Z0-9]{2,8})*$/.test(input)
  ) {
    throw new Error('INVALID_LANGUAGE');
  }
  try {
    return Intl.getCanonicalLocales(input.replaceAll('_', '-'))[0]!;
  } catch {
    throw new Error('INVALID_LANGUAGE');
  }
}

/** A device-following choice is stored separately from the resolved UI language. */
export function normalizeLanguagePreference(input: unknown): string {
  return input === 'system' ? 'system' : normalizeLanguage(input);
}
