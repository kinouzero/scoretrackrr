import { seedPlayers } from '../fixtures/players';
import { waitForOfflineReady } from '../fixtures/offline';
import { expect, test, type Page } from '../fixtures/browser';
const categories = [
  'Les 1',
  'Les 2',
  'Les 3',
  'Les 4',
  'Les 5',
  'Les 6',
  'Brelan',
  'Carré',
  'Full',
  'Petite suite',
  'Grande suite',
  'Yams',
  'Chance',
];
async function create(
  page: Page,
  upperBonus = true,
  configure?: (setup: ReturnType<Page['getByRole']>) => Promise<void>,
  names = ['Alice', 'Bob'],
) {
  await seedPlayers(page, names);
  await page.goto('/games/');
  const card = page.getByRole('article', { name: 'Yams', exact: true });
  await card.getByRole('link', { name: 'Jouer au Yams', exact: true }).click();
  const setup = page.getByRole('dialog', { name: 'Préparer une partie de Yams', exact: true });
  await setup.getByRole('switch', { name: 'Prime supérieure', exact: true }).setChecked(upperBonus);
  if (configure) await configure(setup);
  for (const name of names)
    await setup.getByRole('checkbox', { name: `Sélectionner ${name}`, exact: true }).check();
  await expect(setup.getByLabel('Organisateur sur cet appareil')).toHaveCount(0);
  await setup.getByRole('button', { name: 'Créer la partie', exact: true }).click();
  await page.getByRole('button', { name: 'Démarrer la partie', exact: true }).click();
  await expect(page.locator('.match-identity .match-status')).toHaveText('En cours');
}
async function cell(
  page: Page,
  owner: string,
  category: number,
  points: number,
  previous: number | null = null,
) {
  await page
    .getByRole('button', {
      name: `${owner} — ${categories[category]} : ${previous === null ? 'à remplir' : previous}`,
      exact: true,
    })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Saisir ou corriger une case', exact: true });
  await dialog.getByLabel('Score de la case', { exact: true }).selectOption(String(points));
  await dialog.getByRole('button', { name: 'Confirmer', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole('button', {
      name: `${owner} — ${categories[category]} : ${points}`,
      exact: true,
    }),
  ).toBeVisible();
}
test('plays all thirteen categories offline, recalculates bonus after correction and reopens a completed grid', async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await create(page);
  const scores = page.getByRole('region', { name: 'Scores', exact: true });
  for (let category = 0; category < 6; category++) {
    await cell(page, 'Alice', category, (category + 1) * 3);
    await cell(page, 'Bob', category, 0);
  }
  await expect(scores).toContainText('Alice98');
  const table = page.getByRole('table', { name: 'Grille de Yams', exact: true });
  await expect(
    table
      .getByRole('row', { name: /^Prime supérieure/ })
      .getByRole('cell')
      .first(),
  ).toHaveText('35');
  await page.getByRole('button', { name: 'Mettre en pause', exact: true }).click();
  await expect(page.locator('.match-card')).toContainText('En pause');
  await page.reload();
  await expect(page.locator('.match-card')).toContainText('En pause');
  await page.getByRole('button', { name: 'Reprendre', exact: true }).click();
  await page.getByRole('button', { name: 'Corriger la grille', exact: true }).click();
  await cell(page, 'Alice', 5, 12, 18);
  await page.getByRole('button', { name: 'Revenir au jeu', exact: true }).click();
  await expect(scores).toContainText('Alice57');
  await expect(
    table
      .getByRole('row', { name: /^Prime supérieure/ })
      .getByRole('cell')
      .first(),
  ).toHaveText('0');
  for (let category = 6; category < 13; category++) {
    await cell(page, 'Alice', category, 0);
    await cell(page, 'Bob', category, 0);
  }
  await expect(scores).toContainText('Victoire : Alice');
  await expect(page.getByRole('button', { name: /à remplir$/ })).toHaveCount(0);
  await page.reload();
  await expect(scores).toContainText('Victoire : Alice');
  await page.getByRole('button', { name: 'Bob — Chance : 0', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Saisir ou corriger une case' })
    .getByRole('button', { name: 'Annuler cette case', exact: true })
    .click();
  await expect(page.locator('.match-page-heading')).toContainText('En cours');
  await expect(
    page.getByRole('button', { name: 'Bob — Chance : à remplir', exact: true }),
  ).toBeEnabled();
  await page.screenshot({ path: test.info().outputPath('yams-grid-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: test.info().outputPath('yams-grid-desktop.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
test('computes an assisted full house and supports the explicit no-upper-bonus variant', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await create(page, false);
  await page.getByRole('button', { name: 'Alice — Full : à remplir', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Saisir ou corriger une case' });
  await dialog.getByLabel('Calculer depuis les dés', { exact: true }).check();
  for (let index = 0; index < 5; index++)
    await dialog.getByLabel(`Dé ${index + 1}`, { exact: true }).selectOption(index < 3 ? '2' : '3');
  await expect(dialog.getByText('Score calculé : 25', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Confirmer', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Alice — Full : 25', exact: true })).toBeVisible();
  await cell(page, 'Bob', 0, 0);
  for (let category = 0; category < 6; category++) {
    await cell(page, 'Alice', category, (category + 1) * 3);
    await cell(page, 'Bob', category + 1, 0);
  }
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText('Alice88');
  const table = page.getByRole('table', { name: 'Grille de Yams', exact: true });
  await expect(
    table
      .getByRole('row', { name: /^Prime supérieure/ })
      .getByRole('cell')
      .first(),
  ).toHaveText('0');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Alice — Full : 25', exact: true })).toBeVisible();
});

test('locks other columns, scores custom straights and fixed four of a kind, and persists saved options', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  const players = ['Alice', 'Bob', 'Charlie', 'Diane', 'Emma', 'Noah'];
  await create(
    page,
    false,
    async (setup) => {
      await setup.getByRole('switch', { name: 'Carré à 40 points', exact: true }).check();
      await setup.getByLabel('Valeur des suites', { exact: true }).selectOption('custom');
      await setup.getByLabel('Points de la petite suite', { exact: true }).fill('17');
      await setup.getByLabel('Points de la grande suite', { exact: true }).fill('58');
      await setup
        .getByRole('switch', { name: 'Bonus Yams supplémentaires', exact: true })
        .uncheck();
      await setup.getByRole('switch', { name: 'Joker', exact: true }).uncheck();
    },
    players,
  );
  const empty = (name: string, category: number) =>
    page.getByRole('button', {
      name: `${name} — ${categories[category]} : à remplir`,
      exact: true,
    });
  await expect(page.getByText('À Alice de jouer', { exact: true })).toBeVisible();
  await expect(empty('Bob', 7)).toBeDisabled();
  await empty('Alice', 7).click();
  let dialog = page.getByRole('dialog', { name: 'Saisir ou corriger une case', exact: true });
  await dialog.getByLabel('Calculer depuis les dés', { exact: true }).check();
  for (let i = 0; i < 5; i++)
    await dialog.getByLabel(`Dé ${i + 1}`, { exact: true }).selectOption(i < 4 ? '5' : '2');
  await expect(dialog.getByText('Score calculé : 40', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Confirmer', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(empty('Alice', 9)).toBeDisabled();
  await expect(empty('Bob', 9)).toBeEnabled();
  await page.reload();
  await expect(page.getByText('À Bob de jouer', { exact: true })).toBeVisible();
  const finishOthers = async (category: number) => {
    for (const player of players.slice(1)) {
      await expect(page.getByText(`À ${player} de jouer`, { exact: true })).toBeVisible();
      await expect
        .poll(() =>
          page.locator('th[aria-current="true"]').evaluate((column) => {
            const region = column.closest('.yams-scroll')!.getBoundingClientRect();
            const bounds = column.getBoundingClientRect();
            const label = column.closest('table')!.querySelector('th')!.getBoundingClientRect();
            return bounds.left >= label.right - 2 && bounds.right <= region.right + 2;
          }),
        )
        .toBe(true);
      await cell(page, player, category, 0);
    }
  };
  await finishOthers(0);
  await cell(page, 'Alice', 9, 17);
  await finishOthers(1);
  await empty('Alice', 10).click();
  dialog = page.getByRole('dialog', { name: 'Saisir ou corriger une case', exact: true });
  await dialog.getByLabel('Calculer depuis les dés', { exact: true }).check();
  for (let i = 0; i < 5; i++)
    await dialog.getByLabel(`Dé ${i + 1}`, { exact: true }).selectOption(String(i + 2));
  await expect(dialog.getByText('Score calculé : 58', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Confirmer', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText('Alice115');
  await page.getByRole('button', { name: 'Mettre en pause', exact: true }).click();
  const card = page.locator('.match-card');
  for (const label of ['Carré · 40 points', 'Suites · 17 / 58', 'Sans bonus Yams', 'Sans joker'])
    await expect(card.getByText(label, { exact: true })).toBeVisible();
});

test('exposes 25/30 straights, free four of a kind and independent options in English', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await create(page, true, async (setup) => {
    await setup.getByLabel('Valeur des suites', { exact: true }).selectOption('25/30');
    await setup.getByRole('switch', { name: 'Joker', exact: true }).uncheck();
  });
  await cell(page, 'Alice', 9, 25);
  await cell(page, 'Bob', 0, 0);
  await cell(page, 'Alice', 10, 30);
  await cell(page, 'Bob', 1, 0);
  await cell(page, 'Alice', 7, 22);
  const matchUrl = page.url();
  await page.goto('/settings/');
  await page.getByLabel('Langue de l’application', { exact: true }).selectOption('en');
  await page.goto(matchUrl);
  await expect(page.getByText('Bob’s turn', { exact: true })).toBeVisible();
  await expect(page.getByText('Straights · 25 / 30', { exact: true })).toBeVisible();
  await expect(page.getByText('Four of a kind · dice total', { exact: true })).toBeVisible();
  await expect(page.getByText('Yams bonus · +100', { exact: true })).toBeVisible();
  await expect(page.getByText('No joker', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText('Alice77');
});

test('applies repeated-Yams bonus and forced joker placement, then recalculates bonuses on correction', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await create(page);
  await cell(page, 'Alice', 11, 50);
  await cell(page, 'Bob', 0, 0);
  await page.getByRole('button', { name: 'Alice — Full : à remplir', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Saisir ou corriger une case', exact: true });
  await dialog.getByLabel('Nouveau Yams (cinq dés identiques)', { exact: true }).check();
  await dialog.getByLabel('Valeur des cinq dés', { exact: true }).selectOption('3');
  await expect(dialog.getByRole('button', { name: 'Confirmer', exact: true })).toBeDisabled();
  await expect(dialog.getByText(/Le joker doit remplir/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
  const repeat = async (category: number, points: number) => {
    await page
      .getByRole('button', { name: `Alice — ${categories[category]} : à remplir`, exact: true })
      .click();
    dialog = page.getByRole('dialog', { name: 'Saisir ou corriger une case', exact: true });
    await dialog.getByLabel('Nouveau Yams (cinq dés identiques)', { exact: true }).check();
    await dialog.getByLabel('Valeur des cinq dés', { exact: true }).selectOption('3');
    await expect(dialog.getByText(`Score calculé : ${points}`, { exact: true })).toBeVisible();
    await expect(
      dialog.getByText('Yams supplémentaire : +100 points', { exact: true }),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Confirmer', exact: true }).click();
    await expect(dialog).not.toBeVisible();
  };
  await repeat(2, 15);
  await cell(page, 'Bob', 1, 0);
  await repeat(8, 25);
  await cell(page, 'Bob', 2, 0);
  const scores = page.getByRole('region', { name: 'Scores', exact: true });
  await expect(scores).toContainText('Alice290');
  await page.reload();
  await expect(scores).toContainText('Alice290');
  await page.getByRole('button', { name: 'Corriger la grille', exact: true }).click();
  await cell(page, 'Alice', 11, 0, 50);
  await expect(scores).toContainText('Alice40');
  await cell(page, 'Alice', 11, 50, 0);
  await expect(scores).toContainText('Alice290');
  await page.getByRole('button', { name: 'Revenir au jeu', exact: true }).click();
  await expect(page.getByText('À Alice de jouer', { exact: true })).toBeVisible();
});
