import { writable } from 'svelte/store';
export type PwaUpdateError = 'offline' | 'checkFailed' | 'otherTabs' | 'activationFailed';
export interface PwaUpdateState {
  supported: boolean;
  checking: boolean;
  checked: boolean;
  waiting: boolean;
  dismissed: boolean;
  applying: boolean;
  error: PwaUpdateError | '';
}
const initial: PwaUpdateState = {
  supported: false,
  checking: false,
  checked: false,
  waiting: false,
  dismissed: false,
  applying: false,
  error: '',
};
const checkInterval = 15 * 60 * 1000;
const checkTimeout = 30_000;
const activationTimeout = 15_000;

/** Observe the hosted PWA, independently of optional GitHub release metadata. */
export class PwaUpdates {
  private value = { ...initial };
  private store = writable(this.value);
  readonly subscribe = this.store.subscribe;
  private registration?: ServiceWorkerRegistration;
  private container?: ServiceWorkerContainer;
  private waiting?: ServiceWorker;
  private lastCheck = -Infinity;
  private cancelActivation?: () => void;
  private cleanup?: () => void;
  private lifecycle = 0;
  private cancelCheck?: () => void;
  private set(patch: Partial<PwaUpdateState>) {
    this.value = { ...this.value, ...patch };
    this.store.set(this.value);
  }
  dismiss() {
    this.set({ dismissed: true });
  }
  private syncWaiting() {
    const worker = this.registration?.waiting ?? undefined;
    if (worker !== this.waiting) {
      this.waiting = worker;
      this.set({ waiting: Boolean(worker), dismissed: false, ...(worker ? { error: '' } : {}) });
    }
  }
  start(): () => void {
    if (this.cleanup) return this.cleanup;
    if (!('serviceWorker' in navigator)) return () => {};
    this.container = navigator.serviceWorker;
    let disposed = false;
    const watched = new Map<ServiceWorker, () => void>();
    const watch = () => {
      this.syncWaiting();
      const worker = this.registration?.installing;
      if (!worker || watched.has(worker)) return;
      const changed = () => {
        this.syncWaiting();
        if (worker.state === 'installed') {
          // registration.waiting is updated with the worker state transition.
          queueMicrotask(() => {
            if (!disposed) this.syncWaiting();
          });
          worker.removeEventListener('statechange', changed);
          watched.delete(worker);
        } else if (worker.state === 'redundant') {
          this.set({ error: 'checkFailed', checked: false });
          worker.removeEventListener('statechange', changed);
          watched.delete(worker);
        }
      };
      worker.addEventListener('statechange', changed);
      watched.set(worker, () => worker.removeEventListener('statechange', changed));
      changed();
    };
    const automatic = () => {
      if (
        !disposed &&
        document.visibilityState === 'visible' &&
        navigator.onLine &&
        Date.now() - this.lastCheck >= 60_000
      )
        void this.check(false);
    };
    window.addEventListener('online', automatic);
    document.addEventListener('visibilitychange', automatic);
    const interval = setInterval(automatic, checkInterval);
    void this.container.ready
      .then((registration) => {
        if (disposed) return;
        this.registration = registration;
        this.set({ supported: true });
        registration.addEventListener('updatefound', watch);
        watch();
        automatic();
      })
      .catch(() => {
        if (!disposed) this.set({ error: 'checkFailed' });
      });
    this.cleanup = () => {
      if (disposed) return;
      disposed = true;
      this.lifecycle += 1;
      this.cancelCheck?.();
      clearInterval(interval);
      this.cancelActivation?.();
      window.removeEventListener('online', automatic);
      document.removeEventListener('visibilitychange', automatic);
      this.registration?.removeEventListener('updatefound', watch);
      for (const remove of watched.values()) remove();
      this.registration = undefined;
      this.container = undefined;
      this.waiting = undefined;
      this.lastCheck = -Infinity;
      this.cancelCheck = undefined;
      this.set({ ...initial });
      this.cleanup = undefined;
    };
    return this.cleanup;
  }
  async check(manual = true) {
    const registration = this.registration;
    if (!registration || this.value.checking || this.value.applying) return;
    if (!navigator.onLine) {
      if (manual) this.set({ error: 'offline' });
      return;
    }
    this.lastCheck = Date.now();
    this.set({ checking: true, checked: false, error: '' });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let remove = () => {};
    let finished = false;
    const lifecycle = this.lifecycle;
    const cancelled = new Promise<void>((resolve) => {
      this.cancelCheck = () => {
        finished = true;
        clearTimeout(timer);
        remove();
        resolve();
      };
    });
    try {
      await Promise.race([
        cancelled,
        (async () => {
          await registration.update();
          if (finished) return;
          const worker = registration.installing;
          if (!worker) return;
          await new Promise<void>((resolve, reject) => {
            const changed = () => {
              if (worker.state === 'redundant') reject(new Error('Installation failed'));
              else if (worker.state === 'installed' || worker.state === 'activated') resolve();
            };
            worker.addEventListener('statechange', changed);
            remove = () => worker.removeEventListener('statechange', changed);
            changed();
          });
        })(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Update check timed out')), checkTimeout);
        }),
      ]);
      if (lifecycle !== this.lifecycle) return;
      this.syncWaiting();
      this.set({ checked: !this.value.error });
    } catch {
      if (lifecycle === this.lifecycle)
        this.set({ error: navigator.onLine ? 'checkFailed' : 'offline' });
    } finally {
      finished = true;
      clearTimeout(timer);
      remove();
      if (lifecycle === this.lifecycle) {
        this.cancelCheck = undefined;
        this.set({ checking: false });
      }
    }
  }
  /** Call only after the Settings page has checked saved matches and pending data transfer. */
  apply() {
    if (this.value.applying) return;
    const container = this.container;
    const worker = this.registration?.waiting;
    if (!container || !worker || window.location.pathname.replace(/\/$/, '') !== '/settings') {
      this.syncWaiting();
      this.set({ error: 'activationFailed' });
      return;
    }
    const channel = new MessageChannel();
    const cleanup = () => {
      this.cancelActivation = undefined;
      clearTimeout(timer);
      container.removeEventListener('controllerchange', changed);
      worker.removeEventListener('statechange', changed);
      channel.port1.close();
    };
    const reloadIfReady = () => {
      if (this.cancelActivation !== cleanup) return false;
      if (worker.state !== 'activated' && container.controller !== worker) return false;
      cleanup();
      window.location.reload();
      return true;
    };
    const fail = (error: PwaUpdateError) => {
      if (this.cancelActivation !== cleanup) return;
      if (!reloadIfReady()) {
        cleanup();
        this.syncWaiting();
        this.set({ applying: false, error });
      }
    };
    const changed = () => {
      if (worker.state === 'redundant') fail('activationFailed');
      else reloadIfReady();
    };
    // The waiting worker can activate even if the reply or controllerchange is lost.
    this.cancelActivation = cleanup;
    container.addEventListener('controllerchange', changed);
    worker.addEventListener('statechange', changed);
    const timer = setTimeout(() => fail('activationFailed'), activationTimeout);
    channel.port1.onmessage = (event: MessageEvent<unknown>) => {
      const message = event.data as { type?: unknown; status?: unknown } | null;
      if (!message || message.type !== 'SCORETRACKRR_UPDATE_RESULT') return;
      if (message.status === 'otherTabs') fail('otherTabs');
      else if (message.status === 'accepted') reloadIfReady();
      else fail('activationFailed');
    };
    this.set({ applying: true, error: '' });
    if (this.cancelActivation !== cleanup) return;
    try {
      worker.postMessage({ type: 'SCORETRACKRR_APPLY_UPDATE' }, [channel.port2]);
    } catch {
      fail('activationFailed');
    }
  }
}
export const pwaUpdates = new PwaUpdates();
