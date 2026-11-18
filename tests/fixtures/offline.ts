import { expect, type Page } from '@playwright/test';

export async function waitForOfflineReady(page: Page) {
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker?.controller)), {
      // A fresh context must install the complete offline shell, not just render a page.
      timeout: 15_000,
      message: 'The precached worker must control the page before disabling the network.',
    })
    .toBe(true);
}
