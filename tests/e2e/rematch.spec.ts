import { expect, test, type Page } from '../fixtures/browser';
import { createMatch } from '../fixtures/played-match';

async function finish(page: Page) {
  await createMatch(page);
  await page.getByLabel('Qui marque ?', { exact: true }).selectOption({ label: 'Alice' });
  await page.getByLabel('Points', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Enregistrer le score', exact: true }).click();
  await expect(page.getByText('Victoire : Alice', { exact: true })).toBeVisible();
  return page.url();
}
async function countMatches(page: Page) {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open('scoretrackrr');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('matches');
          const read = tx.objectStore('matches').count();
          read.onsuccess = () => resolve(read.result);
          tx.oncomplete = () => db.close();
        };
      }),
  );
}
test('starts an offline rematch immediately with the losing player first and preserves the finished game', async ({
  page,
}) => {
  const source = await finish(page);
  await page.getByRole('button', { name: 'Revanche', exact: true }).click();
  await expect(page.locator('.match-identity .match-status')).toHaveText('En cours');
  await expect(page.getByRole('button', { name: 'Démarrer la partie', exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByLabel('Qui marque ?', { exact: true })).toHaveValue(
    (await page
      .getByLabel('Qui marque ?', { exact: true })
      .getByRole('option', { name: 'Bob', exact: true })
      .getAttribute('value')) ?? '',
  );
  const next = page.url();
  expect(next).not.toBe(source);
  expect(await countMatches(page)).toBe(2);
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText('Bob0');
  await page.reload();
  await expect(
    page.getByLabel('Qui marque ?', { exact: true }).locator('option:checked'),
  ).toHaveText('Bob');
  await page.goto(source);
  await expect(page.getByText('Victoire : Alice', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Historique des actions', exact: true }).getByRole('listitem'),
  ).toHaveCount(2);
  await page.goto(next);
  await page.getByLabel('Points', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Enregistrer le score', exact: true }).click();
  await expect(page.getByText('Victoire : Bob', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Revanche', exact: true }).click();
  await expect(
    page.getByLabel('Qui marque ?', { exact: true }).locator('option:checked'),
  ).toHaveText('Alice');
  expect(await countMatches(page)).toBe(3);
});
test('rolls back a failed rematch and retries without changing the old result', async ({
  page,
}) => {
  const source = await finish(page);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'matchProjections' && value.status === 'in_progress') {
        IDBObjectStore.prototype.put = original;
        throw new DOMException('Synthetic storage full', 'QuotaExceededError');
      }
      return key === undefined ? original.call(this, value) : original.call(this, value, key);
    };
  });
  await page.getByRole('button', { name: 'Revanche', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'stockage' })).toBeVisible();
  await expect(page).toHaveURL(source);
  expect(await countMatches(page)).toBe(1);
  await expect(page.getByText('Victoire : Alice', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Revanche', exact: true }).click();
  await expect(page.locator('.match-identity .match-status')).toHaveText('En cours');
  expect(await countMatches(page)).toBe(2);
});
test('localizes rematch and refuses deleted players while preserving old history', async ({
  page,
  context,
}) => {
  const source = await finish(page);
  await page.goto('/players/');
  await page.getByRole('button', { name: 'Supprimer Bob', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Supprimer ce joueur', exact: true })
    .click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Supprimer Bob', exact: true })).toHaveCount(0);
  await page.goto(source);
  await page.getByRole('button', { name: 'Revanche', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Vérifiez les profils' })).toBeVisible();
  expect(await countMatches(page)).toBe(1);
  const settings = await context.newPage();
  await settings.goto('/settings/');
  await settings.getByLabel('Langue de l’application', { exact: true }).selectOption('en');
  await expect(page.getByRole('button', { name: 'Rematch', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Rematch', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Check the profiles' })).toBeVisible();
  await expect(page.getByText('Winner: Alice', { exact: true })).toBeVisible();
  expect(await countMatches(page)).toBe(1);
});
