import type { Page } from '@playwright/test';
import { builderDefinition, type BuilderSettings } from '../../src/lib/domain/games/builder';
import type { GameVersionRecord, JsonObject } from '../../src/lib/domain/records';

// Install synthetic pre-existing rules; the product no longer exposes the custom editor.
export async function savedCustomGame(
  page: Page,
  name: string,
  settings: Partial<BuilderSettings> = {},
  gameId = `custom-${crypto.randomUUID()}`,
) {
  const rulesetVersion = crypto.randomUUID().replaceAll('-', '');
  const version: GameVersionRecord = {
    id: crypto.randomUUID(),
    gameId,
    rulesetVersion,
    schemaVersion: 1,
    name,
    publishedAt: new Date().toISOString(),
    definition: builderDefinition(gameId, rulesetVersion, {
      minimum: -1000,
      maximum: 1000,
      initialScore: 0,
      direction: 'highest',
      target: 100,
      fields: [{ id: 'points', minimum: -1000, maximum: 1000, weight: 1 }],
      ...settings,
    }) as unknown as JsonObject,
  };
  await page.getByRole('link', { name: 'Jouer au Yams', exact: true }).waitFor();
  await page.evaluate(
    (serialized) =>
      new Promise<void>((resolve, reject) => {
        const version: GameVersionRecord = JSON.parse(serialized);
        const open = indexedDB.open('scoretrackrr');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(['games', 'gameVersions'], 'readwrite');
          tx.objectStore('gameVersions').add(version);
          tx.objectStore('games').put({
            id: version.gameId,
            slug: version.gameId,
            name: version.name,
            origin: 'custom',
            state: 'available',
            currentVersionId: version.id,
          });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onabort = () => {
            db.close();
            reject(tx.error);
          };
        };
      }),
    JSON.stringify(version),
  );
  // Refresh indexed queries after an external fixture transaction.
  await page.reload();
  return version;
}
