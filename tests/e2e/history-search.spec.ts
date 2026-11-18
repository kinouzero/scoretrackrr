import { expect, test } from '../fixtures/browser';
import { resolve } from 'node:path';
import { build } from 'vite';
import { waitForOfflineReady } from '../fixtures/offline';

let fixtureCode: string;
test.beforeAll(async () => {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: true,
      lib: { entry: resolve('tests/fixtures/history-search.ts'), formats: ['es'] },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  const entry = outputs
    .flatMap((output) => ('output' in output ? output.output : []))
    .find((chunk) => chunk.type === 'chunk' && chunk.isEntry);
  if (!entry || entry.type !== 'chunk') throw new Error('Missing history fixture');
  fixtureCode = entry.code;
});
test.beforeEach(async ({ page, context }) => {
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await page.evaluate(async (code) => {
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    try {
      const { LocalDatabase, seedHistorySearch } = await import(url);
      const database = new LocalDatabase();
      try {
        await seedHistorySearch(database);
      } finally {
        database.close();
      }
    } finally {
      URL.revokeObjectURL(url);
    }
  }, fixtureCode);
  await page.goto('/matches/');
  await expect(page.locator('.match-card')).toHaveCount(24);
});

test('uses one offline search for games, historical players and teams with only a status filter', async ({
  page,
  context,
}) => {
  const toolbar = page.locator('.history-search-controls');
  const search = toolbar.getByRole('searchbox', { name: 'Rechercher une partie', exact: true });
  await expect(toolbar.locator('input')).toHaveCount(1);
  await expect(toolbar.getByRole('combobox')).toHaveCount(1);
  await expect(toolbar.locator('input[type=date], details')).toHaveCount(0);
  await expect(search).toHaveAttribute('placeholder', 'Jeu, joueur ou équipe');
  for (const value of ['petanque', 'ELODIE', 'elephants', '  élod PETANQUE éléph  ']) {
    await search.fill(value);
    await expect(page.locator('.match-card')).toHaveCount(1);
    await expect(page.locator('.match-card')).toContainText('Les Éléphants');
  }
  await search.fill('New nickname');
  await expect(page.locator('.match-card')).toHaveCount(0);
  await search.fill('inconnu');
  await expect(page.locator('.match-card')).toHaveCount(0);
  await search.fill('flechettes');
  await expect(page.locator('.match-card')).toHaveCount(1);
  await expect(page.locator('.match-card')).toContainText('Les Comètes');
  await toolbar.getByRole('combobox').selectOption('draft');
  await expect(page.locator('.match-card')).toHaveCount(0);
  await toolbar.getByRole('combobox').selectOption('paused');
  await expect(page.locator('.match-card')).toHaveCount(1);
  await search.fill('petanque');
  await expect(page.locator('.match-card')).toHaveCount(0);
  await toolbar.getByRole('combobox').selectOption('');
  await expect(page.locator('.match-card')).toHaveCount(1);
  const settings = await context.newPage();
  await settings.goto('/settings/');
  await settings.getByLabel('Langue de l’application', { exact: true }).selectOption('en');
  const englishSearch = toolbar.getByRole('searchbox', { name: 'Search matches', exact: true });
  await expect(englishSearch).toHaveValue('petanque');
  await expect(page.locator('.match-card')).toHaveCount(1);
  await expect(englishSearch).toHaveAttribute('placeholder', 'Game, player or team');
  await englishSearch.fill('6 nimmt ines');
  await expect(page.locator('.match-card')).toHaveCount(1);
  await expect(page.locator('.match-card')).toContainText('6 nimmt!');
  await settings.close();
});

test('resets history pagination when the shared search or status changes', async ({ page }) => {
  const next = page.locator('.profile-pagination').getByRole('button').last();
  await next.click();
  await expect(page.locator('.match-card')).toHaveCount(5);
  const search = page.getByRole('searchbox', { name: 'Rechercher une partie', exact: true });
  await search.fill('elephants');
  await expect(page.locator('.match-card')).toHaveCount(1);
  await expect(page.locator('.match-card')).toContainText('Les Éléphants');
  await search.fill('');
  await expect(page.locator('.match-card')).toHaveCount(24);
  await expect(page.locator('.profile-pagination').getByRole('button').first()).toBeDisabled();
  await next.click();
  await expect(page.locator('.match-card')).toHaveCount(5);
  await page.getByLabel('État de la partie', { exact: true }).selectOption('paused');
  await expect(page.locator('.match-card')).toHaveCount(1);
  await expect(page.locator('.match-card')).toContainText('Les Comètes');
  await page.getByLabel('État de la partie', { exact: true }).selectOption('');
  await expect(page.locator('.match-card')).toHaveCount(24);
  await expect(page.locator('.profile-pagination').getByRole('button').first()).toBeDisabled();
});
