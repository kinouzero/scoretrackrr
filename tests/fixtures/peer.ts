import { waitForOfflineReady } from './offline';
import {
  test as base,
  expect,
  chromium,
  webkit,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';

export interface PeerOptions {
  peerBrowserName?: 'chromium' | 'webkit';
}
export const test = base.extend<PeerOptions & { peerBrowser: Browser }>({
  peerBrowserName: [undefined, { option: true }],
  peerBrowser: async ({ browser, peerBrowserName }, use) => {
    if (!peerBrowserName || browser.browserType().name() === peerBrowserName) {
      await use(browser);
      return;
    }
    const peer = await { chromium, webkit }[peerBrowserName].launch();
    try {
      await use(peer);
    } finally {
      await peer.close();
    }
  },
});

export async function pairPeer(
  hostPage: Page,
  browser: Browser,
  baseURL: string,
  player = 'Bob',
  role = 'scorer',
) {
  const host = hostPage.locator('details.sharing');
  await host.getByText('Partager la partie en Wi-Fi local', { exact: true }).click();
  await host.getByRole('button', { name: 'Créer une offre de lecture', exact: true }).click();
  const slot = host.getByRole('region', { name: 'Lecteur 1', exact: true });
  await expect(slot.getByLabel('Offre de jumelage', { exact: true })).not.toHaveValue('', {
    timeout: 12000,
  });
  const context = await browser.newContext({ baseURL });
  const peer = await context.newPage();
  await peer.goto('/');
  await waitForOfflineReady(peer);
  await disableHttp(context);
  await peer.goto('/matches/');
  const viewer = peer.locator('details.sharing');
  await viewer.getByText('Rejoindre une partie en Wi-Fi local', { exact: true }).click();
  await viewer
    .getByLabel('Offre de jumelage', { exact: true })
    .fill(await slot.getByLabel('Offre de jumelage', { exact: true }).inputValue());
  await viewer.getByRole('button', { name: 'Créer ma réponse', exact: true }).click();
  await expect(viewer.getByLabel('Réponse de jumelage', { exact: true })).not.toHaveValue('', {
    timeout: 12000,
  });
  await slot
    .getByLabel('Réponse de jumelage', { exact: true })
    .fill(await viewer.getByLabel('Réponse de jumelage', { exact: true }).inputValue());
  await slot.getByRole('button', { name: 'Connecter ce lecteur', exact: true }).click();
  await expect(
    viewer.getByRole('heading', { name: 'Scores reçus de l’organisateur', exact: true }),
  ).toBeVisible();
  await slot
    .getByLabel('Joueur associé à ce lecteur', { exact: true })
    .selectOption({ label: player });
  await slot.getByLabel('Droits de ce lecteur', { exact: true }).selectOption(role);
  await slot.getByRole('button', { name: 'Appliquer les droits', exact: true }).click();
  await expect(
    viewer.getByRole('heading', { name: 'Journal rejoué sur cet appareil', exact: true }),
  ).toBeVisible();
  return { peer, context, viewer, slot };
}
export async function createProfiles(page: Page, names = ['Alice', 'Bob']) {
  await page.goto('/players/');
  for (const name of names) {
    await page.getByRole('button', { name: 'Ajouter un joueur' }).click();
    await page.getByLabel('Pseudonyme').fill(name);
    await page.getByRole('button', { name: 'Enregistrer le profil' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  }
}

// WebKit intercepts routed navigations before the worker. A per-context server
// failure preserves native worker handling and leaves WebRTC's LAN untouched.
export async function disableHttp(context: BrowserContext) {
  await context.setExtraHTTPHeaders({ 'X-Scoretrackrr-Test-Offline': '1' });
}
