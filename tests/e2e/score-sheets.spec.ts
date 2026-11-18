import { expect, test } from '../fixtures/browser';
import { seedPlayers } from '../fixtures/players';
import { waitForOfflineReady } from '../fixtures/offline';

test('plays a threshold round of Skyjo offline, restores the result and undoes the round', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await seedPlayers(page, ['Alice', 'Bob']);
  await page.goto('/games/');
  await page.getByRole('link', { name: 'Jouer à Skyjo', exact: true }).click();
  const setup = page.getByRole('dialog');
  for (const name of ['Alice', 'Bob'])
    await setup.getByRole('checkbox', { name: `Sélectionner ${name}`, exact: true }).check();
  await setup.getByRole('button', { name: 'Créer la partie' }).click();
  await page.getByRole('button', { name: 'Démarrer la partie' }).click();
  await page.getByLabel('Joueur qui a fermé la manche').selectOption({ label: 'Alice' });
  await page.getByRole('group', { name: 'Alice', exact: true }).getByLabel('Points').fill('52');
  await page.getByRole('group', { name: 'Bob', exact: true }).getByLabel('Points').fill('32');
  await expect(page.getByRole('complementary', { name: 'Avant validation' })).toContainText('104');
  await page.getByRole('button', { name: 'Enregistrer les scores' }).click();
  await expect(page.getByRole('button', { name: 'Revanche' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText('Alice104');
  await page.getByRole('button', { name: 'Annuler la dernière saisie' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmer' }).click();
  await expect(page.getByLabel('Joueur qui a fermé la manche')).toBeVisible();
});

test('scores a solo Très Futé sheet including fox bonuses', async ({ page }) => {
  await page.goto('/');
  await seedPlayers(page, ['Alice']);
  await page.goto('/games/');
  await page.getByRole('link', { name: 'Jouer à Très Futé !', exact: true }).click();
  const setup = page.getByRole('dialog');
  await setup.getByRole('checkbox', { name: 'Sélectionner Alice', exact: true }).check();
  await setup.getByRole('button', { name: 'Créer la partie' }).click();
  await page.getByRole('button', { name: 'Démarrer la partie' }).click();
  for (const [label, points] of Object.entries({
    Jaune: 10,
    Bleu: 2,
    Vert: 3,
    Orange: 4,
    Violet: 6,
    Renards: 3,
  }))
    await page.getByLabel(label, { exact: true }).fill(String(points));
  await page.getByRole('button', { name: 'Enregistrer et terminer' }).click();
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText('Alice31');
  await expect(page.getByRole('button', { name: 'Enregistrer et terminer' })).toHaveCount(0);
});

test('records the remaining new score-sheet formats with their normal creation flow', async ({
  page,
}) => {
  await page.goto('/');
  await seedPlayers(page, ['Alice', 'Bob', 'Cara', 'Dan']);
  await page.goto('/teams/');
  for (const [name, players] of [
    ['Bleus', ['Alice', 'Bob']],
    ['Rouges', ['Cara', 'Dan']],
  ] as const) {
    await page.getByRole('button', { name: 'Créer une équipe', exact: true }).click();
    const editor = page.getByRole('dialog');
    await editor.getByLabel('Nom de l’équipe', { exact: true }).fill(name);
    for (const player of players)
      await editor.getByRole('checkbox', { name: `Sélectionner ${player}`, exact: true }).check();
    await editor.getByRole('button', { name: 'Enregistrer l’équipe', exact: true }).click();
    await expect(editor).not.toBeVisible();
  }

  async function open(name: string, players: string[]) {
    await page.goto('/games/');
    await page.getByRole('link', { name: `Jouer à ${name}`, exact: true }).click();
    const setup = page.getByRole('dialog');
    if (name === 'Belote / Coinche') {
      for (const team of ['Bleus', 'Rouges'])
        await setup.getByRole('button', { name: `Choisir ${team}`, exact: true }).click();
    } else {
      for (const player of players)
        await setup.getByRole('checkbox', { name: `Sélectionner ${player}`, exact: true }).check();
    }
    await setup.getByRole('button', { name: 'Créer la partie' }).click();
    await page.getByRole('button', { name: 'Démarrer la partie' }).click();
  }

  async function save(score: string, final = false) {
    await page
      .getByRole('button', {
        name: final ? 'Enregistrer et terminer' : 'Enregistrer les scores',
        exact: true,
      })
      .click();
    await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText(score);
    if (!final) {
      await page.getByRole('button', { name: 'Mettre en pause', exact: true }).click();
      await expect(page).toHaveURL(/\/matches\/?$/);
    }
  }

  await open('Belote / Coinche', []);
  await page.getByRole('group', { name: 'Bleus', exact: true }).getByLabel('Points').fill('100');
  await page.getByRole('group', { name: 'Rouges', exact: true }).getByLabel('Points').fill('62');
  await save('Bleus100');

  await open('Tarot', ['Alice', 'Bob', 'Cara']);
  await page.getByLabel('Preneur', { exact: true }).selectOption({ label: 'Alice' });
  await page.getByLabel('Bouts', { exact: true }).selectOption('2');
  await page.getByLabel('Contrat', { exact: true }).selectOption('2');
  await page.getByLabel('Points des cartes de l’attaque').fill('43');
  await save('Alice108');

  await open('UNO / UNO Flip', ['Alice', 'Bob', 'Cara']);
  await page.getByLabel('Gagnant de la manche').selectOption({ label: 'Alice' });
  await page.getByRole('checkbox', { name: 'UNO Flip', exact: true }).check();
  await page.getByLabel('Somme des cartes numérotées').fill('15');
  await page.getByLabel('Nombre de cartes à 20 points').fill('1');
  await page.getByLabel('Nombre de cartes + couleur (60 points)').fill('1');
  await save('Alice95');

  for (const name of ['Rami', 'Dominos']) {
    await open(name, ['Alice', 'Bob']);
    await page.getByLabel('Gagnant de la manche').selectOption({ label: 'Alice' });
    await page.getByLabel('Points restants').fill('9');
    await save('Alice9');
  }

  await open('Scrabble', ['Alice', 'Bob']);
  await page.getByLabel('Joueur', { exact: true }).selectOption({ label: 'Alice' });
  await page.getByLabel('Points', { exact: true }).fill('24');
  await page.getByRole('button', { name: 'Enregistrer les scores', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tour 2', exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Terminer la partie avec cette saisie' }).check();
  await page.getByLabel('Gagnant de la manche').selectOption({ label: 'Alice' });
  await page.getByLabel('Points restants').fill('3');
  await save('Alice27', true);

  for (const [name, players] of [
    ['7 Wonders', ['Alice', 'Bob', 'Cara']],
    ['Qwixx', ['Alice', 'Bob']],
  ] as const) {
    await open(name, [...players]);
    for (const player of players) {
      const fields = page.getByRole('group', { name: player, exact: true }).getByRole('spinbutton');
      await expect(fields).toHaveCount(name === '7 Wonders' ? 9 : 5);
      for (const field of await fields.all()) await field.fill('1');
    }
    await save(name === '7 Wonders' ? 'Alice15' : 'Alice-1', true);
  }
});
