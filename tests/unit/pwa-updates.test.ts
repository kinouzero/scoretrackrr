import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { PwaUpdates } from '../../src/lib/application/pwa-updates';
class Worker extends EventTarget {
  state: ServiceWorkerState = 'installed';
  postMessage = vi.fn();
  change(state: ServiceWorkerState) {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}
const tick = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
let updates: PwaUpdates;
let stop: () => void;
let registration: EventTarget & {
  waiting?: Worker;
  installing?: Worker;
  update: ReturnType<typeof vi.fn>;
};
let container: EventTarget & { controller?: Worker; ready: Promise<unknown> };
let browserWindow: EventTarget & {
  location: { pathname: string; reload: ReturnType<typeof vi.fn> };
};
let browserDocument: EventTarget & { visibilityState: string };
let browserNavigator: { serviceWorker?: unknown; onLine: boolean };
beforeEach(async () => {
  registration = Object.assign(new EventTarget(), { update: vi.fn().mockResolvedValue(undefined) });
  container = Object.assign(new EventTarget(), {
    controller: new Worker(),
    ready: Promise.resolve(registration),
  });
  browserWindow = Object.assign(new EventTarget(), {
    location: { pathname: '/settings/', reload: vi.fn() },
  });
  browserDocument = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  browserNavigator = { serviceWorker: container, onLine: true };
  vi.stubGlobal('window', browserWindow);
  vi.stubGlobal('document', browserDocument);
  vi.stubGlobal('navigator', browserNavigator);
  updates = new PwaUpdates();
  stop = updates.start();
  await tick();
});
afterEach(() => {
  stop();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it('checks once at startup without treating the first installation as an available update', () => {
  expect(registration.update).toHaveBeenCalledTimes(1);
  expect(get(updates)).toMatchObject({ supported: true, checked: true, waiting: false });
  expect(browserWindow.location.reload).not.toHaveBeenCalled();
});
it('detects a worker already waiting and can defer its notice', async () => {
  registration.waiting = new Worker();
  await updates.check();
  expect(get(updates).waiting).toBe(true);
  updates.dismiss();
  expect(get(updates).dismissed).toBe(true);
  await updates.check();
  expect(get(updates).dismissed).toBe(true);
  registration.waiting = new Worker();
  await updates.check();
  expect(get(updates).dismissed).toBe(false);
});
it('follows an installing worker until fully downloaded', async () => {
  const worker = new Worker();
  worker.state = 'installing';
  registration.installing = worker;
  registration.dispatchEvent(new Event('updatefound'));
  const check = updates.check();
  await tick();
  expect(get(updates).checking).toBe(true);
  expect(get(updates).waiting).toBe(false);
  registration.waiting = worker;
  registration.installing = undefined;
  worker.change('installed');
  await check;
  expect(get(updates)).toMatchObject({ checking: false, waiting: true });
});
it('reports failed installs without losing the current controller', async () => {
  const original = container.controller;
  const worker = new Worker();
  worker.state = 'installing';
  registration.installing = worker;
  registration.dispatchEvent(new Event('updatefound'));
  const check = updates.check();
  await tick();
  worker.change('redundant');
  await check;
  expect(get(updates)).toMatchObject({ error: 'checkFailed', waiting: false });
  expect(container.controller).toBe(original);
});
it('handles offline checking and retries network failures', async () => {
  browserNavigator.onLine = false;
  await updates.check();
  expect(get(updates).error).toBe('offline');
  browserNavigator.onLine = true;
  registration.update.mockRejectedValueOnce(new TypeError('Offline'));
  await updates.check();
  expect(get(updates).error).toBe('checkFailed');
  await updates.check();
  expect(get(updates)).toMatchObject({ error: '', checked: true });
});
it('does not reload on a controller change without explicit approval', () => {
  container.controller = new Worker();
  container.dispatchEvent(new Event('controllerchange'));
  expect(browserWindow.location.reload).not.toHaveBeenCalled();
});
it('rejects application from outside Settings', async () => {
  const worker = new Worker();
  registration.waiting = worker;
  await updates.check();
  browserWindow.location.pathname = '/matches/';
  updates.apply();
  expect(get(updates).error).toBe('activationFailed');
  expect(worker.postMessage).not.toHaveBeenCalled();
});
it('handles another open window and allows retry', async () => {
  const worker = new Worker();
  registration.waiting = worker;
  await updates.check();
  worker.postMessage.mockImplementation((_message, ports: MessagePort[]) => {
    ports[0]?.postMessage({ type: 'SCORETRACKRR_UPDATE_RESULT', status: 'otherTabs' });
  });
  updates.apply();
  await vi.waitFor(() =>
    expect(get(updates)).toMatchObject({ error: 'otherTabs', applying: false }),
  );
  expect(browserWindow.location.reload).not.toHaveBeenCalled();
});
it('reloads exactly once after accepting the expected new controller', async () => {
  const worker = new Worker();
  registration.waiting = worker;
  await updates.check();
  worker.postMessage.mockImplementation((_message, ports: MessagePort[]) => {
    ports[0]?.postMessage({ type: 'SCORETRACKRR_UPDATE_RESULT', status: 'accepted' });
  });
  updates.apply();
  updates.apply();
  expect(worker.postMessage).toHaveBeenCalledTimes(1);
  await vi.waitFor(() => expect(get(updates).applying).toBe(true));
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(browserWindow.location.reload).not.toHaveBeenCalled();
  container.controller = worker;
  container.dispatchEvent(new Event('controllerchange'));
  container.dispatchEvent(new Event('controllerchange'));
  expect(browserWindow.location.reload).toHaveBeenCalledTimes(1);
});
it('times out a stalled activation without reloading', async () => {
  vi.useFakeTimers();
  registration.waiting = new Worker();
  await updates.check();
  updates.apply();
  await vi.advanceTimersByTimeAsync(15_000);
  expect(get(updates)).toMatchObject({ applying: false, error: 'activationFailed' });
  expect(browserWindow.location.reload).not.toHaveBeenCalled();
});
it('times out stalled checks and allows retry', async () => {
  vi.useFakeTimers();
  registration.update.mockReturnValueOnce(new Promise(() => {}));
  const check = updates.check();
  await vi.advanceTimersByTimeAsync(30_000);
  await check;
  expect(get(updates)).toMatchObject({ checking: false, error: 'checkFailed' });
  await updates.check();
  expect(get(updates).error).toBe('');
});
it('throttles foreground checks and cleans up listeners and timers', async () => {
  vi.useFakeTimers();
  registration.update.mockClear();
  browserWindow.dispatchEvent(new Event('online'));
  await tick();
  expect(registration.update).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(60_000);
  browserDocument.dispatchEvent(new Event('visibilitychange'));
  await tick();
  expect(registration.update).toHaveBeenCalledTimes(1);
  stop();
  registration.update.mockClear();
  await vi.advanceTimersByTimeAsync(15 * 60_000);
  browserWindow.dispatchEvent(new Event('online'));
  await tick();
  expect(registration.update).not.toHaveBeenCalled();
});

it('cancels an in-flight check when disposed without mutating the next lifecycle', async () => {
  vi.useFakeTimers();
  let finish: () => void = () => {};
  registration.update.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  const pending = updates.check();
  await tick();
  expect(get(updates).checking).toBe(true);
  stop();
  expect(get(updates).checking).toBe(false);
  finish();
  await pending;
  expect(get(updates).supported).toBe(false);
});

it('ignores a disposed check after a new lifecycle has completed its own check', async () => {
  let finish: () => void = () => {};
  registration.update.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  const old = updates.check();
  await tick();
  const previousStop = stop;
  previousStop();
  stop = updates.start();
  await tick();
  expect(get(updates)).toMatchObject({
    supported: true,
    checking: false,
    checked: true,
    error: '',
  });
  previousStop();
  finish();
  await old;
  expect(get(updates)).toMatchObject({
    supported: true,
    checking: false,
    checked: true,
    error: '',
  });
});
