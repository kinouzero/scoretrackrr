import { readFile } from 'node:fs/promises';
import { expect, test } from '../fixtures/browser';
import { waitForOfflineReady } from '../fixtures/offline';

test('loads only the chosen game controls and recovers from an unavailable offline chunk without losing the match', async ({
  page,
  context,
}) => {
  const manifest = JSON.parse(
    await readFile('.svelte-kit/output/client/.vite/manifest.json', 'utf8'),
  ) as Record<string, { file: string }>;
  const path = `/${manifest['src/lib/components/DartsControls.svelte']!.file}`;
  const unused = `/${manifest['src/lib/components/FarkleControls.svelte']!.file}`;
  const body = await readFile(`build${path}`, 'utf8');
  await page.goto('/');
  await waitForOfflineReady(page);
  await page.evaluate(async (path) => {
    for (const name of await caches.keys())
      if (name.startsWith('scoretrackrr-shell-'))
        await (
          await caches.open(name)
        ).put(
          path,
          new Response('Synthetic unavailable asset', {
            status: 503,
            headers: { 'content-type': 'text/javascript', 'cache-control': 'no-store' },
          }),
        );
  }, path);
  await context.setOffline(true);
  await page.goto('/players/');
  for (const name of ['Alice', 'Bob']) {
    await page.getByRole('button', { name: 'Ajouter un joueur', exact: true }).click();
    await page.getByLabel('Pseudonyme', { exact: true }).fill(name);
    await page.getByRole('button', { name: 'Enregistrer le profil', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  }
  await page.goto('/games/');
  await page
    .getByRole('article', { name: 'X01', exact: true })
    .getByRole('link', { name: 'Jouer au X01', exact: true })
    .click();
  const setup = page.getByRole('dialog');
  for (const name of ['Alice', 'Bob'])
    await setup.getByRole('checkbox', { name: `Sélectionner ${name}`, exact: true }).check();
  await setup.getByRole('button', { name: 'Créer la partie', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Impossible de charger les commandes du jeu.' }),
  ).toBeVisible();
  const matchUrl = page.url();
  await page.evaluate(
    async ({ path, body }) => {
      const name = (await caches.keys()).find((name) => name.startsWith('scoretrackrr-shell-'))!;
      await (
        await caches.open(name)
      ).put(path, new Response(body, { headers: { 'content-type': 'text/javascript' } }));
    },
    { path, body },
  );
  await page.getByRole('button', { name: 'Réessayer', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Démarrer la partie', exact: true })).toBeVisible();
  expect(page.url()).toBe(matchUrl);
  await page.getByRole('button', { name: 'Démarrer la partie', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Au tour de Alice', exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      (path) =>
        performance
          .getEntriesByType('resource')
          .some((entry) => new URL(entry.name).pathname === path),
      unused,
    ),
  ).toBe(false);
});
