import { expect, test } from '../fixtures/browser';
import { waitForOfflineReady } from '../fixtures/offline';

test('switches languages offline, preserves open forms across tabs and remembers the choice', async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await page.goto('/settings/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page.getByRole('option', { name: 'Français', exact: true })).toHaveCount(1);
  await page.getByLabel('Langue de l’application', { exact: true }).selectOption('en');
  await expect(page.getByRole('heading', { name: 'Make it yours', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation')).toContainText('Matches');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByText('Language saved on this device.', { exact: true })).toBeVisible();
  const other = await context.newPage();
  other.on('pageerror', (error) => errors.push(error.message));
  await other.goto('/players/');
  await other.getByRole('button', { name: 'Add player', exact: true }).click();
  await other.getByLabel('Nickname', { exact: true }).fill('Élodie');
  await page.getByLabel('App language', { exact: true }).selectOption('fr');
  await expect(other.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(other.getByLabel('Pseudonyme', { exact: true })).toHaveValue('Élodie');
  await other.getByRole('button', { name: 'Enregistrer le profil', exact: true }).click();
  await expect(other.getByRole('dialog')).not.toBeVisible();
  await page.getByLabel('Langue de l’application', { exact: true }).selectOption('en');
  await expect(other.getByText('Élodie', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('App language', { exact: true })).toHaveValue('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  for (const [route, title] of [
    ['/', 'Your next game starts here.'],
    ['/games/', 'What shall we play?'],
    ['/teams/', 'Team spirit'],
    ['/matches/', 'Your matches'],
  ]) {
    await page.goto(route!);
    await expect(page.getByRole('heading', { name: title!, exact: true })).toBeVisible();
  }
  await page.goto('/games/');
  await page.getByLabel('Search games', { exact: true }).fill('6 nimmt');
  await expect(page.getByRole('article')).toHaveCount(1);
  await page.getByRole('link', { name: 'Play 6 nimmt!', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByLabel('Search players', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Create match', exact: true }),
  ).toBeDisabled();
  expect(errors).toEqual([]);
  await other.close();
});

test('plays darts in English offline and localizes an existing match without changing scores', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await page.goto('/settings/');
  await page.getByLabel('Langue de l’application', { exact: true }).selectOption('en');
  await page.goto('/players/');
  for (const name of ['Zoé', 'Bob']) {
    await page.getByRole('button', { name: 'Add player', exact: true }).click();
    await page.getByLabel('Nickname', { exact: true }).fill(name);
    await page.getByRole('button', { name: 'Save profile', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  }
  await page.goto('/games/');
  await page.getByRole('link', { name: 'Play darts', exact: true }).click();
  const setup = page.getByRole('dialog');
  await expect(setup.getByLabel('Starting score', { exact: true })).toHaveValue('301');
  await expect(setup.getByRole('switch', { name: 'Double-out', exact: true })).toBeChecked();
  for (const name of ['Zoé', 'Bob'])
    await setup.getByRole('checkbox', { name: `Select ${name}`, exact: true }).check();
  await setup.getByRole('button', { name: 'Create match', exact: true }).click();
  await page.getByRole('button', { name: 'Start match', exact: true }).click();
  const options = page.getByRole('list', { name: 'Match settings', exact: true });
  await expect(options.getByRole('listitem')).toHaveText([
    'Individual',
    '2 players',
    'X01 · 301',
    'Double-out',
  ]);
  await expect(page.getByText(/Saved rules:/)).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Export match and journal', exact: true }),
  ).toHaveCount(0);
  await page.getByLabel('Sector hit', { exact: true }).selectOption('20');
  await page.getByLabel('Multiplier', { exact: true }).selectOption('3');
  await page.getByRole('button', { name: 'Record dart', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText('Zoé241');
  const url = page.url();
  const settings = await context.newPage();
  await settings.goto('/settings/');
  await settings.getByLabel('App language', { exact: true }).selectOption('fr');
  await expect(
    page.getByRole('button', { name: 'Enregistrer la fléchette', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText('Zoé241');
  await expect(page.getByRole('heading', { name: 'Action n°2', exact: true })).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Paramètres de la partie', exact: true }).getByRole('listitem'),
  ).toHaveText(['Chacun pour soi', '2 joueurs', 'X01 · 301', 'Sortie double']);
  await expect(page.getByText(/Règles conservées/)).toHaveCount(0);
  expect(page.url()).toBe(url);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText('Zoé241');
  await page.getByRole('button', { name: 'Mettre en pause', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Vos parties', exact: true })).toBeVisible();
  const card = page.locator('.match-card[data-game="darts"]');
  await expect(
    card.getByRole('list', { name: 'Paramètres de la partie', exact: true }).getByRole('listitem'),
  ).toHaveText(['Chacun pour soi', '2 joueurs', 'X01 · 301', 'Sortie double']);
  await settings.getByLabel('Langue de l’application', { exact: true }).selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  const englishCard = card;
  await expect(
    englishCard.getByRole('list', { name: 'Match settings', exact: true }).getByRole('listitem'),
  ).toHaveText(['Individual', '2 players', 'X01 · 301', 'Double-out']);
  await page.reload();
  await expect(
    englishCard.getByRole('list', { name: 'Match settings', exact: true }),
  ).toContainText('X01 · 301');
  await settings.close();
});
