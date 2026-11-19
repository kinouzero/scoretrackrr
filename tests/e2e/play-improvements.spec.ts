import { seedPlayers } from '../fixtures/players';
import { expect, test, type Page, type Locator } from '../fixtures/browser';
import { waitForOfflineReady } from '../fixtures/offline';
async function profiles(page: Page) {
  await seedPlayers(page, ['Alice', 'Bob']);
}
async function setup(page: Page, name = 'Jouer aux fléchettes') {
  await page.goto('/games/');
  await page.getByRole('link', { name, exact: true }).click();
  const dialog = page.getByRole('dialog');
  for (const name of ['Alice', 'Bob'])
    await dialog.getByRole('checkbox', { name: `Sélectionner ${name}`, exact: true }).check();
  return dialog;
}
async function start(page: Page, dialog: Locator) {
  await dialog.getByRole('button', { name: 'Créer la partie', exact: true }).click();
  await page.getByRole('button', { name: 'Démarrer la partie', exact: true }).click();
}
test('offers favorite configurations only for games with setup options', async ({ page }) => {
  await page.goto('/games/');
  for (const [name, configurable] of [
    ['421', false],
    ['5000 / 10000', true],
    ['6 qui prend !', true],
    ['Darts X01 / Cricket', true],
    ['Flip 7', false],
    ['Mölkky', true],
    ['Pétanque', true],
    ['Skull King', true],
    ['Time’s Up!', true],
    ['Yams', true],
  ] as const) {
    await page.goto('/games/');
    await page
      .getByRole('article', { name, exact: true })
      .getByRole('link', { name: /^Jouer/ })
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Configurations favorites', { exact: true })).toHaveCount(
      configurable ? 1 : 0,
    );
    await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
    await expect(dialog).not.toBeVisible();
  }
});
test('saves, reapplies and deletes an offline preset with ordered participants', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await profiles(page);
  let dialog = await setup(page);
  await dialog.getByLabel('Score de départ', { exact: true }).selectOption('601');
  await dialog.getByRole('button', { name: 'Monter Bob', exact: true }).click();
  await expect(dialog.locator('.participant-order li')).toHaveText([/Bob/, /Alice/]);
  await dialog.getByText('Configurations favorites', { exact: true }).click();
  await dialog.getByLabel('Nom de la configuration', { exact: true }).fill('Soirée 601');
  await dialog.getByRole('button', { name: 'Enregistrer la configuration', exact: true }).click();
  await expect(dialog.getByText('Configuration enregistrée.', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
  dialog = await setup(page);
  await dialog.getByText('Configurations favorites', { exact: true }).click();
  await dialog
    .getByLabel('Configuration enregistrée', { exact: true })
    .selectOption({ label: 'Soirée 601' });
  await dialog.getByRole('button', { name: 'Appliquer', exact: true }).click();
  await expect(dialog.getByLabel('Score de départ', { exact: true })).toHaveValue('601');
  await expect(dialog.locator('.participant-order li')).toHaveText([/Bob/, /Alice/]);
  await dialog.getByRole('button', { name: 'Supprimer', exact: true }).click();
  await expect(dialog.getByLabel('Configuration enregistrée', { exact: true })).toHaveCount(0);
  await start(page, dialog);
  await expect(page.getByRole('heading', { name: 'Au tour de Bob', exact: true })).toBeVisible();
});
test('recovers unsubmitted darts input, previews it without scoring, and never reuses it after saving', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await profiles(page);
  await start(page, await setup(page));
  await page.getByLabel('Secteur touché', { exact: true }).selectOption('19');
  await page.getByLabel('Multiplicateur', { exact: true }).selectOption('3');
  const preview = page.getByRole('complementary', { name: 'Avant validation', exact: true });
  await expect(preview).toContainText('301 → 244');
  await expect(page.locator('.journal-entries > li')).toHaveCount(1);
  await page.reload();
  await expect(page.getByLabel('Secteur touché', { exact: true })).toHaveValue('19');
  await expect(page.getByLabel('Multiplicateur', { exact: true })).toHaveValue('3');
  await expect(page.getByText(/Saisie récupérée/)).toBeVisible();
  await expect(page.locator('.journal-entries > li')).toHaveCount(1);
  await page.getByRole('button', { name: 'Enregistrer la fléchette', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText('Alice244');
  await expect(page.getByText(/Saisie récupérée/)).not.toBeVisible();
  await page.reload();
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText('Alice244');
  await expect(page.locator('.journal-entries > li')).toHaveCount(2);
});
test('recovers Flip7 card buttons and bonuses without recording the hand', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await profiles(page);
  await page.goto('/players/');
  await page.getByRole('button', { name: 'Ajouter un joueur', exact: true }).click();
  await page.getByLabel('Pseudonyme', { exact: true }).fill('Cara');
  await page.getByRole('button', { name: 'Enregistrer le profil', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  const dialog = await setup(page, 'Jouer à Flip 7');
  await dialog.getByRole('checkbox', { name: 'Sélectionner Cara', exact: true }).check();
  await start(page, dialog);
  await page.getByRole('button', { name: 'Carte 12', exact: true }).click();
  await page.getByRole('button', { name: 'Bonus +10', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Carte 12', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Bonus +10', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByText('22 points pour cette manche', { exact: true })).toBeVisible();
  await expect(page.locator('.journal-entries > li')).toHaveCount(1);
});
test('keeps tabletop display after reload and releases an optional screen lock on pause', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => {
    const state = { requests: 0, releases: 0 };
    Object.assign(window, { wakeTest: state });
    Object.defineProperty(navigator, 'wakeLock', {
      value: {
        request: async () => {
          state.requests++;
          return {
            released: false,
            addEventListener: () => undefined,
            release: async () => {
              state.releases++;
            },
          };
        },
      },
      configurable: true,
    });
  });
  await profiles(page);
  await start(page, await setup(page));
  await expect(page.locator('.match-status[data-status="in_progress"]')).toBeVisible();
  const title = page.getByRole('heading', { level: 1 });
  const controls = page.getByRole('group', { name: 'Affichage de la partie' });
  const keepAwake = controls.getByRole('button', { name: 'Garder l’écran allumé', exact: true });
  async function alignment() {
    return Promise.all(
      [title, controls, keepAwake].map((locator) =>
        locator.evaluate((element) => {
          const { x, y } = element.getBoundingClientRect();
          return { x, y: y + window.scrollY };
        }),
      ),
    );
  }
  const normalAlignment = await alignment();
  await controls.getByRole('button', { name: 'Mode table', exact: true }).click();
  const normalView = controls.getByRole('button', { name: 'Vue normale', exact: true });
  await expect(normalView).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-table-mode', 'true');
  expect(await alignment()).toEqual(normalAlignment);
  await page.getByRole('button', { name: 'Garder l’écran allumé', exact: true }).click();
  await expect(page.getByText('Écran maintenu allumé.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mettre en pause', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Vos parties', exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { wakeTest: { releases: number } }).wakeTest.releases,
      ),
    )
    .toBe(1);
  await page.getByRole('button', { name: 'Reprendre', exact: true }).click();
  await expect(normalView).toBeVisible();
  await page.reload();
  await expect(normalView).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-table-mode', 'true');
  await normalView.click();
  await expect(controls.getByRole('button', { name: 'Mode table', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-table-mode', 'false');
  expect(await alignment()).toEqual(normalAlignment);

  await page.setViewportSize({ width: 390, height: 844 });
  const compactAlignment = await alignment();
  await controls.getByRole('button', { name: 'Mode table', exact: true }).click();
  await expect(normalView).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-table-mode', 'true');
  expect(await alignment()).toEqual(compactAlignment);
});
test('recovers the entire six-nimmt round and previews totals before its atomic save', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await profiles(page);
  await start(page, await setup(page, 'Jouer au 6 qui prend !'));
  await page.getByRole('spinbutton', { name: 'Pénalités de Alice', exact: true }).fill('10');
  await page.getByRole('spinbutton', { name: 'Pénalités de Bob', exact: true }).fill('20');
  await page.reload();
  await expect(
    page.getByRole('spinbutton', { name: 'Pénalités de Alice', exact: true }),
  ).toHaveValue('10');
  await expect(page.getByRole('spinbutton', { name: 'Pénalités de Bob', exact: true })).toHaveValue(
    '20',
  );
  await expect(
    page.getByRole('complementary', { name: 'Avant validation', exact: true }),
  ).toContainText('0 → 20');
  await expect(page.locator('.journal-entries > li')).toHaveCount(1);
});
test('recovers a Yams cell dialog without locking in an unsubmitted score', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await profiles(page);
  await start(page, await setup(page, 'Jouer au Yams'));
  await page.getByRole('button', { name: 'Alice — Les 1 : à remplir', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Saisir ou corriger une case', exact: true });
  await dialog.getByLabel('Score de la case', { exact: true }).selectOption('4');
  await page.reload();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Score de la case', { exact: true })).toHaveValue('4');
  await expect(page.locator('.journal-entries > li')).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Confirmer', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Alice — Les 1 : 4', exact: true })).toBeVisible();
  await page.reload();
  await expect(dialog).not.toBeVisible();
});
test('a system refusal to keep the screen awake never blocks tabletop play', async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: async () => {
          throw new Error('denied');
        },
      },
    }),
  );
  await profiles(page);
  await start(page, await setup(page));
  await page.getByRole('button', { name: 'Garder l’écran allumé', exact: true }).click();
  await expect(
    page.getByText('Le système a refusé le maintien de l’écran.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Mode table', exact: true }).click();
  await page.getByRole('button', { name: 'Enregistrer la fléchette', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText('Alice281');
});

test('restores expansion switches and Rascal scoring from a saved Skull King setup', async ({
  page,
}) => {
  await seedPlayers(page, ['Alice', 'Bob', 'Cara']);
  await page.goto('/games/');
  await page.getByRole('link', { name: 'Jouer à Skull King', exact: true }).click();
  let dialog = page.getByRole('dialog');
  const switches = ['Cartes avancées du jeu de base', 'Extension 2025', 'Calcul des points Rascal'];
  for (const name of switches) await dialog.getByRole('switch', { name, exact: true }).check();
  await expect(dialog.getByRole('switch', { name: 'Cartes Butin', exact: true })).not.toBeChecked();
  for (const name of ['Alice', 'Bob', 'Cara'])
    await dialog.getByRole('checkbox', { name: `Sélectionner ${name}`, exact: true }).check();
  await dialog.getByText('Configurations favorites', { exact: true }).click();
  await dialog.getByLabel('Nom de la configuration', { exact: true }).fill('Rascal sans butin');
  await dialog.getByRole('button', { name: 'Enregistrer la configuration', exact: true }).click();
  await expect(dialog.getByText('Configuration enregistrée.', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
  await page.goto('/games/');
  await page.getByRole('link', { name: 'Jouer à Skull King', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByText('Configurations favorites', { exact: true }).click();
  await dialog
    .getByLabel('Configuration enregistrée', { exact: true })
    .selectOption({ label: 'Rascal sans butin' });
  await dialog.getByRole('button', { name: 'Appliquer', exact: true }).click();
  for (const name of switches)
    await expect(dialog.getByRole('switch', { name, exact: true })).toBeChecked();
  await expect(dialog.getByRole('switch', { name: 'Cartes Butin', exact: true })).not.toBeChecked();
  await start(page, dialog);
  await expect(page.locator('.match-options')).toContainText('Calcul Rascal');
  await expect(page.locator('.match-options')).toContainText('Butin : désactivé');
});
