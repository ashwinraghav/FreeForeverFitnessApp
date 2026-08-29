import type {
  EpochMillis,
  FirestoreTimestampLike,
  SetEntry,
  UserId,
  Workout,
  WorkoutExercise,
  WorkoutId,
  WorkoutTotals,
} from '@freeforever/data';
import { sessionTotals, type Effort, type PerformedSet } from '@freeforever/core';
import type { CompletedSession } from '../features/workout/model/history';
import { toPerformedSet } from '../features/workout/model/history';
import type { DraftExercise, DraftSet } from '../features/workout/model/types';

/**
 * The join between what the workout screen writes down and what the reducers read.
 *
 * The workout feature persists a `CompletedSession` — the draft shape, kept because
 * a half-filled row needs `null` and a `Workout` document has no way to say it. The
 * aggregate reducers in `@freeforever/data/sync` fold `Workout` documents. The two
 * are close relatives and not the same type, and this module is the only place that
 * knows the difference.
 *
 * Three fields the draft simply does not carry, stated here rather than defaulted
 * quietly, because each one silently zeroes something on the Progress tab:
 *
 * - **`programRef`** — `DraftWorkout` has no link back to the routine a session was
 *   started from, so `hasProgram` is always false and `plannedSessions` is always 0.
 * - **`SetEntry.target`** — `DraftSet` has no prescription slot, so
 *   `prescribedSetCount` is 0 and `prescriptionCompliance` is null for every week.
 * - **`tzOffsetMinutes`** — not recorded on a finished session. Nothing in the fold
 *   reads it (every bucket is keyed off `localDate`, which the draft does carry), so
 *   zero here changes no number.
 *
 * `title` and `totals` are likewise absent from the draft. Nothing in the fold reads
 * either — `contribution.ts` deliberately recomputes from the sets — but `totals` is
 * filled in properly from `@freeforever/core` rather than stubbed, so that a document
 * produced here is a document and not a shell with holes in it.
 */

/** No account yet: everything here is device-local and never leaves. */
const LOCAL_UID = 'local' as UserId;

function timestampOf(epochMs: number): FirestoreTimestampLike {
  return { seconds: Math.floor(epochMs / 1000), nanoseconds: 0 };
}

/**
 * A schema `SetEffort` as `@freeforever/core`'s mirrored `Effort`.
 *
 * These two unions are meant to be the same type, and under
 * `exactOptionalPropertyTypes` they are not, in exactly one member: `distance`'s
 * optional `durationSec` infers as `number | undefined` from Zod's `.optional()` and
 * is declared `durationSec?: number` in core, so a `SetEntry` is *not* assignable to
 * a `PerformedSet`. The comment in `core/src/training/types.ts` says the compiler in
 * this app catches drift between the two because the workout feature passes real
 * `SetEntry` values in — it does not: it passes `toPerformedSet` output, which is
 * core-typed on the way out, so nothing ever tried the assignment until now.
 *
 * Reported to domain-model and workout. Rebuilding the union here is the honest fix
 * from outside both packages, and it is total: every member is spelled out, so a new
 * effort kind fails to compile rather than being silently dropped.
 */
function toEffort(effort: SetEntry['effort']): Effort {
  switch (effort.kind) {
    case 'reps':
      return { kind: 'reps', reps: effort.reps };
    case 'duration':
      return { kind: 'duration', durationSec: effort.durationSec };
    case 'distance':
      return {
        kind: 'distance',
        distanceM: effort.distanceM,
        ...(effort.durationSec === undefined ? {} : { durationSec: effort.durationSec }),
      };
    case 'reps_and_duration':
      return { kind: 'reps_and_duration', reps: effort.reps, durationSec: effort.durationSec };
  }
}

/** A logged set as the pure training maths in `@freeforever/core` reads it. */
export function toPerformedEntry(set: SetEntry): PerformedSet {
  return {
    type: set.type,
    state: set.state,
    load: set.load,
    effort: toEffort(set.effort),
    ...(set.effortRating === undefined ? {} : { effortRating: set.effortRating }),
  };
}

/** A draft set, in the union shape the schema and the reducers use. */
export function toSetEntry(set: DraftSet): SetEntry {
  // `toPerformedSet` is the workout feature's own null-to-zero policy, applied at the
  // one place it is allowed to be applied. Reimplementing it here would give the
  // Progress tab a second opinion about what an unfilled row weighs.
  const performed = toPerformedSet(set);
  return {
    id: set.id,
    sortKey: set.sortKey,
    type: set.type,
    state: set.state,
    load: performed.load,
    effort: performed.effort,
    ...(set.effortRating === undefined ? {} : { effortRating: set.effortRating }),
    ...(set.restSecBefore === undefined ? {} : { restSecBefore: set.restSecBefore }),
    ...(set.performedAt === undefined ? {} : { performedAt: set.performedAt }),
    ...(set.tags === undefined ? {} : { tags: [...set.tags] }),
    ...(set.note === undefined ? {} : { note: set.note }),
  };
}

function toWorkoutExercise(exercise: DraftExercise): WorkoutExercise {
  return {
    id: exercise.id,
    sortKey: exercise.sortKey,
    exercise: exercise.exercise,
    sets: exercise.sets.map(toSetEntry),
    ...(exercise.supersetGroup === undefined ? {} : { supersetGroup: exercise.supersetGroup }),
    ...(exercise.targetRestSec === undefined ? {} : { targetRestSec: exercise.targetRestSec }),
    ...(exercise.note === undefined ? {} : { note: exercise.note }),
  };
}

/** Wall-clock length, clamped the same way `contribution.ts` clamps it. */
function durationSecOf(session: CompletedSession): number {
  if (session.endedAt === undefined) return 0;
  return Math.min(Math.max(Math.round((session.endedAt - session.startedAt) / 1000), 0), 86_400);
}

function totalsOf(session: CompletedSession, exercises: readonly WorkoutExercise[]): WorkoutTotals {
  const context =
    session.bodyweightKg === undefined ? {} : { bodyweightKg: session.bodyweightKg };
  const totals = sessionTotals(
    exercises.map((exercise) => ({
      exercise: exercise.exercise,
      sets: exercise.sets.map(toPerformedEntry),
    })),
    context,
  );
  return {
    exerciseCount: totals.exerciseCount,
    setCount: totals.setCount,
    workingSetCount: totals.workingSetCount,
    completedSetCount: totals.completedSetCount,
    failedSetCount: totals.failedSetCount,
    volumeKg: totals.volumeKg,
    volumeKgByMuscle: totals.volumeKgByMuscle,
    durationSec: durationSecOf(session),
  };
}

/**
 * One finished session as the `Workout` document the reducers expect.
 *
 * `status` is `'completed'` unconditionally: the history key holds finished sessions
 * only — `appendHistory` is called at finish — and `foldWorkout` drops anything else,
 * so getting this wrong would empty the whole tab rather than skew it.
 */
export function toWorkoutDocument(session: CompletedSession): Workout {
  const exercises = session.exercises.map(toWorkoutExercise);
  return {
    sv: 1,
    uid: LOCAL_UID,
    createdAt: timestampOf(session.startedAt),
    updatedAt: timestampOf(session.endedAt ?? session.startedAt),
    id: session.id as WorkoutId,
    status: 'completed',
    title: 'Session',
    startedAt: session.startedAt as EpochMillis,
    ...(session.endedAt === undefined ? {} : { endedAt: session.endedAt as EpochMillis }),
    localDate: session.localDate,
    tzOffsetMinutes: 0,
    exercises,
    totals: totalsOf(session, exercises),
    ...(session.bodyweightKg === undefined ? {} : { bodyweightKg: session.bodyweightKg }),
  };
}
