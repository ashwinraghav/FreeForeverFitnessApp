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
 * Retracted sessions, in a key of their own rather than inline in the history array.
 *
 * The obvious design is `status: 'discarded'` on the session where it already lives.
 * It is wrong here, and the reason is a build older than this one: an old bundle knows
 * nothing about `status`, so it would read a retracted session straight back out of
 * `history` — and `data/workoutDocuments.ts` hard-codes `status: 'completed'` when it
 * maps a session for the aggregate reducers. So a workout the user deleted would not
 * merely reappear in a list, it would **re-enter their volume totals and their all-time
 * personal records**. `registerType: 'prompt'` means a user can decline an update for
 * a long time, so that is not a narrow window.
 *
 * Split into its own key, an old reader sees only live sessions and is therefore
 * *correct* rather than merely tolerable. It also never writes this key, so finishing a
 * workout on an old build loses no tombstone. And retractions stop competing with the
 * 60 live slots, which makes the two caps independent instead of one array to reason
 * about.
 *
 * This does not touch ADR-0029. That ADR is about the Firestore document under delta
 * sync, where retraction has to be an update so it propagates; splitting a localStorage
 * key changes neither what syncs nor what a tombstone means to the sync engine.
 */
const DISCARDED_KEY = `${PREFIX}.discarded.v1`;

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
 * How many retracted sessions the device remembers.
 *
 * A tombstone exists only so a future sync layer can carry the retraction to another
 * device; undo does not need it, because `discardSession` hands the session back and
 * the screen holds it for as long as the toast is up. Ten is generous for that and
 * still bounded, which is what free-forever rule 1 asks of anything per-user.
 */
export const MAX_DISCARDED_SESSIONS = 10;

/**
 * The port the screen talks to. One interface, so the Firestore-backed implementation
 * the sync team eventually writes drops in without the screen changing.
 */
export interface WorkoutRepository {
  loadActive(): DraftWorkout | null;
  saveActive(workout: DraftWorkout | null): void;
  loadRest(): RestTimerState | null;
  saveRest(state: RestTimerState | null): void;
  /** Live finished sessions, oldest first. Retracted ones are already filtered out. */
  loadHistory(): CompletedSession[];

  /**
   * One session by id, retracted ones included.
   *
   * Retracted ones are included deliberately: this is what a deep link into a session
   * that has since been deleted needs in order to say so, rather than rendering a
   * blank screen that looks like a bug.
   */
  findSession(id: string): CompletedSession | null;

  /**
   * Insert or replace one finished session, keyed by id.
   *
   * This was called `appendHistory`, and the name was actively misleading: the body
   * already filtered by id before appending, so the update primitive editing a past
   * session needs has been here the whole time. Anyone reasoning from the name would
   * conclude the store was append-only and that editing needed new machinery.
   *
   * Putting a session back also clears any tombstone for it, which is what makes undo
   * of a retraction correct rather than a session that is simultaneously present and
   * deleted.
   */
  putSession(session: CompletedSession): void;

  /**
   * Retract a session. Returns it as it was, so the caller can offer it straight back.
   *
   * A soft delete: the domain retracts rather than erases (ADR-0029), because a hard
   * delete matches no delta query and so can never reach another device.
   */
  discardSession(id: string): CompletedSession | null;
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

  loadHistory: () => liveSessions(read<CompletedSession[]>(HISTORY_KEY)),

  findSession: (id) => {
    const live = liveSessions(read<CompletedSession[]>(HISTORY_KEY)).find(
      (candidate) => candidate.id === id,
    );
    if (live !== undefined) return live;
    return sessionList(read<CompletedSession[]>(DISCARDED_KEY)).find(
      (candidate) => candidate.id === id,
    ) ?? null;
  },

  putSession: (session) => {
    write(HISTORY_KEY, mergeSession(read<CompletedSession[]>(HISTORY_KEY), session));
    // Undoing a retraction has to clear the tombstone, or the session is both present
    // and deleted and whichever key a future reader consults decides which.
    const tombstones = sessionList(read<CompletedSession[]>(DISCARDED_KEY));
    const without = tombstones.filter((candidate) => candidate.id !== session.id);
    if (without.length !== tombstones.length) write(DISCARDED_KEY, without);
  },

  discardSession: (id) => {
    const history = liveSessions(read<CompletedSession[]>(HISTORY_KEY));
    const session = history.find((candidate) => candidate.id === id);
    if (session === undefined) return null;

    write(HISTORY_KEY, history.filter((candidate) => candidate.id !== id));
    write(
      DISCARDED_KEY,
      mergeSession(read<CompletedSession[]>(DISCARDED_KEY), retracted(session)).slice(
        -MAX_DISCARDED_SESSIONS,
      ),
    );
    // The caller gets it as it was, not as a tombstone: putting this straight back is
    // what the undo toast does, and it should restore a session, not a deletion.
    return session;
  },
};

/** `status: 'discarded'` is what a retraction *is* — an update, never an erasure. */
function retracted(session: CompletedSession): CompletedSession {
  return { ...session, status: 'discarded' };
}

function sessionList(value: CompletedSession[] | null): CompletedSession[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Live sessions only.
 *
 * Retracted ones live in their own key, so this filter is belt and braces — but it is
 * the filter that keeps `data/workoutDocuments.ts` honest. That module maps a session
 * to a `Workout` with `status: 'completed'` hard-coded, and its comment explains that
 * getting it wrong empties the Progress tab rather than skewing it. Every consumer,
 * this feature's and insights', reads sessions through here, so one filter in one place
 * is what makes that assumption true.
 */
function liveSessions(value: CompletedSession[] | null): CompletedSession[] {
  return sessionList(value).filter((session) => session.status !== 'discarded');
}

/** Upsert by id, oldest first, capped. Replacing rather than appending is the point. */
function mergeSession(
  existing: CompletedSession[] | null,
  session: CompletedSession,
): CompletedSession[] {
  return [...sessionList(existing).filter((candidate) => candidate.id !== session.id), session]
    .sort((left, right) => left.startedAt - right.startedAt)
    .slice(-MAX_LOCAL_HISTORY);
}

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
  let discarded: CompletedSession[] = [];

  return {
    loadActive: () => active,
    saveActive: (workout) => {
      active = workout;
    },
    loadRest: () => rest,
    saveRest: (state) => {
      rest = state;
    },
    loadHistory: () => liveSessions(history),
    findSession: (id) =>
      liveSessions(history).find((candidate) => candidate.id === id) ??
      discarded.find((candidate) => candidate.id === id) ??
      null,
    putSession: (session) => {
      history = mergeSession(history, session);
      discarded = discarded.filter((candidate) => candidate.id !== session.id);
    },
    discardSession: (id) => {
      const session = liveSessions(history).find((candidate) => candidate.id === id);
      if (session === undefined) return null;
      history = history.filter((candidate) => candidate.id !== id);
      discarded = mergeSession(discarded, retracted(session)).slice(-MAX_DISCARDED_SESSIONS);
      return session;
    },
  };
}

/** Every key this feature owns. Exported so a "delete my data" sweep can find them. */
export const WORKOUT_STORAGE_KEYS = [ACTIVE_KEY, TIMER_KEY, HISTORY_KEY, DISCARDED_KEY] as const;
