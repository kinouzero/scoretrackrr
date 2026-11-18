import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), 'scoretrackrr-i18n-'));
const catalogs = join(temporary, 'src/lib/i18n/locales');
mkdirSync(join(temporary, 'scripts'));
cpSync(join(root, 'scripts/check-i18n.mjs'), join(temporary, 'scripts/check-i18n.mjs'));
symlinkSync(join(root, 'node_modules'), join(temporary, 'node_modules'), 'dir');
const source = JSON.parse(readFileSync(join(root, 'src/lib/i18n/locales/en.json'), 'utf8'));
function write(locale: string, entries: unknown) {
  writeFileSync(join(catalogs, `${locale}.json`), JSON.stringify(entries));
}
function validate() {
  return execFileSync(process.execPath, [join(temporary, 'scripts/check-i18n.mjs')], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
}
beforeEach(() => {
  rmSync(catalogs, { recursive: true, force: true });
  mkdirSync(catalogs, { recursive: true });
  cpSync(join(root, 'src/lib/i18n/bindings.ts'), join(temporary, 'src/lib/i18n/bindings.ts'));
  for (const language of ['en', 'fr'])
    cpSync(join(root, `src/lib/i18n/locales/${language}.json`), join(catalogs, `${language}.json`));
});
afterAll(() => rmSync(temporary, { recursive: true, force: true }));

describe('Weblate catalog validation', () => {
  it('accepts partial and empty community messages with region language filenames', () => {
    write('pt_BR', {
      'nav.home': { defaultMessage: 'Início' },
      'nav.games': { defaultMessage: '' },
    });
    expect(validate()).toContain('across 3 catalogs');
  });
  it('rejects malformed ICU before it can reach a production build', () => {
    write('es', { 'timesUp.cards': { defaultMessage: '{n, plural, one {carta}' } });
    expect(validate).toThrow();
  });
  it('rejects translated placeholder names and unknown IDs', () => {
    write('es', { 'players.edit': { defaultMessage: 'Editar {nombre}' } });
    expect(validate).toThrow();
    write('es', { unknown: { defaultMessage: 'Texto' } });
    expect(validate).toThrow();
  });
  it('requires complete French and English catalogs', () => {
    write('fr', { 'nav.home': { defaultMessage: 'Accueil' } });
    expect(validate).toThrow();
    write('fr', source);
    write('en', { ...source, 'nav.home': { defaultMessage: '' } });
    expect(validate).toThrow();
  });
  it('rejects removal of messages still referenced by typed bindings', () => {
    const reduced = { ...source };
    delete reduced['nav.home'];
    write('en', reduced);
    write('fr', reduced);
    expect(validate).toThrow();
  });
  it('rejects duplicate canonical language tags and invalid entry shapes', () => {
    write('pt_BR', {});
    write('pt-BR', {});
    expect(validate).toThrow();
    rmSync(join(catalogs, 'pt-BR.json'));
    write('pt_BR', { 'nav.home': 'Início' });
    expect(validate).toThrow();
  });
});
