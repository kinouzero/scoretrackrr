import { expect, test, type Page } from '../fixtures/browser';
import { waitForOfflineReady } from '../fixtures/offline';
import { configureDarts } from '../fixtures/setup-settings';
async function profiles(page: Page, names: string[]) {
  await page.goto('/players/');
  for (const name of names) {
    await page.getByRole('button', { name: 'Ajouter un joueur', exact: true }).click();
    await page.getByLabel('Pseudonyme', { exact: true }).fill(name);
    await page.getByRole('button', { name: 'Enregistrer le profil', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  }
}
async function openSetup(page: Page, game = 'X01') {
  await page.goto('/games/');
  await page
    .getByRole('article', { name: game, exact: true })
    .getByRole('link', { name: `Jouer au ${game}`, exact: true })
    .click();
  return page.getByRole('dialog');
}
test('requires a valid cork winner and preserves multiplayer order and evidence offline', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await profiles(page, ['Alice', 'Bob', 'Chloé']);
  const setup = await openSetup(page);
  for (const name of ['Alice', 'Bob', 'Chloé'])
    await setup.getByRole('checkbox', { name: `Sélectionner ${name}`, exact: true }).check();
  await setup.getByRole('switch', { name: 'Cork pour commencer', exact: true }).check();
  const create = setup.getByRole('button', { name: 'Créer la partie', exact: true });
  await expect(create).toBeDisabled();
  await setup.getByRole('radio', { name: 'Chloé', exact: true }).check();
  await expect(create).toBeEnabled();
  await setup.getByRole('button', { name: 'Retirer Chloé', exact: true }).click();
  await expect(create).toBeDisabled();
  await setup.getByRole('checkbox', { name: 'Sélectionner Chloé', exact: true }).check();
  await expect(setup.getByRole('radio', { name: 'Chloé', exact: true })).not.toBeChecked();
  await setup.getByRole('radio', { name: 'Chloé', exact: true }).check();
  await create.click();
  await expect(page.getByText('Cork : Chloé', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Démarrer la partie', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Au tour de Chloé', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Au tour de Chloé', exact: true })).toBeVisible();
  await page.locator('details.rule-guide > summary').click();
  await expect(
    page.getByText('NDFC — règle officielle du lancer au bull', { exact: false }),
  ).toBeVisible();
  await expect(page.getByText('En cas d’égalité, de deux bulls', { exact: false })).toBeVisible();
});
for (const rule of ['alternate', 'loser'] as const)
  test(`uses the cork winner for the first leg then respects ${rule}`, async ({
    page,
    context,
  }) => {
    await page.goto('/');
    await waitForOfflineReady(page);
    await context.setOffline(true);
    await profiles(page, ['Alice', 'Bob']);
    const setup = await openSetup(page);
    await configureDarts(setup, '301 · sortie simple');
    for (const name of ['Alice', 'Bob'])
      await setup.getByRole('checkbox', { name: `Sélectionner ${name}`, exact: true }).check();
    await setup.getByRole('switch', { name: 'Match en plusieurs legs', exact: true }).check();
    await setup.getByLabel('Nombre de legs à gagner', { exact: true }).fill('2');
    await setup.getByLabel('Premier lanceur au leg suivant', { exact: true }).selectOption(rule);
    await setup.getByRole('switch', { name: 'Cork pour commencer', exact: true }).check();
    await expect(setup.getByLabel('Premier lanceur du premier leg', { exact: true })).toHaveCount(
      0,
    );
    await setup.getByRole('radio', { name: 'Bob', exact: true }).check();
    await setup.getByRole('button', { name: 'Créer la partie', exact: true }).click();
    await page.getByRole('button', { name: 'Démarrer la partie', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Au tour de Bob', exact: true })).toBeVisible();
    await page.getByLabel('Mode de saisie', { exact: true }).selectOption('visit');
    async function visit(total: number, next: string) {
      await page.getByLabel(/^Total des/).fill(String(total));
      await page
        .getByRole('button', { name: 'Enregistrer le total de la volée', exact: true })
        .click();
      await expect(
        page.getByRole('heading', { name: `Au tour de ${next}`, exact: true }),
      ).toBeVisible();
    }
    // Alice wins despite Bob's initial cork, distinguishing alternate from loser-start.
    await visit(0, 'Alice');
    await visit(180, 'Bob');
    await visit(0, 'Alice');
    await page.getByLabel(/^Total des/).fill('121');
    await page
      .getByRole('button', { name: 'Enregistrer le total de la volée', exact: true })
      .click();
    const next = rule === 'alternate' ? 'Alice' : 'Bob';
    await expect(page.getByText(`Prochain leg : ${next} commence`, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Démarrer le leg 2', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: `Au tour de ${next}`, exact: true }),
    ).toBeVisible();
  });
test('starts a Cricket team with its first member after a cork and translates the result', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await profiles(page, ['Alice', 'Bob', 'Chloé', 'David']);
  await page.goto('/teams/');
  for (const [name, members] of [
    ['Bleus', ['Alice', 'Bob']],
    ['Rouges', ['Chloé', 'David']],
  ] as const) {
    await page.getByRole('button', { name: 'Créer une équipe', exact: true }).click();
    await page.getByLabel('Nom de l’équipe', { exact: true }).fill(name);
    for (const member of members)
      await page.getByRole('checkbox', { name: `Sélectionner ${member}`, exact: true }).check();
    await page.getByRole('button', { name: 'Enregistrer l’équipe', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  }
  const setup = await openSetup(page, 'Cricket');
  await configureDarts(setup, 'Cricket · points classiques');
  await setup.getByRole('switch', { name: 'Jouer en équipe', exact: true }).check();
  for (const name of ['Bleus', 'Rouges'])
    await setup.getByRole('button', { name: `Choisir ${name}`, exact: true }).click();
  await setup.getByRole('switch', { name: 'Cork pour commencer', exact: true }).check();
  await setup.getByRole('radio', { name: 'Rouges', exact: true }).check();
  await setup.getByRole('button', { name: 'Créer la partie', exact: true }).click();
  await expect(page.getByText('Cork : Rouges', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Démarrer la partie', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Au tour de Rouges', exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Chloé' })).toBeVisible();
  // Change the preference in another tab while the running match remains open.
  const settings = await context.newPage();
  await settings.goto('/settings/');
  await settings.getByLabel('Langue de l’application', { exact: true }).selectOption('en');
  await expect(page.getByText('Cork: Rouges', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Rouges’s turn', exact: true })).toBeVisible();
});
