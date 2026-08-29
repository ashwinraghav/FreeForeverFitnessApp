import type { LocalDate, UnitPreferences } from '@freeforever/data';
import { DEFAULT_UNIT_PREFERENCES } from '@freeforever/data';
import { localWorkoutRepository } from '../features/workout/storage/workoutStore';
import type { InsightsDataSource, InsightsSnapshot } from '../features/insights/data/ports';
import { insightsSnapshotOf } from './localAggregates';

/**
 * The `InsightsDataSource` the app actually runs on.
 *
 * `read()` is synchronous, offline and cache-backed, which is the whole contract in
 * `insights/data/ports.ts`. Under it is `localStorage` and a fold, and there is no
 * third thing.
 *
 * ## Staying fresh without a full reload
 *
 * Three mechanisms, deliberately overlapping, because each covers a case the others
 * miss:
 *
 * 1. **`read()` re-validates.** It compares a cheap stamp — the raw history string
 *    and today's date — against the one the cached snapshot was built from, and folds
 *    again only when they differ. So any render that reaches the store picks up new
 *    data, including the render that mounts the Progress tab straight after a session
 *    was finished on the Train tab. This is the one that makes correctness not depend
 *    on anybody remembering to notify. It is also what keeps `read()` referentially
 *    stable between changes, which `useSyncExternalStore` requires.
 * 2. **`storage` events.** Another tab finishing a session. The event does not fire
 *    in the tab that wrote, which is exactly why 1 and 3 exist.
 * 3. **A same-tab notification.** `notifyLocalDataChanged()` dispatches an event this
 *    store listens for; anything that writes local data can call it and the open
 *    Progress tab updates in place. The workout feature does not call it today (it is
 *    not this team's file to change), so the same-tab path is carried by 1 — reported
 *    to the integrator as a one-line addition on the finish-session path.
 *
 * `visibilitychange` is also listened to, for coming back to a backgrounded app whose
 * data was changed in an installed PWA window.
 */

/**
 * The history key, restated.
 *
 * `workoutStore.ts` exports `WORKOUT_STORAGE_KEYS` but not the individual keys, and
 * indexing into that tuple by position would break silently the day a key is added.
 * `test/insightsSource.test.ts` asserts this string is a member of the exported
 * tuple, so the copy cannot drift without a red test.
 */
export const WORKOUT_HISTORY_KEY = 'ff.workout.history.v1';

/** Fired when device-local data changed in this tab. */
export const LOCAL_DATA_CHANGED_EVENT = 'ff:localdata';

/** Tell any open reader that device-local data changed in this tab. */
export function notifyLocalDataChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(LOCAL_DATA_CHANGED_EVENT));
}

function safeStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Accessing the property itself throws when site data is blocked.
    return null;
  }
}

/** The user's own calendar day, as a `YYYY-MM-DD`. The one clock read in this file. */
export function todayLocalDate(now: Date = new Date()): LocalDate {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}` as LocalDate;
}

function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export interface LocalInsightsSourceOptions {
  /** Overridden in tests so the fold is checked against a fixed day. */
  readonly now?: () => Date;
  readonly timeZone?: string;
  readonly units?: UnitPreferences;
}

export interface LocalInsightsSource extends InsightsDataSource {
  /** Force a re-fold and notify subscribers. Only needed by tests. */
  refresh(): void;
}

export function createLocalInsightsSource(
  options: LocalInsightsSourceOptions = {},
): LocalInsightsSource {
  const now = options.now ?? (() => new Date());
  const units = options.units ?? DEFAULT_UNIT_PREFERENCES;
  const listeners = new Set<() => void>();

  let stamp: string | null = null;
  let snapshot: InsightsSnapshot | null = null;

  const rawHistory = (): string => {
    try {
      return safeStorage()?.getItem(WORKOUT_HISTORY_KEY) ?? '';
    } catch {
      return '';
    }
  };

  const fold = (): InsightsSnapshot => {
    const today = todayLocalDate(now());
    return insightsSnapshotOf({
      sessions: localWorkoutRepository.loadHistory(),
      timeZone: options.timeZone ?? deviceTimeZone(),
      today,
      units,
    });
  };

  const read = (): InsightsSnapshot => {
    const next = `${todayLocalDate(now())}|${rawHistory()}`;
    if (snapshot === null || next !== stamp) {
      stamp = next;
      snapshot = fold();
    }
    return snapshot;
  };

  const revalidate = (): void => {
    const before = snapshot;
    read();
    if (snapshot !== before) for (const listener of listeners) listener();
  };

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    if (typeof window !== 'undefined' && listeners.size === 1) {
      window.addEventListener('storage', revalidate);
      window.addEventListener(LOCAL_DATA_CHANGED_EVENT, revalidate);
      window.addEventListener('focus', revalidate);
      document.addEventListener('visibilitychange', revalidate);
    }
    return () => {
      listeners.delete(listener);
      if (typeof window !== 'undefined' && listeners.size === 0) {
        window.removeEventListener('storage', revalidate);
        window.removeEventListener(LOCAL_DATA_CHANGED_EVENT, revalidate);
        window.removeEventListener('focus', revalidate);
        document.removeEventListener('visibilitychange', revalidate);
      }
    };
  };

  return {
    read,
    subscribe,
    refresh: () => {
      stamp = null;
      revalidate();
    },
  };
}
