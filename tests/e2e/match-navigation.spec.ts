import { expect, test } from '../fixtures/browser';
import { createMatch } from '../fixtures/played-match';

test('keeps navigation on the running game and pauses, resumes and cancels in one step offline', async ({
  page,
}) => {
  const url = await createMatch(page);
  const navigation = page.getByRole('navigation');
  const matches = navigation.getByRole('link', { name: 'Parties', exact: true });
  await expect(page.getByRole('link', { name: 'Toutes les parties', exact: true })).toHaveCount(0);
  await expect(matches).toHaveAttribute('href', /match=/);
  await expect(matches).toHaveAccessibleDescription('Partie en cours : Match actions');
  await expect(matches.locator('.nav-running-indicator')).toBeVisible();
  await navigation.getByRole('link', { name: 'Joueurs', exact: true }).click();
  await page.reload();
  await matches.click();
  await expect(page).toHaveURL(url);
  await page.goto('/matches/');
  await expect(page).toHaveURL(url);
  await expect(page.getByRole('heading', { name: 'Vos parties', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Mettre en pause', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Vos parties', exact: true })).toBeVisible();
  await expect(page.locator('.match-card .match-status')).toHaveText('En pause');
  await expect(matches.locator('.nav-running-indicator')).toHaveCount(0);
  await page.getByRole('navigation').getByRole('link', { name: 'Accueil', exact: true }).click();
  await page
    .getByRole('region', { name: 'Vos dernières parties', exact: true })
    .getByRole('button', { name: /Alice · Bob/ })
    .click();
  await expect(page).toHaveURL(url);
  await expect(page.getByRole('button', { name: 'Mettre en pause', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mettre en pause', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Vos parties', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Reprendre', exact: true }).click();
  await expect(page).toHaveURL(url);
  await expect(page.locator('.match-identity .match-status')).toHaveText('En cours');
  await expect(page.getByRole('button', { name: 'Reprendre la partie', exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole('button', { name: 'Mettre en pause', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Annuler la partie', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmer', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Vos parties', exact: true })).toBeVisible();
  await expect(page.locator('.match-card .match-status')).toHaveText('Annulée');
  await expect(matches.locator('.nav-running-indicator')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reprendre', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Consulter', exact: true }).click();
  await expect(page.locator('.match-identity .match-status')).toHaveText('Annulée');
  await expect(page.getByRole('button', { name: 'Reprendre la partie', exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole('button', { name: 'Mettre en pause', exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('list', { name: 'Historique des actions', exact: true }).getByRole('listitem'),
  ).toHaveCount(6);
});

test('does not navigate or resume on failed writes, then allows retry', async ({ page }) => {
  const url = await createMatch(page);
  const failNextWrite = async () =>
    page.evaluate(() => {
      const original = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, key) {
        if (this.name === 'matchProjections') {
          IDBObjectStore.prototype.put = original;
          throw new DOMException('Synthetic storage full', 'QuotaExceededError');
        }
        return key === undefined ? original.call(this, value) : original.call(this, value, key);
      };
    });
  await failNextWrite();
  await page.getByRole('button', { name: 'Mettre en pause', exact: true }).click();
  await expect(page.getByRole('alert')).not.toBeEmpty();
  await expect(page).toHaveURL(url);
  await expect(page.locator('.match-identity .match-status')).toHaveText('En cours');
  await page.getByRole('button', { name: 'Mettre en pause', exact: true }).click();
  await expect(page.locator('.match-card .match-status')).toHaveText('En pause');
  await failNextWrite();
  await page.getByRole('button', { name: 'Reprendre', exact: true }).click();
  await expect(page.getByRole('alert')).not.toBeEmpty();
  await expect(page.locator('.match-card .match-status')).toHaveText('En pause');
  await expect(page.locator('.nav-running-indicator')).toHaveCount(0);
  await page.getByRole('button', { name: 'Reprendre', exact: true }).click();
  await expect(page).toHaveURL(url);
  await expect(page.locator('.match-identity .match-status')).toHaveText('En cours');
});

test('finds the running game in a fresh tab and clears its indicator after a win', async ({
  page,
  context,
}) => {
  const url = await createMatch(page);
  const other = await context.newPage();
  await other.goto('/settings/');
  const matches = other.getByRole('navigation').getByRole('link', { name: 'Parties', exact: true });
  await expect(matches).toHaveAttribute('href', /match=/);
  await expect(matches.locator('.nav-running-indicator')).toBeVisible();
  await matches.click();
  await expect(other).toHaveURL(url);
  await other.getByRole('navigation').getByRole('link', { name: 'Réglages', exact: true }).click();
  await other.getByLabel('Langue de l’application', { exact: true }).selectOption('en');
  await expect(other.locator('html')).toHaveAttribute('lang', 'en');
  await expect(
    other.getByRole('navigation').getByRole('link', { name: 'Matches', exact: true }),
  ).toHaveAccessibleDescription('Game in progress: Match actions');
  await other.getByLabel('App language', { exact: true }).selectOption('fr');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await page.getByLabel('Qui marque ?', { exact: true }).selectOption({ label: 'Alice' });
  await page.getByLabel('Points', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Enregistrer le score', exact: true }).click();
  await expect(page.getByText('Victoire : Alice', { exact: true })).toBeVisible();
  await expect(matches.locator('.nav-running-indicator')).toHaveCount(0);
  await matches.click();
  await expect(other.getByRole('heading', { name: 'Vos parties', exact: true })).toBeVisible();
  await expect(other.locator('.match-card .match-status')).toHaveText('Terminée');
  await expect(other.getByRole('link', { name: 'Consulter', exact: true })).toBeVisible();
  await expect(other.getByRole('button', { name: 'Reprendre', exact: true })).toHaveCount(0);
});
