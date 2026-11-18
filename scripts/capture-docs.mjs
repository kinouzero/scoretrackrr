import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const origin = 'http://127.0.0.1:4178';
const devOrigin = 'http://127.0.0.1:4179';
const output = join(root, 'docs/images');
const english = JSON.parse(await readFile(join(root, 'src/lib/i18n/locales/en.json'), 'utf8'));
const label = (key) => english[key].defaultMessage;
const images = [];
const temporary = await mkdtemp(join(tmpdir(), 'scoretrackrr-docs-'));
let dev, server, browser;
try {
  try {
    await fetch(origin);
    throw new Error('Port 4178 is already in use. Stop browser tests before capturing docs.');
  } catch (error) {
    if (!String(error).includes('fetch failed')) throw error;
  }
  await readFile(join(root, 'build/service-worker.js'));
  await mkdir(output, { recursive: true });
  dev = await createServer({
    root,
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 4179, strictPort: true },
  });
  await dev.listen();
  server = spawn('python3', ['tests/serve-static.py'], { cwd: root, stdio: 'ignore' });
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if ((await fetch(origin)).ok) break;
    } catch {
      /* Wait only for our isolated server. */
    }
    if (attempt === 99) throw new Error('Static documentation server did not start.');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch();
  const source = await browser.newContext({ locale: 'en-US', acceptDownloads: true });
  const seed = await source.newPage();
  await seed.goto(`${devOrigin}/__dev/demo`);
  await expect(seed).toHaveURL(/\/matches\//);
  await seed.goto(`${devOrigin}/settings/`);
  const download = seed.waitForEvent('download');
  await seed.getByRole('button', { name: label('backup.export'), exact: true }).click();
  const file = join(temporary, 'synthetic.json');
  await (await download).saveAs(file);
  await source.close();

  const context = await browser.newContext({
    locale: 'en-US',
    colorScheme: 'light',
    viewport: { width: 1440, height: 1100 },
  });
  const id = crypto.randomUUID();
  await context.addInitScript((id) => {
    const register = navigator.serviceWorker.register.bind(navigator.serviceWorker);
    navigator.serviceWorker.register = (script, options) => {
      const url = new URL(String(script), location.href);
      url.searchParams.set('test-worker', id);
      return register(url.href, options);
    };
  }, id);
  await context.request.post(`${origin}/__test__/pwa-version`, { data: { id, version: 'docs-a' } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${origin}/settings/`);
  await page.locator('input[type=file]').setInputFiles(file);
  await expect(page.getByRole('status').filter({ hasText: /restored|added/i })).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  async function capture(name, selector) {
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const path = join(output, `${name}.png`);
    if (selector) {
      const element = page.locator(selector);
      await element.evaluate((node) => {
        node.scrollIntoView({ block: 'center' });
        if (node instanceof HTMLDialogElement) node.scrollTop = 0;
      });
      await element.screenshot({ path, animations: 'disabled', caret: 'hide' });
    } else await page.screenshot({ path, animations: 'disabled', caret: 'hide' });
    images.push({
      file: `${name}.png`,
      viewport: page.viewportSize(),
      locale: 'en-US',
      syntheticData: true,
    });
  }
  async function open(path) {
    await page.goto(`${origin}${path}`);
    await expect(page.locator('main h1')).toBeVisible();
  }
  await open('/');
  await capture('home-desktop');
  await open('/games/');
  await capture('games-desktop');
  await open('/players/');
  await capture('players-desktop');
  await open('/teams/');
  await capture('teams-desktop');
  await open('/games/');
  await page.getByRole('article', { name: 'Yams', exact: true }).getByRole('link').click();
  const setup = page.getByRole('dialog');
  for (const name of ['Alice · Démo', 'Lucas · Démo', 'Emma · Démo', 'Hugo · Démo'])
    await setup.getByRole('checkbox', { name: `Select ${name}`, exact: true }).check();
  await page.setViewportSize({ width: 390, height: 1000 });
  await capture('match-setup-mobile', 'dialog[open]');
  await setup.getByText(label('play.presets'), { exact: true }).click();
  await setup.getByLabel(label('play.presetName'), { exact: true }).fill('Weekend Yams');
  await setup.getByRole('button', { name: label('play.savePreset'), exact: true }).click();
  await capture('favorite-setup-mobile', '.setup-presets');
  await setup.getByText(label('play.presets'), { exact: true }).click();
  await setup.getByRole('button', { name: label('petanque.createDraft'), exact: true }).click();
  await page.getByRole('button', { name: label('matches.start'), exact: true }).click();
  await expect(page.locator('.yams-controls table')).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1100 });
  await capture('yams-desktop');
  const examples = [
    ['petanque-mobile', 'petanque-teams', 390, 1000],
    ['darts-desktop', 'darts-x01', 1440, 1100],
    ['skull-king-mobile', 'skull-king', 390, 1100],
    ['flip7-mobile', 'flip-7', 390, 1100],
    ['six-nimmt-desktop', '6-qui-prend', 1440, 1100],
    ['times-up-mobile', 'times-up', 390, 1000],
    ['farkle-desktop', '5000', 1440, 1100],
  ];
  for (const [name, match, width, height] of examples) {
    await page.setViewportSize({ width, height });
    await open(`/matches/?match=local-demo-v1-${match}`);
    await expect(page.locator('.game-play-area')).toBeVisible();
    if (match === 'skull-king') {
      await page.getByRole('button', { name: label('skull.next'), exact: true }).click();
      const bids = page.locator('.bid-choice');
      await expect(bids.first()).toBeVisible();
      for (let index = 0; index < (await bids.count()); index++)
        await bids.nth(index).selectOption(index === 0 ? '1' : '0');
      await page.getByRole('button', { name: label('skull.recordBids'), exact: true }).click();
      const player = page.locator('.player-card').first();
      await player
        .getByRole('button', { name: `Increase: ${label('skull.won')}`, exact: true })
        .click();
      await player.locator('.bonus-toggle').click();
    }
    await capture(
      name,
      match === 'times-up'
        ? '.entry-situation'
        : match === 'skull-king'
          ? '.bonus-grid'
          : undefined,
    );
    if (match === 'darts-x01') {
      await page.getByRole('button', { name: label('play.tableMode'), exact: true }).click();
      await capture('table-mode-desktop');
      await page.getByRole('button', { name: label('play.tableMode'), exact: true }).click();
    }
  }
  await page.setViewportSize({ width: 1200, height: 1000 });
  await open('/settings/');
  await capture('json-backup', 'section[aria-labelledby="backup-title"]');
  const updates = page.getByRole('region', { name: label('pwaUpdate.title'), exact: true });
  await context.request.post(`${origin}/__test__/pwa-version`, { data: { id, version: 'docs-b' } });
  await updates.getByRole('button', { name: label('pwaUpdate.check'), exact: true }).click();
  await expect(
    updates.getByRole('button', { name: label('pwaUpdate.apply'), exact: true }),
  ).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 1000 });
  await capture('pwa-update-mobile', 'section[aria-labelledby="pwa-update-title"]');
  expect(errors).toEqual([]);
  await writeFile(
    join(output, 'manifest.json'),
    `${JSON.stringify({ capturedOn: '2026-11-17', command: 'pnpm docs:screenshots', source: 'Production static build; synthetic demo backup plus a newly configured Yams match. PWA readiness uses two real compiled-worker fixture versions on localhost.', images }, null, 2)}\n`,
  );
  console.log(
    `Captured ${images.length} production screenshots in docs/images using isolated synthetic storage.`,
  );
  await context.close();
} finally {
  await browser?.close();
  server?.kill('SIGTERM');
  await dev?.close();
  await rm(temporary, { recursive: true, force: true });
}
