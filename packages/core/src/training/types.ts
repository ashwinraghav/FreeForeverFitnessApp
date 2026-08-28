/**
 * The structural shapes `training` computes over.
 *
 * These are deliberately *not* imported from `@freeforever/data`. This package has no
 * dependencies at all (see `src/index.ts`), which is what makes it safe to publish
 * under Apache-2.0, cheap to test, and impossible to accidentally couple to Firebase.
 * Every type below is declared so that the corresponding `@freeforever/data` type is
 * assignable to it structurally — `SetEntry` is a `PerformedSet`, `SetLoad` is a
 * `Load` — so callers pass domain objects straight in with no adapter and no cast.
 *
 * A drift test would need to import `@freeforever/data`, so instead the compiler in
 * `apps/web` catches it: the workout feature passes real `SetEntry` values to these
 * functions, and a shape change on either side fails that build.
 */

/** Mirrors `@freeforever/data`'s `setLoadSchema`. */
export type Load =
  | { readonly kind: 'external'; readonly weightKg: number }
  | { readonly kind: 'bodyweight'; readonly addedWeightKg: number }
  | { readonly kind: 'assisted'; readonly assistanceKg: number }
  | { readonly kind: 'none' };

/** Mirrors `@freeforever/data`'s `setEffortSchema`. */
export type Effort =
  | { readonly kind: 'reps'; readonly reps: number }
  | { readonly kind: 'duration'; readonly durationSec: number }
  | { readonly kind: 'distance'; readonly distanceM: number; readonly durationSec?: number }
  | { readonly kind: 'reps_and_duration'; readonly reps: number; readonly durationSec: number };

/** Mirrors `@freeforever/data`'s `effortRatingSchema`. */
export type EffortRating =
  | { readonly scale: 'rpe'; readonly value: number }
  | { readonly scale: 'rir'; readonly value: number };

export type SetState = 'pending' | 'completed' | 'failed';

export type SetKind =
  | 'warmup'
  | 'working'
  | 'top'
  | 'backoff'
  | 'drop'
  | 'amrap'
  | 'myorep'
  | 'cluster';

/**
 * The part of a logged set this package reads. Structurally satisfied by
 * `@freeforever/data`'s `SetEntry`.
 */
export interface PerformedSet {
  readonly type: SetKind;
  readonly state: SetState;
  readonly load: Load;
  readonly effort: Effort;
  readonly effortRating?: EffortRating | undefined;
}

/** Fractional contribution of an exercise to one muscle group. */
export interface MuscleShare {
  readonly muscle: string;
  readonly fraction: number;
}

/**
 * The part of an exercise reference this package reads. Structurally satisfied by
 * `@freeforever/data`'s `ExerciseRef`.
 */
export interface ExerciseShape {
  readonly muscles: readonly MuscleShare[];
  readonly unilateral: boolean;
}

/**
 * Everything needed to turn a {@link Load} union into one number of kilograms.
 *
 * `implementMassKg` follows `exerciseBodySchema.implementMassKg` exactly: it is the
 * mass of the *empty* implement, present only when the user logs the plates rather
 * than the total. Absent means the logged number is already the whole load. Getting
 * this backwards silently adds or drops 20kg from every barbell chart, so the field
 * is required-or-explicitly-absent here rather than defaulted.
 */
export interface LoadContext {
  /** The lifter's bodyweight at the time of the session, kg. */
  readonly bodyweightKg?: number | undefined;
  /** Empty bar / carriage / handle mass, kg. See above. */
  readonly implementMassKg?: number | undefined;
}

/** A warmup is a type, never a flag beside one — mirrors `isWarmupSet` in the schema. */
export function isWarmup(set: Pick<PerformedSet, 'type'>): boolean {
  return set.type === 'warmup';
}

/** A set that counts toward volume, fatigue and progression. Warmups do not. */
export function isWorking(set: Pick<PerformedSet, 'type'>): boolean {
  return set.type !== 'warmup';
}

/** A set that was actually attempted. Pending sets are prescriptions, not evidence. */
export function isAttempted(set: Pick<PerformedSet, 'state'>): boolean {
  return set.state !== 'pending';
}

/** A set that may set a record. A failed set never does, however heavy. */
export function isRecordEligible(set: Pick<PerformedSet, 'type' | 'state'>): boolean {
  return set.state === 'completed' && isWorking(set);
}

/** Reps this set counted, or `null` when the set is not measured in reps. */
export function repsOf(effort: Effort): number | null {
  return effort.kind === 'reps' || effort.kind === 'reps_and_duration' ? effort.reps : null;
}

/** Seconds this set held, or `null` when the set is not measured in time. */
export function durationOf(effort: Effort): number | null {
  if (effort.kind === 'duration' || effort.kind === 'reps_and_duration') return effort.durationSec;
  if (effort.kind === 'distance') return effort.durationSec ?? null;
  return null;
}

/** Metres this set covered, or `null` when the set is not measured in distance. */
export function distanceOf(effort: Effort): number | null {
  return effort.kind === 'distance' ? effort.distanceM : null;
}

/**
 * Reps in reserve, on the one scale that composes. RPE and RIR are stored on the
 * scale the user entered (a lifter who logs RIR must see RIR back), so every rule
 * that compares them converts here rather than inventing its own table.
 */
export function repsInReserve(rating: EffortRating): number {
  return rating.scale === 'rir' ? rating.value : 10 - rating.value;
}

/** The same conversion in the other direction. */
export function ratingOfPerceivedExertion(rating: EffortRating): number {
  return rating.scale === 'rpe' ? rating.value : 10 - rating.value;
}
