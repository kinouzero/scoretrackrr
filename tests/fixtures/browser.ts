import { test as base, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export { expect };
export type { Page, BrowserContext, Locator } from '@playwright/test';
export const test = base.extend({
  page: async ({ page, browserName }, use, testInfo) => {
    const collect = process.env.COVERAGE === '1' && browserName === 'chromium';
    if (!collect) {
      await use(page);
      return;
    }
    const collected: Awaited<ReturnType<typeof page.coverage.stopJSCoverage>> = [];
    let active = false;
    let stopping = false;
    let pending = Promise.resolve();
    const start = async () => {
      if (stopping) return;
      await page.coverage.startJSCoverage({
        resetOnNavigation: false,
        reportAnonymousScripts: false,
      });
      active = true;
    };
    const flush = (restart: boolean) => {
      // Navigation and timeout teardown can overlap; only one collector may stop V8.
      pending = pending.then(async () => {
        if (active && !page.isClosed()) {
          active = false;
          collected.push(...(await page.coverage.stopJSCoverage()));
          if (restart) await start();
        }
      });
      return pending;
    };
    // Flush before a document is destroyed: V8 can discard its counters after navigation.
    const goto = page.goto.bind(page);
    page.goto = async (...args) => {
      await flush(true);
      return goto(...args);
    };
    const reload = page.reload.bind(page);
    page.reload = async (...args) => {
      await flush(true);
      return reload(...args);
    };
    const close = page.close.bind(page);
    page.close = async (...args) => {
      stopping = true;
      await flush(false);
      return close(...args);
    };
    await start();
    try {
      await use(page);
    } finally {
      stopping = true;
      await flush(false);
      const directory = resolve('coverage/browser-raw');
      await mkdir(directory, { recursive: true });
      await writeFile(
        resolve(directory, `${testInfo.testId}-${testInfo.retry}.json`),
        JSON.stringify(
          collected.filter((entry) => new URL(entry.url).pathname.startsWith('/_app/immutable/')),
        ),
      );
    }
  },
});
