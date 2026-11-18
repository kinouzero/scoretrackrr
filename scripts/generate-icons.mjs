import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const browser = await chromium.launch();
try {
  for (const [file, size, variant] of [
    ['icon-192.png', 192, 'icon.svg'],
    ['icon-512.png', 512, 'icon.svg'],
    ['favicon-16x16.png', 16, 'icon.svg'],
    ['favicon-32x32.png', 32, 'icon.svg'],
    ['apple-touch-icon.png', 180, 'icon-fullbleed.svg'],
    ['icon-maskable-192.png', 192, 'icon-maskable.svg'],
    ['icon-maskable-512.png', 512, 'icon-maskable.svg'],
  ]) {
    const source = await readFile(new URL(`../static/icons/${variant}`, import.meta.url), 'utf8');
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    await page.setContent(
      `<html><body style="margin:0;background:transparent"><img width="${size}" height="${size}" alt="" src="data:image/svg+xml;base64,${Buffer.from(source).toString('base64')}"></body></html>`,
    );
    await page.locator('img').evaluate((img) => img.decode());
    const png = await page.screenshot({ omitBackground: true });
    await writeFile(new URL(`../static/icons/${file}`, import.meta.url), png);
    await page.close();
    console.log(`Generated ${file} (${size} × ${size}).`);
  }
} finally {
  await browser.close();
}
