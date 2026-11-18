import { expect, type Page } from '@playwright/test';
import { normalizePlayerProfile } from '../../src/lib/domain/players';
import type { PlayerRecord } from '../../src/lib/domain/records';

// Gameplay prerequisites only. Profile/editor scenarios exercise the real creation UI.
export async function seedPlayers(page: Page, names: readonly string[]) {
  const createdAt = new Date().toISOString();
  const records: PlayerRecord[] = names.map((displayName) => ({
    id: crypto.randomUUID(),
    ...normalizePlayerProfile({
      displayName,
      color: '#2459d3',
      isGuest: false,
      avatar: 'initials',
    }),
    createdAt,
    updatedAt: createdAt,
    revision: 1,
  }));
  await page.goto('/players/');
  await expect(
    page.getByRole('button', { name: /^(Ajouter un joueur|Add player)$/, exact: true }),
  ).toBeEnabled();
  await page.evaluate(
    (records) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('scoretrackrr');
        request.onerror = () => reject(request.error);
        request.onupgradeneeded = () => {
          request.transaction?.abort();
          reject(new Error('Application schema must exist before installing player fixtures'));
        };
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction('players', 'readwrite');
          for (const player of records) transaction.objectStore('players').add(player);
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
    records,
  );
  // Native fixture writes are visible to queries mounted after the next navigation.
  return records;
}
