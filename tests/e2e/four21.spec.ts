import { seedPlayers } from '../fixtures/players';
import { waitForOfflineReady } from '../fixtures/offline';
import { expect, test } from '../fixtures/browser';
test('plays Charge 21 entirely offline with tiebreak, undo, pause and persisted victory', async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await seedPlayers(page, ['Alice', 'Bob']);
  await page.goto('/games/');
  await page.getByRole('link', { name: 'Jouer au 421', exact: true }).click();
  const setup = page.getByRole('dialog');
  for (const name of ['Alice', 'Bob'])
    await setup.getByRole('checkbox', { name: `Sélectionner ${name}`, exact: true }).check();
  await expect(setup.getByLabel('Organisateur sur cet appareil')).toHaveCount(0);
  await setup.getByRole('button', { name: 'Créer la partie', exact: true }).click();
  await page.getByRole('button', { name: 'Démarrer la partie', exact: true }).click();
  await expect(page.locator('.rule-guide')).toContainText('Charge 21');
  async function roll(name: string, dice = [4, 2, 1]) {
    await expect(
      page.getByRole('heading', { name: `Au tour de ${name}`, exact: true }),
    ).toBeVisible();
    for (let n = 0; n < 3; n++)
      await page.getByLabel(`Dé ${n + 1}`, { exact: true }).selectOption(String(dice[n]));
    const latest = page.locator('.journal-entries > li').first().getByRole('heading');
    const before = await latest.innerText();
    await page.getByRole('button', { name: 'Valider la combinaison', exact: true }).click();
    await expect(latest).not.toHaveText(before);
    await expect(
      page.getByText('Partie mise à jour sur cet appareil.', { exact: true }),
    ).toHaveCount(0);
  }
  await roll('Alice');
  await roll('Bob');
  await expect(page.getByLabel('Meilleure combinaison après départage')).toBeVisible();
  await page.getByLabel('Meilleure combinaison après départage').selectOption({ label: 'Alice' });
  await page.getByLabel('Moins bonne combinaison après départage').selectOption({ label: 'Bob' });
  await page.getByRole('button', { name: 'Valider la combinaison', exact: true }).click();
  await expect(page.getByText('Charge · Pot : 11 jetons', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Annuler la dernière saisie' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmer', exact: true }).click();
  await expect(page.getByLabel('Meilleure combinaison après départage')).toBeVisible();
  await page.getByLabel('Meilleure combinaison après départage').selectOption({ label: 'Alice' });
  await page.getByLabel('Moins bonne combinaison après départage').selectOption({ label: 'Bob' });
  await page.getByRole('button', { name: 'Valider la combinaison', exact: true }).click();
  await roll('Bob');
  await roll('Alice', [6, 5, 2]);
  await roll('Alice', [6, 5, 2]);
  await roll('Bob', [6, 5, 4]);
  await expect(page.getByText('Décharge · Pot vide', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mettre en pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reprendre', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Reprendre', exact: true }).click();
  await roll('Alice');
  await roll('Bob', [6, 5, 2]);
  await roll('Bob', [6, 5, 2]);
  await roll('Alice');
  await expect(page.getByText('Terminée', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Terminée', { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('421-offline.png'), fullPage: true });
  expect(errors).toEqual([]);
});
