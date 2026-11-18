import { seedPlayers } from '../fixtures/players';
import { waitForOfflineReady } from '../fixtures/offline';
import { expect, test, type Page } from '../fixtures/browser';
async function create(page: Page, target: 5000 | 10000 = 5000, entry: 0 | 500 = 500) {
  await seedPlayers(page, ['Alice', 'Bob']);
  await page.goto('/games/');
  await page.getByRole('link', { name: 'Jouer au 5000 / 10000', exact: true }).click();
  const setup = page.getByRole('dialog');
  const target5000 = setup.getByRole('switch', { name: 'Objectif de 5 000 points', exact: true });
  await expect(target5000).not.toBeChecked();
  if (target === 10000) {
    await target5000.check();
    const target10000 = setup.getByRole('switch', {
      name: 'Objectif de 10 000 points',
      exact: true,
    });
    await expect(target10000).toBeChecked();
    await target10000.uncheck();
    await expect(target5000).not.toBeChecked();
    await target5000.check();
  }
  if (entry === 0)
    await setup
      .getByRole('switch', { name: 'Seuil d’entrée de 500 points', exact: true })
      .uncheck();
  for (const name of ['Alice', 'Bob'])
    await setup.getByRole('checkbox', { name: `Sélectionner ${name}`, exact: true }).check();
  await expect(setup.getByLabel('Organisateur sur cet appareil')).toHaveCount(0);
  await setup.getByRole('button', { name: 'Créer la partie', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: String(target), level: 1, exact: true }),
  ).toBeVisible();
  await expect(page).toHaveTitle(`${target} · Scoretrackrr`);
  await page.getByRole('button', { name: 'Démarrer la partie', exact: true }).click();
  await expect(page.locator('.rule-guide .rule-goal')).toContainText(String(target));
  await expect(page.locator('.rule-guide')).toContainText(`au moins ${entry} points`);
  await expect(page.locator('.match-identity .match-status')).toHaveText('En cours');
}
test('plays fixed 5000 offline with entry threshold, lost risk, final turn, undo and reload', async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await create(page);
  const bank = page.getByRole('button', { name: 'Garder les points', exact: true });
  async function roll(dice: number[], keep: number[], running: number) {
    for (let i = 0; i < dice.length; i++)
      await page.getByLabel(`Dé ${i + 1}`, { exact: true }).selectOption(String(dice[i]));
    for (const index of keep)
      await page.getByRole('button', { name: `Garder le dé ${index + 1}`, exact: true }).click();
    await page.getByRole('button', { name: 'Valider et continuer', exact: true }).click();
    await expect(page.getByText(new RegExp(`^Tour : ${running} points`))).toBeVisible();
  }
  await roll([1, 1, 1, 2, 3, 4], [0, 1, 2], 300);
  await expect(bank).toBeDisabled();
  await roll([2, 2, 2], [0, 1, 2], 500);
  await bank.click();
  await expect(page.getByRole('heading', { name: 'Au tour de Bob', exact: true })).toBeVisible();
  await roll([6, 6, 6, 6, 6, 6], [0, 1, 2, 3, 4, 5], 3000);
  for (const [i, face] of [2, 2, 3, 3, 4, 6].entries())
    await page.getByLabel(`Dé ${i + 1}`, { exact: true }).selectOption(String(face));
  await page.getByRole('button', { name: 'Valider le tour perdu', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Au tour de Alice', exact: true })).toBeVisible();
  for (const name of ['Alice', 'Bob', 'Alice']) {
    await roll([6, 6, 6, 6, 6, 6], [0, 1, 2, 3, 4, 5], 3000);
    await bank.click();
    await expect(
      page.getByRole('heading', {
        name: `Au tour de ${name === 'Alice' ? 'Bob' : 'Alice'}`,
        exact: true,
      }),
    ).toBeVisible();
  }
  await expect(
    page.getByText('Dernier tour : 1 camp(s) restant(s)', { exact: true }),
  ).toBeVisible();
  await roll([6, 6, 6, 6, 6, 6], [0, 1, 2, 3, 4, 5], 3000);
  await roll([6, 6, 6, 6, 6, 6], [0, 1, 2, 3, 4, 5], 6000);
  await page.reload();
  await expect(
    page.getByText('Tour : 6000 points · 6 dé(s) à lancer', { exact: true }),
  ).toBeVisible();
  await bank.click();
  await expect(page.getByText('Terminée', { exact: true })).toBeVisible();
  await expect(page.getByText('Victoire : Bob', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Annuler la dernière saisie' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmer', exact: true }).click();
  await expect(
    page.getByText('Tour : 6000 points · 6 dé(s) à lancer', { exact: true }),
  ).toBeVisible();
  await bank.click();
  await expect(page.getByText('Terminée', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: '5000', level: 1, exact: true })).toBeVisible();
  await expect(page.getByText('Victoire : Bob', { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('farkle-offline.png'), fullPage: true });
  expect(errors).toEqual([]);
});
test('shows the immutable 10000 target in match titles without an opening threshold', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await create(page, 10000, 0);
  await page.reload();
  await expect(page.getByRole('heading', { name: '10000', level: 1, exact: true })).toBeVisible();
  await expect(page).toHaveTitle('10000 · Scoretrackrr');
  await page.getByRole('button', { name: 'Mettre en pause', exact: true }).click();
  await expect(
    page.locator('.match-card').getByRole('heading', { name: '10000', exact: true }),
  ).toBeVisible();
  await page.getByRole('navigation').getByRole('link', { name: 'Accueil', exact: true }).click();
  await expect(page.locator('.recent-match strong')).toHaveText('10000');
});

test('retains dice drafts through pause, language changes and a failed write', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await create(page);
  for (const [index, face] of [1, 5, 2, 3, 4, 6].entries())
    await page
      .getByRole('combobox', { name: `Dé ${index + 1}`, exact: true })
      .selectOption(String(face));
  const first = page.getByRole('button', { name: 'Garder le dé 1', exact: true });
  await first.focus();
  await page.keyboard.press('Space');
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Garder le dé 2', exact: true }).click();
  await expect(page.getByText('Sélection : 150 points', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Après validation : 150 points dans le tour', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Garder les points', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Mettre en pause', exact: true }).click();
  await expect(page.locator('.match-card .match-status')).toHaveText('En pause');
  await page.getByRole('button', { name: 'Reprendre', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Dé 2', exact: true })).toHaveValue('5');
  const settings = await context.newPage();
  try {
    await settings.goto('/settings/');
    await settings.getByLabel('Langue de l’application', { exact: true }).selectOption('en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('button', { name: 'Keep die 1', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('combobox', { name: 'Die 2', exact: true })).toHaveValue('5');
    await expect(page.getByText('Selection: 150 points', { exact: true })).toBeVisible();
    await settings.getByLabel('App language', { exact: true }).selectOption('fr');
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  } finally {
    await settings.close();
  }
  await page.evaluate(() => {
    const add = IDBObjectStore.prototype.add;
    let fail = true;
    IDBObjectStore.prototype.add = function (...args) {
      if (this.name === 'scoreEvents' && fail) {
        fail = false;
        throw new DOMException('Full', 'QuotaExceededError');
      }
      return add.apply(this, args);
    };
  });
  await page.getByRole('button', { name: 'Valider et continuer', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Le stockage de cet appareil est plein' }),
  ).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Dé 2', exact: true })).toHaveValue('5');
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.journal-entries > li')).toHaveCount(3);
  await page.getByRole('button', { name: 'Valider et continuer', exact: true }).click();
  await expect(
    page.getByText('Tour : 150 points · 4 dé(s) à lancer', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('.die-card')).toHaveCount(4);
  await expect(page.locator('.die-toggle[aria-pressed="true"]')).toHaveCount(0);
  await expect(
    page.getByText('Encore 350 points dans ce tour pour atteindre le seuil d’entrée.', {
      exact: true,
    }),
  ).toBeVisible();
});

test('distinguishes invalid selected dice from a genuine lost turn', async ({ page, context }) => {
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await create(page);
  await expect(
    page.getByRole('button', { name: 'Valider et continuer', exact: true }),
  ).toBeDisabled();
  for (const [index, face] of [1, 2, 3, 3, 4, 6].entries())
    await page
      .getByRole('combobox', { name: `Dé ${index + 1}`, exact: true })
      .selectOption(String(face));
  await page.getByRole('button', { name: 'Garder le dé 2', exact: true }).click();
  await expect(
    page.getByText('La sélection contient des dés non marquants.', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Valider et continuer', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Garder le dé 2', exact: true }).click();
  await page.getByRole('button', { name: 'Garder le dé 1', exact: true }).click();
  await expect(page.getByText('Sélection : 100 points', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Dé 1', exact: true }).selectOption('2');
  await expect(
    page.getByText('Aucun point possible : les points du tour sont perdus.', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('.die-toggle[aria-pressed="true"]')).toHaveCount(0);
  await expect(page.locator('.die-toggle:disabled')).toHaveCount(6);
  await page.getByRole('button', { name: 'Valider le tour perdu', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Au tour de Bob', exact: true })).toBeVisible();
  await expect(page.getByText('Tour : 0 points · 6 dé(s) à lancer', { exact: true })).toBeVisible();
  await expect(page.locator('.die-toggle[aria-pressed="true"]')).toHaveCount(0);
});
