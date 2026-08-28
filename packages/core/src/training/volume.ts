import { effectiveLoadKg, round4 } from './load.js';
import type { ExerciseShape, LoadContext, PerformedSet } from './types.js';
import { isRecordEligible, isWorking, repsOf } from './types.js';

/**
 * Volume, hard sets, and the session totals that get denormalised onto the workout
 * document.
 *
 * Under ADR-0005 nothing may query Firestore to draw a chart, so a week of volume has
 * to be summable from documents already in the local cache. `workoutTotalsSchema` is
 * that pre-sum, and this module is what produces it. The sets remain the truth; these
 * numbers are a cache, and the aggregate reducer recomputes them if they drift.
 *
 * ## The one judgement call in here, stated openly
 *
 * `setEntrySchema`'s comment says a failed set "is real work and counts toward volume
 * and fatigue". `workoutTotalsSchema.volumeKg` says "Sum of load x reps over
 * **completed** working sets". Those two cannot both be implemented by one number.
 *
 * `sessionTotals` follows the field's own documentation, because that field is a
 * contract with the aggregate reducer and with every chart downstream of it — the
 * cost of disagreeing with it silently is two clients that compute different weekly
 * volumes for the same week. `hardSetCount` and `tonnageKg` are where failed work is
 * counted, and both are separate functions with `includeFailed` on by default. This
 * discrepancy has been reported to the domain-model team rather than resolved here.
 */

export interface VolumeOptions extends LoadContext {
  /**
   * Count attempted-but-failed sets. A missed rep is still fatigue, and a programme
   * that ignores it under-reads a hard week.
   */
  readonly includeFailed?: boolean;
  /** Count warmups. Off by default — they are not the stimulus. */
  readonly includeWarmups?: boolean;
}

/**
 * Kilograms moved by one set: effective load times reps.
 *
 * `null` when the set has no rep count (a plank has no tonnage) or when the load
 * cannot be resolved (a bodyweight set with no recorded bodyweight). Callers sum with
 * `?? 0`; the distinction exists so a *set-level* display can say "—" rather than "0".
 */
export function setVolumeKg(
  set: PerformedSet,
  context: LoadContext = {},
): number | null {
  const reps = repsOf(set.effort);
  if (reps === null) return null;
  const load = effectiveLoadKg(set.load, context);
  if (load === null) return null;
  return round4(load * reps);
}

/** Whether a set should be counted at all, under the given options. */
function counts(set: PerformedSet, options: VolumeOptions): boolean {
  if (!isWorking(set) && options.includeWarmups !== true) return false;
  if (set.state === 'pending') return false;
  if (set.state === 'failed' && options.includeFailed !== true) return false;
  return true;
}

/** Total tonnage across a list of sets. Failed work counts unless told otherwise. */
export function tonnageKg(sets: readonly PerformedSet[], options: VolumeOptions = {}): number {
  const resolved: VolumeOptions = { includeFailed: true, ...options };
  let total = 0;
  for (const set of sets) {
    if (!counts(set, resolved)) continue;
    total += setVolumeKg(set, resolved) ?? 0;
  }
  return round4(total);
}

/**
 * A "hard set": a working set that was actually attempted. The unit most training
 * research and most programmes are written in, and the number a lifter should be
 * steering by far more often than tonnage.
 */
export function hardSetCount(sets: readonly PerformedSet[], options: VolumeOptions = {}): number {
  const resolved: VolumeOptions = { includeFailed: true, ...options };
  return sets.filter((set) => counts(set, resolved)).length;
}

/**
 * Tonnage split across the muscles an exercise trains, by the exercise's own
 * fractions. A bench press is 1.0 chest and 0.5 triceps, not 1.0 of both — otherwise
 * every volume chart double-counts and the number the lifter is steering by is wrong.
 *
 * Unilateral work doubles: `unilateral: true` means left and right were loaded
 * separately, so one logged set of ten is ten each side.
 */
export function volumeKgByMuscle(
  sets: readonly PerformedSet[],
  exercise: ExerciseShape,
  options: VolumeOptions = {},
): Record<string, number> {
  const resolved: VolumeOptions = { includeFailed: true, ...options };
  const limbs = exercise.unilateral ? 2 : 1;
  const byMuscle: Record<string, number> = {};

  for (const set of sets) {
    if (!counts(set, resolved)) continue;
    const volume = setVolumeKg(set, resolved);
    if (volume === null || volume === 0) continue;
    for (const share of exercise.muscles) {
      if (share.fraction <= 0) continue;
      byMuscle[share.muscle] = (byMuscle[share.muscle] ?? 0) + volume * share.fraction * limbs;
    }
  }

  for (const muscle of Object.keys(byMuscle)) {
    byMuscle[muscle] = round4(byMuscle[muscle] as number);
  }
  return byMuscle;
}

/**
 * Hard sets per muscle. A set counts *whole* for every muscle the exercise trains at
 * or above `threshold`, and not at all below it — deliberately not fraction-weighted,
 * because "twelve sets for chest this week" is a count of sets and a programme that
 * reports 9.5 has quietly changed the unit it is prescribing in.
 */
export function hardSetsByMuscle(
  sets: readonly PerformedSet[],
  exercise: ExerciseShape,
  options: VolumeOptions & { readonly threshold?: number } = {},
): Record<string, number> {
  const resolved: VolumeOptions = { includeFailed: true, ...options };
  const threshold = options.threshold ?? 0.5;
  const byMuscle: Record<string, number> = {};

  for (const set of sets) {
    if (!counts(set, resolved)) continue;
    for (const share of exercise.muscles) {
      if (share.fraction < threshold) continue;
      byMuscle[share.muscle] = (byMuscle[share.muscle] ?? 0) + 1;
    }
  }
  return byMuscle;
}

/** One exercise as it appears in a session, for the totals fold. */
export interface SessionExercise {
  readonly exercise: ExerciseShape;
  readonly sets: readonly PerformedSet[];
  /** Overrides the session bodyweight / bar mass for this exercise only. */
  readonly context?: LoadContext;
}

/**
 * The shape of `workoutTotalsSchema`, minus `durationSec` — which is wall clock and
 * not derivable from the sets.
 */
export interface SessionTotals {
  readonly exerciseCount: number;
  readonly setCount: number;
  readonly workingSetCount: number;
  readonly completedSetCount: number;
  readonly failedSetCount: number;
  readonly volumeKg: number;
  readonly volumeKgByMuscle: Record<string, number>;
}

/**
 * Fold a session into the totals denormalised onto its document.
 *
 * Follows `workoutTotalsSchema` exactly, including its "completed working sets" rule
 * for `volumeKg` — see the module comment for why that is not the same choice
 * `tonnageKg` makes.
 */
export function sessionTotals(
  exercises: readonly SessionExercise[],
  context: LoadContext = {},
): SessionTotals {
  let setCount = 0;
  let workingSetCount = 0;
  let completedSetCount = 0;
  let failedSetCount = 0;
  let volume = 0;
  const byMuscle: Record<string, number> = {};

  for (const entry of exercises) {
    const merged: LoadContext = { ...context, ...entry.context };
    for (const set of entry.sets) {
      setCount += 1;
      if (isWorking(set)) workingSetCount += 1;
      if (set.state === 'completed') completedSetCount += 1;
      if (set.state === 'failed') failedSetCount += 1;
      if (!isRecordEligible(set)) continue;

      const setVolume = setVolumeKg(set, merged) ?? 0;
      if (setVolume === 0) continue;
      volume += setVolume;

      const limbs = entry.exercise.unilateral ? 2 : 1;
      for (const share of entry.exercise.muscles) {
        if (share.fraction <= 0) continue;
        byMuscle[share.muscle] = (byMuscle[share.muscle] ?? 0) + setVolume * share.fraction * limbs;
      }
    }
  }

  for (const muscle of Object.keys(byMuscle)) {
    byMuscle[muscle] = round4(byMuscle[muscle] as number);
  }

  return {
    exerciseCount: exercises.length,
    setCount,
    workingSetCount,
    completedSetCount,
    failedSetCount,
    volumeKg: round4(volume),
    volumeKgByMuscle: byMuscle,
  };
}
