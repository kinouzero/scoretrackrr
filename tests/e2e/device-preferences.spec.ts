import { expect, test, type Page } from '../fixtures/browser';
import { waitForOfflineReady } from '../fixtures/offline';
async function savedPreference(page: Page, key: 'language' | 'theme') {
  return page.evaluate(
    (key) =>
      new Promise<string | null>((resolve, reject) => {
        const open = indexedDB.open('scoretrackrr');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('deviceSettings');
          const read = tx.objectStore('deviceSettings').get(key);
          read.onsuccess = () => resolve(read.result?.value ?? null);
          tx.oncomplete = () => db.close();
        };
      }),
    key,
  );
}
async function deviceLanguage(page: Page, language: string, event = 'languagechange') {
  await page.evaluate(
    ({ language, event }) => {
      Object.defineProperty(navigator, 'language', { value: language, configurable: true });
      if (event === 'visibilitychange') document.dispatchEvent(new Event(event));
      else window.dispatchEvent(new Event(event));
    },
    { language, event },
  );
}
for (const settings of [
  { locale: 'fr-CA', expected: 'fr', theme: 'dark' as const },
  { locale: 'en-GB', expected: 'en', theme: 'light' as const },
  { locale: 'de-DE', expected: 'en', theme: 'dark' as const },
]) {
  test.describe(`device ${settings.locale}`, () => {
    test.use({ locale: settings.locale, colorScheme: settings.theme });
    test('follows device defaults without saving a manual override and survives offline reload', async ({
      page,
      context,
    }) => {
      await page.goto('/settings/');
      await waitForOfflineReady(page);
      await expect(page.locator('html')).toHaveAttribute('lang', settings.expected);
      const language = page.getByLabel(
        settings.expected === 'fr' ? 'Langue de l’application' : 'App language',
        { exact: true },
      );
      const theme = page.getByLabel(settings.expected === 'fr' ? 'Thème' : 'Theme', {
        exact: true,
      });
      await expect(language).toHaveValue('system');
      await expect(theme).toHaveValue('system');
      await expect(theme).toBeEnabled();
      expect(await savedPreference(page, 'language')).toBeNull();
      expect(await savedPreference(page, 'theme')).toBeNull();
      await expect
        .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme))
        .toBe(settings.theme);
      await context.setOffline(true);
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('lang', settings.expected);
      await expect(language).toHaveValue('system');
      await page.emulateMedia({ colorScheme: settings.theme === 'dark' ? 'light' : 'dark' });
      await expect
        .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme))
        .toBe(settings.theme === 'dark' ? 'light' : 'dark');
      await expect(page.locator('html')).not.toHaveAttribute('data-theme');
    });
  });
}
test('follows language changes with open forms, preserves manual choices and returns to the device across tabs', async ({
  page,
  context,
}) => {
  await page.goto('/players/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Ajouter un joueur', exact: true }).click();
  await page.getByLabel('Pseudonyme', { exact: true }).fill('Élodie');
  await deviceLanguage(page, 'en-GB');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByLabel('Nickname', { exact: true })).toHaveValue('Élodie');
  const other = await context.newPage();
  await other.goto('/settings/');
  await expect(other.getByLabel('Langue de l’application', { exact: true })).toHaveValue('system');
  await other.getByLabel('Langue de l’application', { exact: true }).selectOption('en');
  await deviceLanguage(page, 'fr-FR');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await other.getByLabel('App language', { exact: true }).selectOption('fr');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page.getByLabel('Pseudonyme', { exact: true })).toHaveValue('Élodie');
  await other.getByLabel('Langue de l’application', { exact: true }).selectOption('system');
  await expect(other.getByLabel('Langue de l’application', { exact: true })).toHaveValue('system');
  await deviceLanguage(page, 'ja-JP', 'visibilitychange');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await deviceLanguage(other, 'ja-JP');
  await expect(other.locator('html')).toHaveAttribute('lang', 'en');
  await other.getByLabel('App language', { exact: true }).selectOption('fr');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await page.getByRole('button', { name: 'Enregistrer le profil', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page.getByText('Élodie', { exact: true })).toBeVisible();
  await other.getByLabel('Langue de l’application', { exact: true }).selectOption('system');
  await expect(other.locator('html')).toHaveAttribute('lang', 'en');
  await expect(other.getByLabel('App language', { exact: true })).toHaveValue('system');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  expect(await savedPreference(page, 'language')).toBe('system');
});
test('keeps the last language preference after a failed write and allows retry', async ({
  page,
  context,
}) => {
  await page.goto('/settings/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await expect(page.getByLabel('Langue de l’application', { exact: true })).toBeEnabled();
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'deviceSettings' && value.key === 'language') {
        IDBObjectStore.prototype.put = original;
        throw new DOMException('Synthetic storage full', 'QuotaExceededError');
      }
      return key === undefined ? original.call(this, value) : original.call(this, value, key);
    };
  });
  const panel = page.getByRole('region', { name: 'Langue', exact: true });
  await panel.getByLabel('Langue de l’application', { exact: true }).selectOption('en');
  await expect(panel).toContainText('Le stockage de cet appareil est plein');
  await expect(panel.getByLabel('Langue de l’application', { exact: true })).toHaveValue('system');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  expect(await savedPreference(page, 'language')).toBeNull();
  await panel.getByLabel('Langue de l’application', { exact: true }).selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByLabel('App language', { exact: true })).toHaveValue('en');
  await page.reload();
  await expect(page.getByLabel('App language', { exact: true })).toHaveValue('en');
  await page.getByLabel('App language', { exact: true }).selectOption('system');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
});
