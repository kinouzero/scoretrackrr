import { self } from '$app/service-worker';
import { version } from '$app/env';
import { assets, immutable, prerendered } from '$app/manifest';

const cacheName = `scoretrackrr-shell-${version}`;
const paths = [
  ...new Set(
    [...assets, ...immutable, ...prerendered].map(({ path }) => `/${path.replace(/^\//, '')}`),
  ),
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const existed = await caches.has(cacheName);
      try {
        await (await caches.open(cacheName)).addAll(paths);
      } catch (error) {
        if (!existed) await caches.delete(cacheName);
        throw error;
      }
    })(),
  );
  // Installation only downloads; activation needs closed windows or an explicit Settings request.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const previous = (await caches.keys()).filter(
        (name) => name.startsWith('scoretrackrr-shell-') && name !== cacheName,
      );
      // Retain two prior shells for an old document caught in a new-window race.
      for (const name of previous.slice(0, -2)) await caches.delete(name);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  const known = paths.includes(url.pathname);
  const immutableAsset = url.pathname.startsWith('/_app/immutable/');
  if (!known && !immutableAsset) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(cacheName);
      const current = await cache.match(url.pathname);
      if (current) return current;
      if (immutableAsset) {
        const names = (await caches.keys()).filter((name) =>
          name.startsWith('scoretrackrr-shell-'),
        );
        for (const name of names.reverse()) {
          const response = await (await caches.open(name)).match(url.pathname);
          if (response) return response;
        }
      }
      return fetch(event.request);
    })(),
  );
});

self.addEventListener('message', (event) => {
  const message = event.data as { type?: unknown } | null;
  const port = event.ports[0];
  if (!message || message.type !== 'SCORETRACKRR_APPLY_UPDATE' || !port) return;
  event.waitUntil(
    (async () => {
      const reply = (status: string) =>
        port.postMessage({ type: 'SCORETRACKRR_UPDATE_RESULT', status });
      try {
        const source = event.source;
        if (!source || !('id' in source) || !('url' in source)) {
          reply('unavailable');
          return;
        }
        const url = new URL(source.url);
        if (
          url.origin !== self.location.origin ||
          url.pathname.replace(/\/$/, '') !== '/settings' ||
          !self.registration.waiting
        ) {
          reply('unavailable');
          return;
        }
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        if (windows.length !== 1 || windows[0]?.id !== source.id) {
          reply('otherTabs');
          return;
        }
        reply('accepted');
        await self.skipWaiting();
      } catch {
        reply('unavailable');
      } finally {
        port.close();
      }
    })(),
  );
});
