import { expect, test, type Page } from '../fixtures/browser';

async function offerInstallation(page: Page, result: 'accepted' | 'dismissed' | 'error') {
  return page.evaluate((outcome) => {
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      async prompt() {
        document.body.dataset.installRequested = 'yes';
        if (outcome === 'error') throw new Error('Prompt unavailable');
        return { outcome };
      },
    });
    delete document.body.dataset.installRequested;
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }, result);
}

test('opens the installation prompt only on tap and removes spent or installed offers', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/');
  const header = page.getByRole('banner');
  const button = header.getByRole('button', { name: 'Installer l’app', exact: true });
  await expect(button).toHaveCount(0);
  await expect.poll(() => offerInstallation(page, 'dismissed')).toBe(true);
  await expect(button).toBeVisible();
  expect(await header.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(page.locator('body')).not.toHaveAttribute('data-install-requested', 'yes');
  await button.click();
  await expect(page.locator('body')).toHaveAttribute('data-install-requested', 'yes');
  await expect(button).toHaveCount(0);

  expect(await offerInstallation(page, 'error')).toBe(true);
  await button.click();
  await expect(header.getByRole('status')).toContainText('utilisez le menu du navigateur');

  expect(await offerInstallation(page, 'accepted')).toBe(true);
  await page.getByRole('link', { name: 'Jeux', exact: true }).click();
  await expect(button).toBeVisible();
  await button.click();
  await expect(button).toHaveCount(0);
  expect(await offerInstallation(page, 'accepted')).toBe(false);
});

test('ignores fresh offers when already installed or launched as a standalone app', async ({
  page,
}) => {
  await page.goto('/');
  const button = page.getByRole('button', { name: 'Installer l’app', exact: true });
  await expect.poll(() => offerInstallation(page, 'accepted')).toBe(true);
  await expect(button).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await expect(button).toHaveCount(0);
  expect(await offerInstallation(page, 'accepted')).toBe(false);

  await page.addInitScript(() => {
    const matchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query) => {
      const media = matchMedia(query);
      if (query === '(display-mode: standalone)')
        Object.defineProperty(media, 'matches', { value: true });
      return media;
    };
  });
  await page.reload();
  expect(await offerInstallation(page, 'accepted')).toBe(false);
  await expect(button).toHaveCount(0);
});
