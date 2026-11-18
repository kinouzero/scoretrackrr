import { waitForOfflineReady } from '../fixtures/offline';
import { expect, test, type Page } from '../fixtures/browser';

async function createProfiles(page: Page) {
  await page.goto('/players/');
  for (const name of ['Alice', 'Lucas', 'Emma', 'Hugo']) {
    await page.getByRole('button', { name: 'Ajouter un joueur' }).click();
    await page.getByLabel('Pseudonyme').fill(name);
    if (name === 'Hugo') await page.getByLabel('Invité sans compte', { exact: true }).check();
    await page.getByRole('button', { name: 'Enregistrer le profil' }).click();
    await expect(page.getByRole('article', { name, exact: true })).toBeVisible();
  }
  await page.goto('/teams/');
}

async function createTeam(page: Page) {
  await page.getByRole('button', { name: 'Créer une équipe', exact: true }).click();
  await page.getByLabel('Nom de l’équipe', { exact: true }).fill('Les amis');
  await page.getByLabel('Composition', { exact: true }).selectOption('petanque_doublette');
  await page.getByRole('checkbox', { name: 'Sélectionner Alice', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Sélectionner Lucas', exact: true }).check();
  await page.getByRole('button', { name: 'Enregistrer l’équipe', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Les amis', exact: true })).toBeVisible();
}

test('manages reusable rosters, size errors and confirmed deletion entirely offline', async ({
  page,
  context,
}) => {
  const external: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.protocol.startsWith('http') && url.origin !== 'http://127.0.0.1:4178')
      external.push(request.url());
  });
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await createProfiles(page);
  await createTeam(page);
  await page.getByRole('button', { name: 'Modifier l’équipe Les amis', exact: true }).click();
  await expect(page.getByLabel('Nom de l’équipe', { exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Retirer Lucas', exact: true }).click();
  await page.getByRole('button', { name: 'Enregistrer l’équipe', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
    'exactement 2 pour une doublette',
  );
  await page.getByRole('checkbox', { name: 'Sélectionner Emma', exact: true }).check();
  await page.getByRole('radio', { name: 'Étoile', exact: true }).check();
  await page.getByLabel('Nom de l’équipe', { exact: true }).fill('Les étoiles');
  await page.getByRole('button', { name: 'Enregistrer l’équipe', exact: true }).click();
  const card = page.getByRole('article', { name: 'Les étoiles', exact: true });
  await expect(card.getByText('Alice', { exact: true })).toBeVisible();
  await expect(card.getByText('Emma', { exact: true })).toBeVisible();
  await expect(card.getByText('Lucas', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(card).toBeVisible();
  await page.getByRole('button', { name: 'Modifier l’équipe Les étoiles', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', { name: 'Modifier l’équipe Les étoiles', exact: true }),
  ).toBeFocused();
  await expect(page.getByLabel('Voir les équipes archivées')).toHaveCount(0);
  await page.getByRole('button', { name: 'Supprimer l’équipe Les étoiles', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Annuler', exact: true }).click();
  await expect(card).toBeVisible();
  await page.getByRole('button', { name: 'Supprimer l’équipe Les étoiles', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Supprimer l’équipe Les étoiles ?');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Supprimer l’équipe', exact: true })
    .click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(card).toHaveCount(0);
  await page.reload();
  await expect(card).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Restaurer l’équipe/ })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('teams-mobile.png'), fullPage: true });
  expect(external).toEqual([]);
});

test('previews and persists reusable random teams offline', async ({ page, context }) => {
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await createProfiles(page);
  await page.getByRole('button', { name: 'Tirer au sort des équipes' }).click();
  for (const name of ['Alice', 'Lucas', 'Emma'])
    await page.getByRole('checkbox', { name: `Sélectionner ${name}`, exact: true }).check();
  await page.getByRole('button', { name: 'Répartir les joueurs', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('sans joueur restant');
  await page.getByRole('checkbox', { name: 'Sélectionner Hugo', exact: true }).check();
  await page.getByRole('button', { name: 'Répartir les joueurs', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Composition proposée' })).toBeVisible();
  await page.getByRole('button', { name: 'Retirer Hugo', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Enregistrer les équipes', exact: true }),
  ).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Sélectionner Hugo', exact: true }).check();
  await page.getByRole('button', { name: 'Répartir les joueurs', exact: true }).click();
  await page.getByLabel('Nom de l’équipe 1', { exact: true }).fill('Les bleus');
  await page.getByLabel('Nom de l’équipe 2', { exact: true }).fill('Les rouges');
  await page.screenshot({
    path: test.info().outputPath('team-distribution-mobile.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Enregistrer les équipes', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(2);
  const rosters = await page.locator('.team-members').allTextContents();
  for (const name of ['Alice', 'Lucas', 'Emma', 'Hugo'])
    expect(rosters.join(' ').split(name)).toHaveLength(2);
  for (const card of await page.getByRole('article').all())
    await expect(card.locator('.team-members li')).toHaveCount(2);
  await page.reload();
  await expect(page.getByLabel('Utilisation', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('article', { name: 'Les bleus', exact: true })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Les rouges', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: test.info().outputPath('teams-desktop.png'), fullPage: true });
});

test('preserves rosters and form input after concurrent or quota failures', async ({
  page,
  context,
}) => {
  await createProfiles(page);
  await createTeam(page);
  await page.getByRole('button', { name: 'Modifier l’équipe Les amis', exact: true }).click();
  await page.getByLabel('Nom de l’équipe', { exact: true }).fill('Stale team');
  const other = await context.newPage();
  await other.goto('/teams/');
  await other.getByRole('button', { name: 'Modifier l’équipe Les amis', exact: true }).click();
  await other.getByLabel('Nom de l’équipe', { exact: true }).fill('Latest team');
  await other.getByRole('button', { name: 'Enregistrer l’équipe', exact: true }).click();
  await expect(other.getByRole('article', { name: 'Latest team', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Enregistrer l’équipe', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Cette équipe a changé');
  await page.keyboard.press('Escape');
  await page.reload();
  await page.getByRole('button', { name: 'Modifier l’équipe Latest team', exact: true }).click();
  await page.getByRole('button', { name: 'Retirer Lucas', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Sélectionner Emma', exact: true }).check();
  await page.getByLabel('Nom de l’équipe', { exact: true }).fill('Unsaved team');
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'teams') throw new DOMException('Full', 'QuotaExceededError');
      return put.apply(this, args);
    };
  });
  await page.getByRole('button', { name: 'Enregistrer l’équipe', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
    'Le stockage de cet appareil est plein',
  );
  await expect(page.getByLabel('Nom de l’équipe', { exact: true })).toHaveValue('Unsaved team');
  await page.keyboard.press('Escape');
  await page.reload();
  const card = page.getByRole('article', { name: 'Latest team', exact: true });
  await expect(card.getByText('Lucas', { exact: true })).toBeVisible();
  await expect(card.getByText('Emma', { exact: true })).toHaveCount(0);
});
