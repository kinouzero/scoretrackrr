import { seedPlayers } from '../fixtures/players';
import { expect, test, type Page } from '../fixtures/browser';
import { waitForOfflineReady } from '../fixtures/offline';
async function profiles(page: Page) {
  await seedPlayers(page, ['Alice', 'Bob']);
}
async function setup(page: Page) {
  await page.goto('/games/');
  await page.getByRole('link', { name: 'Jouer au X01', exact: true }).click();
  const dialog = page.getByRole('dialog');
  for (const name of ['Alice', 'Bob'])
    await dialog.getByRole('checkbox', { name: `Sélectionner ${name}`, exact: true }).check();
  return dialog;
}
test('offers fixed X01 starting scores and preserves101 points in a loser-first rematch offline', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await profiles(page);
  const dialog = await setup(page),
    input = dialog.getByLabel('Score de départ', { exact: true });
  await expect(input).toHaveValue('301');
  await expect(input.getByRole('option')).toHaveText([
    '101',
    '201',
    '301',
    '401',
    '501',
    '601',
    '701',
  ]);
  for (const score of ['101', '201', '301', '401', '501', '601', '701']) {
    await input.selectOption(score);
    await expect(input).toHaveValue(score);
  }
  await input.selectOption('101');
  await dialog.getByRole('switch', { name: 'Sortie double', exact: true }).uncheck();
  await expect(input).toHaveValue('101');
  await dialog.getByRole('button', { name: 'Créer la partie', exact: true }).click();
  await page.getByRole('button', { name: 'Démarrer la partie', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText(
    /Alice\s*101/,
  );
  const original = page.url();
  await page.getByLabel('Mode de saisie', { exact: true }).selectOption('visit');
  await page.getByLabel(/^Total des/).fill('101');
  await page.getByRole('button', { name: 'Enregistrer le total de la volée', exact: true }).click();
  await expect(page.getByText('Victoire : Alice', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Revanche', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Au tour de Bob', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText(
    /Bob\s*101/,
  );
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Au tour de Bob', exact: true })).toBeVisible();
  await page.goto(original);
  await expect(page.getByText('Victoire : Alice', { exact: true })).toBeVisible();
});
test('keeps701 points with cork, series, aggregate scoring and pause/reload', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await profiles(page);
  const dialog = await setup(page);
  await dialog.getByLabel('Score de départ', { exact: true }).selectOption('701');
  await dialog.getByRole('switch', { name: 'Match en plusieurs legs', exact: true }).check();
  await dialog.getByRole('switch', { name: 'Cork pour commencer', exact: true }).check();
  await dialog.getByRole('radio', { name: 'Bob', exact: true }).check();
  await dialog.getByRole('button', { name: 'Créer la partie', exact: true }).click();
  await page.getByRole('button', { name: 'Démarrer la partie', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Au tour de Bob', exact: true })).toBeVisible();
  await page.getByLabel('Mode de saisie', { exact: true }).selectOption('visit');
  await page.getByLabel(/^Total des/).fill('180');
  await page.getByRole('button', { name: 'Enregistrer le total de la volée', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Au tour de Alice', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText(
    /Bob\s*521/,
  );
  await page.getByRole('button', { name: 'Mettre en pause', exact: true }).click();
  await expect(page.locator('.match-card .match-status')).toHaveText('En pause');
  await expect(page.locator('.match-card')).toContainText('701');
  await page.reload();
  await page.getByRole('button', { name: 'Reprendre', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText(
    /Bob\s*521/,
  );
  await expect(page.getByRole('heading', { name: 'Au tour de Alice', exact: true })).toBeVisible();
});
test('selects a fixed X01 score and retains it across checkout changes in English', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await profiles(page);
  await page.goto('/settings/');
  await page.getByLabel('Langue de l’application', { exact: true }).selectOption('en');
  await page.goto('/games/');
  await page.getByRole('link', { name: 'Play X01', exact: true }).click();
  const dialog = page.getByRole('dialog');
  for (const name of ['Alice', 'Bob'])
    await dialog.getByRole('checkbox', { name: `Select ${name}`, exact: true }).check();
  const input = dialog.getByLabel('Starting score', { exact: true });
  await input.selectOption('401');
  await dialog.getByRole('switch', { name: 'Double-out', exact: true }).uncheck();
  await expect(dialog.getByRole('switch', { name: /Play (X01|Cricket)/ })).toHaveCount(0);
  await expect(input).toHaveValue('401');
  await dialog.getByRole('button', { name: 'Create match', exact: true }).click();
  await page.getByRole('button', { name: 'Start match', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText(
    /Alice\s*401/,
  );
  await page.reload();
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText(
    /Alice\s*401/,
  );
});
