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
 * "First time" means no key this app has ever written is present — under either
 * of the two prefix conventions in use; see `APP_KEY`. Detected from storage
 * rather than a flag of its own, so clearing site data genuinely resets it and a
 * fresh install of the PWA behaves like a fresh install.
 *
 * Reading localStorage can throw outright — Safari in private mode, and any
 * browser with site data blocked — so a failure is treated as "not first run".
 * Sending someone to an explainer because their browser is locked down would be
 * a strange way to greet them.
 */
/**
 * Both separators, deliberately. The teams settled on different conventions —
 * workout writes `ff.workout.history.v1`, nutrition writes `ff:nutrition:v1`,
 * and the insights change-stamp is `ff:localdata` — so a prefix of `ff.` alone
 * could not see two of the three. Someone who had only ever logged food was
 * therefore greeted as a brand-new user on every launch, forever.
 *
 * The fix belongs here rather than in the key names: renaming a storage key
 * orphans the data already under the old one, and a returning user losing their
 * food log is far worse than an inconsistent prefix. This detector is the thing
 * that has to be tolerant.
 */
const APP_KEY = /^ff[.:]/u;

export function hasUsedTheAppBefore(storage: Storage | null = safeStorage()): boolean {
  if (storage === null) return true;
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key !== null && APP_KEY.test(key)) return true;
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
