import { seedPlayers } from '../fixtures/players';
import { expect, test, type Page } from '../fixtures/browser';
import { waitForOfflineReady } from '../fixtures/offline';
async function create(page: Page, options?: { cards: number; seconds: number }) {
  await seedPlayers(page, ['Alice', 'Bob', 'Emma', 'Hugo']);
  await page.goto('/teams/');
  for (const [name, members] of [
    ['Bleus', ['Alice', 'Bob']],
    ['Rouges', ['Emma', 'Hugo']],
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
  await page.getByRole('article', { name: 'Time’s Up!', exact: true }).getByRole('link').click();
  const setup = page.getByRole('dialog');
  if (options) {
    await setup.getByLabel('Nombre de cartes', { exact: true }).fill(String(options.cards));
    await setup
      .getByLabel('Durée du chrono (secondes)', { exact: true })
      .fill(String(options.seconds));
  }
  await expect(setup.getByRole('button', { name: 'Créer la partie', exact: true })).toBeDisabled();
  for (const name of ['Bleus', 'Rouges'])
    await setup.getByRole('button', { name: `Choisir ${name}`, exact: true }).click();
  await setup.getByRole('button', { name: 'Créer la partie', exact: true }).click();
  await page.getByRole('button', { name: 'Démarrer la partie', exact: true }).click();
}
async function confirm(page: Page) {
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmer', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
}
async function score(page: Page, points: number) {
  await page.getByLabel('Cartes trouvées pendant ce tour', { exact: true }).fill(String(points));
  await page.getByRole('button', { name: 'Enregistrer le tour', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Démarrer le chrono', exact: true })).toBeVisible();
}
test('keeps a running deadline through offline reload, freezes on match pause and expires at zero', async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await create(page);
  await expect(page.getByText('Fait deviner : Alice', { exact: true })).toBeVisible();
  // Freeze Date while retaining real browser scheduling for Dexie and UI interactions.
  const start = Date.now();
  await page.clock.setFixedTime(start);
  await page.getByRole('button', { name: 'Démarrer le chrono', exact: true }).click();
  await page.clock.setFixedTime(start + 12_000);
  await expect(page.getByRole('timer')).toHaveText('00:18');
  await expect(page.getByText('Fait deviner : Alice', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('timer')).toHaveText('00:18');
  await expect(page.getByText('Fait deviner : Alice', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mettre en pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reprendre', exact: true })).toBeVisible();
  await page.clock.setFixedTime(start + 120_000);
  await page.reload();
  await expect(page.locator('.match-card .match-status')).toHaveText('En pause');
  await page.getByRole('button', { name: 'Reprendre', exact: true }).click();
  await expect(page.getByRole('timer')).toHaveText('00:18');
  await expect(page.getByText('Fait deviner : Alice', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reprendre le chrono', exact: true }).click();
  await page.clock.setFixedTime(start + 139_000);
  await expect(page.getByRole('timer')).toHaveText('00:00');
  await expect(page.getByText('Temps écoulé !', { exact: true })).toBeVisible();
  await score(page, 10);
  await expect(page.getByText('Fait deviner : Emma', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Au tour de Rouges', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Corriger le dernier tour', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByLabel('Cartes trouvées pendant ce tour', { exact: true })
    .fill('12');
  await confirm(page);
  await expect(page.getByText('28 cartes restantes', { exact: true })).toBeVisible();
  await expect(page.getByText('Fait deviner : Emma', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Annuler la dernière action', exact: true }).click();
  await confirm(page);
  await expect(page.getByRole('heading', { name: 'Au tour de Bleus', exact: true })).toBeVisible();
  await expect(page.getByText('40 cartes restantes', { exact: true })).toBeVisible();
  await expect(page.getByText('Fait deviner : Alice', { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('times-up-timer.png'), fullPage: true });
  expect(errors).toEqual([]);
});
test('plays all three rounds and corrects a winning score back into an unfinished round', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await create(page);
  for (let round = 1; round <= 3; round++) {
    await expect(
      page.getByText(`Fait deviner : ${['Alice', 'Emma', 'Bob'][round - 1]}`, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: new RegExp(`Manche ${round} sur 3`) }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Démarrer le chrono', exact: true }).click();
    await page.getByLabel('Cartes trouvées pendant ce tour', { exact: true }).fill('40');
    await page.getByRole('button', { name: 'Enregistrer le tour', exact: true }).click();
    if (round < 3)
      await expect(
        page.getByRole('button', { name: 'Démarrer le chrono', exact: true }),
      ).toBeVisible();
  }
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText(
    'Victoire : Bleus',
  );
  await page.reload();
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText(
    'Victoire : Bleus',
  );
  await page.screenshot({ path: test.info().outputPath('times-up-finished.png'), fullPage: true });
  await page.getByRole('button', { name: 'Corriger le dernier tour', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByLabel('Cartes trouvées pendant ce tour', { exact: true })
    .fill('39');
  await confirm(page);
  await expect(page.getByText('1 carte restante', { exact: true })).toBeVisible();
  await expect(page.getByText('Fait deviner : Hugo', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Démarrer le chrono', exact: true })).toBeVisible();
});

test('uses a custom card pool and a timer longer than one minute after reload', async ({
  page,
}) => {
  await create(page, { cards: 7, seconds: 90 });
  await expect(page.getByText('7 cartes restantes', { exact: true })).toBeVisible();
  await expect(page.getByRole('timer')).toHaveText('01:30');
  await expect(page.getByLabel('Cartes trouvées pendant ce tour', { exact: true })).toHaveAttribute(
    'max',
    '7',
  );
  await page.reload();
  await expect(page.getByRole('timer')).toHaveText('01:30');
  await page.getByRole('button', { name: 'Démarrer le chrono', exact: true }).click();
  await score(page, 7);
  await expect(page.getByText('7 cartes restantes', { exact: true })).toBeVisible();
  await expect(page.getByRole('timer')).toHaveText('01:30');
});
