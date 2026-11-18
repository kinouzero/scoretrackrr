import { readFileSync } from 'node:fs';
import { expect, test } from '../fixtures/browser';
import { waitForOfflineReady } from '../fixtures/offline';
const api = 'https://api.github.com/repos/kinouzero/scoretrackrr/releases';
const { version } = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { version: string };
const [major, minor, patch] = version.split('.').map(Number);
const nextTag = `v${major}.${minor}.${patch! + 1}`;
const latest = {
  tag_name: nextTag,
  html_url: `https://github.com/kinouzero/scoretrackrr/releases/tag/${nextTag}`,
  published_at: '2026-11-17T12:00:00Z',
  draft: false,
  prerelease: false,
};
test('shows app metadata offline without automatically requesting GitHub', async ({
  page,
  context,
}) => {
  let requests = 0;
  await context.route(`${api}**`, async (route) => {
    requests++;
    await route.abort();
  });
  await page.goto('/settings/');
  await waitForOfflineReady(page);
  const about = page.locator('section[aria-labelledby="about-title"]');
  await expect(about).toContainText(`Version ${version}`);
  await expect(about.getByRole('listitem')).toHaveCount(8);
  await expect(about.getByRole('link', { name: 'Code source sur GitHub' })).toHaveAttribute(
    'href',
    'https://github.com/kinouzero/scoretrackrr',
  );
  await context.setOffline(true);
  await page.reload();
  await about.getByRole('button', { name: 'Vérifier les mises à jour' }).click();
  await expect(about.getByRole('alert')).toBeVisible();
  expect(requests).toBe(0);
});
test.describe('mocked public GitHub API', () => {
  test.use({ serviceWorkers: 'block' });
  test('checks releases explicitly, translates results and recovers after an error', async ({
    page,
    context,
  }) => {
    let requests = 0;
    await context.route(`${api}**`, async (route) => {
      requests++;
      await route.fulfill({ status: requests === 2 ? 429 : 200, json: latest });
    });
    await page.goto('/settings/');
    const about = page.locator('section[aria-labelledby="about-title"]');
    const check = about.getByRole('button', { name: 'Vérifier les mises à jour' });
    await expect(check).toBeEnabled();
    expect(requests).toBe(0);
    await check.click();
    await expect(about).toContainText(`Nouvelle version disponible : ${nextTag}.`);
    await expect(about.getByRole('link', { name: 'Voir la release' })).toHaveAttribute(
      'href',
      latest.html_url,
    );
    await check.click();
    await expect(about.getByRole('alert')).toBeVisible();
    await expect(about.getByRole('link', { name: 'Voir la release' })).toBeVisible();
    await page.getByLabel('Langue de l’application', { exact: true }).selectOption('en');
    await expect(page.getByRole('heading', { name: 'About', exact: true })).toBeVisible();
    await about.getByRole('button', { name: 'Check for updates' }).click();
    await expect(about.getByRole('alert')).toHaveCount(0);
    await expect(about).toContainText(`New version available: ${nextTag}.`);
    expect(requests).toBe(3);
  });
  test('reports no stable release and rejects a foreign release URL', async ({ page, context }) => {
    let invalid = false;
    await context.route(`${api}**`, async (route) => {
      if (invalid)
        await route.fulfill({ json: { ...latest, html_url: 'https://example.com/evil' } });
      else if (route.request().url().endsWith('/latest'))
        await route.fulfill({ status: 404, json: {} });
      else await route.fulfill({ json: [] });
    });
    await page.goto('/settings/');
    const about = page.locator('section[aria-labelledby="about-title"]');
    const check = about.getByRole('button', { name: 'Vérifier les mises à jour' });
    await check.click();
    await expect(about).toContainText('Aucune release stable');
    invalid = true;
    await check.click();
    await expect(about.getByRole('alert')).toBeVisible();
    await expect(about.getByRole('link')).toHaveCount(1);
  });
});
