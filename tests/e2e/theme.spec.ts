import { waitForOfflineReady } from '../fixtures/offline';
import { expect, test } from '../fixtures/browser';

test('keeps light/dark/system preferences offline and applies changes across tabs', async ({
  page,
  context,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await page.goto('/settings/');
  const theme = page.getByRole('region', { name: 'Apparence' });
  await expect(theme.getByLabel('Thème', { exact: true })).toBeEnabled();
  await expect(theme.getByLabel('Thème', { exact: true })).toHaveValue('system');
  await expect(page.locator('html')).not.toHaveAttribute('data-theme');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(
    'dark',
  );
  await theme.getByLabel('Thème', { exact: true }).selectOption('light');
  await expect(theme).toContainText('Thème enregistré');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(
    'light',
  );
  await page.reload();
  await expect(theme.getByLabel('Thème', { exact: true })).toHaveValue('light');
  const other = await context.newPage();
  await other.goto('/games/');
  await expect(other.locator('html')).toHaveAttribute('data-theme', 'light');
  await theme.getByLabel('Thème', { exact: true }).selectOption('dark');
  await expect(other.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({
    path: test.info().outputPath('settings-dark-mobile.png'),
    fullPage: true,
  });
  await other.screenshot({
    path: test.info().outputPath('catalog-dark-mobile.png'),
    fullPage: true,
  });
  await theme.getByLabel('Thème', { exact: true }).selectOption('system');
  await expect(page.locator('html')).not.toHaveAttribute('data-theme');
  await page.emulateMedia({ colorScheme: 'light' });
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(
    'light',
  );
  await other.close();
});
