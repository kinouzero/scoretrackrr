import { savedCustomGame } from '../fixtures/custom-games';
import { waitForOfflineReady } from '../fixtures/offline';
import { expect, test } from '../fixtures/browser';
test('filters immutable local history without match export or a statistics menu offline', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await page.goto('/players/');
  for (const name of ['Alice', 'Bob']) {
    await page.getByRole('button', { name: 'Ajouter un joueur' }).click();
    await page.getByLabel('Pseudonyme').fill(name);
    await page.getByRole('button', { name: 'Enregistrer le profil' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  }
  await page.goto('/games/');
  await savedCustomGame(page, 'Course historique', { target: 10 });
  await page
    .getByRole('article', { name: 'Course historique', exact: true })
    .getByRole('link', { name: 'Jouer à ce jeu', exact: true })
    .click();
  const setup = page.getByRole('dialog');
  for (const name of ['Alice', 'Bob'])
    await setup.getByRole('checkbox', { name: `Sélectionner ${name}`, exact: true }).check();
  await expect(setup.getByLabel('Organisateur sur cet appareil')).toHaveCount(0);
  await setup.getByRole('button', { name: 'Créer la partie', exact: true }).click();
  await page.getByRole('button', { name: 'Démarrer la partie', exact: true }).click();
  await page.getByLabel('Qui marque ?', { exact: true }).selectOption({ label: 'Alice' });
  await page.getByLabel('Points', { exact: true }).fill('10');
  await page.getByRole('button', { name: 'Enregistrer le score', exact: true }).click();
  await expect(page.getByText('Victoire : Alice', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Exporter cette partie et son journal', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: 'Télécharger l’archive JSON de la partie', exact: true }),
  ).toHaveCount(0);
  const journal = page.getByRole('list', { name: 'Historique des actions', exact: true });
  await expect(journal.getByRole('listitem')).toHaveCount(2);
  await expect(journal).toContainText('Saisie pour Alice');
  await page.getByRole('link', { name: 'Toutes les parties', exact: true }).click();
  const card = page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: 'Course historique', exact: true }) });
  await expect(
    card.getByRole('list', { name: 'Paramètres de la partie', exact: true }).getByRole('listitem'),
  ).toHaveText(['Chacun pour soi', '2 joueurs', 'Objectif · 10 points']);
  const filters = page.locator('.history-search-controls');
  await expect(filters.locator('input[type=date]')).toHaveCount(0);
  const search = page.getByRole('searchbox', { name: 'Rechercher une partie', exact: true });
  await expect(page.getByRole('searchbox')).toHaveCount(1);
  await expect(page.locator('#history-player, #history-team')).toHaveCount(0);
  await search.fill('absent');
  await expect(
    page.getByRole('list', { name: 'Parties enregistrées', exact: true }).getByRole('listitem'),
  ).toHaveCount(0);
  await search.fill('Course ALICE');
  await filters.getByLabel('État de la partie', { exact: true }).selectOption('finished');
  await expect(page.getByRole('link', { name: 'Consulter', exact: true })).toHaveCount(1);
  await expect(page.getByText('Statistiques locales', { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Calculer les statistiques', exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('Statistiques locales', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Consulter', exact: true })).toHaveCount(1);
  await page.getByRole('link', { name: 'Consulter', exact: true }).click();
  await expect(page.getByText('Victoire : Alice', { exact: true })).toBeVisible();
});
