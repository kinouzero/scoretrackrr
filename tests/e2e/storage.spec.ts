import { waitForOfflineReady } from '../fixtures/offline';
import { expect, test, type Page } from '../fixtures/browser';

async function savedSettings(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{
        version: number;
        stores: string[];
        settings: { key: string; value: unknown }[];
      }>((resolve, reject) => {
        const open = indexedDB.open('scoretrackrr');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const read = db.transaction('deviceSettings').objectStore('deviceSettings').getAll();
          read.onerror = () => {
            db.close();
            reject(read.error);
          };
          read.onsuccess = () => {
            const value = {
              version: db.version,
              stores: [...db.objectStoreNames],
              settings: read.result,
            };
            db.close();
            resolve(value);
          };
        };
      }),
  );
}

test('upgrades existing v1 data and reopens it in a new page without a network', async ({
  page,
  context,
}) => {
  // Seed before the app's theme observer opens/upgrades IndexedDB.
  await page.route('**/__legacy_seed__', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Legacy storage fixture</title>',
    }),
  );
  await page.goto('/__legacy_seed__');
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        // Dexie logical v1 uses IndexedDB version 10.
        const request = indexedDB.open('scoretrackrr', 10);
        request.onupgradeneeded = () => {
          request.result.createObjectStore('deviceSettings', { keyPath: 'key' });
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction('deviceSettings', 'readwrite');
          transaction
            .objectStore('deviceSettings')
            .put({ key: 'deviceName', value: 'Appareil existant' });
          transaction
            .objectStore('deviceSettings')
            .put({ key: 'unrecognizedSetting', value: { keep: true } });
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
          transaction.onabort = () => {
            db.close();
            reject(transaction.error);
          };
        };
      }),
  );
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await page.goto('/settings/');
  await expect(page.getByLabel('Nom de l’appareil')).toHaveCount(0);
  const data = await savedSettings(page);
  expect(data.version).toBe(70);
  expect(data.stores).toContain('matches');
  expect(data.stores).toContain('scoreEvents');
  expect(data.settings).toContainEqual({ key: 'unrecognizedSetting', value: { keep: true } });
  expect(data.settings).toContainEqual({ key: 'deviceName', value: 'Appareil existant' });
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto('/settings/');
  await expect(reopened.getByLabel('Nom de l’appareil')).toHaveCount(0);
  expect((await savedSettings(reopened)).settings).toContainEqual({
    key: 'deviceName',
    value: 'Appareil existant',
  });
  await expect.poll(() => reopened.evaluate(() => navigator.onLine)).toBe(false);
});

test('reports a full store and preserves the last saved theme', async ({ page }) => {
  await page.goto('/settings/');
  const panel = page.getByRole('region', { name: 'Apparence', exact: true });
  const theme = panel.getByLabel('Thème', { exact: true });
  await expect(theme).toBeEnabled();
  await theme.selectOption('light');
  await expect(panel).toContainText('Thème enregistré');
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'deviceSettings') throw new DOMException('Full', 'QuotaExceededError');
      return put.apply(this, args);
    };
  });
  await theme.selectOption('dark');
  await expect(panel).toContainText('Le stockage de cet appareil est plein');
  await expect(panel).not.toContainText('Thème enregistré');
  await page.reload();
  await expect(theme).toHaveValue('light');
  await expect(page.getByLabel('Nom de l’appareil')).toHaveCount(0);
});

test('recovers formerly consumed teams during the v4 upgrade while retaining historical snapshots', async ({
  page,
}) => {
  await page.route('**/__legacy_teams__', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Legacy teams</title>' }),
  );
  await page.goto('/__legacy_teams__');
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('scoretrackrr', 40);
        open.onupgradeneeded = () => {
          for (const name of ['players', 'teams', 'teamMemberships', 'matches', 'scoreEvents'])
            open.result.createObjectStore(name, { keyPath: 'id' });
        };
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(
            ['players', 'teams', 'teamMemberships', 'matches', 'scoreEvents'],
            'readwrite',
          );
          const date = '2026-11-16T10:00:00.000Z';
          for (const id of ['Alice', 'Bob'])
            tx.objectStore('players').put({
              id,
              displayName: id,
              color: '#153e35',
              isGuest: false,
              createdAt: date,
              updatedAt: date,
            });
          for (const id of ['Retrouvée', 'Archivée']) {
            tx.objectStore('teams').put({
              id,
              name: id,
              color: '#153e35',
              kind: 'temporary',
              revision: 2,
              createdAt: date,
              updatedAt: date,
              archivedAt: date,
              ...(id === 'Retrouvée' ? { assignedMatchId: 'old-match' } : {}),
            });
            for (const playerId of ['Alice', 'Bob'])
              tx.objectStore('teamMemberships').put({
                id: `${id}-${playerId}`,
                teamId: id,
                playerId,
                joinedAt: date,
              });
          }
          tx.objectStore('matches').put({
            id: 'old-match',
            updatedAt: date,
            teamsSnapshot: [
              {
                id: 'Retrouvée',
                name: 'Nom historique',
                kind: 'temporary',
                playerIds: ['Alice', 'Bob'],
              },
            ],
          });
          tx.objectStore('scoreEvents').put({
            id: 'old-event',
            matchId: 'old-match',
            payload: { immutable: true },
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
  await page.goto('/teams/');
  await expect(page.getByRole('article', { name: 'Retrouvée', exact: true })).toContainText(
    'Alice',
  );
  await expect(page.getByRole('article', { name: 'Archivée', exact: true })).toBeVisible();
  await expect(page.getByLabel('Utilisation', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Voir les équipes archivées', { exact: true })).toHaveCount(0);
  const data = await page.evaluate(
    () =>
      new Promise<{
        version: number;
        team: Record<string, unknown>;
        match: Record<string, unknown>;
        event: Record<string, unknown>;
      }>((resolve, reject) => {
        const open = indexedDB.open('scoretrackrr');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(['teams', 'matches', 'scoreEvents']);
          const team = tx.objectStore('teams').get('Retrouvée');
          const match = tx.objectStore('matches').get('old-match');
          const event = tx.objectStore('scoreEvents').get('old-event');
          tx.oncomplete = () => {
            resolve({
              version: db.version,
              team: team.result,
              match: match.result,
              event: event.result,
            });
            db.close();
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };
      }),
  );
  expect(data.version).toBe(70);
  expect(data.team.kind).toBe('permanent');
  expect(data.team.revision).toBe(3);
  expect(data.team.assignedMatchId).toBeUndefined();
  expect(data.team.archivedAt).toBeUndefined();
  expect(data.match.teamsSnapshot).toEqual([
    { id: 'Retrouvée', name: 'Nom historique', kind: 'temporary', playerIds: ['Alice', 'Bob'] },
  ]);
  expect(data.event).toEqual({
    id: 'old-event',
    matchId: 'old-match',
    payload: { immutable: true },
  });
});
