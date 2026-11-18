import { seedPlayers } from '../fixtures/players';
import { waitForOfflineReady } from '../fixtures/offline';
import { expect, test, type Page } from '../fixtures/browser';
async function create(page: Page) {
  await seedPlayers(page, ['Alice', 'Bob', 'Cara']);
  await page.goto('/games/');
  await page.getByRole('link', { name: 'Jouer à Flip 7', exact: true }).click();
  const setup = page.getByRole('dialog');
  for (const name of ['Alice', 'Bob', 'Cara'])
    await setup.getByRole('checkbox', { name: `Sélectionner ${name}`, exact: true }).check();
  await expect(setup.getByLabel('Organisateur sur cet appareil')).toHaveCount(0);
  await setup.getByRole('button', { name: 'Créer la partie', exact: true }).click();
  await page.getByRole('button', { name: 'Démarrer la partie', exact: true }).click();
  await expect(page.locator('.rule-guide')).toContainText('édition 3.1');
}
test('scores edition3.1 offline with modifiers, bust, complete-round victory and winning reversal', async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await create(page);
  const zero = page.getByRole('button', { name: 'Carte 0', exact: true });
  await zero.focus();
  await page.keyboard.press('Space');
  await expect(zero).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Space');
  await expect(zero).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.journal-entries > li')).toHaveCount(1);
  async function changed(name: string) {
    const latest = page.locator('.journal-entries > li').first().getByRole('heading');
    const before = await latest.innerText();
    await page.getByRole('button', { name, exact: true }).click();
    await expect(latest).not.toHaveText(before);
  }
  async function alice() {
    await expect(page.getByRole('heading', { name: 'Alice', exact: true })).toBeVisible();
    for (const card of [6, 7, 8, 9, 10, 11, 12])
      await page.getByRole('button', { name: `Carte ${card}`, exact: true }).click();
    for (const value of [2, 4, 6, 8, 10])
      await page.getByRole('button', { name: `Bonus +${value}`, exact: true }).click();
    await page.getByRole('button', { name: 'Multiplicateur ×2', exact: true }).click();
    await expect(page.getByText('171 points pour cette manche', { exact: true })).toBeVisible();
    await changed('Enregistrer la main');
  }
  for (let round = 1; round <= 2; round++) {
    await alice();
    await expect(page.getByText('Terminée', { exact: true })).not.toBeVisible();
    await expect(page.getByRole('heading', { name: 'Bob', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Carte 12', exact: true }).click();
    await changed('Enregistrer la main');
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await changed('Bust · 0 point');
    if (round === 1) {
      await page.getByRole('button', { name: 'Mettre en pause', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Reprendre', exact: true })).toBeVisible();
      await page.reload();
      await page.getByRole('button', { name: 'Reprendre', exact: true }).click();
      await changed('Manche suivante');
    }
  }
  await expect(page.getByText('Victoire : Alice', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Annuler la dernière saisie' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmer', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Cara', exact: true })).toBeVisible();
  await changed('Bust · 0 point');
  await page.reload();
  await expect(page.getByText('Victoire : Alice', { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('flip7-offline.png') });
  expect(errors).toEqual([]);
});

test('a direct bust ignores selected values and leaves modifiers available for the next player', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await create(page);
  for (const card of [6, 7, 8, 9, 10, 11, 12])
    await page.getByRole('button', { name: `Carte ${card}`, exact: true }).click();
  for (const value of [2, 4, 6, 8, 10])
    await page.getByRole('button', { name: `Bonus +${value}`, exact: true }).click();
  await page.getByRole('button', { name: 'Multiplicateur ×2', exact: true }).click();
  await expect(page.getByText('171 points pour cette manche', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Bust · 0 point', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Bob', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText('Alice0');
  for (const card of [6, 7, 8, 9, 10, 11, 12])
    await expect(page.getByRole('button', { name: `Carte ${card}`, exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  for (const value of [2, 4, 6, 8, 10])
    await page.getByRole('button', { name: `Bonus +${value}`, exact: true }).click();
  await page.getByRole('button', { name: 'Multiplicateur ×2', exact: true }).click();
  await page.getByRole('button', { name: 'Carte 12', exact: true }).click();
  await page.getByRole('button', { name: 'Enregistrer la main', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Cara', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText('Bob54');
  await page.getByRole('button', { name: 'Bust · 0 point', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Manche suivante', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText('Alice0');
});

test('caps number choices at seven, counts zero and shows the automatic bonus exactly once', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await create(page);
  const numbers = page.getByRole('group', { name: 'Cartes Numéro conservées', exact: true });
  const bonus = page.getByRole('status').filter({ hasText: 'Flip 7 ! Bonus de +15 points' });
  await expect(page.getByText('Cartes numériques : 0 / 7', { exact: true })).toBeVisible();
  await expect(bonus).toHaveCount(0);
  // Dispatch consecutive clicks before the DOM disables the eighth button.
  await numbers.getByRole('button').evaluateAll((buttons) => {
    for (const button of buttons.slice(0, 8)) (button as HTMLButtonElement).click();
  });
  await expect(numbers.getByRole('button', { pressed: true })).toHaveCount(7);
  await expect(page.getByText('Cartes numériques : 7 / 7', { exact: true })).toBeVisible();
  await expect(bonus).toBeVisible();
  await expect(page.getByText('36 points pour cette manche', { exact: true })).toBeVisible();
  for (const value of [0, 1, 2, 3, 4, 5, 6])
    await expect(page.getByRole('button', { name: `Carte ${value}`, exact: true })).toBeEnabled();
  for (const value of [7, 8, 9, 10, 11, 12])
    await expect(page.getByRole('button', { name: `Carte ${value}`, exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Carte 6', exact: true }).click();
  await expect(bonus).toHaveCount(0);
  await expect(page.getByText('Cartes numériques : 6 / 7', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Carte 7', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Carte 7', exact: true }).click();
  await expect(bonus).toBeVisible();
  await expect(page.getByText('37 points pour cette manche', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Carte 7', exact: true }).click();
  await page.getByRole('button', { name: 'Carte 6', exact: true }).click();
  await page.getByRole('button', { name: 'Bonus +10', exact: true }).click();
  await page.getByRole('button', { name: 'Multiplicateur ×2', exact: true }).click();
  await expect(page.getByText('67 points pour cette manche', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Enregistrer la main', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Bob', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText('Alice67');
  await expect(page.getByText('Cartes numériques : 0 / 7', { exact: true })).toBeVisible();
  await expect(bonus).toHaveCount(0);
  await expect(numbers.getByRole('button', { disabled: true })).toHaveCount(0);
});
