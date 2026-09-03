import { registerSW } from 'virtual:pwa-register';

/**
 * One registration, and a reload this app actually performs.
 *
 * Reported: "Check for Updates says everything is latest. Go to Train, pull to refresh,
 * and it says a new update is available. Click Update and it hangs. Kill the app, come
 * back to More, and there is an Install button — that one works."
 *
 * Three separate bugs, all of them ours, all of them visible only on a device.
 *
 * ## 1. `updateServiceWorker(true)` does not reload. The argument is ignored.
 *
 * The generated helper is, verbatim:
 *
 *     const updateServiceWorker = async (_reloadPage = true) => {
 *       await registerPromise
 *       if (!auto) sendSkipWaitingMessage?.()
 *     }
 *
 * The parameter is underscore-prefixed and unused. It only posts SKIP_WAITING. The
 * reload comes from somewhere else entirely — a `controlling` listener attached inside
 * the library's `showSkipWaitingPrompt`, and only when `event.isUpdate` is true. We
 * passed `true` believing it meant "and reload". It never did.
 *
 * ## 2. Two components each registered their own worker.
 *
 * `useRegisterSW()` calls `registerSW()` once per call, and each call constructs its own
 * `Workbox`. `UpdatePrompt` and `AppUpdateSection` both called it, so there were two
 * instances over one registration — and `sendSkipWaitingMessage` is assigned, and the
 * reload listener attached, only on whichever instance observed the `waiting` event.
 * The other one's button called `sendSkipWaitingMessage?.()` on `undefined`: optional
 * chaining, so no error, no message, no reload. A button that silently does nothing.
 *
 * That is the "hangs, then works after a restart" shape exactly — after a restart the
 * surviving waiting worker is seen by whichever instance mounts, and that one's button
 * is the live one.
 *
 * ## 3. `registration.update()` resolves before the new worker has installed.
 *
 * It resolves once the *check* is done and the new worker has begun installing, so
 * reading `registration.waiting` straight afterwards usually finds `null` while the
 * worker is still in `installing`. That is why Check said "latest" and a plain reload a
 * minute later disagreed.
 *
 * ## What this module does instead
 *
 * Registers once, at module scope. Owns the reload rather than hoping the library does
 * it: SKIP_WAITING goes to `registration.waiting` directly — the generated worker
 * handles that message — then we wait for `controllerchange` and reload ourselves, with
 * a timeout that reloads anyway. A stuck update must not be an app that sits there.
 */

/** How long to wait for the new worker to take control before reloading regardless. */
const CONTROL_TIMEOUT_MS = 3_000;
/** How long to wait for a newly-found worker to finish installing during a check. */
const INSTALL_TIMEOUT_MS = 20_000;

export type CheckResult = 'ready' | 'uptodate' | 'unsupported';

let updateReady = false;
let registration: ServiceWorkerRegistration | undefined;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function markReady(): void {
  if (updateReady) return;
  updateReady = true;
  emit();
}

/**
 * Registered here rather than in a component, so there is exactly one however many
 * places read the state. `immediate` because the app shell is already mounted by the
 * time this module is imported.
 */
if (typeof window !== 'undefined') {
  registerSW({
    immediate: true,
    onNeedRefresh: markReady,
    onRegisteredSW(_url, r) {
      registration = r;
      // The library fires `onNeedRefresh` from a `waiting` event. A worker that was
      // already waiting when this page loaded may have fired it before we subscribed,
      // so the registration is also inspected directly.
      if (r?.waiting) markReady();
    },
  });
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isUpdateReady(): boolean {
  return updateReady;
}

/** Dismiss the banner without installing. The worker stays waiting. */
export function dismissUpdate(): void {
  updateReady = false;
  emit();
}

async function currentRegistration(): Promise<ServiceWorkerRegistration | undefined> {
  // Test the VALUE, not the key. `'serviceWorker' in navigator` is true when the
  // property exists holding undefined, which is what a non-secure or locked-down
  // context presents — and the guard then walks straight into a TypeError.
  const container = navigator.serviceWorker as ServiceWorkerContainer | undefined;
  if (container === undefined) return undefined;
  return registration ?? (await container.getRegistration()) ?? undefined;
}

/** Resolve once `worker` leaves `installing`, or the timeout expires. */
function settled(worker: ServiceWorker): Promise<void> {
  if (worker.state !== 'installing') return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(finish, INSTALL_TIMEOUT_MS);
    function finish(): void {
      clearTimeout(timer);
      worker.removeEventListener('statechange', onChange);
      resolve();
    }
    function onChange(): void {
      if (worker.state !== 'installing') finish();
    }
    worker.addEventListener('statechange', onChange);
  });
}

/**
 * Ask the server now, and do not answer until the answer is knowable.
 *
 * The waiting-worker check happens *after* any newly-found worker has finished
 * installing. Reading it straight after `update()` is what made this lie.
 */
export async function checkForUpdate(): Promise<CheckResult> {
  let reg: ServiceWorkerRegistration | undefined;
  try {
    reg = await currentRegistration();
  } catch {
    // Registration lookup throws outright on a non-secure origin or with site data
    // blocked. Saying so beats leaving the status on "Checking…" forever.
    return 'unsupported';
  }
  if (reg === undefined) return 'unsupported';

  try {
    await reg.update();
  } catch {
    // Offline, or the server is unreachable. Not an error worth a scary message: the
    // installed app is fine, we simply could not ask.
    return updateReady || reg.waiting !== null ? 'ready' : 'uptodate';
  }

  const pending = reg.installing;
  if (pending !== null) await settled(pending);

  if (reg.waiting !== null) {
    markReady();
    return 'ready';
  }
  return updateReady ? 'ready' : 'uptodate';
}

/**
 * Install the waiting worker and reload — ourselves, not by asking nicely.
 *
 * `controllerchange` fires when the new worker takes control. The timeout is not
 * belt-and-braces: if the message is lost, or the worker was already controlling, that
 * event never comes, and the previous version of this simply sat there. Reloading is
 * safe at any moment — the draft workout is written to storage on every change.
 */
export async function installUpdate(): Promise<void> {
  const reg = await currentRegistration().catch(() => undefined);
  const waiting = reg?.waiting ?? null;

  if (waiting === null) {
    // Nothing parked. Either it already activated or there was never an update; a
    // reload is both harmless and the thing the user asked for.
    window.location.reload();
    return;
  }

  const container = navigator.serviceWorker as ServiceWorkerContainer | undefined;
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      container?.removeEventListener('controllerchange', finish);
      resolve();
    };
    container?.addEventListener('controllerchange', finish);
    setTimeout(finish, CONTROL_TIMEOUT_MS);
    // The generated worker listens for exactly this message and calls `skipWaiting`.
    waiting.postMessage({ type: 'SKIP_WAITING' });
  });

  window.location.reload();
}
