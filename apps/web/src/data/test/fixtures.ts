import type { EpochMillis, ExerciseRef, LocalDate, SetId, SetState, SetType, SortKey, WorkoutExerciseId, WorkoutId } from '@freeforever/data';
import type { CompletedSession } from '../../features/workout/model/history';
import type { DraftExercise, DraftSet } from '../../features/workout/model/types';

/**
 * Three consecutive days of training, with every number chosen so the expected
 * output can be worked out by hand and written into the assertions as a constant.
 *
 * Two lifts so the per-exercise fold has something to separate; a warmup so volume
 * has something to exclude; a failed set so `failedSetCount` has something to count
 * and the record fold has a heavy set it must refuse.
 */

export const BENCH: ExerciseRef = {
  source: 'catalogue',
  exerciseId: 'bench-press' as ExerciseRef['exerciseId'],
  name: 'Barbell bench press',
  loadKind: 'external',
  effortKind: 'reps',
  muscles: [
    { muscle: 'chest', fraction: 1 },
    { muscle: 'triceps', fraction: 0.5 },
  ],
  unilateral: false,
};

export const SQUAT: ExerciseRef = {
  source: 'catalogue',
  exerciseId: 'back-squat' as ExerciseRef['exerciseId'],
  name: 'Back squat',
  loadKind: 'external',
  effortKind: 'reps',
  muscles: [
    { muscle: 'quads', fraction: 1 },
    { muscle: 'glutes', fraction: 0.5 },
  ],
  unilateral: false,
};

let sortCounter = 0;

function set(
  id: string,
  type: SetType,
  state: SetState,
  weightKg: number,
  reps: number,
  performedAt: number,
): DraftSet {
  sortCounter += 1;
  return {
    id: id as SetId,
    sortKey: `a${sortCounter}` as SortKey,
    type,
    state,
    loadKind: 'external',
    effortKind: 'reps',
    weightKg,
    reps,
    durationSec: null,
    distanceM: null,
    performedAt: performedAt as EpochMillis,
  };
}

function exercise(id: string, ref: ExerciseRef, sets: readonly DraftSet[]): DraftExercise {
  return { id: id as WorkoutExerciseId, sortKey: 'a0' as SortKey, exercise: ref, sets };
}

const DAY_MS = 86_400_000;
/** 2026-08-10T18:00:00Z. A Monday. */
const S1_START = 1_786_384_800_000;

export const SESSION_1: CompletedSession = {
  id: 'w1' as WorkoutId,
  localDate: '2026-08-10' as LocalDate,
  startedAt: S1_START,
  endedAt: S1_START + 3600_000,
  exercises: [
    exercise('e1', BENCH, [
      set('s1', 'warmup', 'completed', 40, 10, S1_START + 60_000),
      set('s2', 'working', 'completed', 100, 5, S1_START + 300_000),
      set('s3', 'working', 'completed', 100, 5, S1_START + 600_000),
    ]),
  ],
};

export const SESSION_2: CompletedSession = {
  id: 'w2' as WorkoutId,
  localDate: '2026-08-11' as LocalDate,
  startedAt: S1_START + DAY_MS,
  endedAt: S1_START + DAY_MS + 1800_000,
  exercises: [
    exercise('e2', SQUAT, [
      set('s4', 'working', 'completed', 140, 5, S1_START + DAY_MS + 300_000),
      set('s5', 'working', 'completed', 140, 5, S1_START + DAY_MS + 600_000),
    ]),
  ],
};

export const SESSION_3: CompletedSession = {
  id: 'w3' as WorkoutId,
  localDate: '2026-08-12' as LocalDate,
  startedAt: S1_START + 2 * DAY_MS,
  endedAt: S1_START + 2 * DAY_MS + 2700_000,
  exercises: [
    exercise('e3', BENCH, [
      set('s6', 'working', 'completed', 105, 5, S1_START + 2 * DAY_MS + 300_000),
      set('s7', 'working', 'completed', 105, 3, S1_START + 2 * DAY_MS + 600_000),
      // Heavier than anything completed, and missed. Counts as volume, never a record.
      set('s8', 'working', 'failed', 110, 1, S1_START + 2 * DAY_MS + 900_000),
    ]),
  ],
};

export const SESSIONS: readonly CompletedSession[] = [SESSION_1, SESSION_2, SESSION_3];

/** What `workoutStore.ts` actually writes: a `{ v: 1, data }` envelope. */
export function historyBlob(sessions: readonly CompletedSession[] = SESSIONS): string {
  return JSON.stringify({ v: 1, data: sessions });
}

/** A `Storage` good enough for the store under test, and for the events it emits. */
export function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => {
      map.delete(key);
    },
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}
