import { savedCustomGame } from '../fixtures/custom-games';
import { waitForOfflineReady } from '../fixtures/offline';
import { expect, test } from '../fixtures/browser';
test('plays named custom rounds in order offline, resumes and undoes the final score', async ({
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
  await savedCustomGame(page, 'Défi en manches', {
    target: undefined,
    turns: { rounds: 2, categories: ['Ouverture', 'Finale'] },
  });
  await page
    .getByRole('article', { name: 'Défi en manches', exact: true })
    .getByRole('link', { name: 'Jouer à ce jeu', exact: true })
    .click();
  const setup = page.getByRole('dialog');
  for (const name of ['Alice', 'Bob'])
    await setup.getByRole('checkbox', { name: `Sélectionner ${name}`, exact: true }).check();
  await expect(setup.getByLabel('Organisateur sur cet appareil')).toHaveCount(0);
  await setup.getByRole('button', { name: 'Créer la partie', exact: true }).click();
  await page.getByRole('button', { name: 'Démarrer la partie', exact: true }).click();
  const score = page.getByLabel('Points', { exact: true });
  const record = page.getByRole('button', { name: 'Enregistrer le score', exact: true });
  await expect(
    page.getByText('Manche 1/2 · Ouverture · Au tour de Alice', { exact: true }),
  ).toBeVisible();
  await score.fill('2');
  await record.click();
  await expect(
    page.getByText('Manche 1/2 · Ouverture · Au tour de Bob', { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Qui marque ?', { exact: true }).locator('option')).toHaveCount(2);
  await score.fill('1');
  await record.click();
  await expect(
    page.getByText('Manche 2/2 · Finale · Au tour de Alice', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText('Manche 2/2 · Finale · Au tour de Alice', { exact: true }),
  ).toBeVisible();
  await score.fill('0');
  await record.click();
  await expect(
    page.getByText('Manche 2/2 · Finale · Au tour de Bob', { exact: true }),
  ).toBeVisible();
  await score.fill('5');
  await record.click();
  await expect(page.getByText('Victoire : Bob', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Annuler cette saisie', exact: true }).first().click();
  await page.getByRole('button', { name: 'Confirmer', exact: true }).click();
  await expect(
    page.getByText('Manche 2/2 · Finale · Au tour de Bob', { exact: true }),
  ).toBeVisible();
  await score.fill('0');
  await record.click();
  await expect(page.getByText('Victoire : Alice', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Victoire : Alice', { exact: true })).toBeVisible();
});
