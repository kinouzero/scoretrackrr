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
  private accepted = false;
  private expected?: ServiceWorker;
  private reloadStarted = false;
  private activationTimer?: ReturnType<typeof setTimeout>;
  private port?: MessagePort;
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
  private reloadIfReady = () => {
    if (
      !this.accepted ||
      !this.expected ||
      this.container?.controller !== this.expected ||
      this.reloadStarted
    )
      return;
    this.reloadStarted = true;
    clearTimeout(this.activationTimer);
    this.port?.close();
    window.location.reload();
  };
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
    this.container.addEventListener('controllerchange', this.reloadIfReady);
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
      clearTimeout(this.activationTimer);
      this.port?.close();
      this.container?.removeEventListener('controllerchange', this.reloadIfReady);
      window.removeEventListener('online', automatic);
      document.removeEventListener('visibilitychange', automatic);
      this.registration?.removeEventListener('updatefound', watch);
      for (const remove of watched.values()) remove();
      this.registration = undefined;
      this.container = undefined;
      this.waiting = undefined;
      this.expected = undefined;
      this.accepted = false;
      this.reloadStarted = false;
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
    const worker = this.registration?.waiting;
    if (!worker || window.location.pathname.replace(/\/$/, '') !== '/settings') {
      this.syncWaiting();
      this.set({ error: 'activationFailed' });
      return;
    }
    this.expected = worker;
    this.accepted = false;
    this.set({ applying: true, error: '' });
    const channel = new MessageChannel();
    this.port = channel.port1;
    const fail = (error: PwaUpdateError) => {
      clearTimeout(this.activationTimer);
      channel.port1.close();
      this.accepted = false;
      this.expected = undefined;
      this.set({ applying: false, error });
    };
    this.activationTimer = setTimeout(() => fail('activationFailed'), activationTimeout);
    channel.port1.onmessage = (event: MessageEvent<unknown>) => {
      const message = event.data as { type?: unknown; status?: unknown } | null;
      if (!message || message.type !== 'SCORETRACKRR_UPDATE_RESULT') return;
      if (message.status === 'otherTabs') fail('otherTabs');
      else if (message.status === 'accepted') {
        this.accepted = true;
        this.reloadIfReady();
      } else fail('activationFailed');
    };
    try {
      worker.postMessage({ type: 'SCORETRACKRR_APPLY_UPDATE' }, [channel.port2]);
    } catch {
      fail('activationFailed');
    }
  }
}
export const pwaUpdates = new PwaUpdates();
