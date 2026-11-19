import { seedPlayers } from '../fixtures/players';
import { configureDarts } from '../fixtures/setup-settings';
import { waitForOfflineReady } from '../fixtures/offline';
import { expect, test, type Page } from '../fixtures/browser';
async function create(page: Page, variant = 'Cricket · points classiques', series = false) {
  await seedPlayers(page, ['Alice', 'Bob']);
  await page.goto('/games/');
  const card = page.getByRole('article', { name: 'Darts X01 / Cricket', exact: true });
  await card.getByRole('link', { name: 'Jouer aux fléchettes', exact: true }).click();
  const setup = page.getByRole('dialog');
  await configureDarts(setup, variant);
  for (const name of ['Alice', 'Bob'])
    await setup.getByRole('checkbox', { name: `Sélectionner ${name}`, exact: true }).check();
  if (series) {
    await setup.getByRole('switch', { name: 'Match en plusieurs legs', exact: true }).check();
    await setup.getByLabel('Nombre de legs à gagner', { exact: true }).fill('2');
  }
  await expect(setup.getByLabel('Organisateur sur cet appareil')).toHaveCount(0);
  await setup.getByRole('button', { name: 'Créer la partie', exact: true }).click();
  await page.getByRole('button', { name: 'Démarrer la partie', exact: true }).click();
}
function thrower(page: Page) {
  let sequence = 1;
  return async (sector: number, multiplier = 1) => {
    await page.getByLabel('Secteur touché', { exact: true }).selectOption(String(sector));
    await page.getByLabel('Multiplicateur', { exact: true }).selectOption(String(multiplier));
    await page.getByRole('button', { name: 'Enregistrer la fléchette', exact: true }).click();
    sequence++;
    await expect(
      page.getByRole('heading', { name: `Action n°${sequence}`, exact: true }),
    ).toBeVisible();
  };
}
test('plays classic Cricket offline, shows marks, waits for score parity and undoes a winning hit', async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await create(page);
  const dart = thrower(page);
  await expect(page.getByRole('complementary', { name: /Sorties possibles/ })).toHaveCount(0);
  const grid = page.getByRole('table', { name: 'Grille de Cricket', exact: true });
  await dart(19, 3);
  await dart(0);
  await dart(0);
  await dart(20, 3);
  await dart(20, 3);
  await dart(0);
  for (const sector of [20, 18, 17]) await dart(sector, 3);
  for (let i = 0; i < 3; i++) await dart(0);
  await dart(16, 3);
  await dart(15, 3);
  await dart(25, 2);
  await expect(grid.getByLabel('Alice · bull : 2 marque(s) sur 3', { exact: true })).toBeVisible();
  for (let i = 0; i < 3; i++) await dart(0);
  await dart(25);
  await expect(
    grid.getByLabel('Alice · bull : 3 marque(s) sur 3 · fermé', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Terminée', { exact: true })).not.toBeVisible();
  await dart(15, 2);
  await dart(15, 2);
  await expect(page.getByText('Victoire : Alice', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Annuler la dernière saisie' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmer', exact: true }).click();
  await expect(page.getByText('Fléchette 3 sur 3', { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    grid.getByLabel('Alice · bull : 3 marque(s) sur 3 · fermé', { exact: true }),
  ).toBeVisible();
  await page.getByLabel('Secteur touché', { exact: true }).selectOption('15');
  await page.getByLabel('Multiplicateur', { exact: true }).selectOption('2');
  await page.getByRole('button', { name: 'Enregistrer la fléchette', exact: true }).click();
  await expect(page.getByText('Victoire : Alice', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Victoire : Alice', { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('cricket-offline.png'), fullPage: true });
  expect(errors).toEqual([]);
});
test('plays the no-score Cricket variant with excess hits worth zero', async ({ page }) => {
  await create(page, 'Cricket · sans points');
  const dart = thrower(page);
  await expect(page.getByRole('complementary', { name: /Sorties possibles/ })).toHaveCount(0);
  for (const targets of [
    [20, 20, 19],
    [18, 17, 16],
  ]) {
    for (const sector of targets) await dart(sector, 3);
    for (let i = 0; i < 3; i++) await dart(0);
  }
  await dart(15, 3);
  await dart(25, 2);
  await dart(25);
  await expect(page.getByText('Victoire : Alice', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText('Alice0');
  const stats = page.getByRole('table', { name: 'Statistiques de la partie' });
  await expect(stats.getByRole('row', { name: /^Alice / }).getByRole('cell')).toHaveText([
    '3',
    '21',
  ]);
});

test('resets Cricket marks between legs while retaining the match score and next starter', async ({
  page,
}) => {
  await create(page, 'Cricket · sans points', true);
  const dart = thrower(page);
  for (const targets of [
    [20, 19, 18],
    [17, 16, 15],
  ]) {
    for (const sector of targets) await dart(sector, 3);
    for (let i = 0; i < 3; i++) await dart(0);
  }
  await dart(25, 2);
  await dart(25);
  const summary = page.getByRole('region', { name: 'Score du match', exact: true });
  await expect(summary).toContainText('Alice : 1 leg(s) gagné(s)');
  await expect(summary).toContainText('Prochain leg : Bob commence');
  await expect(
    page.getByRole('button', { name: 'Enregistrer la fléchette', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Démarrer le leg 2', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Au tour de Bob', exact: true })).toBeVisible();
  await expect(
    page
      .getByRole('table', { name: 'Grille de Cricket', exact: true })
      .getByLabel('Alice · bull : 0 marque(s) sur 3', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(summary).toContainText('Alice : 1 leg(s) gagné(s)');
  await expect(page.getByRole('heading', { name: 'Au tour de Bob', exact: true })).toBeVisible();
});
