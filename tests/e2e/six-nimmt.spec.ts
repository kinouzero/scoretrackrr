import { seedPlayers } from '../fixtures/players';
import { expect, test, type Page } from '../fixtures/browser';
import { waitForOfflineReady } from '../fixtures/offline';
async function create(page: Page, names: string[], surprises = false) {
  await seedPlayers(page, names);
  await page.goto('/games/');
  await page
    .getByRole('article', { name: '6 qui prend !', exact: true })
    .getByRole('link', { name: 'Jouer au 6 qui prend !', exact: true })
    .click();
  const setup = page.getByRole('dialog');
  if (surprises)
    await setup
      .getByRole('switch', { name: '6 qui surprend ! · Cartes spéciales', exact: true })
      .check();
  await expect(setup.getByRole('switch', { name: 'Jouer en équipe', exact: true })).toHaveCount(0);
  await expect(setup.getByLabel('Variante', { exact: true })).toHaveCount(0);
  await expect(setup.getByRole('button', { name: 'Créer la partie', exact: true })).toBeDisabled();
  for (const name of names)
    await setup.getByRole('checkbox', { name: `Sélectionner ${name}`, exact: true }).check();
  await setup.getByRole('button', { name: 'Créer la partie', exact: true }).click();
  await page.getByRole('button', { name: 'Démarrer la partie', exact: true }).click();
}
function field(page: Page, name: string) {
  return page.getByRole('spinbutton', { name: `Pénalités de ${name}`, exact: true });
}
async function round(page: Page, values: Record<string, number>) {
  for (const [name, value] of Object.entries(values)) await field(page, name).fill(String(value));
  await page.getByRole('button', { name: 'Enregistrer les pénalités', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Enregistrer les pénalités', exact: true }),
  ).toHaveCount(0);
  for (const name of Object.keys(values)) await expect(field(page, name)).toBeDisabled();
}
async function confirm(page: Page) {
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmer', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
}
test('scores complete rounds offline with pause, lowest-total victory, correction, undo and reload', async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await create(page, ['Alice', 'Bob']);
  await expect(
    page
      .getByRole('form', { name: 'Têtes de bœuf de la manche', exact: true })
      .getByRole('spinbutton'),
  ).toHaveCount(2);
  await expect(field(page, 'Alice')).toHaveValue('');
  await expect(field(page, 'Bob')).toHaveValue('');
  await field(page, 'Alice').fill('10');
  await field(page, 'Bob').fill('20');
  await page.getByRole('button', { name: 'Mettre en pause', exact: true }).click();
  await expect(page.locator('.match-card .match-status')).toHaveText('En pause');
  await page.getByRole('button', { name: 'Reprendre', exact: true }).click();
  await expect(field(page, 'Alice')).toHaveValue('10');
  await expect(field(page, 'Bob')).toHaveValue('20');
  await round(page, { Alice: 10, Bob: 20 });
  await page.reload();
  await expect(field(page, 'Alice')).toHaveValue('10');
  await expect(field(page, 'Bob')).toHaveValue('20');
  await page.getByRole('button', { name: 'Manche suivante', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Manche 2', exact: true })).toBeVisible();
  await expect(field(page, 'Alice')).toHaveValue('');
  await round(page, { Alice: 5, Bob: 46 });
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText(
    'Victoire : Alice',
  );
  await page.getByRole('button', { name: 'Corriger la dernière saisie', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByLabel('Têtes de bœuf de la manche', { exact: true })
    .fill('45');
  await confirm(page);
  await expect(page.getByRole('button', { name: 'Manche suivante', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).not.toContainText(
    'Victoire',
  );
  await page.getByRole('button', { name: 'Annuler la dernière saisie', exact: true }).click();
  await confirm(page);
  await expect(field(page, 'Alice')).toBeDisabled();
  await expect(field(page, 'Alice')).toHaveValue('5');
  await expect(field(page, 'Bob')).toBeEnabled();
  await page.reload();
  await expect(field(page, 'Alice')).toHaveValue('5');
  await expect(field(page, 'Bob')).toHaveValue('');
  await round(page, { Bob: 46 });
  await page.reload();
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText('Alice15');
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText('Bob66');
  await expect(
    page.getByRole('list', { name: 'Historique des actions', exact: true }),
  ).toContainText('manche 2');
  await page.screenshot({ path: test.info().outputPath('six-nimmt-offline.png'), fullPage: true });
  expect(errors).toEqual([]);
});
test('waits for all scores after66 and preserves a shared lowest-score victory offline', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await create(page, ['Alice', 'Bob', 'Chloé']);
  await expect(
    page
      .getByRole('form', { name: 'Têtes de bœuf de la manche', exact: true })
      .getByRole('spinbutton'),
  ).toHaveCount(3);
  await field(page, 'Alice').fill('66');
  await field(page, 'Bob').fill('0');
  await page.getByRole('button', { name: 'Enregistrer les pénalités', exact: true }).click();
  await expect(field(page, 'Chloé')).toBeFocused();
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText('Alice0');
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).not.toContainText(
    'Victoire',
  );
  await round(page, { Alice: 66, Bob: 0, Chloé: 0 });
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText(
    'Victoire : Bob, Chloé',
  );
  await page.reload();
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText(
    'Victoire : Bob, Chloé',
  );
});

test('keeps all fields after an atomic quota rollback and validates the whole-round limit', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await create(page, ['Alice', 'Bob', 'Chloé']);
  await field(page, 'Alice').fill('100');
  await field(page, 'Bob').fill('100');
  await field(page, 'Chloé').fill('0');
  await expect(
    page.getByRole('button', { name: 'Enregistrer les pénalités', exact: true }),
  ).toBeDisabled();
  await field(page, 'Alice').fill('8');
  await field(page, 'Bob').fill('12');
  await field(page, 'Chloé').fill('0');
  await page.evaluate(() => {
    const add = IDBObjectStore.prototype.add;
    let writes = 0;
    IDBObjectStore.prototype.add = function (...args) {
      if (this.name === 'scoreEvents' && ++writes === 2)
        throw new DOMException('Full', 'QuotaExceededError');
      return add.apply(this, args);
    };
  });
  await page.getByRole('button', { name: 'Enregistrer les pénalités', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Le stockage de cet appareil est plein' }),
  ).toBeVisible();
  await expect(field(page, 'Alice')).toHaveValue('8');
  await expect(field(page, 'Bob')).toHaveValue('12');
  await expect(
    page.getByRole('list', { name: 'Historique des actions', exact: true }).getByRole('listitem'),
  ).toHaveCount(1);
  await round(page, { Alice: 8, Bob: 12, Chloé: 0 });
  await expect(
    page.getByRole('list', { name: 'Historique des actions', exact: true }).getByRole('listitem'),
  ).toHaveCount(4);
});
test('shows all ten player fields together and resets them only for the next round', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  const names = ['Alice', 'Bob', 'Chloé', 'Dan', 'Emma', 'Franck', 'Gina', 'Hugo', 'Iris', 'Jules'];
  await create(page, names);
  const form = page.getByRole('form', { name: 'Têtes de bœuf de la manche', exact: true });
  await expect(form.getByRole('spinbutton')).toHaveCount(10);
  await round(page, Object.fromEntries(names.map((name, index) => [name, index])));
  await page.getByRole('button', { name: 'Manche suivante', exact: true }).click();
  for (const name of names) {
    await expect(field(page, name)).toHaveValue('');
    await expect(field(page, name)).toBeEnabled();
  }
  await page.reload();
  await expect(form.getByRole('spinbutton')).toHaveCount(10);
});

test('keeps the whole unsaved round when another tab switches to English', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await create(page, ['Alice', 'Bob']);
  await field(page, 'Alice').fill('8');
  await field(page, 'Bob').fill('0');
  const settings = await context.newPage();
  try {
    await settings.goto('/settings/');
    await settings.getByLabel('Langue de l’application', { exact: true }).selectOption('en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(
      page.getByRole('spinbutton', { name: 'Alice’s penalties', exact: true }),
    ).toHaveValue('8');
    await expect(
      page.getByRole('spinbutton', { name: 'Bob’s penalties', exact: true }),
    ).toHaveValue('0');
    await page.getByRole('button', { name: 'Record penalties', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Record penalties', exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText('Alice8');
    await page.reload();
    await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText('Alice8');
  } finally {
    await settings.close();
  }
});

test('finishes 6 qui surprend after two rounds instead of the 66-point threshold', async ({
  page,
}) => {
  await create(page, ['Alice', 'Bob'], true);
  await expect(page.locator('.match-options')).toContainText('6 qui surprend !');
  await round(page, { Alice: 70, Bob: 0 });
  await expect(page.getByRole('button', { name: 'Manche suivante', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Manche suivante', exact: true }).click();
  await round(page, { Alice: 0, Bob: 1 });
  await expect(page.getByRole('button', { name: 'Manche suivante', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Revanche', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('.match-options')).toContainText('2 manches');
});
