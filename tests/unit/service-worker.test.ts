import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const environment = vi.hoisted(() => ({ scope: {} as Record<string, unknown> }));
vi.mock('$app/service-worker', () => ({ self: environment.scope }));
type Handler = (event: Record<string, unknown>) => void;
let handlers: Map<string, Handler>;
let caches: Map<string, Map<string, Response>>;
let addAll: ReturnType<typeof vi.fn>;
let claim: ReturnType<typeof vi.fn>;
let skipWaiting: ReturnType<typeof vi.fn>;
let matchAll: ReturnType<typeof vi.fn>;
let fetcher: ReturnType<typeof vi.fn>;
const current = 'scoretrackrr-shell-unit-current';
const origin = 'https://scoretrackrr.example';
const workerPath = new URL('../../src/service-worker/index.ts', import.meta.url).pathname;

beforeEach(async () => {
  vi.resetModules();
  handlers = new Map();
  caches = new Map();
  addAll = vi.fn().mockResolvedValue(undefined);
  claim = vi.fn().mockResolvedValue(undefined);
  skipWaiting = vi.fn().mockResolvedValue(undefined);
  matchAll = vi.fn().mockResolvedValue([{ id: 'settings-client' }]);
  fetcher = vi.fn().mockResolvedValue(new Response('network'));
  Object.assign(environment.scope, {
    location: { origin },
    registration: { waiting: {} },
    clients: { claim, matchAll },
    skipWaiting,
    addEventListener: (name: string, handler: Handler) => handlers.set(name, handler),
  });
  vi.stubGlobal('fetch', fetcher);
  vi.stubGlobal('caches', {
    has: async (name: string) => caches.has(name),
    keys: async () => [...caches.keys()],
    delete: async (name: string) => caches.delete(name),
    open: async (name: string) => {
      if (!caches.has(name)) caches.set(name, new Map());
      return { addAll, match: async (path: string) => caches.get(name)!.get(path) };
    },
  });
  await import(workerPath);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function lifetime(type: string, event: Record<string, unknown> = {}) {
  let result: Promise<unknown> | undefined;
  handlers.get(type)!({
    ...event,
    waitUntil: (promise: Promise<unknown>) => {
      result = promise;
    },
  });
  return result;
}
function request(path: string, method = 'GET') {
  let response: Promise<Response> | undefined;
  handlers.get('fetch')!({
    request: new Request(path.startsWith('http') ? path : origin + path, { method }),
    respondWith: (promise: Promise<Response>) => {
      response = promise;
    },
  });
  return response;
}
function update(
  source: unknown = { id: 'settings-client', url: origin + '/settings/' },
  pathname?: unknown,
) {
  const postMessage = vi.fn();
  const close = vi.fn();
  const result = lifetime('message', {
    data: { type: 'SCORETRACKRR_APPLY_UPDATE', pathname },
    source,
    ports: [{ postMessage, close }],
  });
  return { result, postMessage, close };
}

it('precaches the complete shell without forcing activation', async () => {
  await lifetime('install');
  expect(addAll).toHaveBeenCalledWith([
    '/icons/icon.svg',
    '/_app/immutable/game.js',
    '/',
    '/games/',
  ]);
  expect(skipWaiting).not.toHaveBeenCalled();
});
it.each([false, true])(
  'preserves an existing shell after failed installation (existed=%s)',
  async (existed) => {
    if (existed) caches.set(current, new Map());
    addAll.mockRejectedValue(new Error('download failed'));
    await expect(lifetime('install')).rejects.toThrow('download failed');
    expect(caches.has(current)).toBe(existed);
  },
);
it('retains two prior shells and leaves unrelated caches intact', async () => {
  for (const name of [
    'unrelated',
    'scoretrackrr-shell-old1',
    'scoretrackrr-shell-old2',
    'scoretrackrr-shell-old3',
    current,
  ])
    caches.set(name, new Map());
  await lifetime('activate');
  expect([...caches.keys()]).toEqual([
    'unrelated',
    'scoretrackrr-shell-old2',
    'scoretrackrr-shell-old3',
    current,
  ]);
  expect(claim).toHaveBeenCalledOnce();
});
it.each([
  ['/unknown/', 'GET'],
  ['/games/', 'POST'],
  ['https://other.example/games/', 'GET'],
])('does not intercept unrelated requests %s/%s', (path, method) => {
  expect(request(path!, method)).toBeUndefined();
  expect(fetcher).not.toHaveBeenCalled();
});
it('uses a cached known page and falls back to the network when absent', async () => {
  caches.set(current, new Map([['/games/', new Response('offline page')]]));
  expect(await (await request('/games/'))!.text()).toBe('offline page');
  expect(fetcher).not.toHaveBeenCalled();
  expect(await (await request('/'))!.text()).toBe('network');
});
it('finds old immutable chunks without replacing the current shell', async () => {
  caches.set(
    'scoretrackrr-shell-old',
    new Map([['/_app/immutable/previous.js', new Response('old chunk')]]),
  );
  caches.set('unrelated', new Map());
  expect(await (await request('/_app/immutable/previous.js'))!.text()).toBe('old chunk');
  expect(await (await request('/_app/immutable/missing.js'))!.text()).toBe('network');
});
it.each([null, {}, { type: 'UNKNOWN' }])('ignores unrecognized messages %j', (data) => {
  expect(lifetime('message', { data, ports: [] })).toBeUndefined();
  expect(skipWaiting).not.toHaveBeenCalled();
});
it('requires a response port', () => {
  expect(
    lifetime('message', { data: { type: 'SCORETRACKRR_APPLY_UPDATE' }, ports: [] }),
  ).toBeUndefined();
});
it.each([
  null,
  {},
  { id: 'settings-client', url: 'https://other.example/settings/' },
  { id: 'settings-client', url: 'not a URL' },
])('refuses activation from an invalid client %j', async (source) => {
  const action = update(source);
  await action.result;
  expect(action.postMessage).toHaveBeenCalledWith({
    type: 'SCORETRACKRR_UPDATE_RESULT',
    status: 'unavailable',
  });
  expect(skipWaiting).not.toHaveBeenCalled();
});
it('refuses activation when no worker is waiting', async () => {
  environment.scope.registration = { waiting: null };
  const action = update();
  await action.result;
  expect(action.postMessage).toHaveBeenCalledWith(
    expect.objectContaining({ status: 'unavailable' }),
  );
});
it.each([[{ id: 'settings-client' }, { id: 'other-client' }], [{ id: 'other-client' }], []])(
  'refuses activation unless Settings is the sole client (%j)',
  async (...clients) => {
    matchAll.mockResolvedValue(clients);
    const action = update();
    await action.result;
    expect(action.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'otherTabs' }),
    );
    expect(skipWaiting).not.toHaveBeenCalled();
  },
);
it.each([
  ['/settings', undefined],
  ['/', undefined],
  ['/', '/settings/'],
])('acknowledges an explicit sole Settings client (entry=%s, route=%s)', async (entry, route) => {
  const action = update({ id: 'settings-client', url: origin + entry }, route);
  await action.result;
  expect(action.postMessage).toHaveBeenCalledWith({
    type: 'SCORETRACKRR_UPDATE_RESULT',
    status: 'accepted',
  });
  expect(skipWaiting).toHaveBeenCalledOnce();
  expect(action.close).toHaveBeenCalledOnce();
});
it.each([
  [origin + '/settings/', '/games/'],
  [origin + '/settings/', null],
  ['https://other.example/', '/settings/'],
])('refuses an invalid sender or current route (entry=%s, route=%s)', async (url, route) => {
  const action = update({ id: 'settings-client', url }, route);
  await action.result;
  expect(action.postMessage).toHaveBeenCalledWith(
    expect.objectContaining({ status: 'unavailable' }),
  );
  expect(skipWaiting).not.toHaveBeenCalled();
});
it('reports an unavailable update after a browser client-query failure', async () => {
  matchAll.mockRejectedValue(new Error('browser unavailable'));
  const action = update();
  await action.result;
  expect(action.postMessage).toHaveBeenCalledWith(
    expect.objectContaining({ status: 'unavailable' }),
  );
});
