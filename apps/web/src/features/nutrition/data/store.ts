import { EMPTY_STATE, type NutritionState } from './types.js';

/**
 * Local-first persistence for the nutrition feature.
 *
 * Firestore is a sync engine, not a query engine (ADR-0005): reads come from
 * the device and a day view must never be a fan-out of network calls. Sync is
 * not built yet, so this module is the seam. It defines the port the feature
 * codes against and ships a working local adapter, so nutrition is complete and
 * usable standalone — which is also what ADR-0001 rule 1 asks of every feature.
 *
 * When the sync layer lands it implements `NutritionStore` and writes the
 * documents through with their envelope (`sv`, `uid`, server timestamps). No
 * screen changes, because no screen knows where the state came from.
 */

export interface NutritionStore {
  load(): NutritionState;
  save(state: NutritionState): void;
  /** Everything, as JSON. Export is unconditional and complete (ADR-0001 rule 7). */
  export(): string;
  clear(): void;
}

/** The key everything lives under. Versioned so a shape change is detectable. */
export const STORAGE_KEY = 'ff:nutrition:v1';

/** Fully in-memory. The test double, and the fallback when storage is blocked. */
export function createMemoryStore(initial: NutritionState = EMPTY_STATE): NutritionStore {
  let state = initial;
  return {
    load: () => state,
    save: (next) => {
      state = next;
    },
    export: () => JSON.stringify(state, null, 2),
    clear: () => {
      state = EMPTY_STATE;
    },
  };
}

/**
 * Merge a loaded blob onto the empty state.
 *
 * Not a spread: a state written by an older build is missing keys a newer one
 * reads, and `undefined.length` on the recents array is a white screen on
 * launch. Every top-level key is defaulted individually, and anything
 * unrecognised is dropped rather than carried forward.
 */
export function reviveState(raw: unknown): NutritionState {
  if (typeof raw !== 'object' || raw === null) return EMPTY_STATE;
  const value = raw as Partial<NutritionState>;
  return {
    days: isRecord(value.days) ? value.days : {},
    customFoods: Array.isArray(value.customFoods) ? value.customFoods : [],
    recipes: Array.isArray(value.recipes) ? value.recipes : [],
    savedMeals: Array.isArray(value.savedMeals) ? value.savedMeals : [],
    favourites: Array.isArray(value.favourites) ? value.favourites : [],
    recents: Array.isArray(value.recents) ? value.recents : [],
    target: value.target ?? null,
    preferences: {
      energyUnit: value.preferences?.energyUnit === 'kJ' ? 'kJ' : 'kcal',
      massUnit: value.preferences?.massUnit === 'oz' ? 'oz' : 'g',
      showMicronutrients: value.preferences?.showMicronutrients !== false,
    },
  };
}

function isRecord(value: unknown): value is Record<string, never> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Backed by `localStorage`, in front of an in-memory copy.
 *
 * Storage is treated as best-effort throughout. A private window, a browser
 * with site data disabled, or a full quota all throw, and none of them may take
 * the food log down — the in-memory state stays authoritative for the session
 * and the user loses persistence, not their afternoon.
 */
export function createLocalStore(storage: Storage | null = safeLocalStorage()): NutritionStore {
  const memory = createMemoryStore(readFrom(storage));

  return {
    load: memory.load,
    save: (next) => {
      memory.save(next);
      if (storage === null) return;
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Quota exceeded or storage disabled mid-session. The session keeps
        // working from memory; persistence is what is lost, not the log.
      }
    },
    export: memory.export,
    clear: () => {
      memory.clear();
      try {
        storage?.removeItem(STORAGE_KEY);
      } catch {
        /* see above */
      }
    },
  };
}

function readFrom(storage: Storage | null): NutritionState {
  if (storage === null) return EMPTY_STATE;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    return raw === null ? EMPTY_STATE : reviveState(JSON.parse(raw));
  } catch {
    // Corrupt JSON is not recoverable and must not be a launch failure. Start
    // empty rather than crash; the alternative is an app that cannot open.
    return EMPTY_STATE;
  }
}

/** `localStorage` access throws outright in some privacy modes, not just on write. */
export function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
