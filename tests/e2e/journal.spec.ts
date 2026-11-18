import { waitForOfflineReady } from '../fixtures/offline';
import { resolve } from 'node:path';
import { expect, test } from '../fixtures/browser';
import { build } from 'vite';

let fixtureCode: string;
test.beforeAll(async () => {
  const built = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: true,
      lib: { entry: resolve('tests/fixtures/journal.ts'), formats: ['es'] },
    },
  });
  const outputs = Array.isArray(built) ? built : [built];
  const entry = outputs
    .flatMap((output) => ('output' in output ? output.output : []))
    .find((chunk) => chunk.type === 'chunk' && chunk.isEntry);
  if (!entry || entry.type !== 'chunk') throw new Error('Missing journal test fixture');
  fixtureCode = entry.code;
});

test('persists and displays an append-only corrected journal offline after reload', async ({
  page,
  context,
}) => {
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  const result = await page.evaluate(async (code) => {
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    try {
      const { LocalDatabase, MatchJournal, seedJournal, timestamp } = await import(url);
      const db = new LocalDatabase();
      await seedJournal(db);
      const journal = new MatchJournal(db);
      let version = 0;
      const record = (ownerId: string, points: number) => ({
        type: 'record',
        ownerId,
        values: { points },
      });
      const send = async (action: unknown) => {
        const view = await journal.submit({
          matchId: 'match',
          eventId: `e-${version + 1}`,
          commandId: `c-${version + 1}`,
          expectedVersion: version,
          actorPlayerId: 'alice',
          deviceId: 'phone-a',
          timestamp,
          action,
        });
        version++;
        return view;
      };
      await send({ type: 'start' });
      await send(record('blue', 4));
      await send(record('red', 2));
      await send(record('blue', 6));
      const won = await send(record('blue', 3));
      const original = await db.scoreEvents.get('e-2');
      await send({ type: 'correct', targetEventId: 'e-2', replacement: record('blue', 3) });
      const corrected = await send({ type: 'undo', targetEventId: 'e-3' });
      const preserved =
        JSON.stringify(await db.scoreEvents.get('e-2')) === JSON.stringify(original);
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        if (this.name === 'matchProjections') throw new DOMException('Full', 'QuotaExceededError');
        return put.apply(this, args);
      };
      let quota = '';
      try {
        await send(record('blue', 1));
      } catch (error) {
        quota = (error as { code: string }).code;
      } finally {
        IDBObjectStore.prototype.put = put;
      }
      const rolledBack = JSON.stringify(await journal.read('match')) === JSON.stringify(corrected);
      await db.matchProjections.put({
        matchId: 'match',
        lastEventSequence: 99,
        totals: { blue: 999 },
        status: 'finished',
      });
      const rebuilt = await journal.rebuild('match', version);
      const events = await db.scoreEvents.count();
      db.close();
      return {
        won: won.projection.status,
        totals: rebuilt.projection.totals,
        status: rebuilt.projection.status,
        events,
        preserved,
        rolledBack,
        quota,
      };
    } finally {
      URL.revokeObjectURL(url);
    }
  }, fixtureCode);
  expect(result).toEqual({
    won: 'finished',
    totals: { blue: 12, red: 0 },
    status: 'in_progress',
    events: 7,
    preserved: true,
    rolledBack: true,
    quota: 'quota_exceeded',
  });
  await page.goto('/matches/');
  await expect(page).toHaveURL(/match=match/);
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).toBeVisible();
  const scores = page.getByRole('region', { name: 'Scores', exact: true });
  await expect(scores).toContainText('blue12');
  await expect(scores).toContainText('red0');
  await expect(
    page.locator('.match-page-heading').getByText('En cours', { exact: true }),
  ).toBeVisible();
  const history = page.getByRole('list', { name: 'Historique des actions' });
  await expect(history.getByRole('listitem')).toHaveCount(7);
  await expect(history).toContainText('Remplacée par l’action n°6');
  await expect(history).toContainText('Corriger l’action n°2');
  await expect(history).toContainText('Annuler l’action n°3');
  await expect(history).toContainText('Par alice');
  await expect(history).not.toContainText('Appareil');
  await expect(history).not.toContainText('phone-a');
  await page.screenshot({ path: test.info().outputPath('journal-mobile.png'), fullPage: true });
  await page.reload();
  await expect(history.getByRole('listitem')).toHaveCount(7);
  await expect(scores).toContainText('blue12');
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: test.info().outputPath('journal-desktop.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('link', { name: 'Toutes les parties' })).toHaveCount(0);
  await page.goto('/matches/');
  await expect(page).toHaveURL(/match=match/);
  await expect(history.getByRole('listitem')).toHaveCount(7);
  await page.goto('/matches/?match=missing');
  await expect(page.getByRole('alert')).toContainText(
    'Cette partie est introuvable sur cet appareil.',
  );
  expect(failures).toEqual([]);
});
