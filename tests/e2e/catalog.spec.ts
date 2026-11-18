import { savedCustomGame } from '../fixtures/custom-games';
import { seedPlayers } from '../fixtures/players';
import { waitForOfflineReady } from '../fixtures/offline';
import { expect, test, type Page } from '../fixtures/browser';

async function counter(page: Page, name: string, automatic = true) {
  await page.goto('/games/');
  return savedCustomGame(page, name, {
    target: automatic ? 10 : undefined,
    fields: [{ id: 'points', minimum: -10, maximum: 10, weight: 1 }],
  });
}
async function profiles(page: Page) {
  await page.goto('/players/');
  for (const name of ['Alice', 'Bob', 'Chloé']) {
    await page.getByRole('button', { name: 'Ajouter un joueur' }).click();
    await page.getByLabel('Pseudonyme').fill(name);
    await page.getByRole('button', { name: 'Enregistrer le profil' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  }
}
async function score(page: Page, owner: string, points: number) {
  const form = page.getByRole('form', { name: 'Enregistrer le score', exact: true });
  await form.getByLabel('Qui marque ?', { exact: true }).selectOption({ label: owner });
  await form.getByLabel('Points', { exact: true }).fill(String(points));
  await form.getByRole('button', { name: 'Enregistrer le score', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Score enregistré sur cet appareil.' }),
  ).toBeVisible();
}

test('searches, filters, favorites and opens pinned Pétanque presets offline', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await page.goto('/games/');
  const favorite = page.getByRole('button', { name: 'Favori : Pétanque', exact: true });
  await favorite.click();
  await expect(favorite).toHaveAttribute('aria-pressed', 'true');
  const favorites = page.getByRole('switch', { name: 'Mes favoris', exact: true });
  await expect(favorites).not.toBeChecked();
  await favorites.focus();
  await page.keyboard.press('Space');
  await expect(favorites).toBeChecked();
  await expect(page.getByRole('article')).toHaveCount(1);
  await favorites.click();
  await expect(favorites).not.toBeChecked();
  await expect(page.getByRole('article')).toHaveCount(20);
  await favorites.check();
  await page.getByLabel('Rechercher un jeu', { exact: true }).fill('Yams');
  await expect(page.getByRole('article')).toHaveCount(0);
  await page.getByLabel('Rechercher un jeu', { exact: true }).fill('');
  await expect(page.getByRole('article')).toHaveCount(1);
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Favori : Pétanque', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Rechercher un jeu', { exact: true }).fill('Pé');
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByText('Variantes et versions', { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Jouer à la pétanque', exact: true }).click();
  const setup = page.getByRole('dialog', { name: 'Préparer la partie' });
  await setup.getByRole('switch', { name: 'Jouer en équipe', exact: true }).check();
  await setup.getByRole('switch', { name: 'Partie en 11 points', exact: true }).check();
  await expect(setup.getByRole('switch', { name: 'Jouer en équipe', exact: true })).toBeChecked();
  await expect(
    setup.getByRole('switch', { name: 'Partie en 11 points', exact: true }),
  ).toBeChecked();
  await setup.getByRole('button', { name: 'Annuler', exact: true }).click();
  await page.goto('/games/');
  await page.getByLabel('Rechercher un jeu', { exact: true }).fill('');
  await expect(page.getByRole('article')).toHaveCount(20);
  await expect(page.getByText('Bientôt disponible', { exact: true })).toHaveCount(0);
  await page.screenshot({
    path: test.info().outputPath('catalog-filters-mobile.png'),
    fullPage: true,
  });
});

test('preserves immutable saved custom versions and plays a cooperative pinned version offline', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await profiles(page);
  const originalVersion = await counter(page, 'Course');
  const card = page.getByRole('article', { name: 'Course', exact: true });
  await card.getByRole('link', { name: 'Jouer à ce jeu', exact: true }).click();
  const setup = page.getByRole('dialog', { name: 'Préparer une partie personnalisée' });
  const originalVersionId = await setup
    .getByLabel('Règles enregistrées', { exact: true })
    .inputValue();
  await setup.getByRole('switch', { name: 'Score commun (coopératif)', exact: true }).check();
  for (const name of ['Alice', 'Bob'])
    await setup.getByRole('checkbox', { name: `Sélectionner ${name}`, exact: true }).check();
  await setup.getByRole('button', { name: 'Retirer Alice', exact: true }).click();
  await setup.getByRole('checkbox', { name: 'Sélectionner Alice', exact: true }).check();
  await expect(setup.getByLabel('Organisateur sur cet appareil')).toHaveCount(0);
  await setup.getByRole('button', { name: 'Créer la partie', exact: true }).click();
  await page.getByRole('button', { name: 'Démarrer la partie', exact: true }).click();
  await score(page, 'Tous ensemble', 7);
  const oldUrl = page.url();
  const organizer = await page.evaluate(
    () =>
      new Promise<{ name: string; valid: boolean }>((resolve, reject) => {
        const open = indexedDB.open('scoretrackrr');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const read = db.transaction('matches', 'readonly').objectStore('matches').getAll();
          read.onerror = () => {
            db.close();
            reject(read.error);
          };
          read.onsuccess = () => {
            const match = read.result[0];
            const player = match.playersSnapshot.find(
              (row: { id: string }) => row.id === match.organizerPlayerId,
            );
            db.close();
            resolve({
              name: player?.displayName ?? '',
              valid: match.organizerPlayerId === match.playersSnapshot[0]?.id,
            });
          };
        };
      }),
  );
  expect(organizer).toEqual({ name: 'Bob', valid: true });
  const other = await context.newPage();
  await other.goto('/games/');
  const otherCard = other.getByRole('article', { name: 'Course', exact: true });
  await savedCustomGame(
    other,
    'Course',
    { target: 20, fields: [{ id: 'points', minimum: -10, maximum: 10, weight: 1 }] },
    originalVersion.gameId,
  );
  await otherCard.getByRole('link', { name: 'Jouer à ce jeu', exact: true }).click();
  const nextSetup = other.getByRole('dialog');
  await expect(
    nextSetup.getByLabel('Règles enregistrées', { exact: true }).locator('option'),
  ).toHaveCount(2);
  await nextSetup.getByText('Historique des règles', { exact: true }).click();
  await nextSetup
    .getByLabel('Règles enregistrées', { exact: true })
    .selectOption(originalVersionId);
  await nextSetup.getByRole('button', { name: 'Annuler', exact: true }).click();
  await page.reload();
  await score(page, 'Tous ensemble', 3);
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText(
    'Victoire : Tous ensemble',
  );
  expect(page.url()).toBe(oldUrl);
  await page.getByRole('button', { name: 'Corriger cette saisie', exact: true }).first().click();
  const correction = page.getByRole('dialog', { name: 'Confirmer cette action', exact: true });
  await correction.getByLabel('Points', { exact: true }).fill('1');
  await correction.getByRole('button', { name: 'Confirmer', exact: true }).click();
  await expect(correction).not.toBeVisible();
  await expect(page.locator('.match-page-heading')).toContainText('En cours');
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText(
    'Tous ensemble8',
  );
  await page.screenshot({
    path: test.info().outputPath('counter-cooperative-mobile.png'),
    fullPage: true,
  });
  await other.close();
});

test('offers player-based custom setup despite saved teams and manually finishes offline', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await profiles(page);
  await page.goto('/teams/');
  await page.getByRole('button', { name: 'Créer une équipe', exact: true }).click();
  await page.getByLabel('Nom de l’équipe', { exact: true }).fill('Duo');
  for (const name of ['Alice', 'Bob'])
    await page.getByRole('checkbox', { name: `Sélectionner ${name}`, exact: true }).check();
  await page.getByRole('button', { name: 'Enregistrer l’équipe', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await counter(page, 'Compteur individuel', false);
  await page
    .getByRole('article', { name: 'Compteur individuel', exact: true })
    .getByRole('link', { name: 'Jouer à ce jeu', exact: true })
    .click();
  const setup = page.getByRole('dialog', { name: 'Préparer une partie personnalisée' });
  await expect(setup.locator('#declarative-mode option[value=teams]')).toHaveCount(0);
  await expect(setup.locator('#declarative-mode option[value=mixed]')).toHaveCount(0);
  await setup.getByRole('checkbox', { name: 'Sélectionner Alice', exact: true }).check();
  await setup.getByRole('checkbox', { name: 'Sélectionner Chloé', exact: true }).check();
  await expect(setup.getByRole('button', { name: 'Choisir Duo', exact: true })).toHaveCount(0);
  await expect(setup.getByLabel('Organisateur sur cet appareil')).toHaveCount(0);
  await setup.getByRole('button', { name: 'Créer la partie', exact: true }).click();
  await page.getByRole('button', { name: 'Démarrer la partie', exact: true }).click();
  await score(page, 'Alice', 4);
  await score(page, 'Chloé', 3);
  await page.getByRole('button', { name: 'Clôturer la partie', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Confirmer cette action', exact: true })
    .getByRole('button', { name: 'Confirmer', exact: true })
    .click();
  const scores = page.getByRole('region', { name: 'Scores', exact: true });
  await expect(scores).toContainText('Victoire : Alice');
  await page.reload();
  await expect(scores).toContainText('Chloé3');
  await page.goto('/matches/');
  const history = page.getByRole('list', { name: 'Parties enregistrées', exact: true });
  await expect(history).toContainText('Compteur individuel');
  await expect(history).toContainText('Alice · Chloé');
  await expect(
    page.getByRole('link', { name: 'Nouvelle partie de pétanque', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('link', { name: 'Nouvelle partie', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'À quoi joue-t-on ?', exact: true }),
  ).toBeVisible();
});

test('keeps individual setup for player games offline', async ({ page, context }) => {
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  for (const name of ['Yams', '421', '5000 / 10000', 'Skull King', 'Flip 7', '6 qui prend !']) {
    await page.goto('/games/');
    await page
      .getByRole('article', { name, exact: true })
      .getByRole('link', { name: /^Jouer/ })
      .first()
      .click();
    const setup = page.getByRole('dialog');
    await expect(setup.getByRole('switch', { name: 'Jouer en équipe', exact: true })).toHaveCount(
      0,
    );
    await expect(
      setup.getByRole('heading', { name: 'Équipes de la partie', exact: true }),
    ).toHaveCount(0);
    await expect(
      setup.getByRole('button', { name: 'Créer la partie', exact: true }),
    ).toBeDisabled();
    await setup.getByRole('button', { name: 'Annuler', exact: true }).click();
    await expect(setup).not.toBeVisible();
  }
});

test('plays darts with saved teams offline', async ({ page, context }) => {
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await seedPlayers(page, ['Alice', 'Bob', 'Chloé']);
  await page.goto('/teams/');
  for (const [name, members] of [
    ['Duo', ['Alice', 'Bob']],
    ['Solo', ['Chloé']],
  ] as const) {
    await page.getByRole('button', { name: 'Créer une équipe', exact: true }).click();
    const editor = page.getByRole('dialog');
    await editor.getByLabel('Nom de l’équipe', { exact: true }).fill(name);
    for (const member of members)
      await editor.getByRole('checkbox', { name: `Sélectionner ${member}`, exact: true }).check();
    await editor.getByRole('button', { name: 'Enregistrer l’équipe', exact: true }).click();
    await expect(editor).not.toBeVisible();
  }
  await page.goto('/games/');
  await page
    .getByRole('article', { name: 'Darts X01 / Cricket', exact: true })
    .getByRole('link', { name: 'Jouer aux fléchettes', exact: true })
    .click();
  const setup = page.getByRole('dialog');
  await setup.getByRole('switch', { name: 'Jouer en équipe', exact: true }).check();
  for (const name of ['Duo', 'Solo'])
    await setup.getByRole('button', { name: `Choisir ${name}`, exact: true }).click();
  await setup.getByRole('switch', { name: 'Jouer au X01', exact: true }).check();
  await expect(setup.getByRole('switch', { name: 'Jouer en équipe', exact: true })).toBeChecked();
  await setup.getByRole('switch', { name: 'Jouer au Cricket', exact: true }).uncheck();
  await setup.getByRole('button', { name: 'Créer la partie', exact: true }).click();
  await page.getByRole('button', { name: 'Démarrer la partie', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Au tour de Duo', exact: true })).toBeVisible();
  await expect(page.getByText('À toi de jouer : Alice', { exact: true })).toBeVisible();
  await page.getByLabel('Secteur touché', { exact: true }).selectOption('20');
  await page.getByLabel('Multiplicateur', { exact: true }).selectOption('3');
  await page.getByRole('button', { name: 'Enregistrer la fléchette', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText('Duo241');
  await page.reload();
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText('Duo241');
  await expect(page.getByText('À toi de jouer : Alice', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Enregistrer la fléchette', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Action n°3', exact: true })).toBeVisible();
  await expect(page.getByText('À toi de jouer : Alice', { exact: true })).toBeVisible();
  // Reload resets the form to misses; the third dart still completes the same member's visit.
  await page.getByRole('button', { name: 'Enregistrer la fléchette', exact: true }).click();
  await expect(page.getByText('À toi de jouer : Chloé', { exact: true })).toBeVisible();
  for (let dart = 0; dart < 3; dart++) {
    await page.getByRole('button', { name: 'Enregistrer la fléchette', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: `Action n°${5 + dart}`, exact: true }),
    ).toBeVisible();
  }
  await expect(page.getByText('À toi de jouer : Bob', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('À toi de jouer : Bob', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Annuler la dernière saisie', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmer', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByText('À toi de jouer : Chloé', { exact: true })).toBeVisible();
});
