import { expect, test, type Page } from '../fixtures/browser';
import { createMatch } from '../fixtures/played-match';

function card(page: Page) {
  return page.locator('.match-card');
}
async function list(page: Page) {
  const pause = page.getByRole('button', { name: 'Mettre en pause', exact: true });
  if (await pause.isVisible()) await pause.click();
  else if (await page.getByRole('link', { name: 'Toutes les parties', exact: true }).isVisible())
    await page.getByRole('link', { name: 'Toutes les parties', exact: true }).click();
  await expect(card(page)).toHaveCount(1);
}
async function records(page: Page) {
  return page.evaluate(
    () =>
      new Promise<Record<string, unknown[]>>((resolve, reject) => {
        const open = indexedDB.open('scoretrackrr');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const names = [
            'matches',
            'scoreEvents',
            'matchProjections',
            'matchPermissions',
            'players',
            'teams',
            'gameVersions',
          ];
          const tx = db.transaction(names, 'readonly');
          const result: Record<string, unknown[]> = {};
          for (const name of names) {
            const read = tx.objectStore(name).getAll();
            read.onsuccess = () => {
              result[name] = read.result;
            };
          }
          tx.oncomplete = () => {
            db.close();
            resolve(result);
          };
          tx.onabort = () => {
            db.close();
            reject(tx.error);
          };
        };
      }),
  );
}

test('confirms cancellation separately from deletion and keeps profiles offline', async ({
  page,
}) => {
  await createMatch(page);
  await list(page);
  await expect(card(page).getByRole('button', { name: 'Reprendre', exact: true })).toBeVisible();
  const cancel = card(page).getByRole('button', { name: 'Annuler', exact: true });
  const dialog = page.getByRole('dialog');
  await cancel.click();
  await expect(dialog).toContainText('Ses scores et son historique seront conservés.');
  await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
  await expect(cancel).toBeFocused();
  await expect(card(page).locator('.match-status')).toHaveText('En pause');
  await cancel.click();
  await dialog.getByRole('button', { name: 'Confirmer', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(card(page).locator('.match-status')).toHaveText('Annulée');
  await expect(cancel).toHaveCount(0);
  await card(page).getByRole('link', { name: 'Consulter', exact: true }).click();
  await expect(
    page.getByRole('list', { name: 'Historique des actions', exact: true }).getByRole('listitem'),
  ).toHaveCount(3);
  await list(page);
  const before = await records(page);
  const remove = card(page).getByRole('button', { name: 'Supprimer', exact: true });
  await remove.click();
  await expect(dialog).toContainText('supprimés définitivement');
  await page.keyboard.press('Escape');
  await expect(remove).toBeFocused();
  expect(await records(page)).toEqual(before);
  await remove.click();
  await dialog.getByRole('button', { name: 'Supprimer', exact: true }).click();
  await expect(card(page)).toHaveCount(0);
  const after = await records(page);
  for (const name of ['matches', 'scoreEvents', 'matchProjections', 'matchPermissions'])
    expect(after[name]).toEqual([]);
  for (const name of ['players', 'teams', 'gameVersions'])
    expect(after[name]).toEqual(before[name]);
  await page.reload();
  await expect(card(page)).toHaveCount(0);
});

test('rejects stale cancel and delete confirmations across tabs', async ({ page, context }) => {
  const url = await createMatch(page);
  await list(page);
  const other = await context.newPage();
  await other.goto(url);
  await expect(other.locator('.match-identity .match-status')).toHaveText('En pause');
  const dialog = page.getByRole('dialog');
  await card(page).getByRole('button', { name: 'Annuler', exact: true }).click();
  await other.getByRole('button', { name: 'Annuler la partie', exact: true }).click();
  await other.getByRole('dialog').getByRole('button', { name: 'Confirmer', exact: true }).click();
  await expect(card(other).locator('.match-status')).toHaveText('Annulée');
  await dialog.getByRole('button', { name: 'Confirmer', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Cette partie a changé');
  await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
  await card(page).getByRole('button', { name: 'Supprimer', exact: true }).click();
  await list(other);
  await card(other).getByRole('button', { name: 'Supprimer', exact: true }).click();
  await other.getByRole('dialog').getByRole('button', { name: 'Supprimer', exact: true }).click();
  await expect(card(other)).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Supprimer', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Cette partie a changé');
  expect((await records(page)).scoreEvents).toHaveLength(0);
  await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
  await expect(card(page)).toHaveCount(0);
});

test('preserves a finished match after a failed delete and allows retry', async ({ page }) => {
  await createMatch(page);
  await page.getByLabel('Qui marque ?', { exact: true }).selectOption({ label: 'Alice' });
  await page.getByLabel('Points', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Enregistrer le score', exact: true }).click();
  await expect(page.getByText('Victoire : Alice', { exact: true })).toBeVisible();
  await list(page);
  await expect(card(page).getByRole('button', { name: 'Annuler', exact: true })).toHaveCount(0);
  const before = await records(page);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function (key) {
      if (this.name === 'matches') {
        IDBObjectStore.prototype.delete = original;
        throw new DOMException('Synthetic storage failure', 'QuotaExceededError');
      }
      return original.call(this, key);
    };
  });
  await card(page).getByRole('button', { name: 'Supprimer', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Supprimer', exact: true }).click();
  await expect(dialog.getByRole('alert')).not.toBeEmpty();
  expect(await records(page)).toEqual(before);
  await dialog.getByRole('button', { name: 'Supprimer', exact: true }).click();
  await expect(card(page)).toHaveCount(0);
});
