/**
 * Where the app opens.
 *
 * Returning users land on Train, because the Phase 0 bar is a set logged in
 * under ten seconds from a cold start and a home screen in front of that trades
 * a real strength for orientation nobody needs twice.
 *
 * Someone opening it for the first time has the opposite problem: Train shows
 * "Nothing logged yet" and an Add exercise button, which says what to tap and
 * nothing about what the app is, what the other tabs do, or that there is
 * anything to pay for. They land on More instead — one screen that explains the
 * three tabs and then gets out of the way.
 *
 * "First time" means no key this app has ever written is present. Detected from
 * storage rather than a flag of its own, so clearing site data genuinely resets
 * it and a fresh install of the PWA behaves like a fresh install.
 *
 * Reading localStorage can throw outright — Safari in private mode, and any
 * browser with site data blocked — so a failure is treated as "not first run".
 * Sending someone to an explainer because their browser is locked down would be
 * a strange way to greet them.
 */
const APP_PREFIX = 'ff.';

export function hasUsedTheAppBefore(storage: Storage | null = safeStorage()): boolean {
  if (storage === null) return true;
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key !== null && key.startsWith(APP_PREFIX)) return true;
    }
    return false;
  } catch {
    return true;
  }
}

function safeStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
