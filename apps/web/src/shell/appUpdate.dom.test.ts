import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The update path, against a fake registration that behaves like the real one.
 *
 * Every case here is a bug that shipped. None was catchable by the previous tests,
 * because those mocked the library and asserted the mock — including one that asserted
 * `updateServiceWorker` was called with `true` and passed while `true` did nothing.
 */

type Listener = () => void;

class FakeWorker extends EventTarget {
  state: ServiceWorker['state'] = 'installing';
  readonly posted: unknown[] = [];
  postMessage(data: unknown): void {
    this.posted.push(data);
  }
  settle(state: ServiceWorker['state']): void {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}

class FakeRegistration {
  installing: FakeWorker | null = null;
  waiting: FakeWorker | null = null;
  /** What `update()` should discover, if anything. */
  found: FakeWorker | null = null;
  updateCalls = 0;
  update = async (): Promise<void> => {
    this.updateCalls += 1;
    // The real `update()` resolves once the new worker has *begun* installing. It does
    // not wait for it to reach `waiting`. That gap is the whole of bug 3.
    if (this.found) this.installing = this.found;
  };
}

let registration: FakeRegistration;
let controllerListeners: Listener[];
let reloads: number;

async function loadModule() {
  vi.resetModules();
  return import('./appUpdate');
}

beforeEach(() => {
  registration = new FakeRegistration();
  controllerListeners = [];
  reloads = 0;

  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      getRegistration: async () => registration,
      addEventListener: (type: string, fn: Listener) => {
        if (type === 'controllerchange') controllerListeners.push(fn);
      },
      removeEventListener: () => undefined,
    },
  });

  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { reload: () => { reloads += 1; } },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('checking for an update', () => {
  it('asks the server rather than waiting for the browser to look', async () => {
    const { checkForUpdate } = await loadModule();
    await checkForUpdate();
    expect(registration.updateCalls).toBe(1);
  });

  it('waits for a newly-found worker to install before answering', async () => {
    /*
     * The reported bug: "Check for Updates says everything is latest, then a pull to
     * refresh says a new update is available."
     *
     * `update()` resolves while the new worker is still `installing`, so reading
     * `registration.waiting` straight afterwards finds null and the old code reported
     * "you already have the newest version" to someone who did not.
     */
    const found = new FakeWorker();
    registration.found = found;

    const { checkForUpdate } = await loadModule();
    let settled: string | null = null;
    const pending = checkForUpdate().then((r) => (settled = r));

    /*
     * Wait until `update()` has actually been called and several microtasks have
     * drained, so the function has genuinely reached the point where the old code read
     * `registration.waiting` — which is still null, because the worker is `installing`.
     *
     * An earlier version of this test advanced a single tick and asserted "not resolved
     * yet". It passed with the fix removed, because one tick was not enough to reach the
     * read at all: the test was measuring its own timing, not the behaviour.
     */
    await vi.waitFor(() => expect(registration.updateCalls).toBe(1));
    for (let i = 0; i < 20; i += 1) await Promise.resolve();

    expect(registration.waiting).toBeNull();
    expect(settled).toBeNull();

    registration.waiting = found;
    found.settle('installed');
    await pending;
    expect(settled).toBe('ready');
  });

  it('says up to date only when nothing is waiting after the install settles', async () => {
    const { checkForUpdate } = await loadModule();
    expect(await checkForUpdate()).toBe('uptodate');
  });

  it('does not hang when an install never finishes', async () => {
    // A worker stuck in `installing` must not leave the UI on "Checking…" forever.
    vi.useFakeTimers();
    const found = new FakeWorker();
    registration.found = found;

    const { checkForUpdate } = await loadModule();
    const pending = checkForUpdate();
    await vi.advanceTimersByTimeAsync(25_000);
    expect(await pending).toBe('uptodate');
  });

  it('reports unsupported rather than throwing where there is no worker', async () => {
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: undefined });
    const { checkForUpdate } = await loadModule();
    expect(await checkForUpdate()).toBe('unsupported');
  });

  it('stays calm when the update request itself fails, as it will offline', async () => {
    const { checkForUpdate } = await loadModule();
    registration.update = async () => { throw new Error('offline'); };
    expect(await checkForUpdate()).toBe('uptodate');
  });
});

describe('installing the waiting update', () => {
  it('posts SKIP_WAITING to the waiting worker, which is what the worker listens for', async () => {
    const waiting = new FakeWorker();
    waiting.state = 'installed';
    registration.waiting = waiting;

    const { installUpdate } = await loadModule();
    const pending = installUpdate();
    // `installUpdate` awaits the registration lookup first, so a single microtask tick
    // is not enough — and a half-awaited install leaks its timeout into the next test.
    await vi.waitFor(() => expect(waiting.posted).toEqual([{ type: 'SKIP_WAITING' }]));

    for (const fn of controllerListeners) fn();
    await pending;
  });

  it('performs the reload itself once the new worker takes control', async () => {
    /*
     * The reported hang. `updateServiceWorker(true)` looks like it reloads and does not:
     * the library signature is `async (_reloadPage = true)` — the argument is unused. The
     * reload lived in a `controlling` listener attached elsewhere, gated on
     * `event.isUpdate`, and on the instance that had not seen `waiting` it never ran.
     */
    const waiting = new FakeWorker();
    waiting.state = 'installed';
    registration.waiting = waiting;

    const { installUpdate } = await loadModule();
    const pending = installUpdate();
    await vi.waitFor(() => expect(controllerListeners.length).toBeGreaterThan(0));
    // Nothing has reloaded yet: the swap has been asked for, not observed.
    expect(reloads).toBe(0);

    for (const fn of controllerListeners) fn();
    await pending;
    expect(reloads).toBe(1);
  });

  it('reloads anyway when the swap is never confirmed', async () => {
    // If the message is lost, or the worker was already controlling, `controllerchange`
    // never fires. The old code sat there. A stuck update must not be a stuck app.
    vi.useFakeTimers();
    const waiting = new FakeWorker();
    waiting.state = 'installed';
    registration.waiting = waiting;

    const { installUpdate } = await loadModule();
    const pending = installUpdate();
    await vi.advanceTimersByTimeAsync(5_000);
    await pending;
    expect(reloads).toBe(1);
  });

  it('still reloads when nothing is waiting, because that is what was asked for', async () => {
    const { installUpdate } = await loadModule();
    await installUpdate();
    expect(reloads).toBe(1);
  });
});

describe('the store', () => {
  it('tells subscribers once an update is ready', async () => {
    const found = new FakeWorker();
    registration.found = found;

    const { checkForUpdate, isUpdateReady, subscribe } = await loadModule();
    expect(isUpdateReady()).toBe(false);

    let notified = 0;
    subscribe(() => { notified += 1; });

    const pending = checkForUpdate();
    registration.waiting = found;
    found.settle('installed');
    await pending;

    expect(isUpdateReady()).toBe(true);
    expect(notified).toBeGreaterThan(0);
  });

  it('lets the banner be dismissed without losing the waiting worker', async () => {
    const found = new FakeWorker();
    registration.found = found;
    const { checkForUpdate, dismissUpdate, isUpdateReady } = await loadModule();

    const pending = checkForUpdate();
    registration.waiting = found;
    found.settle('installed');
    await pending;
    expect(isUpdateReady()).toBe(true);

    dismissUpdate();
    expect(isUpdateReady()).toBe(false);
    // Dismissing is a UI choice, not an uninstall: the worker is still parked, so a
    // later check finds it again rather than reporting the app is current.
    expect(registration.waiting).not.toBeNull();
    expect(await checkForUpdate()).toBe('ready');
  });
});
