import { savedCustomGame } from '../fixtures/custom-games';
import { waitForOfflineReady } from '../fixtures/offline';
import { expect, test } from '../fixtures/browser';
test('restores an offline full backup into another device, retains identities and refuses conflicting changes', async ({
  page,
  context,
  browser,
}) => {
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await page.goto('/players/');
  for (const name of ['Alice', 'Bob']) {
    await page.getByRole('button', { name: 'Ajouter un joueur' }).click();
    await page.getByLabel('Pseudonyme').fill(name);
    await page.getByRole('button', { name: 'Enregistrer le profil' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  }
  await page.goto('/games/');
  await savedCustomGame(page, 'À conserver', { target: 10 });
  await page
    .getByRole('article', { name: 'À conserver', exact: true })
    .getByRole('link', { name: 'Jouer à ce jeu', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  for (const name of ['Alice', 'Bob'])
    await dialog.getByRole('checkbox', { name: `Sélectionner ${name}`, exact: true }).check();
  await expect(dialog.getByLabel('Organisateur sur cet appareil')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Créer la partie', exact: true }).click();
  await page.getByRole('button', { name: 'Démarrer la partie', exact: true }).click();
  const form = page.getByRole('form', { name: 'Enregistrer le score', exact: true });
  await form.getByLabel('Qui marque ?', { exact: true }).selectOption({ label: 'Alice' });
  await form.getByLabel('Points', { exact: true }).fill('10');
  await form.getByRole('button', { name: 'Enregistrer le score', exact: true }).click();
  await expect(page.getByText('Victoire : Alice', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Exporter cette partie et son journal', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: 'Télécharger l’archive JSON de la partie', exact: true }),
  ).toHaveCount(0);
  const matchUrl = page.url();
  await page.goto('/settings/');
  const backup = page.getByRole('region', { name: 'Sauvegarde JSON', exact: true });
  await expect(backup.getByRole('button')).toHaveCount(2);
  await expect(backup.getByRole('button', { name: /CSV/ })).toHaveCount(0);
  const downloadPromise = page.waitForEvent('download');
  await backup.getByRole('button', { name: 'Exporter en JSON', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('scoretrackrr-backup.json');
  const stream = await download.createReadStream();
  if (!stream) throw new Error('Missing JSON download');
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const json = Buffer.concat(chunks).toString('utf8');
  const data = JSON.parse(json);
  expect(data.format).toBe('scoretrackrr-backup');
  expect(data.tables.matches).toHaveLength(1);
  const other = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    locale: 'fr-FR',
  });
  try {
    const target = await other.newPage();
    await target.goto('/');
    await waitForOfflineReady(target);
    await target.goto('/games/');
    await expect(target.getByRole('article', { name: 'Pétanque', exact: true })).toBeVisible();
    await other.setOffline(true);
    await target.goto('/settings/');
    const restore = target.getByRole('region', { name: 'Sauvegarde JSON', exact: true });
    const upload = restore.getByLabel('Fichier JSON à importer', { exact: true });
    await upload.setInputFiles({
      name: 'bad.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{bad'),
    });
    await expect(restore.getByRole('alert')).toContainText('Ce fichier JSON est invalide');
    await expect(upload).toHaveValue('');
    await expect(
      restore.getByRole('button', { name: 'Importer un JSON', exact: true }),
    ).toBeEnabled();
    const chooserPromise = target.waitForEvent('filechooser');
    await restore.getByRole('button', { name: 'Importer un JSON', exact: true }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
      name: 'backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(json),
    });
    await expect(restore.getByRole('status')).toContainText('Import terminé');
    await target.goto(matchUrl);
    await expect(target.getByText('Victoire : Alice', { exact: true })).toBeVisible();
    await target.reload();
    await expect(target.getByText('Victoire : Alice', { exact: true })).toBeVisible();
    await target.goto('/settings/');
    await expect(restore.getByRole('button')).toHaveCount(2);
    await expect(restore.getByRole('button', { name: /CSV/ })).toHaveCount(0);
    await upload.setInputFiles({
      name: 'again.json',
      mimeType: 'application/json',
      buffer: Buffer.from(json),
    });
    await expect(restore.getByRole('status')).toContainText('0 enregistrement(s) ajouté(s)');
    await target.screenshot({ path: test.info().outputPath('backup-restored.png') });
    const conflict = JSON.parse(json);
    conflict.tables.players[0].displayName = 'Conflicting name';
    await upload.setInputFiles({
      name: 'conflict.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(conflict)),
    });
    await expect(restore.getByRole('alert')).toContainText('Vos données actuelles sont conservées');
    await target.goto(matchUrl);
    await expect(target.getByText('Victoire : Alice', { exact: true })).toBeVisible();
  } finally {
    await other.close();
  }
});
