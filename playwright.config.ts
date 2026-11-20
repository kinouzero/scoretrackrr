import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Coverage snapshots add work to navigation and teardown on hosted runners.
  timeout: process.env.COVERAGE === '1' ? 60_000 : 30_000,
  use: { baseURL: 'http://127.0.0.1:4178', trace: 'retain-on-failure-and-retries' },
  projects: [
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'], locale: 'fr-FR' } },
    { name: 'mobile-webkit', use: { ...devices['iPhone 13'], locale: 'fr-FR' } },
  ],
  webServer: {
    command: 'python3 tests/serve-static.py',
    url: 'http://127.0.0.1:4178',
    reuseExistingServer: false,
  },
});
