import { waitForOfflineReady } from '../fixtures/offline';
import { expect, test, type Page } from '../fixtures/browser';

async function profiles(page: Page, names = ['Alice', 'Lucas', 'Emma', 'Hugo']) {
  await page.goto('/players/');
  for (const name of names) {
    await page.getByRole('button', { name: 'Ajouter un joueur' }).click();
    await page.getByLabel('Pseudonyme').fill(name);
    await page.getByLabel('Invité sans compte', { exact: true }).check();
    await page.getByRole('button', { name: 'Enregistrer le profil' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  }
}
async function team(page: Page, name: string, members: string[]) {
  await page.goto('/teams/');
  await page.getByRole('button', { name: 'Créer une équipe', exact: true }).click();
  await page.getByLabel('Nom de l’équipe', { exact: true }).fill(name);
  for (const member of members)
    await page.getByRole('checkbox', { name: `Sélectionner ${member}`, exact: true }).check();
  await page.getByRole('button', { name: 'Enregistrer l’équipe', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
}
async function prepareTeams(page: Page, names = ['Bleus', 'Rouges']) {
  await page.goto('/games/');
  await page.getByRole('link', { name: 'Jouer à la pétanque' }).click();
  const setup = page.getByRole('dialog', { name: 'Préparer la partie' });
  await setup.getByRole('switch', { name: 'Jouer en équipe', exact: true }).check();
  for (const name of names)
    await setup.getByRole('button', { name: `Choisir ${name}`, exact: true }).click();
  await expect(setup.getByLabel('Organisateur sur cet appareil')).toHaveCount(0);
  await setup.getByLabel('Premier lancer du cochonnet').selectOption({ label: names[0] });
  await setup.getByRole('button', { name: 'Créer la partie', exact: true }).click();
  await expect(setup).not.toBeVisible();
  await page.getByRole('button', { name: 'Démarrer la partie', exact: true }).click();
  await expect(page.getByRole('form', { name: 'Enregistrer la mène' })).toBeVisible();
  await expect(page.locator('details.sharing')).toHaveCount(0);
}
async function record(page: Page, name: string, points: number) {
  const form = page.getByRole('form', { name: 'Enregistrer la mène' });
  await form.getByRole('radio', { name: `Points pour ${name}`, exact: true }).check();
  await form
    .getByRole('button', { name: `${points} ${points === 1 ? 'point' : 'points'}`, exact: true })
    .click();
  await form.getByRole('button', { name: 'Enregistrer la mène', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Mène enregistrée sur cet appareil.' }),
  ).toBeVisible();
}
async function confirm(page: Page, title: string) {
  const dialog = page.getByRole('dialog', { name: title, exact: true });
  await dialog.getByRole('button', { name: 'Confirmer', exact: true }).click();
  await expect(dialog).not.toBeVisible();
}

test('plays, corrects, pauses, reopens and rematches two teams entirely offline', async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  const external: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.protocol.startsWith('http') && url.origin !== 'http://127.0.0.1:4178')
      external.push(request.url());
  });
  await page.addInitScript(() => {
    Object.defineProperty(window, 'RTCPeerConnection', {
      value: class {
        constructor() {
          throw new Error('Unexpected peer connection in single-device play');
        }
      },
    });
  });
  await page.goto('/matches/');
  await expect(page.locator('details.sharing')).toHaveCount(0);
  await waitForOfflineReady(page);
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await profiles(page);
  await team(page, 'Bleus', ['Alice', 'Lucas']);
  await team(page, 'Rouges', ['Emma', 'Hugo']);
  await prepareTeams(page);
  const scores = page.getByRole('region', { name: 'Scores', exact: true });
  await record(page, 'Bleus', 4);
  await record(page, 'Rouges', 2);
  const form = page.getByRole('form', { name: 'Enregistrer la mène' });
  await form.getByRole('radio', { name: 'Mène nulle', exact: true }).check();
  await form.getByRole('button', { name: 'Enregistrer la mène', exact: true }).click();
  await expect(page.getByText('3 mènes comptées', { exact: false })).toBeVisible();
  await expect(scores).toContainText('Bleus4');
  await expect(scores).toContainText('Rouges2');
  await page.getByRole('button', { name: 'Annuler la mène n°2', exact: true }).click();
  await confirm(page, 'Confirmer l’annulation de la mène');
  await page.getByRole('button', { name: 'Corriger la mène n°1', exact: true }).click();
  const correction = page.getByRole('dialog', { name: 'Confirmer la correction' });
  await correction.getByRole('button', { name: '3 points', exact: true }).click();
  await confirm(page, 'Confirmer la correction');
  await expect(scores).toContainText('Bleus3');
  await expect(scores).toContainText('Rouges0');
  await page.getByRole('button', { name: 'Mettre en pause', exact: true }).click();
  await expect(form).not.toBeVisible();
  await page.reload();
  await expect(page.locator('.match-card').getByText('En pause', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reprendre', exact: true }).click();
  await record(page, 'Bleus', 6);
  await record(page, 'Bleus', 4);
  await expect(scores).toContainText('Victoire : Bleus');
  await expect(form).not.toBeVisible();
  await page.getByRole('button', { name: 'Corriger la mène n°5', exact: true }).click();
  await correction.getByRole('button', { name: '2 points', exact: true }).click();
  await confirm(page, 'Confirmer la correction');
  await expect(
    page.locator('.match-page-heading').getByText('En cours', { exact: true }),
  ).toBeVisible();
  await expect(scores).toContainText('Bleus11');
  await record(page, 'Bleus', 2);
  await expect(scores).toContainText('Victoire : Bleus');
  await page.screenshot({
    path: test.info().outputPath('petanque-team-mobile.png'),
    fullPage: true,
  });
  const oldUrl = page.url();
  await page.getByRole('button', { name: 'Revanche', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mettre en pause', exact: true })).toBeVisible();
  await expect(
    page.getByText('Prochain lancer du cochonnet : Rouges', { exact: true }),
  ).toBeVisible();
  expect(page.url()).not.toBe(oldUrl);
  await expect(scores).toContainText('Bleus0');
  await page.goto('/teams/');
  await expect(page.getByRole('article')).toHaveCount(2);
  await expect(page.getByLabel('Utilisation', { exact: true })).toHaveCount(0);
  await prepareTeams(page);
  await record(page, 'Bleus', 1);
  await page.goto(oldUrl);
  await expect(scores).toContainText('Victoire : Bleus');
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test('chooses four individuals and finishes an 11-point free-play match with two boules each', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await profiles(page);
  await page.goto('/matches/?new=petanque');
  const setup = page.getByRole('dialog', { name: 'Préparer la partie' });
  await expect(
    setup.getByRole('switch', { name: 'Jouer en équipe', exact: true }),
  ).not.toBeChecked();
  for (const name of ['Alice', 'Lucas', 'Emma', 'Hugo'])
    await setup.getByRole('checkbox', { name: `Sélectionner ${name}`, exact: true }).check();
  await expect(setup.getByText('Jeu libre à plus de deux camps', { exact: false })).toBeVisible();
  await setup.getByLabel('Boules par joueur').selectOption('2');
  await setup.getByRole('switch', { name: 'Partie en 11 points', exact: true }).check();
  await expect(setup.getByLabel('Organisateur sur cet appareil')).toHaveCount(0);
  await setup.getByLabel('Premier lancer du cochonnet').selectOption({ label: 'Emma' });
  await setup.getByRole('button', { name: 'Créer la partie', exact: true }).click();
  await page.getByRole('button', { name: 'Démarrer la partie', exact: true }).click();
  const scores = page.getByRole('region', { name: 'Scores', exact: true });
  await expect(
    scores.getByRole('list', { name: 'Scores', exact: true }).getByRole('listitem'),
  ).toHaveCount(4);
  await expect(
    page.getByRole('list', { name: 'Paramètres de la partie', exact: true }).getByRole('listitem'),
  ).toHaveText([
    'Chacun pour soi',
    '4 joueurs',
    'Objectif · 11 points',
    '2 boules par joueur',
    'Jeu libre',
  ]);
  await expect(
    page.getByRole('form').getByRole('button', { name: '3 points', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole('radio', { name: 'Cochonnet mort', exact: true })).toHaveCount(0);
  await record(page, 'Alice', 2);
  await record(page, 'Emma', 1);
  for (let i = 0; i < 5; i++) await record(page, 'Hugo', 2);
  // The last point hides the entry form, so commit it without the helper's reset assertion.
  const form = page.getByRole('form', { name: 'Enregistrer la mène' });
  await form.getByRole('radio', { name: 'Points pour Hugo', exact: true }).check();
  await form.getByRole('button', { name: '1 point', exact: true }).click();
  await form.getByRole('button', { name: 'Enregistrer la mène', exact: true }).click();
  await expect(scores).toContainText('Victoire : Hugo');
  await page.reload();
  await expect(scores).toContainText('Hugo11');
  await expect(scores).toContainText('Alice2');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({
    path: test.info().outputPath('petanque-individual-desktop.png'),
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('selects three teams, keeps score for each and rejects a stale correction confirmation', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await profiles(page, ['Alice', 'Lucas', 'Emma', 'Hugo', 'Léa', 'Max']);
  await team(page, 'Bleus', ['Alice', 'Lucas']);
  await team(page, 'Rouges', ['Emma', 'Hugo']);
  await team(page, 'Verts', ['Léa', 'Max']);
  await prepareTeams(page, ['Bleus', 'Rouges', 'Verts']);
  await record(page, 'Verts', 3);
  await record(page, 'Bleus', 4);
  const scores = page.getByRole('region', { name: 'Scores', exact: true });
  await expect(
    scores.getByRole('list', { name: 'Scores', exact: true }).getByRole('listitem'),
  ).toHaveCount(3);
  await expect(scores).toContainText('Verts3');
  await expect(
    page.getByText('À plus de deux camps, le cochonnet mort', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Corriger la mène n°1', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirmer la correction' });
  const other = await context.newPage();
  await other.goto(page.url());
  await other.getByRole('button', { name: 'Mettre en pause', exact: true }).click();
  await expect(other.locator('.match-card')).toContainText('En pause');
  await dialog.getByRole('button', { name: 'Confirmer', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('La partie ou une équipe a changé');
  await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
  await expect(scores).toContainText('Verts3');
  await page.getByRole('button', { name: 'Reprendre la partie', exact: true }).click();
  await record(page, 'Rouges', 1);
  await page.reload();
  await expect(scores).toContainText('Rouges1');
  await other.close();
});

test('enters a dead jack explicitly and preserves score input after quota failure', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await profiles(page);
  await team(page, 'Bleus', ['Alice', 'Lucas']);
  await team(page, 'Rouges', ['Emma', 'Hugo']);
  await prepareTeams(page);
  const form = page.getByRole('form', { name: 'Enregistrer la mène' });
  const scores = page.getByRole('region', { name: 'Scores', exact: true });
  await form.getByRole('radio', { name: 'Cochonnet mort', exact: true }).check();
  await form.getByLabel('Boules restantes pour Bleus').selectOption('0');
  await form.getByLabel('Boules restantes pour Rouges').selectOption('4');
  await form.getByRole('button', { name: 'Enregistrer la mène', exact: true }).click();
  await expect(scores).toContainText('Rouges4');
  await expect(
    page.getByText('Prochain lancer du cochonnet : Rouges', { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'matchProjections') throw new DOMException('Full', 'QuotaExceededError');
      return put.apply(this, args);
    };
  });
  await form.getByRole('radio', { name: 'Points pour Bleus', exact: true }).check();
  await form.getByRole('button', { name: '3 points', exact: true }).click();
  await form.getByRole('button', { name: 'Enregistrer la mène', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Le stockage de cet appareil est plein' }),
  ).toBeVisible();
  await expect(form.getByRole('radio', { name: 'Points pour Bleus', exact: true })).toBeChecked();
  await expect(form.getByRole('button', { name: '3 points', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(scores).toContainText('Bleus0');
  await page.reload();
  await expect(scores).toContainText('Rouges4');
  await expect(scores).toContainText('Bleus0');
  await expect(page.getByText('1 mène comptée', { exact: false })).toBeVisible();
});

test('uses separate collapsed rules and top actions for undo, pause, rematch and cancellation offline', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await profiles(page);
  await team(page, 'Bleus', ['Alice', 'Lucas']);
  await team(page, 'Rouges', ['Emma', 'Hugo']);
  await prepareTeams(page);
  await expect(
    page.getByRole('heading', { name: 'Pétanque', level: 1, exact: true }),
  ).toBeVisible();
  await expect(page).toHaveTitle('Pétanque · Scoretrackrr');
  await expect(page.getByText('Scores recalculés', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Organisateur actuel', { exact: false })).toHaveCount(0);
  const toolbar = page.getByRole('group', { name: 'Actions de la partie', exact: true });
  const rulesSection = page.getByRole('region', { name: 'Règles du jeu', exact: true });
  const rules = rulesSection.locator('summary');
  const disclosure = rulesSection.locator('details');
  await expect(toolbar.locator('summary')).toHaveCount(0);
  await expect(disclosure).not.toHaveAttribute('open');
  await rules.focus();
  await page.keyboard.press('Space');
  await expect(
    rulesSection.getByRole('heading', { name: 'Joueurs de la partie', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(
    rulesSection.getByRole('heading', { name: 'Joueurs de la partie', exact: true }),
  ).not.toBeVisible();
  await rules.click();
  await expect(disclosure).toHaveAttribute('open', '');
  await page.reload();
  await expect(disclosure).not.toHaveAttribute('open');
  await record(page, 'Bleus', 2);
  await toolbar.getByRole('button', { name: 'Annuler la dernière saisie', exact: true }).click();
  await confirm(page, 'Confirmer l’annulation de la mène');
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText('Bleus0');
  await expect(
    toolbar.getByRole('button', { name: 'Annuler la dernière saisie', exact: true }),
  ).toHaveCount(0);
  await toolbar.getByRole('button', { name: 'Mettre en pause', exact: true }).click();
  await expect(page.getByRole('form', { name: 'Enregistrer la mène' })).not.toBeVisible();
  await page.getByRole('button', { name: 'Reprendre', exact: true }).click();
  await record(page, 'Bleus', 6);
  await record(page, 'Bleus', 6);
  await record(page, 'Bleus', 1);
  await expect(page.getByText('Victoire : Bleus', { exact: true })).toBeVisible();
  await rules.click();
  await expect(disclosure).toHaveAttribute('open', '');
  await toolbar.getByRole('button', { name: 'Revanche', exact: true }).click();
  await expect(toolbar.getByRole('button', { name: 'Mettre en pause', exact: true })).toBeVisible();
  await expect(disclosure).not.toHaveAttribute('open');
  await toolbar.getByRole('button', { name: 'Annuler la partie', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmer', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('.match-card').getByText('Annulée', { exact: true })).toBeVisible();
});
