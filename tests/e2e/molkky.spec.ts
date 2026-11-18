import { seedPlayers } from '../fixtures/players';
import { expect, test, type Page } from '../fixtures/browser';
import { waitForOfflineReady } from '../fixtures/offline';
async function create(page: Page, names: string[]) {
  await seedPlayers(page, names);
  await page.goto('/games/');
  await page
    .getByRole('article', { name: 'Mölkky', exact: true })
    .getByRole('link', { name: 'Jouer au Mölkky', exact: true })
    .click();
  const setup = page.getByRole('dialog');
  await expect(setup.getByLabel('Variante', { exact: true })).toHaveCount(0);
  await expect(
    setup.getByRole('switch', { name: 'Jouer en équipe', exact: true }),
  ).not.toBeChecked();
  await expect(setup.getByLabel('Organisateur sur cet appareil')).toHaveCount(0);
  for (const name of names)
    await setup.getByRole('checkbox', { name: `Sélectionner ${name}`, exact: true }).check();
  await setup.getByRole('button', { name: 'Créer la partie', exact: true }).click();
  await page.getByRole('button', { name: 'Démarrer la partie', exact: true }).click();
  await expect(page.locator('.rule-guide .rule-goal')).toContainText('exactement 50');
}
async function shot(page: Page, points: number, next?: string) {
  await page.getByLabel('Points du lancer', { exact: true }).selectOption(String(points));
  await page.getByRole('button', { name: 'Enregistrer le lancer', exact: true }).click();
  if (next)
    await expect(
      page.getByRole('heading', { name: `Au tour de ${next}`, exact: true }),
    ).toBeVisible();
  else await expect(page.locator('.match-page-heading')).toContainText('Terminée');
}
async function confirm(page: Page) {
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmer', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
}
test('plays exact50 offline with overshoot, pause, correction, undo and persistent victory', async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await create(page, ['Alice', 'Bob']);
  for (let i = 0; i < 4; i++) {
    await shot(page, 12, 'Bob');
    await shot(page, 1, 'Alice');
  }
  await shot(page, 3, 'Bob');
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText('Alice25');
  await page.getByRole('button', { name: 'Mettre en pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reprendre', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Reprendre', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Au tour de Bob', exact: true })).toBeVisible();
  await shot(page, 1, 'Alice');
  await shot(page, 12, 'Bob');
  await shot(page, 1, 'Alice');
  await shot(page, 12, 'Bob');
  await shot(page, 1, 'Alice');
  await shot(page, 1);
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText(
    'Victoire : Alice',
  );
  await page.getByRole('button', { name: 'Corriger le dernier lancer', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Points du lancer', { exact: true }).fill('0');
  await confirm(page);
  await expect(page.getByRole('heading', { name: 'Au tour de Bob', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Annuler le dernier lancer', exact: true }).click();
  await confirm(page);
  await expect(page.getByRole('heading', { name: 'Au tour de Alice', exact: true })).toBeVisible();
  await shot(page, 1);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText('Alice50');
  await page.screenshot({ path: test.info().outputPath('molkky-offline.png'), fullPage: true });
  expect(errors).toEqual([]);
});
test('eliminates after three misses, skips eliminated turns and reopens a last-survivor win', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await create(page, ['Alice', 'Bob', 'Chloé']);
  for (let i = 0; i < 2; i++) {
    await shot(page, 0, 'Bob');
    await shot(page, 1, 'Chloé');
    await shot(page, 1, 'Alice');
  }
  await shot(page, 0, 'Bob');
  await expect(
    page.getByRole('list', { name: 'Lancers nuls et éliminations', exact: true }),
  ).toContainText('Alice : éliminé');
  await shot(page, 0, 'Chloé');
  await shot(page, 1, 'Bob');
  await shot(page, 0, 'Chloé');
  await shot(page, 1, 'Bob');
  await shot(page, 0);
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText(
    'Victoire : Chloé',
  );
  await page.getByRole('button', { name: 'Annuler le dernier lancer', exact: true }).click();
  await confirm(page);
  await expect(page.getByRole('heading', { name: 'Au tour de Bob', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Au tour de Bob', exact: true })).toBeVisible();
});

test('uses saved teams with shared scores and miss counters offline', async ({ page, context }) => {
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await page.goto('/players/');
  for (const name of ['Alice', 'Bob', 'Chloé', 'David']) {
    await page.getByRole('button', { name: 'Ajouter un joueur', exact: true }).click();
    await page.getByLabel('Pseudonyme', { exact: true }).fill(name);
    await page.getByRole('button', { name: 'Enregistrer le profil', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  }
  await page.goto('/teams/');
  for (const [name, members] of [
    ['Bois', ['Alice', 'Bob']],
    ['Quilles', ['Chloé', 'David']],
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
  await page.getByRole('link', { name: 'Jouer au Mölkky', exact: true }).click();
  const setup = page.getByRole('dialog');
  await setup.getByRole('switch', { name: 'Jouer en équipe', exact: true }).check();
  for (const name of ['Bois', 'Quilles'])
    await setup.getByRole('button', { name: `Choisir ${name}`, exact: true }).click();
  await setup.getByRole('button', { name: 'Créer la partie', exact: true }).click();
  await page.getByRole('button', { name: 'Démarrer la partie', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Au tour de Bois', exact: true })).toBeVisible();
  await expect(page.getByText('À toi de jouer : Alice', { exact: true })).toBeVisible();
  await shot(page, 0, 'Quilles');
  await expect(page.getByText('À toi de jouer : Chloé', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Lancers nuls et éliminations', exact: true }),
  ).toContainText('Bois : 1/3');
  await shot(page, 12, 'Bois');
  await expect(page.getByText('À toi de jouer : Bob', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('À toi de jouer : Bob', { exact: true })).toBeVisible();
  await shot(page, 0, 'Quilles');
  await expect(page.getByText('À toi de jouer : David', { exact: true })).toBeVisible();
  await shot(page, 12, 'Bois');
  await expect(page.getByText('À toi de jouer : Alice', { exact: true })).toBeVisible();
  await shot(page, 0);
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText(
    'Victoire : Quilles',
  );
  await page.reload();
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText(
    'Quilles24',
  );
  await expect(
    page.getByRole('list', { name: 'Lancers nuls et éliminations', exact: true }),
  ).toContainText('Bois : éliminé');
  await page.screenshot({ path: test.info().outputPath('molkky-teams.png'), fullPage: true });
});
