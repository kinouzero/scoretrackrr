import { IntlMessageFormat } from 'intl-messageformat';
import { normalizeLanguage } from '#lib/domain/settings';

export interface Message {
  defaultMessage: string;
  description?: string;
}
export type Catalog = Record<string, Message>;
export type MessageValues = Record<string, string | number | boolean | Date>;
export type Translator = (key: string, values?: MessageValues) => string;

const files = import.meta.glob<Catalog>('./locales/*.json', { eager: true, import: 'default' });
const catalogs = Object.fromEntries(
  Object.entries(files).map(([path, catalog]) => [
    normalizeLanguage(
      path
        .split('/')
        .at(-1)!
        .replace(/\.json$/, ''),
    ),
    catalog,
  ]),
);
export const defaultLocale = 'en';
export const locales = Object.keys(catalogs)
  .sort()
  .map((code) => {
    const name = new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code;
    return { code, name: name.replace(/^./u, (initial) => initial.toLocaleUpperCase(code)) };
  });
export function supportedLocale(input: unknown): string {
  try {
    let code = normalizeLanguage(input);
    while (code) {
      if (catalogs[code]) return code;
      const separator = code.lastIndexOf('-');
      if (separator < 0) break;
      code = code.slice(0, separator);
    }
  } catch {
    // Unavailable or malformed device languages use the English source catalog.
  }
  return defaultLocale;
}

export function resolveLocale(preference: unknown, deviceLanguage: unknown): string {
  return supportedLocale(preference === 'system' ? deviceLanguage : preference);
}

// Each catalog gets its own bounded cache; translations are text, never HTML or executable code.
export function createTranslator(available: Record<string, Catalog>) {
  const compiled = new Map<string, IntlMessageFormat>();
  return (locale: string, key: string, values: MessageValues = {}): string => {
    const language = available[locale] ? locale : defaultLocale;
    const localized = available[language]?.[key]?.defaultMessage;
    const source = localized || available.en?.[key]?.defaultMessage;
    if (!source) throw new Error(`UNKNOWN_MESSAGE: ${key}`);
    const cacheKey = `${language}:${key}`;
    let formatter = compiled.get(cacheKey);
    if (!formatter) {
      formatter = new IntlMessageFormat(source, localized ? language : 'en', undefined, {
        ignoreTag: true,
      });
      compiled.set(cacheKey, formatter);
    }
    return String(formatter.format(values));
  };
}
export const translate = createTranslator(catalogs);
