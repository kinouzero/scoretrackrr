import { seedPlayers } from '../fixtures/players';
import { waitForOfflineReady } from '../fixtures/offline';
import { expect, test, type Page } from '../fixtures/browser';
async function create(page: Page, names = ['Alice', 'Bob', 'Cara'], expanded = false) {
  await seedPlayers(page, names);
  await page.goto('/games/');
  await page.getByRole('link', { name: 'Jouer à Skull King', exact: true }).click();
  const setup = page.getByRole('dialog');
  if (expanded)
    for (const name of [
      'Cartes avancées du jeu de base',
      'Extension 2025',
      'Cartes Butin',
      'Calcul des points Rascal',
    ])
      await setup.getByRole('switch', { name, exact: true }).check();
  for (const name of names)
    await setup.getByRole('checkbox', { name: `Sélectionner ${name}`, exact: true }).check();
  await expect(setup.getByLabel('Organisateur sur cet appareil')).toHaveCount(0);
  await setup.getByRole('button', { name: 'Créer la partie', exact: true }).click();
  await page.getByRole('button', { name: 'Démarrer la partie', exact: true }).click();
  if (!expanded) await expect(page.locator('.rule-guide')).toContainText('Barème classique 2021');
}
function bid(page: Page, name: string) {
  return page.getByRole('combobox', { name: `Pari de ${name}`, exact: true });
}
async function confirmed(page: Page) {
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmer', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
}
async function tricks(page: Page, name: string, value: number, english = false) {
  const player = page.getByRole('article', { name, exact: true });
  const label = english ? 'Tricks won' : 'Plis remportés';
  const current = Number(
    await player.getByRole('status', { name: label, exact: true }).locator('strong').innerText(),
  );
  const action =
    value >= current
      ? english
        ? `Increase: ${label}`
        : `Augmenter : ${label}`
      : english
        ? `Decrease: ${label}`
        : `Diminuer : ${label}`;
  for (let n = 0; n < Math.abs(value - current); n++)
    await player.getByRole('button', { name: action, exact: true }).click();
}
test('plays classic Skull King offline through ten rounds, validates tricks and reopens a winning result', async ({
  page,
  context,
}) => {
  // Ten complete rounds include every player's bids and counter-button results.
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await create(page);
  async function action(name: string) {
    const heading = page.locator('.journal-entries > li').first().getByRole('heading');
    const before = await heading.innerText();
    await page.getByRole('button', { name, exact: true }).first().click();
    await expect(heading).not.toHaveText(before);
  }
  for (let round = 1; round <= 10; round++) {
    await expect(
      page.getByRole('heading', {
        name: `Manche ${round} · ${round} carte(s) par joueur`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page
        .getByRole('group', { name: 'Annonces et résultats de la manche', exact: true })
        .getByRole('combobox'),
    ).toHaveCount(3);
    if (round === 1) {
      await bid(page, 'Alice').selectOption('1');
      await bid(page, 'Bob').selectOption('0');
      await page.getByRole('button', { name: 'Enregistrer les paris', exact: true }).click();
      await expect(bid(page, 'Cara')).toBeFocused();
      await expect(
        page.getByRole('group', { name: 'Plis remportés', exact: true }).first(),
      ).toHaveCount(0);
      await expect(page.locator('.journal-entries > li')).toHaveCount(1);
    }
    for (const [i, name] of ['Alice', 'Bob', 'Cara'].entries()) {
      await bid(page, name).selectOption(String(i === 0 ? round : 0));
    }
    await action('Enregistrer les paris');
    await expect(
      page.getByRole('group', { name: 'Plis remportés', exact: true }).first(),
    ).toBeFocused();
    for (const [i, name] of ['Alice', 'Bob', 'Cara'].entries()) {
      await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
      await tricks(page, name, i === 0 ? round : 0);
      await action('Enregistrer le résultat');
    }
    if (round === 1) {
      await page.getByRole('button', { name: 'Mettre en pause', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Reprendre', exact: true })).toBeVisible();
      await page.reload();
      await page.getByRole('button', { name: 'Reprendre', exact: true }).click();
    }
    if (round < 10) await action('Manche suivante');
  }
  await expect(page.getByText('Victoire : Alice', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Annuler la dernière saisie' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmer', exact: true }).click();
  await expect(
    page.getByRole('group', { name: 'Plis remportés', exact: true }).first(),
  ).toBeVisible();
  await action('Enregistrer le résultat');
  await expect(page.getByText('Victoire : Alice', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Victoire : Alice', { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('skull-offline.png') });
  expect(errors).toEqual([]);
});

test('completes saved partial bets after undo and reload without reentering other players', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await create(page);
  for (const [name, value] of [
    ['Alice', '1'],
    ['Bob', '0'],
    ['Cara', '0'],
  ])
    await bid(page, name!).selectOption(value!);
  await page.getByRole('button', { name: 'Enregistrer les paris', exact: true }).click();
  await expect(
    page.getByRole('group', { name: 'Plis remportés', exact: true }).first(),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Annuler la dernière saisie', exact: true }).click();
  await confirmed(page);
  await expect(bid(page, 'Cara')).toBeVisible();
  await expect(page.locator('.bid-choice')).toHaveCount(1);
  await page.reload();
  await expect(bid(page, 'Cara')).toHaveValue('');
  await bid(page, 'Cara').selectOption('1');
  await page.getByRole('button', { name: 'Enregistrer les paris', exact: true }).click();
  await expect(
    page.getByRole('group', { name: 'Plis remportés', exact: true }).first(),
  ).toBeVisible();
  for (const [name, value] of [
    ['Alice', '1'],
    ['Bob', '0'],
    ['Cara', '1'],
  ])
    await expect(
      page
        .getByRole('article', { name: name!, exact: true })
        .locator('.round-summary strong')
        .first(),
    ).toHaveText(value!);
  await expect(page.locator('.journal-entries > li')).toHaveCount(6);
});
test('retains every selected bet when a later write fails and saves the whole set on retry', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await create(page);
  await bid(page, 'Alice').selectOption('1');
  await bid(page, 'Bob').selectOption('0');
  await bid(page, 'Cara').selectOption('0');
  await page.evaluate(() => {
    const add = IDBObjectStore.prototype.add;
    let writes = 0;
    IDBObjectStore.prototype.add = function (...args) {
      if (this.name === 'scoreEvents' && ++writes === 2)
        throw new DOMException('Full', 'QuotaExceededError');
      return add.apply(this, args);
    };
  });
  await page.getByRole('button', { name: 'Enregistrer les paris', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Le stockage de cet appareil est plein' }),
  ).toBeVisible();
  await expect(bid(page, 'Alice')).toHaveValue('1');
  await expect(bid(page, 'Bob')).toHaveValue('0');
  await expect(bid(page, 'Cara')).toHaveValue('0');
  await expect(page.locator('.journal-entries > li')).toHaveCount(1);
  await page.getByRole('button', { name: 'Enregistrer les paris', exact: true }).click();
  await expect(
    page.getByRole('group', { name: 'Plis remportés', exact: true }).first(),
  ).toBeVisible();
  await expect(page.locator('.journal-entries > li')).toHaveCount(4);
});
test('shows all eight bets, preserves them across language changes and clears them for the next round', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  const names = ['Alice', 'Bob', 'Cara', 'Dan', 'Emma', 'Franck', 'Gina', 'Hugo'];
  await create(page, names);
  await expect(page.locator('.bid-choice')).toHaveCount(8);
  for (const name of names) {
    await expect(bid(page, name)).toHaveValue('');
    await bid(page, name).selectOption('0');
  }
  const settings = await context.newPage();
  try {
    await settings.goto('/settings/');
    await settings.getByLabel('Langue de l’application', { exact: true }).selectOption('en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    for (const name of names)
      await expect(page.getByRole('combobox', { name: `${name}’s bid`, exact: true })).toHaveValue(
        '0',
      );
    await page.getByRole('button', { name: 'Save all bids', exact: true }).click();
    await expect(
      page.getByRole('group', { name: 'Tricks won', exact: true }).first(),
    ).toBeVisible();
    for (const [index, name] of names.entries()) {
      await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
      await tricks(page, name, index === 0 ? 1 : 0, true);
      await page
        .getByRole('form', { name, exact: true })
        .getByRole('button', { name: 'Record result', exact: true })
        .click();
      await expect(
        page.getByRole('article', { name, exact: true }).getByText('Saved', { exact: true }),
      ).toBeVisible();
      if (index < names.length - 1)
        await expect(
          page.getByRole('heading', { name: names[index + 1], exact: true }),
        ).toBeVisible();
    }
    await page.getByRole('button', { name: 'Next round', exact: true }).click();
    for (const name of names)
      await expect(page.getByRole('combobox', { name: `${name}’s bid`, exact: true })).toHaveValue(
        '',
      );
    await expect(page.locator('.bid-choice').first().getByRole('option')).toHaveCount(4);
    await page.reload();
    await expect(page.locator('.bid-choice')).toHaveCount(8);
  } finally {
    await settings.close();
  }
});

test('opens only one player bonus panel, preserves drafts and records captures independently', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await create(page);
  for (const name of ['Alice', 'Bob', 'Cara'])
    await bid(page, name).selectOption(name === 'Bob' ? '1' : '0');
  await page.getByRole('button', { name: 'Enregistrer les paris', exact: true }).click();
  const alice = page.getByRole('article', { name: 'Alice', exact: true });
  const bob = page.getByRole('article', { name: 'Bob', exact: true });
  const cara = page.getByRole('article', { name: 'Cara', exact: true });
  const toggle = (name: string) =>
    page.getByRole('button', { name: `Bonus et captures · ${name}`, exact: true });
  await expect(page.getByRole('button', { name: /Bonus et captures/ })).toHaveCount(3);
  await expect(page.locator('.bonus-panel')).toHaveCount(0);
  await bob
    .getByRole('group', { name: 'Plis remportés', exact: true })
    .getByRole('button', { name: 'Augmenter : Plis remportés', exact: true })
    .click();
  await expect(
    bob.getByRole('status', { name: 'Plis remportés', exact: true }).locator('strong'),
  ).toHaveText('1');
  await toggle('Bob').focus();
  await page.keyboard.press('Enter');
  await expect(toggle('Bob')).toHaveAttribute('aria-expanded', 'true');
  await bob
    .getByRole('button', { name: 'Augmenter : 14 de couleur capturés', exact: true })
    .click();
  await expect(
    bob.getByRole('status', { name: '14 de couleur capturés', exact: true }).locator('strong'),
  ).toHaveText('1');
  await expect(bob.locator('.score')).toHaveText('+30');
  await toggle('Alice').click();
  await expect(toggle('Bob')).toHaveAttribute('aria-expanded', 'false');
  await expect(
    alice.getByRole('region', { name: 'Bonus et captures · Alice', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.bonus-panel')).toHaveCount(1);
  await expect(
    alice.getByRole('button', { name: 'Augmenter : 14 de couleur capturés', exact: true }),
  ).toBeDisabled();
  await toggle('Bob').click();
  await expect(toggle('Alice')).toHaveAttribute('aria-expanded', 'false');
  await expect(
    bob.getByRole('status', { name: '14 de couleur capturés', exact: true }).locator('strong'),
  ).toHaveText('1');
  await bob.getByRole('button', { name: 'Fermer les bonus', exact: true }).click();
  await expect(page.locator('.bonus-panel')).toHaveCount(0);
  await expect(toggle('Bob')).toBeFocused();
  // Saving a different player must not reset another player's unsubmitted captures.
  await alice.getByRole('button', { name: 'Enregistrer le résultat', exact: true }).click();
  await expect(alice.getByText('Enregistré', { exact: true })).toBeVisible();
  await toggle('Bob').click();
  await expect(
    bob.getByRole('status', { name: '14 de couleur capturés', exact: true }).locator('strong'),
  ).toHaveText('1');
  await page.getByRole('button', { name: 'Mettre en pause', exact: true }).click();
  await expect(page.locator('.match-card .match-status')).toHaveText('En pause');
  await page.getByRole('button', { name: 'Reprendre', exact: true }).click();
  await expect(
    bob.getByRole('status', { name: '14 de couleur capturés', exact: true }).locator('strong'),
  ).toHaveText('1');
  await bob.getByRole('button', { name: 'Enregistrer le résultat', exact: true }).click();
  await expect(bob.getByText('Enregistré', { exact: true })).toBeVisible();
  await expect(page.locator('.bonus-panel')).toHaveCount(0);
  await cara.getByRole('button', { name: 'Enregistrer le résultat', exact: true }).click();
  await expect(cara.getByText('Enregistré', { exact: true })).toBeVisible();
  await page.reload();
  await toggle('Bob').click();
  await expect(
    page
      .getByRole('article', { name: 'Bob', exact: true })
      .getByRole('status', { name: '14 de couleur capturés', exact: true })
      .locator('strong'),
  ).toHaveText('1');
  await expect(
    page.getByRole('article', { name: 'Bob', exact: true }).locator('.score'),
  ).toHaveText('+30');
  await expect(
    page
      .getByRole('article', { name: 'Bob', exact: true })
      .getByRole('button', { name: 'Augmenter : 14 de couleur capturés', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Manche suivante', exact: true }).click();
  await expect(page.locator('.bonus-panel')).toHaveCount(0);
  await expect(bid(page, 'Bob')).toHaveValue('');
});
test('uses input-free counters and shares every capture category across pending and saved players', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await create(page);
  for (const name of ['Alice', 'Bob', 'Cara'])
    await bid(page, name).selectOption(name === 'Alice' ? '1' : '0');
  await page.getByRole('button', { name: 'Enregistrer les paris', exact: true }).click();
  await tricks(page, 'Alice', 1);
  for (const name of ['Alice', 'Bob', 'Cara'])
    await page
      .getByRole('article', { name, exact: true })
      .getByRole('button', { name: 'Enregistrer le résultat', exact: true })
      .click();
  await page.getByRole('button', { name: 'Manche suivante', exact: true }).click();
  for (const name of ['Alice', 'Bob', 'Cara'])
    await bid(page, name).selectOption(name === 'Cara' ? '0' : '1');
  await page.getByRole('button', { name: 'Enregistrer les paris', exact: true }).click();
  const player = (name: string) => page.getByRole('article', { name, exact: true });
  const toggle = async (name: string) => {
    const button = player(name).getByRole('button', {
      name: `Bonus et captures · ${name}`,
      exact: true,
    });
    if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
  };
  const plus = (name: string, label: string) =>
    player(name).getByRole('button', { name: `Augmenter : ${label}`, exact: true });
  const minus = (name: string, label: string) =>
    player(name).getByRole('button', { name: `Diminuer : ${label}`, exact: true });
  await tricks(page, 'Alice', 1);
  await tricks(page, 'Bob', 1);
  await expect(plus('Cara', 'Plis remportés')).toBeDisabled();
  await expect(page.getByRole('spinbutton')).toHaveCount(0);
  const before = await page.locator('.journal-entries > li').count();
  for (const [label, cap] of [
    ['14 de couleur capturés', 3],
    ['14 noir capturé', 1],
    ['Sirènes capturées par un pirate', 2],
    ['Pirates capturés par le Skull King', 6],
    ['Skull King capturé par une sirène', 1],
  ] as const) {
    await toggle('Alice');
    await plus('Alice', label).focus();
    await page.keyboard.press('Space');
    for (let n = 1; n < cap; n++) await plus('Alice', label).click();
    await expect(plus('Alice', label)).toBeDisabled();
    await toggle('Bob');
    await expect(plus('Bob', label)).toBeDisabled();
    await toggle('Alice');
    await minus('Alice', label).click();
    await toggle('Bob');
    await plus('Bob', label).click();
    await expect(plus('Bob', label)).toBeDisabled();
    await minus('Bob', label).click();
    await toggle('Alice');
    for (let n = 0; n < cap - 1; n++) await minus('Alice', label).click();
    await expect(minus('Alice', label)).toBeDisabled();
  }
  await plus('Alice', 'Skull King capturé par une sirène').click();
  await expect(plus('Alice', 'Pirates capturés par le Skull King')).toBeDisabled();
  await toggle('Bob');
  await expect(plus('Bob', 'Pirates capturés par le Skull King')).toBeDisabled();
  await toggle('Alice');
  await plus('Alice', '14 de couleur capturés').click();
  await expect(page.locator('.journal-entries > li')).toHaveCount(before);
  await page.reload();
  await toggle('Alice');
  await expect(
    player('Alice')
      .getByRole('status', { name: '14 de couleur capturés', exact: true })
      .locator('strong'),
  ).toHaveText('1');
  await minus('Alice', 'Plis remportés').click();
  await expect(
    player('Alice')
      .getByRole('status', { name: '14 de couleur capturés', exact: true })
      .locator('strong'),
  ).toHaveText('0');
  await expect(plus('Alice', '14 de couleur capturés')).toBeDisabled();
  await expect(
    player('Alice').getByText('Gagnez au moins un pli pour ajouter des captures.', { exact: true }),
  ).toBeVisible();
  await tricks(page, 'Alice', 1);
  await plus('Alice', '14 noir capturé').click();
  await player('Alice')
    .getByRole('button', { name: 'Enregistrer le résultat', exact: true })
    .click();
  await expect(player('Alice').getByText('Enregistré', { exact: true })).toBeVisible();
  await toggle('Bob');
  await expect(plus('Bob', '14 noir capturé')).toBeDisabled();
});

test('adapts counters and Rascal previews to the enabled expansion cards', async ({ page }) => {
  await create(page, ['Alice', 'Bob', 'Cara'], true);
  for (const name of ['Alice', 'Bob', 'Cara']) await bid(page, name).selectOption('0');
  await page.getByRole('button', { name: 'Enregistrer les paris', exact: true }).click();
  const alice = page.getByRole('article', { name: 'Alice', exact: true });
  const toggle = alice.getByRole('button', { name: 'Bonus et captures · Alice', exact: true });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  const monsters = alice.getByRole('button', {
    name: 'Augmenter : Créatures capturées par Davy (+20)',
    exact: true,
  });
  for (let n = 0; n < 3; n++) await monsters.click();
  await expect(monsters).toBeDisabled();
  await expect(
    alice.getByRole('button', { name: 'Augmenter : 8 capturés (+5)', exact: true }),
  ).toBeDisabled();
  await expect(alice.getByText('Score de la manche : 70', { exact: true })).toBeVisible();
  await expect(page.getByRole('spinbutton')).toHaveCount(0);
  await alice.getByRole('button', { name: 'Enregistrer le résultat', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText('Alice70');
  await page.reload();
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText('Alice70');
});
