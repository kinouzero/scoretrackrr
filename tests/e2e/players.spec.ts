import { waitForOfflineReady } from '../fixtures/offline';
import { readFile } from 'node:fs/promises';
import { expect, test } from '../fixtures/browser';

test('creates, edits and permanently removes local profiles and guests offline', async ({
  page,
  context,
}) => {
  const externalRequests: string[] = [];
  page.on('request', (request) => {
    if (
      new URL(request.url()).protocol.startsWith('http') &&
      new URL(request.url()).origin !== 'http://127.0.0.1:4178'
    )
      externalRequests.push(request.url());
  });
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await page.goto('/players/');
  const add = page.getByRole('button', { name: 'Ajouter un joueur' });
  await expect(add).toBeEnabled();
  await add.click();
  const editor = page.getByRole('dialog', { name: 'Un nouveau compagnon' });
  await expect(editor.getByLabel('Pseudonyme')).toBeFocused();
  await editor.getByLabel('Pseudonyme').fill(' Alice ');
  await editor.getByRole('radio', { name: 'Soleil', exact: true }).check();
  await editor.getByLabel('Couleur', { exact: true }).fill('#1e5f91');
  await editor.getByRole('button', { name: 'Enregistrer le profil' }).click();
  await expect(editor).not.toBeVisible();
  await expect(add).toBeFocused();
  await expect(page.getByRole('article', { name: 'Alice', exact: true })).toBeVisible();
  await add.click();
  await page.getByLabel('Pseudonyme').fill('Lucas');
  await page.getByLabel('Invité sans compte', { exact: true }).check();
  await expect(page.getByLabel('Adresse e-mail (facultative)')).toHaveCount(0);
  await expect(page.getByRole('radio', { name: 'Gravatar', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Enregistrer le profil' }).click();
  await expect(
    page.getByRole('article', { name: 'Lucas', exact: true }).getByText('Invité', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Modifier Alice', exact: true }).click();
  await page.getByLabel('Pseudonyme').fill('Alice Martin');
  await page.getByRole('button', { name: 'Enregistrer le profil' }).click();
  await expect(page.getByRole('article', { name: 'Alice Martin', exact: true })).toBeVisible();
  await page.getByLabel('Rechercher un joueur').fill('ali');
  await expect(page.getByRole('article')).toHaveCount(1);
  await page.getByLabel('Rechercher un joueur').fill('');
  await page.screenshot({ path: test.info().outputPath('players-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: test.info().outputPath('players-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Modifier Alice Martin', exact: true }).click();
  await page.getByLabel('Pseudonyme').fill('Abandoned edit');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Modifier Alice Martin', exact: true }),
  ).toBeFocused();
  await page.reload();
  await expect(page.getByRole('article', { name: 'Alice Martin', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Supprimer Alice Martin', exact: true }).click();
  const deletion = page.getByRole('dialog', { name: 'Supprimer Alice Martin ?' });
  await deletion.getByRole('button', { name: 'Annuler', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Alice Martin', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Supprimer Alice Martin', exact: true }).click();
  await deletion.getByRole('button', { name: 'Supprimer ce joueur', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Alice Martin', exact: true })).toHaveCount(0);
  await expect(add).toBeFocused();
  await page.reload();
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByLabel('Voir les profils archivés')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Restaurer|Archiver/ })).toHaveCount(0);
  expect(externalRequests).toEqual([]);
});

test('caches Gravatar by email and never refetches it while rendering or playing offline', async ({
  page,
  context,
  browserName,
}) => {
  const image = await readFile('static/icons/icon-192.png');
  const requests: string[] = [];
  let unavailable = false;
  if (browserName === 'webkit') {
    // WebKit's service-worker pass-through bypasses Playwright network routing.
    // Mock only the external fetch; keep the real worker, streaming decoder and offline cache.
    await context.exposeBinding(
      'scoretrackrrMockGravatar',
      async (_source, url: string, options: Record<string, string>) => {
        requests.push(url);
        expect(options).toMatchObject({
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          redirect: 'error',
        });
        if (unavailable) throw new Error('Offline');
        return image.toString('base64');
      },
    );
    await context.addInitScript(() => {
      const nativeFetch = window.fetch.bind(window);
      const binding = window as unknown as Window & {
        scoretrackrrMockGravatar: (
          url: string,
          options: Record<string, string | undefined>,
        ) => Promise<string>;
      };
      window.fetch = async (input, options) => {
        const url = input instanceof Request ? input.url : String(input);
        if (!url.startsWith('https://www.gravatar.com/avatar/')) return nativeFetch(input, options);
        const base64 = await binding.scoretrackrrMockGravatar(url, {
          credentials: options?.credentials,
          referrerPolicy: options?.referrerPolicy,
          redirect: options?.redirect,
        });
        return new Response(
          Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)),
          { headers: { 'content-type': 'image/png' } },
        );
      };
    });
  } else {
    await context.route('https://www.gravatar.com/avatar/**', async (route) => {
      requests.push(route.request().url());
      expect(route.request().headers()).not.toHaveProperty('referer');
      if (unavailable) {
        await route.abort('internetdisconnected');
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        headers: { 'access-control-allow-origin': '*' },
        body: image,
      });
    });
  }
  await page.goto('/players/');
  await waitForOfflineReady(page);
  await page.getByRole('button', { name: 'Ajouter un joueur' }).click();
  await page.getByLabel('Pseudonyme').fill('Emma');
  await page.getByLabel('Adresse e-mail (facultative)').fill('MyEmailAddress@example.com');
  await page.getByRole('radio', { name: 'Gravatar', exact: true }).check();
  await page.getByRole('button', { name: 'Enregistrer le profil' }).click();
  const card = page.getByRole('article', { name: 'Emma', exact: true });
  await expect(card.locator('img')).toHaveAttribute('src', /^data:image\/png;base64,/);
  expect(requests).toEqual([
    'https://www.gravatar.com/avatar/84059b07d4be67b806386c0aad8070a23f18836bbaae342275dc0a83414c32ee?s=128&d=404&r=g',
  ]);
  await context.setOffline(true);
  await page.reload();
  await expect(card.locator('img')).toHaveAttribute('src', /^data:image\/png;base64,/);
  expect(
    await card.locator('img').evaluate((image) => (image as HTMLImageElement).naturalWidth),
  ).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Modifier Emma', exact: true }).click();
  await page.getByLabel('Pseudonyme').fill('Emma Martin');
  await page.getByRole('button', { name: 'Enregistrer le profil' }).click();
  await expect(
    page.getByRole('article', { name: 'Emma Martin', exact: true }).locator('img'),
  ).toBeVisible();
  expect(requests).toHaveLength(1);
  unavailable = true;
  await page.getByRole('button', { name: 'Modifier Emma Martin', exact: true }).click();
  await page.getByLabel('Actualiser la photo à l’enregistrement', { exact: true }).check();
  await page.getByRole('button', { name: 'Enregistrer le profil' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Photo Gravatar indisponible' }),
  ).toBeVisible();
  await expect(
    page.getByRole('article', { name: 'Emma Martin', exact: true }).locator('img'),
  ).toHaveAttribute('src', /^data:image\/png;base64,/);
  expect(requests).toHaveLength(2);
});

test('saves a profile when Gravatar is missing and retains form input after quota failure', async ({
  page,
  context,
}) => {
  await context.route('https://www.gravatar.com/avatar/**', (route) =>
    route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' } }),
  );
  await page.goto('/players/');
  await page.getByRole('button', { name: 'Ajouter un joueur' }).click();
  await page.getByLabel('Pseudonyme').fill('Hugo');
  await page.getByLabel('Adresse e-mail (facultative)').fill('hugo@example.com');
  await page.getByRole('radio', { name: 'Gravatar', exact: true }).check();
  await page.getByRole('button', { name: 'Enregistrer le profil' }).click();
  await expect(page.getByRole('article', { name: 'Hugo', exact: true })).toBeVisible();
  await expect(
    page.getByRole('status').filter({ hasText: 'Photo Gravatar indisponible' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Modifier Hugo', exact: true }).click();
  await page.getByRole('radio', { name: 'Initiales', exact: true }).check();
  await page.getByLabel('Pseudonyme').fill('Hugo modifié');
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'players') throw new DOMException('Full', 'QuotaExceededError');
      return put.apply(this, args);
    };
  });
  await page.getByRole('button', { name: 'Enregistrer le profil' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
    'Le stockage de cet appareil est plein',
  );
  await expect(page.getByLabel('Pseudonyme')).toHaveValue('Hugo modifié');
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.getByRole('article', { name: 'Hugo', exact: true })).toBeVisible();
});

test('rejects an edit based on stale data from another tab', async ({ page, context }) => {
  await page.goto('/players/');
  await page.getByRole('button', { name: 'Ajouter un joueur' }).click();
  await page.getByLabel('Pseudonyme').fill('Alice');
  await page.getByRole('button', { name: 'Enregistrer le profil' }).click();
  await page.getByRole('button', { name: 'Modifier Alice', exact: true }).click();
  await page.getByLabel('Pseudonyme').fill('Stale draft');
  const other = await context.newPage();
  await other.goto('/players/');
  await other.getByRole('button', { name: 'Modifier Alice', exact: true }).click();
  await other.getByLabel('Pseudonyme').fill('Latest edit');
  await other.getByRole('button', { name: 'Enregistrer le profil' }).click();
  await expect(other.getByRole('article', { name: 'Latest edit', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Enregistrer le profil' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Ce profil a changé');
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.getByRole('article', { name: 'Latest edit', exact: true })).toBeVisible();
});

test('deletes a team member, preserves existing play and repairs the reusable roster offline', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await page.goto('/players/');
  for (const name of ['Alice', 'Bob', 'Chloé']) {
    await page.getByRole('button', { name: 'Ajouter un joueur' }).click();
    await page.getByLabel('Pseudonyme').fill(name);
    await page.getByRole('button', { name: 'Enregistrer le profil' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  }
  await page.goto('/teams/');
  await page.getByRole('button', { name: 'Créer une équipe', exact: true }).click();
  await page.getByLabel('Nom de l’équipe', { exact: true }).fill('Duo');
  for (const name of ['Alice', 'Bob'])
    await page.getByRole('checkbox', { name: `Sélectionner ${name}`, exact: true }).check();
  await page.getByRole('button', { name: 'Enregistrer l’équipe', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.goto('/games/');
  await page.getByRole('link', { name: 'Jouer à la pétanque', exact: true }).click();
  const setup = page.getByRole('dialog', { name: 'Préparer la partie' });
  for (const name of ['Alice', 'Bob'])
    await setup.getByRole('checkbox', { name: `Sélectionner ${name}`, exact: true }).check();
  await expect(setup.getByLabel('Organisateur sur cet appareil')).toHaveCount(0);
  await setup.getByLabel('Premier lancer du cochonnet').selectOption({ label: 'Alice' });
  await setup.getByRole('button', { name: 'Créer la partie', exact: true }).click();
  await expect(setup).not.toBeVisible();
  const matchUrl = page.url();
  await page.getByRole('button', { name: 'Démarrer la partie', exact: true }).click();
  await expect(page.getByRole('form', { name: 'Enregistrer la mène' })).toBeVisible();
  await page.goto('/players/');
  await page.getByRole('button', { name: 'Supprimer Alice', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Supprimer Alice ?' })
    .getByRole('button', { name: 'Supprimer ce joueur', exact: true })
    .click();
  await expect(page.getByRole('article', { name: 'Alice', exact: true })).toHaveCount(0);
  await page.goto('/teams/');
  const team = page.getByRole('article', { name: 'Duo', exact: true });
  await expect(team).toContainText('Supprimé');
  await expect(team).toContainText('Complétez la composition');
  await page.getByRole('button', { name: 'Modifier l’équipe Duo', exact: true }).click();
  await page.getByRole('button', { name: 'Retirer Alice', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Sélectionner Chloé', exact: true }).check();
  await page.getByRole('button', { name: 'Enregistrer l’équipe', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(team).toContainText('Chloé');
  await expect(team).not.toContainText('Supprimé');
  await page.goto(matchUrl);
  const form = page.getByRole('form', { name: 'Enregistrer la mène' });
  await form.getByRole('radio', { name: 'Points pour Alice', exact: true }).check();
  await form.getByRole('button', { name: '1 point', exact: true }).click();
  await form.getByRole('button', { name: 'Enregistrer la mène', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText('Alice1');
});

test('selects players across search to create reusable teams and delete a confirmed batch offline', async ({
  page,
  context,
}) => {
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
  await page.getByRole('button', { name: 'Sélectionner des joueurs', exact: true }).click();
  const selection = page.getByRole('region', { name: 'Sélectionner des joueurs', exact: true });
  await expect(
    selection.getByRole('button', { name: 'Supprimer la sélection', exact: true }),
  ).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Sélectionner Alice', exact: true }).check();
  await page.getByLabel('Rechercher un joueur', { exact: true }).fill('Bob');
  await page.getByRole('checkbox', { name: 'Sélectionner Bob', exact: true }).check();
  await expect(selection).toContainText('2 joueurs sélectionnés');
  await selection
    .getByRole('button', { name: 'Créer une équipe avec la sélection', exact: true })
    .click();
  const editor = page.getByRole('dialog');
  await expect(editor.getByRole('button', { name: 'Retirer Alice', exact: true })).toBeVisible();
  await expect(editor.getByRole('button', { name: 'Retirer Bob', exact: true })).toBeVisible();
  await editor.getByLabel('Nom de l’équipe', { exact: true }).fill('Les amis');
  await editor.getByRole('button', { name: 'Enregistrer l’équipe', exact: true }).click();
  await expect(editor).not.toBeVisible();
  await expect(
    selection.getByRole('button', { name: 'Créer une équipe avec la sélection', exact: true }),
  ).toBeFocused();
  await page.getByLabel('Rechercher un joueur', { exact: true }).fill('');
  await expect(page.getByRole('article')).toHaveCount(4);
  await page.getByRole('checkbox', { name: 'Sélectionner cette page', exact: true }).check();
  await expect(selection).toContainText('4 joueurs sélectionnés');
  await selection
    .getByRole('button', { name: 'Répartir en plusieurs équipes', exact: true })
    .click();
  await editor.getByRole('button', { name: 'Répartir les joueurs', exact: true }).click();
  await expect(editor.getByRole('region', { name: 'Composition proposée' })).toBeVisible();
  await editor.getByLabel('Nom de l’équipe 1', { exact: true }).fill('Bleus');
  await editor.getByLabel('Nom de l’équipe 2', { exact: true }).fill('Rouges');
  await editor.getByRole('button', { name: 'Enregistrer les équipes', exact: true }).click();
  await expect(editor).not.toBeVisible();
  await selection.getByRole('button', { name: 'Tout désélectionner', exact: true }).click();
  for (const name of ['Alice', 'Bob'])
    await page.getByRole('checkbox', { name: `Sélectionner ${name}`, exact: true }).check();
  await selection.getByRole('button', { name: 'Supprimer la sélection', exact: true }).click();
  const deletion = page.getByRole('dialog', { name: 'Supprimer 2 joueurs ?', exact: true });
  await expect(deletion).toContainText('Alice');
  await expect(deletion).toContainText('Bob');
  await deletion.getByRole('button', { name: 'Annuler', exact: true }).click();
  await expect(selection).toContainText('2 joueurs sélectionnés');
  await expect(page.getByRole('article')).toHaveCount(4);
  await page.screenshot({
    path: test.info().outputPath('player-multiselection.png'),
    fullPage: true,
  });
  await selection.getByRole('button', { name: 'Supprimer la sélection', exact: true }).click();
  await deletion.getByRole('button', { name: 'Supprimer ces joueurs', exact: true }).click();
  await expect(deletion).not.toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(2);
  await expect(selection).toContainText('0 joueur sélectionné');
  await page.reload();
  await expect(page.getByRole('article')).toHaveCount(2);
  await page.goto('/teams/');
  await expect(page.getByRole('article')).toHaveCount(3);
  const friends = page.getByRole('article', { name: 'Les amis', exact: true });
  await expect(friends).toContainText('Alice');
  await expect(friends).toContainText('Bob');
  await expect(friends).toContainText('supprimé');
});

test('keeps selections across pages and preserves the entire batch on a concurrent edit', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await page.goto('/players/');
  await expect(page.getByRole('button', { name: 'Ajouter un joueur' })).toBeEnabled();
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('scoretrackrr');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('players', 'readwrite');
          for (let i = 0; i < 26; i++)
            tx.objectStore('players').add({
              id: `batch-${i}`,
              displayName: `Player ${String(i).padStart(2, '0')}`,
              color: '#153e35',
              avatar: 'initials',
              isGuest: false,
              revision: 1,
              createdAt: '2026-11-16T12:00:00.000Z',
              updatedAt: '2026-11-16T12:00:00.000Z',
            });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };
      }),
  );
  await page.reload();
  await expect(page.getByRole('article')).toHaveCount(24);
  await page.getByRole('button', { name: 'Sélectionner des joueurs', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Sélectionner cette page', exact: true }).check();
  await page.getByRole('button', { name: 'Suivant', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(2);
  await page.getByRole('checkbox', { name: 'Sélectionner cette page', exact: true }).check();
  const selection = page.getByRole('region', { name: 'Sélectionner des joueurs', exact: true });
  await expect(selection).toContainText('26 joueurs sélectionnés');
  await page.getByRole('button', { name: 'Précédent', exact: true }).click();
  await expect(
    page.getByRole('checkbox', { name: 'Sélectionner cette page', exact: true }),
  ).toBeChecked();
  await selection.getByRole('button', { name: 'Tout désélectionner', exact: true }).click();
  for (const name of ['Player 00', 'Player 01'])
    await page.getByRole('checkbox', { name: `Sélectionner ${name}`, exact: true }).check();
  await selection.getByRole('button', { name: 'Supprimer la sélection', exact: true }).click();
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('scoretrackrr');
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('players', 'readwrite');
          const table = tx.objectStore('players');
          const read = table.get('batch-1');
          read.onsuccess = () => table.put({ ...read.result, revision: 2 });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };
        open.onerror = () => reject(open.error);
      }),
  );
  const deletion = page.getByRole('dialog', { name: 'Supprimer 2 joueurs ?', exact: true });
  await deletion.getByRole('button', { name: 'Supprimer ces joueurs', exact: true }).click();
  await expect(deletion.getByRole('alert')).not.toBeEmpty();
  await deletion.getByRole('button', { name: 'Annuler', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(24);
  await expect(selection).toContainText('2 joueurs sélectionnés');
  await page.getByRole('button', { name: 'Terminer la sélection', exact: true }).click();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
});
