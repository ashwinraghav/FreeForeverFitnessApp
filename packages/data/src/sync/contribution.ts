import type { ExerciseProgressPoint } from '../aggregates.js';
import type { ExerciseId, WorkoutId } from '../common/ids.js';
import type { IsoWeek, LocalDate } from '../common/time.js';
import type { MuscleGroup } from '../schemas/exercise.js';
import { exerciseKey } from '../schemas/exercise.js';
import type { SetEntry, SetLoad, Workout } from '../schemas/workout.js';
import { isWorkingSet } from '../schemas/workout.js';
import { isoWeekOf } from './week.js';

/**
 * Everything the aggregates need from one workout, computed once.
 *
 * The reducers are "replace by document id" folds: this module is the single place
 * that turns a session document into numbers, so that every aggregate agrees on
 * what a set was worth. The sets are the truth — `workout.totals` is a denormalised
 * convenience for rendering and is deliberately not read here, because the whole
 * point of the aggregate layer is to be the thing that repairs `totals` drift, not
 * to inherit it.
 *
 * Conventions, stated once:
 *
 * - Only `status === 'completed'` sessions contribute. An in-progress session is
 *   read live from its own document; a discarded one contributes nothing.
 * - A "working set" is any attempted non-warmup set. Failed sets are real work:
 *   they count toward volume and set counts (`failedSetCount` reports them
 *   separately), and they never feed an e1RM.
 * - Volume is load x reps over attempted working rep sets, doubled for unilateral
 *   exercises, whose one logged set loads each limb separately.
 * - Bodyweight-loaded sets need the session's `bodyweightKg` snapshot. Without it
 *   the honest number is unknown, so the set contributes its added weight only
 *   (or nothing) rather than a guess.
 */

export interface ExerciseFold {
  readonly exerciseKey: string;
  readonly exerciseId: ExerciseId;
  readonly displayName: string;
  readonly point: ExerciseProgressPoint | null;
}

export interface WorkoutFold {
  readonly workoutId: WorkoutId;
  readonly localDate: LocalDate;
  readonly week: IsoWeek;
  readonly durationSec: number;
  readonly workingSetCount: number;
  readonly failedSetCount: number;
  readonly volumeKg: number;
  readonly volumeKgByMuscle: Partial<Record<MuscleGroup, number>>;
  readonly setsByMuscle: Partial<Record<MuscleGroup, number>>;
  readonly exercises: readonly ExerciseFold[];
  /** True when the session was started from a routine. */
  readonly hasProgram: boolean;
  /** Sets that carried a prescription, and how many of those were completed. */
  readonly prescribedSetCount: number;
  readonly completedPrescribedSetCount: number;
}

/** Load actually moved by one set, or null when it is genuinely unknowable. */
export function resolveSetLoadKg(load: SetLoad, bodyweightKg: number | undefined): number | null {
  switch (load.kind) {
    case 'external':
      return load.weightKg;
    case 'bodyweight':
      if (bodyweightKg === undefined) {
        return load.addedWeightKg > 0 ? load.addedWeightKg : null;
      }
      return Math.max(bodyweightKg + load.addedWeightKg, 0);
    case 'assisted':
      return bodyweightKg === undefined ? null : Math.max(bodyweightKg - load.assistanceKg, 0);
    case 'none':
      return bodyweightKg ?? null;
  }
}

function repsOf(set: SetEntry): number | null {
  const effort = set.effort;
  return effort.kind === 'reps' || effort.kind === 'reps_and_duration' ? effort.reps : null;
}

/** Epley estimate. Only defined for a completed working set with load and reps. */
function e1rmOf(loadKg: number, reps: number): number {
  return reps <= 1 ? loadKg : loadKg * (1 + reps / 30);
}

function wasAttempted(set: SetEntry): boolean {
  return set.state === 'completed' || set.state === 'failed';
}

/**
 * Folds one workout, or returns null when the session contributes nothing
 * (not completed). Pure; never throws on data the schema allowed.
 */
export function foldWorkout(workout: Workout): WorkoutFold | null {
  if (workout.status !== 'completed') return null;

  let workingSetCount = 0;
  let failedSetCount = 0;
  let volumeKg = 0;
  let prescribedSetCount = 0;
  let completedPrescribedSetCount = 0;
  const volumeByMuscle: Partial<Record<MuscleGroup, number>> = {};
  const setsByMuscle: Partial<Record<MuscleGroup, number>> = {};
  const exercises: ExerciseFold[] = [];

  for (const exercise of workout.exercises) {
    const limbFactor = exercise.exercise.unilateral ? 2 : 1;
    let bestE1rm: number | null = null;
    let topSetLoadKg = 0;
    let topSetReps = 0;
    let exerciseVolumeKg = 0;
    let exerciseWorkingSets = 0;

    for (const set of exercise.sets) {
      if (set.target !== undefined) {
        prescribedSetCount += 1;
        if (set.state === 'completed') completedPrescribedSetCount += 1;
      }
      if (!wasAttempted(set) || !isWorkingSet(set)) continue;

      workingSetCount += 1;
      exerciseWorkingSets += 1;
      if (set.state === 'failed') failedSetCount += 1;

      for (const { muscle, fraction } of exercise.exercise.muscles) {
        setsByMuscle[muscle] = (setsByMuscle[muscle] ?? 0) + fraction;
      }

      const loadKg = resolveSetLoadKg(set.load, workout.bodyweightKg);
      const reps = repsOf(set);
      if (loadKg === null || reps === null || reps <= 0) continue;

      const setVolume = loadKg * reps * limbFactor;
      volumeKg += setVolume;
      exerciseVolumeKg += setVolume;
      for (const { muscle, fraction } of exercise.exercise.muscles) {
        volumeByMuscle[muscle] = (volumeByMuscle[muscle] ?? 0) + setVolume * fraction;
      }

      // Records and progress read completed sets only; a failed set is fatigue,
      // not evidence of strength.
      if (set.state === 'completed') {
        const e1rm = e1rmOf(loadKg, reps);
        if (bestE1rm === null || e1rm > bestE1rm) bestE1rm = e1rm;
        if (loadKg > topSetLoadKg || (loadKg === topSetLoadKg && reps > topSetReps)) {
          topSetLoadKg = loadKg;
          topSetReps = reps;
        }
      }
    }

    const key = exerciseKey(exercise.exercise);
    const point: ExerciseProgressPoint | null =
      bestE1rm === null
        ? null
        : {
            localDate: workout.localDate,
            workoutId: workout.id,
            e1rmKg: round(bestE1rm),
            topSetLoadKg: round(topSetLoadKg),
            topSetReps,
            totalVolumeKg: round(exerciseVolumeKg),
            workingSetCount: exerciseWorkingSets,
          };
    exercises.push({
      exerciseKey: key,
      exerciseId: exercise.exercise.exerciseId,
      displayName: exercise.exercise.name,
      point,
    });
  }

  const durationSec =
    workout.endedAt === undefined
      ? 0
      : Math.min(Math.max(Math.round((workout.endedAt - workout.startedAt) / 1000), 0), 86_400);

  return {
    workoutId: workout.id,
    localDate: workout.localDate,
    week: isoWeekOf(workout.localDate),
    durationSec,
    workingSetCount,
    failedSetCount,
    volumeKg: round(volumeKg),
    volumeKgByMuscle: roundMap(volumeByMuscle),
    setsByMuscle: roundMap(setsByMuscle),
    exercises,
    hasProgram: workout.programRef !== undefined,
    prescribedSetCount,
    completedPrescribedSetCount,
  };
}

/**
 * Six decimal places — far below anything a chart shows, but enough that the
 * same per-session numbers summed in the same order produce bit-identical state
 * in `reduce` and `rebuild`, which is what the drift check compares.
 */
export function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function roundMap<K extends string>(
  map: Partial<Record<K, number>>,
): Partial<Record<K, number>> {
  const out: Partial<Record<K, number>> = {};
  for (const key of Object.keys(map).sort() as K[]) {
    const value = map[key];
    if (value !== undefined && value !== 0) out[key] = round(value);
  }
  return out;
}
