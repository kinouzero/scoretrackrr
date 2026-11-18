import { readFile, readdir } from 'node:fs/promises';
import { IntlMessageFormat } from 'intl-messageformat';

const directory = new URL('../src/lib/i18n/locales/', import.meta.url);
const filenames = (await readdir(directory)).filter((name) => name.endsWith('.json'));
const source = JSON.parse(await readFile(new URL('en.json', directory), 'utf8'));
const failures = [];
const bindings = await readFile(new URL('../src/lib/i18n/bindings.ts', import.meta.url), 'utf8');
// Bindings contain stable dotted IDs, never translated text. Check them before bundling.
for (const [, id] of bindings.matchAll(/['"]([a-zA-Z][a-zA-Z0-9_-]*(?:\.[a-zA-Z0-9_-]+)+)['"]/g)) {
  if (!Object.hasOwn(source, id)) failures.push(`bindings.ts: missing source message ${id}`);
}
const languages = new Set();
function parameters(elements, result = new Set()) {
  for (const element of elements) {
    if ([1, 2, 3, 4, 5, 6].includes(element.type)) result.add(element.value);
    if (element.options)
      for (const option of Object.values(element.options)) parameters(option.value, result);
    if (element.children) parameters(element.children, result);
  }
  return [...result].sort().join(',');
}
for (const filename of filenames) {
  let locale;
  try {
    locale = Intl.getCanonicalLocales(filename.replace(/\.json$/, '').replaceAll('_', '-'))[0];
    if (!locale || languages.has(locale)) throw new Error('Duplicate or invalid language');
    languages.add(locale);
  } catch {
    failures.push(`${filename}: invalid or duplicate BCP 47 filename`);
    continue;
  }
  const catalog = JSON.parse(await readFile(new URL(filename, directory), 'utf8'));
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
    failures.push(`${filename}: expected a Format.JS message object`);
    continue;
  }
  for (const [id, entry] of Object.entries(catalog)) {
    if (!Object.hasOwn(source, id)) failures.push(`${filename}: unknown message ${id}`);
    if (
      !entry ||
      typeof entry !== 'object' ||
      typeof entry.defaultMessage !== 'string' ||
      (entry.description !== undefined && typeof entry.description !== 'string') ||
      Object.keys(entry).some((key) => !['defaultMessage', 'description'].includes(key))
    ) {
      failures.push(`${filename}: invalid Format.JS entry ${id}`);
      continue;
    }
    if (!entry.defaultMessage) continue; // Empty community translations fall back to English.
    try {
      const translated = new IntlMessageFormat(entry.defaultMessage, locale, undefined, {
        ignoreTag: true,
      });
      if (
        source[id] &&
        parameters(translated.getAst()) !==
          parameters(
            new IntlMessageFormat(source[id].defaultMessage, 'en', undefined, {
              ignoreTag: true,
            }).getAst(),
          )
      ) {
        failures.push(`${filename}: changed ICU parameters in ${id}`);
      }
    } catch (error) {
      failures.push(`${filename}: ${id}: ${error.message}`);
    }
  }
  if (filename === 'en.json' || filename === 'fr.json') {
    for (const id of Object.keys(source))
      if (!catalog[id]?.defaultMessage) failures.push(`${filename}: missing ${id}`);
  }
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else
  console.log(
    `Validated ${Object.keys(source).length} ICU messages across ${filenames.length} catalogs.`,
  );
