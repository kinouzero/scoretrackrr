import { expect, test, type BrowserContext, type Page } from '../fixtures/browser';
import { waitForOfflineReady } from '../fixtures/offline';
const origin = 'http://127.0.0.1:4178';
const panel = (page: Page) =>
  page.getByRole('region', { name: 'Mises à jour de l’application', exact: true });
const notice = (page: Page) =>
  page.getByRole('complementary', { name: 'Une mise à jour est prête', exact: true });
const fixtureIds = new WeakMap<BrowserContext, string>();
async function version(context: BrowserContext, value: string) {
  const response = await context.request.post(`${origin}/__test__/pwa-version`, {
    data: { id: fixtureIds.get(context), version: value },
  });
  expect(response.ok()).toBe(true);
}
async function installed(page: Page, context: BrowserContext, value: string) {
  const id = crypto.randomUUID();
  fixtureIds.set(context, id);
  await context.addInitScript((id) => {
    const register = navigator.serviceWorker.register.bind(navigator.serviceWorker);
    navigator.serviceWorker.register = (script, options) => {
      const url = new URL(String(script), location.href);
      if (url.origin === location.origin && url.pathname === '/service-worker.js')
        url.searchParams.set('test-worker', id);
      return register(url.href, options);
    };
  }, id);
  await version(context, `${value}-a`);
  await page.goto('/settings/');
  await waitForOfflineReady(page);
  await expect(
    panel(page).getByRole('button', { name: 'Vérifier la PWA', exact: true }),
  ).toBeEnabled();
  await expect
    .poll(() => page.evaluate(() => caches.keys()))
    .toContainEqual(expect.stringContaining(`-test-${value}-a`));
}
async function prepare(page: Page, context: BrowserContext, value: string) {
  await version(context, value);
  await panel(page).getByRole('button', { name: 'Vérifier la PWA', exact: true }).click();
  await expect(
    panel(page).getByRole('button', { name: 'Installer et recharger', exact: true }),
  ).toBeEnabled();
}
async function apply(page: Page) {
  await page.evaluate(() => {
    document.documentElement.dataset.updateTest = 'before';
  });
  await panel(page).getByRole('button', { name: 'Installer et recharger', exact: true }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-update-test', 'before');
  await expect(panel(page)).toBeVisible();
  await expect(notice(page)).toHaveCount(0);
}
async function createPlayer(page: Page, name: string) {
  await page.getByRole('button', { name: 'Ajouter un joueur', exact: true }).click();
  await page.getByLabel('Pseudonyme', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Enregistrer le profil', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
}
test('applies an update after opening Settings from the app home', async ({ page, context }) => {
  await installed(page, context, 'settings-link');
  await page.goto('/');
  await page.evaluate(() => {
    document.documentElement.dataset.settingsNavigation = 'same-document';
  });
  await page.getByRole('link', { name: 'Réglages', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-settings-navigation', 'same-document');
  await prepare(page, context, 'settings-link-b');
  await apply(page);
  await expect(panel(page).getByRole('alert')).toHaveCount(0);
});
test('accepts an update from an older app after navigating to Settings', async ({
  page,
  context,
}) => {
  await installed(page, context, 'legacy-settings');
  await page.goto('/');
  await page.getByRole('link', { name: 'Réglages', exact: true }).click();
  await prepare(page, context, 'legacy-settings-b');
  await page.evaluate(async () => {
    const worker = (await navigator.serviceWorker.ready).waiting!;
    const post = worker.postMessage.bind(worker);
    Object.defineProperty(worker, 'postMessage', {
      value({ type }: { type: string }, transfer: Transferable[]) {
        post({ type }, transfer);
      },
    });
  });
  await apply(page);
  await expect(panel(page).getByRole('alert')).toHaveCount(0);
});
test('detects a real waiting worker, defers without losing a draft and applies offline preserving saved profiles', async ({
  page,
  context,
}) => {
  await installed(page, context, 'profiles');
  await page.getByLabel('Thème', { exact: true }).selectOption('dark');
  await page.evaluate(async () => {
    const name = (await caches.keys()).find((name) => name.endsWith('-test-profiles-a'))!;
    await (
      await caches.open(name)
    ).put('/_app/immutable/retired-test.js', new Response('old-build-asset'));
  });
  await page.goto('/players/');
  await createPlayer(page, 'Alice');
  await page.getByRole('button', { name: 'Ajouter un joueur', exact: true }).click();
  await page.getByLabel('Pseudonyme', { exact: true }).fill('Unsaved draft');
  await version(context, 'profiles-b');
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.ready).update();
  });
  await expect(page.locator('.update-notice')).toBeAttached();
  await expect(page.getByLabel('Pseudonyme', { exact: true })).toHaveValue('Unsaved draft');
  // Native dialogs make the background notice inert; defer after closing the draft explicitly.
  await page.getByRole('dialog').getByRole('button', { name: 'Annuler', exact: true }).click();
  await notice(page).getByRole('button', { name: 'Plus tard', exact: true }).click();
  await expect(notice(page)).toHaveCount(0);
  await expect(page.getByRole('article', { name: 'Alice', exact: true })).toBeVisible();
  await page.goto('/settings/');
  await expect(
    panel(page).getByRole('button', { name: 'Installer et recharger', exact: true }),
  ).toBeEnabled();
  await context.setOffline(true);
  await apply(page);
  await expect(page.getByLabel('Thème', { exact: true })).toHaveValue('dark');
  expect(
    await page.evaluate(async () => (await fetch('/_app/immutable/retired-test.js')).text()),
  ).toBe('old-build-asset');
  await page.goto('/players/');
  await page.reload();
  await expect(page.getByRole('article', { name: 'Alice', exact: true })).toBeVisible();
  const keys = await page.evaluate(() => caches.keys());
  expect(keys).toContainEqual(expect.stringContaining('-test-profiles-a'));
  expect(keys).toContainEqual(expect.stringContaining('-test-profiles-b'));
});
test('blocks activation with another window and never reloads its unsaved form', async ({
  page,
  context,
}) => {
  await installed(page, context, 'windows');
  const other = await context.newPage();
  await other.goto('/players/');
  await other.getByRole('button', { name: 'Ajouter un joueur', exact: true }).click();
  await other.getByLabel('Pseudonyme', { exact: true }).fill('Keep this form');
  await prepare(page, context, 'windows-b');
  await panel(page).getByRole('button', { name: 'Installer et recharger', exact: true }).click();
  await expect(panel(page).getByRole('alert')).toHaveText(
    'Fermez les autres onglets et fenêtres de Scoretrackrr, puis réessayez.',
  );
  await expect(other.getByLabel('Pseudonyme', { exact: true })).toHaveValue('Keep this form');
  const rejection = await other.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = (event) => {
        channel.port1.close();
        resolve(event.data.status);
      };
      registration.waiting!.postMessage({ type: 'SCORETRACKRR_APPLY_UPDATE' }, [channel.port2]);
    });
  });
  expect(rejection).toBe('otherTabs');
  await other.close();
  await apply(page);
  for (const value of ['windows-c', 'windows-d']) {
    await prepare(page, context, value);
    await apply(page);
  }
  const shells = (await page.evaluate(() => caches.keys())).filter((name) =>
    name.startsWith('scoretrackrr-shell-'),
  );
  expect(shells).toHaveLength(3);
  expect(shells).not.toContainEqual(expect.stringContaining('-test-windows-a'));
});
test('reopens the shell automatically when the activation notifications are interrupted', async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    navigator.serviceWorker.addEventListener('controllerchange', (event) => {
      event.stopImmediatePropagation();
    });
  });
  await installed(page, context, 'activation');
  await page.getByLabel('Thème', { exact: true }).selectOption('dark');
  await prepare(page, context, 'activation-b');
  await page.evaluate(async () => {
    const worker = (await navigator.serviceWorker.ready).waiting!;
    const post = worker.postMessage.bind(worker);
    Object.defineProperty(worker, 'postMessage', {
      value(message: unknown) {
        const channel = new MessageChannel();
        post(message, [channel.port2]);
        channel.port1.close();
      },
    });
  });
  await apply(page);
  await expect(panel(page).getByRole('alert')).toHaveCount(0);
  await expect(page.getByLabel('Thème', { exact: true })).toHaveValue('dark');
});
test('blocks a running match, then updates a paused match without losing its score', async ({
  page,
  context,
}) => {
  await installed(page, context, 'match');
  await page.goto('/players/');
  for (const name of ['Alice', 'Bob']) await createPlayer(page, name);
  await page.goto('/games/');
  await page
    .getByRole('article', { name: 'X01', exact: true })
    .getByRole('link', { name: 'Jouer au X01', exact: true })
    .click();
  const setup = page.getByRole('dialog');
  for (const name of ['Alice', 'Bob'])
    await setup.getByRole('checkbox', { name: `Sélectionner ${name}`, exact: true }).check();
  await setup.getByRole('button', { name: 'Créer la partie', exact: true }).click();
  await page.getByRole('button', { name: 'Démarrer la partie', exact: true }).click();
  const matchUrl = page.url();
  await page.getByLabel('Mode de saisie', { exact: true }).selectOption('visit');
  await page.getByLabel(/^Total des/).fill('20');
  await page.getByRole('button', { name: 'Enregistrer le total de la volée', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Au tour de Bob', exact: true })).toBeVisible();
  await page.goto('/settings/');
  await prepare(page, context, 'match-b');
  await panel(page).getByRole('button', { name: 'Installer et recharger', exact: true }).click();
  await expect(panel(page).getByRole('alert')).toContainText('Une partie est en cours.');
  await page.goto(matchUrl);
  await page.getByRole('button', { name: 'Mettre en pause', exact: true }).click();
  await expect(page.locator('.match-card .match-status')).toHaveText('En pause');
  await page.goto('/settings/');
  await apply(page);
  await context.setOffline(true);
  await page.goto('/matches/');
  await expect(page.locator('.match-card .match-status')).toHaveText('En pause');
  await page.getByRole('button', { name: 'Reprendre', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Au tour de Bob', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Scores', exact: true })).toContainText('281');
});
test('retains the current offline shell when a new precache fails and retries successfully', async ({
  page,
  context,
}) => {
  await installed(page, context, 'failed');
  await version(context, 'failed-broken');
  await panel(page).getByRole('button', { name: 'Vérifier la PWA', exact: true }).click();
  await expect(panel(page).getByRole('alert')).toContainText('Impossible de télécharger');
  await expect(
    panel(page).getByRole('button', { name: 'Installer et recharger', exact: true }),
  ).toHaveCount(0);
  await context.setOffline(true);
  await page.reload();
  await expect(panel(page)).toBeVisible();
  await context.setOffline(false);
  await prepare(page, context, 'failed-c');
  await apply(page);
});
test('blocks unavailable storage and an ongoing JSON import before applying', async ({
  page,
  context,
}) => {
  await installed(page, context, 'storage');
  await prepare(page, context, 'storage-b');
  await page.evaluate(() => {
    const original = IDBIndex.prototype.count;
    IDBIndex.prototype.count = function () {
      IDBIndex.prototype.count = original;
      throw new DOMException('Synthetic read error', 'UnknownError');
    };
  });
  await panel(page).getByRole('button', { name: 'Installer et recharger', exact: true }).click();
  await expect(panel(page).getByRole('alert')).toContainText(
    'Le stockage local n’est pas accessible.',
  );
  await page.evaluate(() => {
    const original = File.prototype.text;
    File.prototype.text = function () {
      File.prototype.text = original;
      return new Promise((resolve) => {
        Object.assign(window, { finishTestImport: () => resolve('{}') });
      });
    };
  });
  await page.locator('input[type=file]').setInputFiles({
    name: 'test-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{}'),
  });
  await expect(
    panel(page).getByRole('button', { name: 'Installer et recharger', exact: true }),
  ).toBeDisabled();
  await page.evaluate(() => {
    (window as unknown as { finishTestImport(): void }).finishTestImport();
  });
  await expect(
    panel(page).getByRole('button', { name: 'Installer et recharger', exact: true }),
  ).toBeEnabled();
  await apply(page);
});
