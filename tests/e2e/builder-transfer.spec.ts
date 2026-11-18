import { waitForOfflineReady } from '../fixtures/offline';
import { savedCustomGame } from '../fixtures/custom-games';
import { expect, test } from '../fixtures/browser';
import { readBuilder } from '../../src/lib/domain/games/builder';
import type { DeclarativeRules } from '../../src/lib/domain/engine/types';
import type { GameVersionRecord } from '../../src/lib/domain/records';

test('plays saved weighted rules offline without game import or custom authoring controls', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await waitForOfflineReady(page);
  await expect(page.getByRole('link', { name: /Vos propres règles/ })).toHaveCount(0);
  await context.setOffline(true);
  await page.goto('/games/');
  await expect(
    page.getByRole('button', { name: 'Créer un jeu compteur', exact: true }),
  ).toHaveCount(0);
  await savedCustomGame(page, 'Pondéré', {
    fields: [
      { id: 'points', minimum: -1000, maximum: 1000, weight: 2 },
      { id: 'penalty', minimum: -1000, maximum: 1000, weight: -3 },
    ],
    bonus: { field: 'points', threshold: 10, points: 5 },
    turns: { rounds: 2, categories: ['Ouverture', 'Finale'] },
  });
  await expect(page.getByRole('button', { name: 'Modifier les règles', exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole('button', { name: 'Dupliquer ce jeu', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Exporter.*version/ })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Importer un jeu', exact: true })).toHaveCount(0);
  await expect(page.getByText('Importer un jeu JSON', { exact: true })).toHaveCount(0);
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('article', { name: 'Pondéré', exact: true })).toBeVisible();
  const target = page;
  // Inspect synthetic existing rules without reviving removed import or authoring controls.
  const imported = await target.evaluate(
    () =>
      new Promise<GameVersionRecord>((resolve, reject) => {
        const open = indexedDB.open('scoretrackrr');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const read = db
            .transaction('gameVersions', 'readonly')
            .objectStore('gameVersions')
            .getAll();
          read.onerror = () => {
            db.close();
            reject(read.error);
          };
          read.onsuccess = () => {
            db.close();
            const version = read.result.find((row: GameVersionRecord) =>
              row.gameId.startsWith('custom-'),
            );
            if (version) resolve(version);
            else reject(new Error('Missing fixture'));
          };
        };
      }),
  );
  expect(readBuilder(imported.definition as unknown as DeclarativeRules)).toMatchObject({
    fields: [
      { id: 'points', weight: 2 },
      { id: 'penalty', weight: -3 },
    ],
    bonus: { field: 'points', threshold: 10, points: 5 },
    turns: { rounds: 2, categories: ['Ouverture', 'Finale'] },
  });
  await target.goto('/players/');
  for (const name of ['Alice', 'Bob']) {
    await target.getByRole('button', { name: 'Ajouter un joueur', exact: true }).click();
    await target.getByLabel('Pseudonyme', { exact: true }).fill(name);
    await target.getByRole('button', { name: 'Enregistrer le profil', exact: true }).click();
    await expect(target.getByRole('dialog')).not.toBeVisible();
  }
  await target.goto('/games/');
  await target
    .getByRole('article', { name: 'Pondéré', exact: true })
    .getByRole('link', { name: 'Jouer à ce jeu', exact: true })
    .click();
  for (const name of ['Alice', 'Bob'])
    await target
      .getByRole('dialog')
      .getByRole('checkbox', { name: `Sélectionner ${name}`, exact: true })
      .check();
  await target
    .getByRole('dialog')
    .getByRole('button', { name: 'Créer la partie', exact: true })
    .click();
  await target.getByRole('button', { name: 'Démarrer la partie', exact: true }).click();
  await target.getByLabel('Qui marque ?', { exact: true }).selectOption({ label: 'Alice' });
  await target.getByLabel('Points', { exact: true }).fill('10');
  await target.getByLabel('penalty', { exact: true }).fill('2');
  await target.getByRole('button', { name: 'Enregistrer le score', exact: true }).click();
  await expect(target.getByRole('region', { name: 'Scores', exact: true })).toContainText(
    'Alice19',
  );
});
