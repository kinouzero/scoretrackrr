import { resolve } from 'node:path';
import { build } from 'vite';
import { expect, test, type Page } from '../fixtures/browser';
import { waitForOfflineReady } from '../fixtures/offline';
async function examples(page: Page) {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: true,
      lib: { entry: resolve('tests/fixtures/rule-guides.ts'), formats: ['es'] },
    },
  });
  const output = Array.isArray(result) ? result : [result];
  const entry = output
    .flatMap((item) => ('output' in item ? item.output : []))
    .find((item) => item.type === 'chunk' && item.isEntry);
  if (!entry || entry.type !== 'chunk') throw new Error('Missing rule guide fixture bundle');
  return page.evaluate(async (code) => {
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    try {
      return (await (await import(url)).seedRuleGuides()) as string[];
    } finally {
      URL.revokeObjectURL(url);
    }
  }, entry.code);
}
for (const locale of ['fr', 'en'] as const) {
  test(`reads every game guide and official source offline in ${locale} without automatic external requests`, async ({
    page,
    context,
  }) => {
    const external: string[] = [];
    context.on('request', (request) => {
      if (request.url().startsWith('https://')) external.push(request.url());
    });
    await page.goto('/');
    await waitForOfflineReady(page);
    await context.setOffline(true);
    const ids = await examples(page);
    if (locale === 'en') {
      await page.goto('/settings/');
      await page.getByLabel('Langue de l’application', { exact: true }).selectOption('en');
      await expect(page.getByLabel('App language', { exact: true })).toHaveValue('en');
    }
    for (const id of ids) {
      await page.goto(`/matches/?match=${encodeURIComponent(id)}`);
      const rules = page.getByRole('region', {
        name: locale === 'fr' ? 'Règles du jeu' : 'Game rules',
        exact: true,
      });
      const disclosure = rules.locator('details');
      await expect(disclosure).not.toHaveAttribute('open');
      await rules.locator('summary').focus();
      await page.keyboard.press('Enter');
      await expect(
        rules.getByRole('heading', { name: locale === 'fr' ? 'But du jeu' : 'Goal', exact: true }),
      ).toBeVisible();
      await expect(
        rules.getByRole('heading', {
          name: locale === 'fr' ? 'Fin de partie' : 'End of the game',
          exact: true,
        }),
      ).toBeVisible();
      await expect(rules.getByRole('table')).toHaveCount(1);
      await expect(rules.getByText(/undefined|UNKNOWN_MESSAGE|ruleGuide\./)).toHaveCount(0);
      if (id === 'rules-custom') {
        await expect(rules.getByRole('link')).toHaveCount(0);
        await expect(rules).toContainText(
          locale === 'fr' ? 'aucune source officielle' : 'no official source',
        );
      } else {
        const links = rules.getByRole('link');
        expect(await links.count()).toBeGreaterThan(0);
        for (const link of await links.all()) {
          await expect(link).toHaveAttribute('href', /^https:\/\//);
          await expect(link).toHaveAttribute('rel', /noopener noreferrer/);
          await expect(link).toHaveAttribute('referrerpolicy', 'no-referrer');
        }
      }
      if (id === 'rules-modern-yams') {
        await expect(rules.getByRole('table')).toContainText('17 points.');
        await expect(rules.getByRole('table')).toContainText('58 points.');
        await expect(rules).toContainText(locale === 'fr' ? 'Joker désactivé' : 'Joker disabled');
      }
    }
    await page.reload();
    await expect(page.locator('.rule-guide')).not.toHaveAttribute('open');
    expect(external).toEqual([]);
  });
}
test('opens official documents only on explicit request and preserves the current match', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await examples(page);
  await page.goto('/matches/?match=rules-modern-yams');
  const original = page.url();
  const rules = page.getByRole('region', { name: 'Règles du jeu', exact: true });
  await rules.locator('summary').click();
  const url = 'https://instructions.hasbro.com/api/download/C2406_en-us_yahtzee.pdf';
  let requests = 0;
  await context.route(url, async (route) => {
    requests++;
    await route.fulfill({
      status: 200,
      contentType: 'text/plain',
      body: 'Synthetic official-document response',
    });
  });
  expect(requests).toBe(0);
  const popupPromise = context.waitForEvent('page');
  await rules.getByRole('link', { name: /Hasbro — Yahtzee Classic C2406/ }).click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(url);
  await expect(popup.locator('body')).toContainText('Synthetic official-document response');
  expect(requests).toBe(1);
  await expect(page).toHaveURL(original);
  await expect(rules.locator('details')).toHaveAttribute('open', '');
});
