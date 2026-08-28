import type { CompletedSession } from '../model/history.js';
import type { RestTimerState } from '../timer/restTimer.js';
import type { DraftWorkout } from '../model/types.js';

/**
 * Device-local persistence for a session in progress.
 *
 * This is not the sync layer and does not want to be — Firestore's own offline
 * persistence is what eventually carries a finished session to the server, and that
 * is the sync team's file. What this covers is the gap Firestore does not: the
 * *unfinished* session, mid-edit, with half-typed numbers in it, between the moment
 * the app is killed and the moment it is reopened.
 *
 * Every operation is wrapped. `localStorage` throws rather than returns in three real
 * situations — Safari private browsing, a full quota, and an embedded webview with
 * site data disabled — and a workout screen that white-screens because the quota is
 * full has lost the session it was trying to protect. A failed save degrades to
 * in-memory state; a failed read degrades to "no session in progress".
 *
 * Keys carry a version. An unrecognised version is discarded rather than parsed,
 * because a half-understood session is worse than a missing one.
 */

const PREFIX = 'ff.workout';
const ACTIVE_KEY = `${PREFIX}.active.v1`;
const TIMER_KEY = `${PREFIX}.rest.v1`;
const HISTORY_KEY = `${PREFIX}.history.v1`;

/**
 * How many finished sessions the device keeps locally.
 *
 * Bounded because free-forever rule 2 applies to bytes as well as to requests, and
 * because everything this cache is *for* — ghosts, the last three outings, recents —
 * reads only the recent end of it. The authoritative history is the synced
 * collection, not this.
 */
export const MAX_LOCAL_HISTORY = 60;

/**
 * The port the screen talks to. One interface, so the Firestore-backed implementation
 * the sync team eventually writes drops in without the screen changing.
 */
export interface WorkoutRepository {
  loadActive(): DraftWorkout | null;
  saveActive(workout: DraftWorkout | null): void;
  loadRest(): RestTimerState | null;
  saveRest(state: RestTimerState | null): void;
  loadHistory(): CompletedSession[];
  appendHistory(session: CompletedSession): void;
}

interface Envelope<T> {
  readonly v: 1;
  readonly data: T;
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Accessing the property itself throws when site data is blocked.
    return null;
  }
}

function read<T>(key: string): T | null {
  const store = storage();
  if (store === null) return null;
  try {
    const raw = store.getItem(key);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Envelope<T> | null;
    if (parsed === null || typeof parsed !== 'object' || parsed.v !== 1) return null;
    return parsed.data;
  } catch {
    // Corrupt JSON, or a shape from a version this build does not know. Drop it
    // rather than crash the screen on the way in.
    return null;
  }
}

function write<T>(key: string, data: T | null): boolean {
  const store = storage();
  if (store === null) return false;
  try {
    if (data === null) {
      store.removeItem(key);
      return true;
    }
    store.setItem(key, JSON.stringify({ v: 1, data } satisfies Envelope<T>));
    return true;
  } catch {
    return false;
  }
}

export const localWorkoutRepository: WorkoutRepository = {
  loadActive: () => {
    const workout = read<DraftWorkout>(ACTIVE_KEY);
    // A session that was finished or discarded is not "active"; it is a leftover from
    // a write that raced a reload, and resuming it would resurrect a closed session.
    if (workout === null || workout.status !== 'in_progress') return null;
    return isPlausible(workout) ? workout : null;
  },
  saveActive: (workout) => {
    write(ACTIVE_KEY, workout);
  },

  loadRest: () => {
    const state = read<RestTimerState>(TIMER_KEY);
    if (state === null) return null;
    return typeof state.startedAt === 'number' && typeof state.durationSec === 'number'
      ? state
      : null;
  },
  saveRest: (state) => {
    write(TIMER_KEY, state);
  },

  loadHistory: () => {
    const sessions = read<CompletedSession[]>(HISTORY_KEY);
    return Array.isArray(sessions) ? sessions : [];
  },
  appendHistory: (session) => {
    const existing = read<CompletedSession[]>(HISTORY_KEY) ?? [];
    // Keyed by id so a re-finish of the same session replaces rather than duplicates.
    const merged = [...existing.filter((candidate) => candidate.id !== session.id), session]
      .sort((left, right) => left.startedAt - right.startedAt)
      .slice(-MAX_LOCAL_HISTORY);
    write(HISTORY_KEY, merged);
  },
};

/**
 * A cheap sanity check on what came back off disk.
 *
 * Not a Zod parse: the draft is not a document and has no schema, and running a full
 * validation on the critical path of opening the app to log a set buys nothing. What
 * this catches is the shape being wrong enough that rendering would throw.
 */
function isPlausible(workout: DraftWorkout): boolean {
  return (
    typeof workout.id === 'string' &&
    typeof workout.startedAt === 'number' &&
    Number.isFinite(workout.startedAt) &&
    Array.isArray(workout.exercises) &&
    workout.exercises.every((exercise) => Array.isArray(exercise.sets))
  );
}

/** An in-memory implementation, for tests and for a browser with no storage at all. */
export function memoryWorkoutRepository(): WorkoutRepository {
  let active: DraftWorkout | null = null;
  let rest: RestTimerState | null = null;
  let history: CompletedSession[] = [];

  return {
    loadActive: () => active,
    saveActive: (workout) => {
      active = workout;
    },
    loadRest: () => rest,
    saveRest: (state) => {
      rest = state;
    },
    loadHistory: () => history,
    appendHistory: (session) => {
      history = [...history.filter((candidate) => candidate.id !== session.id), session]
        .sort((left, right) => left.startedAt - right.startedAt)
        .slice(-MAX_LOCAL_HISTORY);
    },
  };
}

/** Every key this feature owns. Exported so a "delete my data" sweep can find them. */
export const WORKOUT_STORAGE_KEYS = [ACTIVE_KEY, TIMER_KEY, HISTORY_KEY] as const;
