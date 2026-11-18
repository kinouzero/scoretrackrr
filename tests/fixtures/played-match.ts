import { expect, type Page } from '@playwright/test';
import { savedCustomGame } from './custom-games';
import { waitForOfflineReady } from './offline';

export async function createMatch(page: Page) {
  await page.goto('/');
  await waitForOfflineReady(page);
  await page.context().setOffline(true);
  await page.goto('/players/');
  for (const name of ['Alice', 'Bob']) {
    await page.getByRole('button', { name: 'Ajouter un joueur' }).click();
    await page.getByLabel('Pseudonyme').fill(name);
    await page.getByRole('button', { name: 'Enregistrer le profil' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  }
  await page.goto('/games/');
  await savedCustomGame(page, 'Match actions', { target: 1 });
  await page
    .getByRole('article', { name: 'Match actions', exact: true })
    .getByRole('link', { name: 'Jouer à ce jeu', exact: true })
    .click();
  const setup = page.getByRole('dialog');
  for (const name of ['Alice', 'Bob'])
    await setup.getByRole('checkbox', { name: `Sélectionner ${name}`, exact: true }).check();
  await setup.getByRole('button', { name: 'Créer la partie', exact: true }).click();
  await page.getByRole('button', { name: 'Démarrer la partie', exact: true }).click();
  await expect(page.locator('.match-identity .match-status')).toHaveText('En cours');
  return page.url();
}
