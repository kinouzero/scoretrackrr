import { waitForOfflineReady } from '../fixtures/offline';
import { expect, test } from '../fixtures/browser';

test('opens all twenty-one games and resumes an actual local match from the dashboard offline', async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await waitForOfflineReady(page);
  await expect(page.getByRole('heading', { name: 'Une belle série à commencer' })).toBeVisible();
  const games = page.getByRole('region', { name: 'À chaque envie, sa partie' });
  const alphabeticalGames = [
    '421',
    '5000 / 10000',
    '6 qui prend !',
    '7 Wonders',
    'Belote / Coinche',
    'Cricket',
    'Dominos',
    'Flip 7',
    'Mölkky',
    'Pétanque',
    'Qwixx',
    'Rami',
    'Scrabble',
    'Skull King',
    'Skyjo',
    'Tarot',
    'Time’s Up!',
    'Très Futé !',
    'UNO / UNO Flip',
    'X01',
    'Yams',
  ];
  await expect(games.locator('.quick-game > strong')).toHaveText(alphabeticalGames);
  for (const name of alphabeticalGames) {
    await expect(
      games.getByRole('link', { name: new RegExp(name.replaceAll('/', '\\/')) }),
    ).toBeVisible();
  }
  await games.getByRole('link', { name: /Skull King/ }).click();
  await expect(page).toHaveURL(/games.*#game-skull-king/);
  await expect(page.getByRole('article', { name: 'Skull King', exact: true })).toBeInViewport();
  await context.setOffline(true);
  await page.goto('/players/');
  for (const name of ['Alice', 'Bob']) {
    await page.getByRole('button', { name: 'Ajouter un joueur' }).click();
    await page.getByLabel('Pseudonyme').fill(name);
    await page.getByRole('button', { name: 'Enregistrer le profil' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  }
  await page.goto('/games/');
  await page.getByRole('link', { name: 'Jouer à la pétanque', exact: true }).click();
  const setup = page.getByRole('dialog', { name: 'Préparer la partie' });
  for (const name of ['Alice', 'Bob'])
    await setup.getByRole('checkbox', { name: `Sélectionner ${name}`, exact: true }).check();
  await expect(setup.getByLabel('Organisateur sur cet appareil')).toHaveCount(0);
  await setup.getByLabel('Premier lancer du cochonnet').selectOption({ label: 'Alice' });
  await setup.getByRole('button', { name: 'Créer la partie', exact: true }).click();
  await expect(setup).not.toBeVisible();
  const matchUrl = page.url();
  await page.getByRole('button', { name: 'Démarrer la partie', exact: true }).click();
  await expect(page.getByRole('form', { name: 'Enregistrer la mène' })).toBeVisible();
  await page.goto('/');
  const recent = page.getByRole('region', { name: 'Vos dernières parties' });
  await expect(recent).toContainText('Alice · Bob');
  await expect(recent).toContainText('En cours');
  await page.reload();
  await recent.getByRole('link', { name: /Alice · Bob/ }).click();
  await expect(page).toHaveURL(matchUrl);
  await expect(page.getByRole('form', { name: 'Enregistrer la mène' })).toBeVisible();
  await page.getByRole('button', { name: 'Mettre en pause', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Vos parties', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Nouvelle partie', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(21);
  await expect(page.getByRole('article').getByRole('heading', { level: 2 })).toHaveText(
    alphabeticalGames,
  );
  expect(errors).toEqual([]);
});
