import { seedPlayers } from '../fixtures/players';
import { configureDarts } from '../fixtures/setup-settings';
import { waitForOfflineReady } from '../fixtures/offline';
import { expect, test, type Page } from '../fixtures/browser';
async function create(
  page: Page,
  variant = '301 · sortie double',
  series?: { target: number; rule: 'alternate' | 'loser'; sets?: number },
) {
  await seedPlayers(page, ['Alice', 'Bob']);
  await page.goto('/games/');
  const card = page.getByRole('article', { name: 'Darts X01 / Cricket', exact: true });
  await card.getByRole('link', { name: 'Jouer aux fléchettes', exact: true }).click();
  const setup = page.getByRole('dialog');
  await configureDarts(setup, variant);
  for (const name of ['Alice', 'Bob'])
    await setup.getByRole('checkbox', { name: `Sélectionner ${name}`, exact: true }).check();
  if (series) {
    await setup.getByRole('switch', { name: 'Match en plusieurs legs', exact: true }).check();
    if (series.sets !== undefined) {
      await setup.getByRole('switch', { name: 'Jouer en sets', exact: true }).check();
      await setup.getByLabel('Nombre de sets à gagner', { exact: true }).fill(String(series.sets));
    }
    await setup
      .getByLabel(
        series.sets === undefined ? 'Nombre de legs à gagner' : 'Nombre de legs à gagner par set',
        { exact: true },
      )
      .fill(String(series.target));
    await setup
      .getByLabel('Premier lanceur au leg suivant', { exact: true })
      .selectOption(series.rule);
    await setup
      .getByLabel('Premier lanceur du premier leg', { exact: true })
      .selectOption({ label: 'Alice' });
  }
  await expect(setup.getByLabel('Organisateur sur cet appareil')).toHaveCount(0);
  await setup.getByRole('button', { name: 'Créer la partie', exact: true }).click();
  await page.getByRole('button', { name: 'Démarrer la partie', exact: true }).click();
}
function thrower(page: Page) {
  let sequence = 1;
  return async (sector: number, multiplier = 1) => {
    await page.getByLabel('Secteur touché', { exact: true }).selectOption(String(sector));
    await page.getByLabel('Multiplicateur', { exact: true }).selectOption(String(multiplier));
    await page.getByRole('button', { name: 'Enregistrer la fléchette', exact: true }).click();
    sequence++;
    await expect(
      page.getByRole('heading', { name: `Action n°${sequence}`, exact: true }),
    ).toBeVisible();
  };
}
test('plays 301 double-out offline with a whole-visit bust, reversal and persisted checkout', async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await create(page);
  const dart = thrower(page);
  for (let i = 0; i < 3; i++) await dart(20, 3);
  for (let i = 0; i < 3; i++) await dart(0);
  await dart(20, 3);
  await dart(20);
  await dart(1);
  for (let i = 0; i < 3; i++) await dart(0);
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText('Alice40');
  const suggestions = page.getByRole('complementary', { name: /Sorties possibles/ });
  await expect(suggestions).toContainText('D20');
  await expect(suggestions.getByRole('heading')).toHaveText(
    'Sorties possibles · 3 fléchette(s) restante(s)',
  );
  await suggestions.getByRole('button', { name: 'Sorties suivantes', exact: true }).click();
  await expect(suggestions).toContainText(/Page 2 sur/);
  await dart(20);
  await expect(suggestions.getByRole('heading')).toHaveText(
    'Sorties possibles · 2 fléchette(s) restante(s)',
  );
  await expect(suggestions.getByRole('listitem').first()).toHaveText('D10');
  await dart(20);
  await expect(page.getByText(/^Bust :/)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText('Alice40');
  await expect(page.getByRole('heading', { name: 'Au tour de Bob', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Annuler la dernière saisie' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmer', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText('Alice20');
  await page.reload();
  await expect(
    page.getByText('Fléchette 2 sur 3 · début de volée : 40', { exact: true }),
  ).toBeVisible();
  await page.getByLabel('Secteur touché', { exact: true }).selectOption('10');
  await page.getByLabel('Multiplicateur', { exact: true }).selectOption('2');
  await page.getByRole('button', { name: 'Enregistrer la fléchette', exact: true }).click();
  await expect(page.getByText('Victoire : Alice', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Victoire : Alice', { exact: true })).toBeVisible();
  const stats = page.getByRole('table', { name: 'Statistiques de la partie' });
  await expect(stats.getByRole('row', { name: /^Alice / }).getByRole('cell')).toHaveText([
    '3',
    '301',
    '180',
    '100,3',
    '0',
  ]);
  await page.screenshot({ path: test.info().outputPath('301-offline.png'), fullPage: true });
  expect(errors).toEqual([]);
});
test('completes the 501 straight-out preset', async ({ page }) => {
  await create(page, '501 · sortie simple');
  const dart = thrower(page);
  for (let visit = 0; visit < 3; visit++) {
    for (let i = 0; i < 3; i++) await dart(20, visit === 2 && i === 2 ? 1 : 3);
    for (let i = 0; i < 3; i++) await dart(0);
  }
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText('Alice1');
  await expect(
    page
      .getByRole('complementary', { name: /Sorties possibles/ })
      .getByRole('listitem')
      .first(),
  ).toHaveText('S1');
  await dart(1);
  await expect(page.getByText('Victoire : Alice', { exact: true })).toBeVisible();
});

test('switches between per-dart and total-visit entry with bust, checkout and audited undo offline', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await create(page);
  await page.getByLabel('Mode de saisie', { exact: true }).selectOption('visit');
  let sequence = 1;
  async function visit(total: number, checkout = false) {
    await page.getByLabel(/^Total des/).fill(String(total));
    if (checkout)
      await page
        .getByRole('checkbox', {
          name: 'Dernière fléchette sur un double ou bull à 50',
          exact: true,
        })
        .check();
    await page
      .getByRole('button', { name: 'Enregistrer le total de la volée', exact: true })
      .click();
    sequence++;
    await expect(
      page.getByRole('heading', { name: `Action n°${sequence}`, exact: true }),
    ).toBeVisible();
  }
  await page.getByLabel(/^Total des/).scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('darts-entry-modes.png') });
  await page.getByLabel(/^Total des/).fill('179');
  await page.getByRole('button', { name: 'Enregistrer le total de la volée', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('total réalisable');
  await expect(page.getByRole('heading', { name: 'Au tour de Alice', exact: true })).toBeVisible();
  await visit(180);
  await expect(page.getByRole('heading', { name: 'Au tour de Bob', exact: true })).toBeVisible();
  await visit(0);
  await visit(81);
  await visit(0);
  await visit(40);
  await expect(page.getByText(/^Bust :/)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText('Alice40');
  await visit(0);
  await page.getByLabel('Mode de saisie', { exact: true }).selectOption('dart');
  await page.getByLabel('Secteur touché', { exact: true }).selectOption('20');
  await page.getByRole('button', { name: 'Enregistrer la fléchette', exact: true }).click();
  sequence++;
  await expect(
    page.getByRole('heading', { name: `Action n°${sequence}`, exact: true }),
  ).toBeVisible();
  await page.getByLabel('Mode de saisie', { exact: true }).selectOption('visit');
  await expect(
    page.getByLabel('Total des 2 fléchette(s) restante(s)', { exact: true }),
  ).toBeVisible();
  await visit(20, true);
  await expect(page.getByText('Victoire : Alice', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Alice : volée 20 points · sortie double confirmée', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Annuler la dernière saisie' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmer', exact: true }).click();
  await expect(
    page.getByLabel('Total des 2 fléchette(s) restante(s)', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText('Fléchette 2 sur 3 · début de volée : 40', { exact: true }),
  ).toBeVisible();
  await page.getByLabel('Mode de saisie', { exact: true }).selectOption('visit');
  await page.getByLabel(/^Total des/).fill('20');
  await page
    .getByRole('checkbox', { name: 'Dernière fléchette sur un double ou bull à 50', exact: true })
    .check();
  await page.getByRole('button', { name: 'Enregistrer le total de la volée', exact: true }).click();
  await expect(page.getByText('Victoire : Alice', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Victoire : Alice', { exact: true })).toBeVisible();
});

test('plays a darts match in sets and resumes after a reload at the set boundary', async ({
  page,
}) => {
  await create(page, '301 · sortie simple', { target: 2, sets: 2, rule: 'alternate' });
  const summary = page.getByRole('region', { name: 'Score du match', exact: true });
  async function visit(total: number) {
    const newest = page.locator('.journal-entries > li').first().getByRole('heading');
    const before = await newest.innerText();
    await page.getByLabel('Mode de saisie', { exact: true }).selectOption('visit');
    await page.getByLabel(/^Total des/).fill(String(total));
    await page
      .getByRole('button', { name: 'Enregistrer le total de la volée', exact: true })
      .click();
    await expect(newest).not.toHaveText(before);
  }
  async function winLeg(second: boolean) {
    await expect(
      page.getByRole('heading', {
        name: second ? 'Au tour de Bob' : 'Au tour de Alice',
        exact: true,
      }),
    ).toBeVisible();
    if (second) await visit(0);
    await visit(180);
    await visit(0);
    await visit(121);
  }
  await expect(summary).toContainText('Set 1 · Leg 1');
  await winLeg(false);
  await page.getByRole('button', { name: 'Démarrer le leg 2', exact: true }).click();
  await winLeg(true);
  await expect(summary).toContainText('Set remporté par Alice');
  await expect(page.getByText('Victoire : Alice', { exact: true })).not.toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Démarrer le set 2', exact: true }).click();
  await expect(summary).toContainText('Set 2 · Leg 1');
  await expect(summary).toContainText('Alice · 1 set · 0 leg');
  await winLeg(false);
  await page.getByRole('button', { name: 'Démarrer le leg 2', exact: true }).click();
  await winLeg(true);
  await expect(page.getByText('Victoire : Alice', { exact: true })).toBeVisible();
  await expect(summary).toContainText('Alice · 2 sets · 2 legs');
});

for (const rule of ['alternate', 'loser'] as const)
  test(`plays a three-leg target offline with ${rule} starters and a reversible match win`, async ({
    page,
    context,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await waitForOfflineReady(page);
    await context.setOffline(true);
    await create(page, '301 · sortie simple', { target: 3, rule });
    const summary = page.getByRole('region', { name: 'Score du match', exact: true });
    async function changed(click: () => Promise<unknown>) {
      const newest = page.locator('.journal-entries > li').first().getByRole('heading');
      const before = await newest.innerText();
      await click();
      await expect(newest).not.toHaveText(before);
    }
    async function visit(total: number) {
      await page.getByLabel('Mode de saisie', { exact: true }).selectOption('visit');
      await page.getByLabel(/^Total des/).fill(String(total));
      await changed(() =>
        page.getByRole('button', { name: 'Enregistrer le total de la volée', exact: true }).click(),
      );
    }
    async function win(starter: string) {
      await expect(
        page.getByRole('heading', { name: `Au tour de ${starter}`, exact: true }),
      ).toBeVisible();
      if (starter === 'Bob') await visit(0);
      await visit(180);
      await visit(0);
      await visit(121);
      await expect(summary).toContainText('Leg remporté par Alice');
    }
    await win('Alice');
    await expect(summary).toContainText('Alice : 1 leg(s) gagné(s)');
    await expect(summary).toContainText('Prochain leg : Bob commence');
    await expect(page.getByText('Terminée', { exact: true })).not.toBeVisible();
    await page.getByRole('button', { name: 'Mettre en pause', exact: true }).click();
    await expect(page.locator('.match-card .match-status')).toHaveText('En pause');
    await page.reload();
    await expect(page.locator('.match-card .match-status')).toHaveText('En pause');
    await page.getByRole('button', { name: 'Reprendre', exact: true }).click();
    await expect(summary).toContainText('Alice : 1 leg(s) gagné(s)');
    await changed(() =>
      page.getByRole('button', { name: 'Démarrer le leg 2', exact: true }).click(),
    );
    await win('Bob');
    const third = rule === 'alternate' ? 'Alice' : 'Bob';
    await expect(summary).toContainText(`Prochain leg : ${third} commence`);
    await summary.scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath(`legs-${rule}.png`) });
    await changed(() =>
      page.getByRole('button', { name: 'Démarrer le leg 3', exact: true }).click(),
    );
    await win(third);
    await expect(page.getByText('Victoire : Alice', { exact: true })).toBeVisible();
    await expect(summary).toContainText('Alice : 3 leg(s) gagné(s)');
    await page.getByRole('button', { name: 'Annuler la dernière saisie' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirmer', exact: true }).click();
    await expect(summary).toContainText('Alice : 2 leg(s) gagné(s)');
    await expect(page.getByText('Terminée', { exact: true })).not.toBeVisible();
    await visit(121);
    await page.reload();
    await expect(page.getByText('Victoire : Alice', { exact: true })).toBeVisible();
    await expect(summary).toContainText('Alice : 3 leg(s) gagné(s)');
    const stats = page.getByRole('table', { name: 'Statistiques de la partie' });
    await expect(stats.getByRole('row', { name: /^Alice / }).getByRole('cell')).toHaveText([
      '6',
      '903',
      '180',
      '150,5',
      '0',
    ]);
    expect(errors).toEqual([]);
  });

test('uses keyboard toggles and retains participants and leg settings across rule changes offline', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await page.goto('/players/');
  for (const name of ['Alice', 'Bob']) {
    await page.getByRole('button', { name: 'Ajouter un joueur', exact: true }).click();
    await page.getByLabel('Pseudonyme', { exact: true }).fill(name);
    await page.getByRole('button', { name: 'Enregistrer le profil', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  }
  await page.goto('/games/');
  await page.getByRole('link', { name: 'Jouer aux fléchettes', exact: true }).click();
  const setup = page.getByRole('dialog');
  await expect(setup.getByLabel('Variante', { exact: true })).toHaveCount(0);
  for (const name of ['Alice', 'Bob'])
    await setup.getByRole('checkbox', { name: `Sélectionner ${name}`, exact: true }).check();
  await setup.getByRole('switch', { name: 'Match en plusieurs legs', exact: true }).check();
  await setup.getByLabel('Nombre de legs à gagner', { exact: true }).fill('2');
  await setup
    .getByLabel('Premier lanceur du premier leg', { exact: true })
    .selectOption({ label: 'Bob' });
  const start = setup.getByLabel('Score de départ', { exact: true });
  await start.selectOption('601');
  await expect(start).toHaveValue('601');
  await setup.getByRole('switch', { name: 'Sortie double', exact: true }).uncheck();
  await setup.getByRole('switch', { name: 'Jouer au X01', exact: true }).check();
  await setup.getByRole('switch', { name: 'Compter les points', exact: true }).uncheck();
  await setup.getByRole('switch', { name: 'Jouer au Cricket', exact: true }).uncheck();
  await expect(start).toHaveValue('601');
  await expect(setup.getByRole('switch', { name: 'Sortie double', exact: true })).not.toBeChecked();
  await expect(
    setup.getByRole('switch', { name: 'Match en plusieurs legs', exact: true }),
  ).toBeChecked();
  await expect(setup.getByLabel('Nombre de legs à gagner', { exact: true })).toHaveValue('2');
  await setup.getByRole('switch', { name: 'Jouer au X01', exact: true }).check();
  await expect(
    setup.getByRole('switch', { name: 'Compter les points', exact: true }),
  ).not.toBeChecked();
  await setup.getByRole('switch', { name: 'Jouer au Cricket', exact: true }).uncheck();
  await setup.getByRole('button', { name: 'Créer la partie', exact: true }).click();
  await page.getByRole('button', { name: 'Démarrer la partie', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Au tour de Bob', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText('Bob601');
});
