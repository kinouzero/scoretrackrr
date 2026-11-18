import { waitForOfflineReady } from '../fixtures/offline';
import { expect, test } from '../fixtures/browser';

test('caches unvisited pages and keeps local data after an offline reload', async ({
  page,
  context,
}) => {
  const externalRequests: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:4178')) externalRequests.push(request.url());
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'La prochaine partie commence ici.',
  );
  await waitForOfflineReady(page);
  await expect(page.locator('footer')).toHaveCount(0);
  await expect(page.getByText('Réseau disponible', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('home-mobile.png'), fullPage: true });
  await expect(page.getByRole('button', { name: 'Voir les joueurs de démonstration' })).toHaveCount(
    0,
  );
  await context.setOffline(true);

  // Direct navigation proves precaching, including pages not previously visited.
  for (const [path, title] of [
    ['/games/', 'À quoi joue-t-on ?'],
    ['/players/', 'Vos compagnons de jeu'],
    ['/teams/', 'L’esprit d’équipe'],
    ['/matches/', 'Vos parties'],
    ['/settings/', 'À votre façon'],
  ]) {
    await page.goto(path!);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title!);
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  }
  await expect(page.getByLabel('Nom de l’appareil')).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel('Nom de l’appareil')).toHaveCount(0);
  await page.getByRole('link', { name: 'Jeux', exact: true }).click();
  await expect(page.getByText('Bientôt disponible', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Jouer à la pétanque' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Jouer au Yams' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Pétanque', exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('catalog-mobile.png'), fullPage: true });
  await expect(
    page.getByRole('button', { name: 'Créer un jeu compteur', exact: true }),
  ).toHaveCount(0);
  expect(externalRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test('reports unavailable IndexedDB without claiming a successful save', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', {
      get() {
        throw new DOMException('Blocked', 'SecurityError');
      },
    });
  });
  await page.goto('/settings/');
  await expect(page.getByRole('alert')).toContainText('Le stockage local est indisponible');
  await expect(page.getByLabel('Nom de l’appareil')).toHaveCount(0);
  const backup = page.getByRole('region', { name: 'Sauvegarde JSON', exact: true });
  await backup.getByRole('button', { name: 'Exporter en JSON', exact: true }).click();
  await expect(backup.getByRole('alert')).toContainText('Le stockage local est indisponible');
  await page.goto('/');
  await expect(page.getByRole('status')).toContainText('Impossible de lire les parties.');
  await expect(page.getByRole('heading', { name: 'Une belle série à commencer' })).toHaveCount(0);
});

test('provides installation assets and keyboard navigation on desktop', async ({
  page,
  request,
  browserName,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
  await expect(page.getByRole('link', { name: 'Aller au contenu' })).toBeFocused();
  await page.screenshot({ path: test.info().outputPath('home-desktop.png'), fullPage: true });
  await page.getByRole('link', { name: 'Jeux', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Jeux', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  expect(
    (await request.get('/', { headers: { 'X-Scoretrackrr-Test-Offline': '1' } })).status(),
  ).toBe(503);
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest.display).toBe('standalone');
  for (const icon of manifest.icons) expect((await request.get(icon.src)).ok()).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
